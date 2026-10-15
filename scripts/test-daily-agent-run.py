#!/usr/bin/env python3
"""Offline supervisor regressions; only create/signal our own isolated processes."""
import contextlib
import errno
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('daily_agent_run', ROOT / 'scripts/daily-agent-run.py')
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


def stat_bytes(pid=123, pgid=b'77', start=b'456', state=b'S', comm=b'normal'):
    fields = [state] + [b'0'] * 49
    fields[2], fields[19] = pgid, start
    return str(pid).encode() + b' (' + comm + b') ' + b' '.join(fields) + b'\n'


def entries(*pids):
    return contextlib.nullcontext([SimpleNamespace(name=str(pid)) for pid in pids])


class Clock:
    now = 10.0

    def sleep(self, seconds):
        self.now += seconds


class StatTests(unittest.TestCase):
    def test_binary_comm(self):
        for comm in (b'normal', '中文进程'.encode(), b'bad\xff\xfe', b'a b c',
                     b'(left) right))(', b'line\n) two\n(end)'):
            with self.subTest(comm=comm), patch('builtins.open', return_value=io.BytesIO(stat_bytes(comm=comm))) as opened:
                self.assertEqual(runner.read_stat(123), runner.ProcStat(123, b'S', 77, 456))
                opened.assert_called_once_with('/proc/123/stat', 'rb')

    def test_invalid_stat_is_unknown_not_exited(self):
        cases = [b'', b'123 (truncated) S 1 77', b'123 no-parentheses',
                 stat_bytes(pid=999), stat_bytes(state=b'QQ'), stat_bytes(pgid=b'NaN'),
                 stat_bytes(pgid=b'-1'), stat_bytes(pgid=b'7_7'), stat_bytes(start=b'NaN'),
                 stat_bytes(start=b'-1'), stat_bytes(start=b'+1')]
        for data in cases:
            with self.subTest(data=data[:30]), patch('builtins.open', return_value=io.BytesIO(data)):
                with self.assertRaises(runner.InspectionError) as error:
                    runner.read_stat(123)
                self.assertEqual(error.exception.operation, 'parse-stat')
                self.assertIsInstance(error.exception.cause, ValueError)

    def test_only_disappearance_errno_is_absent(self):
        for code in (errno.ENOENT, errno.ESRCH, errno.EACCES, errno.EPERM,
                     errno.EIO, errno.EINTR, errno.ENOTDIR, errno.EINVAL):
            with self.subTest(errno=code), patch('builtins.open', side_effect=OSError(code, 'fixture')):
                if code in (errno.ENOENT, errno.ESRCH):
                    self.assertIsNone(runner.read_stat(123))
                else:
                    with self.assertRaises(runner.InspectionError) as error:
                        runner.read_stat(123)
                    self.assertEqual(error.exception.cause.errno, code)

    def test_exited_between_enumeration_and_read(self):
        with patch.object(runner.os, 'scandir', return_value=entries(123)), \
             patch('builtins.open', side_effect=FileNotFoundError(errno.ENOENT, 'gone')):
            self.assertEqual(runner.members(77), [])

    def test_malformed_unrelated_stat_is_unknown_not_an_empty_group(self):
        with patch.object(runner.os, 'scandir', return_value=entries(123)), \
             patch('builtins.open', return_value=io.BytesIO(stat_bytes(pgid=b'88', start=b'bad'))), \
             self.assertRaises(runner.InspectionError):
            runner.members(77)

    def test_live_zombie_and_exit_semantics(self):
        stats = [runner.ProcStat(1, b'R', 77, 1), runner.ProcStat(2, b'Z', 77, 2),
                 runner.ProcStat(3, b'X', 77, 3), runner.ProcStat(4, b'S', 88, 4)]
        with patch.object(runner.os, 'scandir', return_value=entries(1, 2, 3, 4)), \
             patch.object(runner, 'read_stat', side_effect=stats):
            self.assertEqual(runner.members(77), [1])


class InspectionTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.enterContext(patch.object(runner.time, 'monotonic', side_effect=lambda: self.clock.now))
        self.enterContext(patch.object(runner.time, 'sleep', side_effect=self.clock.sleep))
        self.stderr = self.enterContext(contextlib.redirect_stderr(io.StringIO()))

    def failure(self, code=errno.EIO):
        return runner.InspectionError('read-stat', 123, OSError(code, 'do not log raw data'))

    def test_transient_failure_restarts_complete_scan(self):
        # The first partial scan saw 101; it must NOT leak into the successful second scan.
        with patch.object(runner.os, 'scandir', side_effect=lambda _: entries(101, 102)), \
             patch.object(runner, 'read_stat', side_effect=[runner.ProcStat(101, b'S', 77, 1),
                                                          self.failure(), None,
                                                          runner.ProcStat(102, b'S', 77, 2)]) as read:
            inspector = runner.Inspector()
            self.assertEqual(inspector.run(lambda: runner.members(77), 'test', 20), [102])
        self.assertEqual([call.args[0] for call in read.call_args_list], [101, 102, 101, 102])
        self.assertEqual(inspector.errors, [])
        self.assertEqual(self.stderr.getvalue(), '')  # no normal/recovered scan spam

    def test_transient_truncated_stat_recovers_with_valid_full_scan(self):
        with patch.object(runner.os, 'scandir', side_effect=lambda _: entries(123)), \
             patch('builtins.open', side_effect=[io.BytesIO(b'123 (cut) S'), io.BytesIO(stat_bytes())]):
            inspector = runner.Inspector()
            self.assertEqual(inspector.run(lambda: runner.members(77), 'monitor', 20), [123])
        self.assertEqual(inspector.errors, [])

    def test_persistent_read_and_parse_errors_are_unknown(self):
        for failure in (self.failure(errno.EACCES), self.failure(errno.EPERM), self.failure(),
                        runner.InspectionError('parse-stat', 123, ValueError('raw comm must not leak'))):
            with self.subTest(error=type(failure.cause).__name__), \
                 patch.object(runner, 'members', side_effect=failure) as scan:
                before = self.clock.now
                inspector = runner.Inspector()
                with self.assertRaises(runner.InspectionError):
                    inspector.run(lambda: runner.members(77), 'monitor', self.clock.now + 10)
                self.assertEqual(scan.call_count, 4)
                self.assertLessEqual(self.clock.now - before, 1)
                self.assertEqual(inspector.errors, [{'phase': 'monitor', 'operation': failure.operation,
                    'pid': 123, 'exceptionType': type(failure.cause).__name__,
                    'errno': getattr(failure.cause, 'errno', None), 'retryCount': 3}])
        self.assertNotIn('raw comm', self.stderr.getvalue())
        self.assertNotIn('do not log', self.stderr.getvalue())

    def test_enumeration_failure_is_unknown(self):
        def interrupted_entries():
            yield SimpleNamespace(name='123')
            raise OSError(errno.EIO, 'fixture')
        for source in (Mock(side_effect=PermissionError(errno.EACCES, 'fixture')),
                       Mock(side_effect=lambda _: contextlib.nullcontext(interrupted_entries()))):
            with self.subTest(source=source), patch.object(runner.os, 'scandir', source), \
                 patch.object(runner, 'read_stat', return_value=runner.ProcStat(123, b'S', 77, 1)):
                with self.assertRaises(runner.InspectionError) as error:
                    runner.members(77)
                self.assertEqual(error.exception.operation, 'scan-proc')
                self.assertIsNone(error.exception.pid)

    def test_retry_obeys_deadline(self):
        scan = Mock(side_effect=self.failure())
        inspector = runner.Inspector()
        with self.assertRaises(runner.InspectionError):
            inspector.run(scan, 'monitor', self.clock.now + 0.08)
        self.assertEqual(scan.call_count, 2)
        self.assertLess(self.clock.now, 10.08)
        self.assertEqual(inspector.errors[0]['retryCount'], 1)

    def test_oversleep_does_not_start_late_retry(self):
        def oversleep(_):
            self.clock.now += 1
        scan = Mock(side_effect=self.failure())
        with patch.object(runner.time, 'sleep', side_effect=oversleep), \
             self.assertRaises(runner.InspectionError):
            runner.Inspector().run(scan, 'monitor', self.clock.now + 0.1)
        self.assertEqual(scan.call_count, 1)

    def test_signal_stops_retries(self):
        for sig in ('SIGTERM', 'SIGINT'):
            with self.subTest(signal=sig):
                interrupted = []
                scan = Mock(side_effect=self.failure())
                inspector = runner.Inspector(lambda: bool(interrupted))
                with patch.object(runner.time, 'sleep', side_effect=lambda _: interrupted.append(sig)), \
                     self.assertRaises(runner.InspectionError):
                    inspector.run(scan, 'monitor', self.clock.now + 10)
                self.assertEqual(scan.call_count, 1)
                self.assertEqual(interrupted, [sig])
                self.assertEqual(inspector.errors[0]['retryCount'], 0)


class SupervisorTests(unittest.TestCase):
    def setUp(self):
        (ROOT / '.pi-tmp').mkdir(exist_ok=True)
        self.directory = Path(self.enterContext(tempfile.TemporaryDirectory(dir=ROOT / '.pi-tmp')))
        self.result = self.directory / 'agent-result.json'
        self.clock = Clock()
        self.enterContext(patch.object(runner.time, 'monotonic', side_effect=lambda: self.clock.now))
        self.enterContext(patch.object(runner.time, 'sleep', side_effect=self.clock.sleep))
        self.enterContext(patch.object(runner.signal, 'signal'))
        self.enterContext(patch.object(sys, 'argv', ['runner', 'mock-prompt', str(self.directory / 'out'), str(self.result), '10']))
        self.enterContext(patch.dict(os.environ, {'AGENT_TERM_GRACE_SECONDS': '1',
                                                'AGENT_DRAIN_SECONDS': '1', 'AGENT_KILL_WAIT_SECONDS': '1'}))
        self.enterContext(patch.object(runner.os, 'getpgrp', return_value=999))
        self.kill = self.enterContext(patch.object(runner.os, 'killpg'))
        self.enterContext(patch.object(runner.subprocess, 'Popen', return_value=Mock(pid=400, returncode=0, poll=Mock(return_value=0))))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.stderr = self.enterContext(contextlib.redirect_stderr(io.StringIO()))

    def test_persistent_unknown_never_confirms_writer_or_signals(self):
        with patch.object(runner, 'read_stat', return_value=runner.ProcStat(400, b'S', 400, 456)), \
             patch.object(runner, 'members', side_effect=runner.InspectionError('read-stat', 123, PermissionError(errno.EACCES, 'fixture'))):
            self.assertEqual(runner.main(), 125)
        record = json.loads(self.result.read_text())
        self.assertFalse(record['writerStopped'])
        self.assertIsNone(record['remainingPids'])
        self.assertEqual(record['reason'], 'inspection-failed')
        self.assertEqual({item['phase'] for item in record['inspectionErrors']},
                         {'monitor', 'before-SIGTERM', 'confirm-stopped'})
        self.assertIn('"pid": 123', self.stderr.getvalue())
        self.kill.assert_not_called()

    def test_unknown_final_scan_never_confirms_stopped(self):
        failure = runner.InspectionError('parse-stat', 123, ValueError('fixture'))
        with patch.object(runner, 'read_stat', return_value=runner.ProcStat(400, b'S', 400, 456)), \
             patch.object(runner, 'members', side_effect=[[]] + [failure] * 4):
            self.assertEqual(runner.main(), 125)
        record = json.loads(self.result.read_text())
        self.assertFalse(record['writerStopped'])
        self.assertIsNone(record['remainingPids'])
        self.assertEqual(record['reason'], 'inspection-failed')
        self.kill.assert_not_called()

    def test_initial_identity_failure_leaves_no_stop_claim(self):
        with patch.object(runner, 'read_stat', side_effect=runner.InspectionError('parse-stat', 400, ValueError('fixture'))), \
             self.assertRaises(runner.InspectionError):
            runner.main()
        self.assertFalse(self.result.exists())  # wrapper treats absent result as UNKNOWN
        self.assertIn('record-identity', self.stderr.getvalue())
        self.kill.assert_not_called()

    def test_reused_pid_or_changed_pgid_never_signalled(self):
        for leader in (runner.ProcStat(400, b'S', 400, 999), runner.ProcStat(400, b'S', 888, 456)):
            with self.subTest(leader=leader), \
                 patch.object(runner, 'read_stat', side_effect=[runner.ProcStat(400, b'S', 400, 456)] + [leader] * 4), \
                 patch.object(runner, 'members', return_value=[400]):
                self.assertEqual(runner.main(), 125)
                record = json.loads(self.result.read_text())
                self.assertFalse(record['writerStopped'])
                self.assertEqual(record['inspectionErrors'][0]['operation'], 'verify-identity')
                self.assertEqual(record['inspectionErrors'][0]['exceptionType'], 'IdentityMismatch')
        self.kill.assert_not_called()

    def test_identity_checked_again_before_kill(self):
        identity = runner.ProcStat(400, b'S', 400, 456)
        reused = runner.ProcStat(400, b'S', 400, 999)
        with patch.object(runner, 'read_stat', side_effect=[identity, identity] + [reused] * 4), \
             patch.object(runner, 'members', return_value=[400]):
            self.assertEqual(runner.main(), 125)
        self.kill.assert_called_once_with(400, signal.SIGTERM)
        record = json.loads(self.result.read_text())
        self.assertFalse(record['writerStopped'])
        self.assertEqual(record['inspectionErrors'][0]['phase'], 'before-SIGKILL')

    def test_missing_leader_with_live_descendant_can_be_signalled(self):
        # Leader already reaped; surviving original members keep the PGID reserved.
        with patch.object(runner, 'members', return_value=[401]), \
             patch.object(runner, 'read_stat', return_value=None):
            self.assertEqual(runner.owned_members(400, 456), [401])

    def test_parent_group_rejected_even_with_matching_starttime(self):
        with patch.object(runner, 'members', return_value=[999]), \
             patch.object(runner, 'read_stat', return_value=runner.ProcStat(999, b'S', 999, 456)), \
             self.assertRaises(runner.InspectionError):
            runner.owned_members(999, 456)
        self.kill.assert_not_called()

    def test_check_reuses_binary_parser_and_requires_complete_scan(self):
        (self.directory / 'agent-group.json').write_text(json.dumps({'pgid': 400, 'startTime': '456'}))
        def opened(path, *args, **kwargs):
            if str(path) == '/proc/400/stat':
                return io.BytesIO(stat_bytes(400, b'400', comm=b'\xff\n( )'))
            return real_open(path, *args, **kwargs)
        real_open = open
        with patch('builtins.open', side_effect=opened), \
             patch.object(runner.os, 'scandir', side_effect=lambda _: entries(400)):
            self.assertEqual(runner.check(str(self.directory), runner.Inspector()), 1)
        with patch.object(runner, 'members', return_value=[]), \
             patch.object(runner, 'read_stat', return_value=None):
            self.assertEqual(runner.check(str(self.directory), runner.Inspector()), 0)
        with patch.object(runner, 'members', return_value=[400]), \
             patch.object(runner, 'read_stat', return_value=runner.ProcStat(400, b'S', 400, 999)):
            self.assertEqual(runner.check(str(self.directory), runner.Inspector()), 0)
        # Even evidence of a reused leader cannot turn an incomplete scan into success.
        with patch.object(runner, 'members', side_effect=runner.InspectionError('read-stat', 123, OSError(errno.EIO, 'fixture'))), \
             patch.object(runner, 'read_stat', return_value=runner.ProcStat(400, b'S', 400, 999)):
            self.assertEqual(runner.check(str(self.directory), runner.Inspector()), 1)
        self.kill.assert_not_called()

    def test_check_missing_or_invalid_identity_fails_closed_with_diagnostic(self):
        group_file = self.directory / 'agent-group.json'
        for data in (None, '{', '{"pgid":400,"startTime":true}'):
            with self.subTest(data=data):
                if data is not None:
                    group_file.write_text(data)
                inspector = runner.Inspector()
                self.assertEqual(runner.check(str(self.directory), inspector), 1)
                self.assertEqual(inspector.errors[0]['phase'], 'check')
                self.assertEqual(inspector.errors[0]['operation'], 'read-group-identity')
                self.assertEqual(inspector.errors[0]['retryCount'], 0)

    def test_check_corrupt_leader_is_unknown_even_if_members_empty(self):
        (self.directory / 'agent-group.json').write_text(json.dumps({'pgid': 400, 'startTime': '456'}))
        with patch.object(runner, 'members', return_value=[]), \
             patch.object(runner, 'read_stat', side_effect=runner.InspectionError('parse-stat', 400, ValueError('fixture'))):
            self.assertEqual(runner.check(str(self.directory), runner.Inspector()), 1)
        self.assertIn('"phase": "check"', self.stderr.getvalue())


@unittest.skipUnless(sys.platform == 'linux', 'requires Linux /proc and prctl')
class LinuxIntegrationTests(unittest.TestCase):
    def process(self, comm):
        code = '''import ctypes, sys, time
name = bytes.fromhex(sys.argv[1])
if ctypes.CDLL(None, use_errno=True).prctl(15, ctypes.c_char_p(name), 0, 0, 0):
    raise OSError(ctypes.get_errno(), 'prctl')
print('ready', flush=True)
time.sleep(30)
'''
        proc = subprocess.Popen([sys.executable, '-c', code, comm.hex()], start_new_session=True,
                                stdout=subprocess.PIPE, text=True)

        def cleanup():
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=5)
            proc.stdout.close()

        self.addCleanup(cleanup)
        self.assertEqual(proc.stdout.readline().strip(), 'ready')
        return proc

    def test_unrelated_unicode_comm_does_not_break_members(self):
        target = self.process(b'test-target')
        unrelated = self.process('无关进程'.encode())
        self.assertNotEqual(os.getpgid(unrelated.pid), target.pid)
        active = runner.members(target.pid)
        self.assertIsNotNone(active)
        self.assertIn(target.pid, active)

    def test_real_non_utf8_parentheses_and_newline_comm(self):
        target = self.process(b'bad\xff( )\nname')
        self.assertIn(target.pid, runner.members(target.pid))
        self.assertEqual(runner.read_stat(target.pid).pgid, target.pid)

    def test_supervised_mock_task_with_unrelated_unicode_process(self):
        self.process('无关进程'.encode())
        (ROOT / '.pi-tmp').mkdir(exist_ok=True)
        directory = Path(self.enterContext(tempfile.TemporaryDirectory(dir=ROOT / '.pi-tmp')))
        shutil.copyfile(ROOT / 'scripts/daily-agent-run.py', directory / 'daily-agent-run.py')
        (directory / 'daily-agent.sh').write_text('#!/usr/bin/env bash\nexec sleep .3\n')
        (directory / 'prompt').write_text('offline mock, no model')
        proc = subprocess.Popen([sys.executable, str(directory / 'daily-agent-run.py'),
                                 str(directory / 'prompt'), str(directory / 'out'),
                                 str(directory / 'agent-result.json'), '5'],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)

        def cleanup():
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=5)
            proc.stdout.close()
            proc.stderr.close()
            group_file = directory / 'agent-group.json'
            if group_file.exists():
                group = json.loads(group_file.read_text())
                stat = runner.read_stat(group['pgid'])
                if stat is not None and stat.pgid == group['pgid'] and str(stat.start_time) == group['startTime']:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(group['pgid'], signal.SIGKILL)

        self.addCleanup(cleanup)
        stdout, stderr = proc.communicate(timeout=10)
        self.assertEqual(proc.returncode, 0, (stdout, stderr))
        result = json.loads((directory / 'agent-result.json').read_text())
        self.assertEqual(result['reason'], 'exit')
        self.assertTrue(result['writerStopped'])
        self.assertEqual(result['remainingPids'], [])
        self.assertNotIn('inspectionErrors', result)


if __name__ == '__main__':
    unittest.main()
