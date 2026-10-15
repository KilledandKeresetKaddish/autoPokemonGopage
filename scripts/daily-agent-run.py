#!/usr/bin/env python3
"""Supervise only this invocation's isolated POSIX process group (Linux /proc)."""
import errno
import json
import os
import signal
import subprocess
import sys
import time
from typing import NamedTuple


class ProcStat(NamedTuple):
    pid: int
    state: bytes
    pgid: int
    start_time: int


def parse_stat(data, pid):
    """comm is arbitrary bytes, including spaces, ')' and newlines; never decode it."""
    head, separator, _ = data.partition(b' (')
    end = data.rfind(b')')
    if not separator or end < len(head) + 2 or data[end + 1:end + 2] != b' ':
        raise ValueError('invalid stat framing')
    fields = data[end + 2:].split()  # field 3 onwards, NOT the comm field
    if len(fields) < 20 or fields[0] not in (
            b'R', b'S', b'D', b'Z', b'T', b't', b'X', b'x', b'K', b'W', b'P', b'I'):
        raise ValueError('missing stat fields or invalid state')
    numbers = (head, fields[2], fields[19])  # pid, pgrp (5), starttime (22)
    if not all(value.isdigit() for value in numbers):
        raise ValueError('invalid pid/pgrp/starttime')
    parsed_pid, pgid, start_time = map(int, numbers)
    if parsed_pid != pid or parsed_pid <= 0:
        raise ValueError('stat pid mismatch')
    return ProcStat(parsed_pid, fields[0], pgid, start_time)


class InspectionError(Exception):
    def __init__(self, operation, pid, cause):
        super().__init__(operation)
        self.operation, self.pid, self.cause = operation, pid, cause


class IdentityMismatch(ValueError):
    pass


def read_stat(pid):
    try:
        with open(f'/proc/{pid}/stat', 'rb') as stream:
            data = stream.read()
    except OSError as exc:
        if exc.errno in (errno.ENOENT, errno.ESRCH):
            return None  # exited between enumeration and inspection
        raise InspectionError('read-stat', pid, exc) from exc
    try:
        return parse_stat(data, pid)
    except ValueError as exc:
        raise InspectionError('parse-stat', pid, exc) from exc


def members(pgid):
    """Complete scan: nonempty = live, [] = stopped; InspectionError = UNKNOWN."""
    found = []
    try:
        with os.scandir('/proc') as entries:
            for entry in entries:
                if not entry.name.isdecimal():
                    continue
                stat = read_stat(int(entry.name))
                if stat is not None and stat.pgid == pgid and stat.state not in (b'Z', b'X'):
                    found.append(stat.pid)
    except OSError as exc:
        raise InspectionError('scan-proc', None, exc) from exc
    return found


def owned_members(pgid, start_time):
    """Only the recorded isolated group may be signalled; never a reused leader."""
    active = members(pgid)
    leader = read_stat(pgid)
    if pgid <= 1 or pgid == os.getpgrp() or (leader is not None and
            (leader.pgid != pgid or leader.start_time != start_time)):
        raise InspectionError('verify-identity', pgid, IdentityMismatch())
    # A reaped leader is safe only with surviving original group members:
    # the kernel cannot reuse their PGID while they remain in that group.
    return active


class Inspector:
    def __init__(self, interrupted=lambda: False):
        self.interrupted = interrupted
        self.errors = []

    def report(self, error, phase, retries):
        # Never include comm, command line, environment, prompt, or raw stat bytes.
        detail = {'phase': phase, 'operation': error.operation, 'pid': error.pid,
                  'exceptionType': type(error.cause).__name__,
                  'errno': getattr(error.cause, 'errno', None), 'retryCount': retries}
        self.errors.append(detail)
        print('agent supervisor: inspection failed ' + json.dumps(detail), file=sys.stderr, flush=True)

    def run(self, action, phase, deadline=float('inf')):
        # Restart the WHOLE action, never merge partial scans. At most 3 short
        # retries (150ms total wait), charged to the caller's existing deadline.
        retries = 0
        while True:
            try:
                return action()
            except InspectionError as exc:
                if retries < 3 and not self.interrupted() and time.monotonic() + 0.05 < deadline:
                    time.sleep(0.05)  # signal handler runs; at most 50ms before rechecking
                    if not self.interrupted() and time.monotonic() < deadline:
                        retries += 1
                        continue
                self.report(exc, phase, retries)
                raise


def check(directory, inspector):
    try:
        with open(os.path.join(directory, 'agent-group.json'), encoding='utf-8') as stream:
            group = json.load(stream)
        pgid, raw_start = group['pgid'], group['startTime']
        if (type(pgid) is not int or pgid <= 1 or not isinstance(raw_start, str)
                or not raw_start.isascii() or not raw_start.isdecimal()):
            raise ValueError('invalid group identity')
        start_time = int(raw_start)
        # Scan + identity must BOTH succeed; reuse is not proof over a failed scan.
        def status():
            return members(pgid), read_stat(pgid)
        active, leader = inspector.run(status, 'check', time.monotonic() + 1)
        if inspector.interrupted():
            return 1
        if leader is not None and leader.start_time != start_time:
            print(f'previous run {directory}: original group ID reused; inspect tree/snapshot')
            return 0
        if active:
            print(f'previous run {directory}: agent group {pgid} may still be writing; stop/inspect manually', file=sys.stderr)
            return 1
    except InspectionError:
        print(f'previous run {directory}: group status unknown; inspect manually', file=sys.stderr)
        return 1
    except (OSError, KeyError, ValueError, TypeError) as exc:
        inspector.report(InspectionError('read-group-identity', None, exc), 'check', 0)
        print(f'previous run {directory}: group identity unavailable; verify no writer manually', file=sys.stderr)
        return 1
    print(f'previous run {directory}: writer group stopped; inspect tree/snapshot (no automatic cleanup)')
    return 0


def main():
    interrupted = None

    def handle(sig, _frame):
        nonlocal interrupted
        interrupted = signal.Signals(sig).name

    signal.signal(signal.SIGTERM, handle)
    signal.signal(signal.SIGINT, handle)
    inspector = Inspector(lambda: interrupted)
    if len(sys.argv) == 3 and sys.argv[1] == 'check':
        return check(sys.argv[2], inspector)
    if len(sys.argv) != 5:
        sys.exit('usage: daily-agent-run.py PROMPT OUTPUT RESULT TIMEOUT')
    prompt, output, result, raw_timeout = sys.argv[1:]
    timeout = int(raw_timeout)
    grace = int(os.environ.get('AGENT_TERM_GRACE_SECONDS', '10'))
    drain = int(os.environ.get('AGENT_DRAIN_SECONDS', '10'))
    kill_wait = int(os.environ.get('AGENT_KILL_WAIT_SECONDS', '5'))
    started = time.monotonic()
    deadline = started + timeout
    # With start_new_session, pgid == PID; never send signals to our parent's group.
    with open(output, 'wb') as stream:
        child = subprocess.Popen(['bash', os.path.join(os.path.dirname(__file__), 'daily-agent.sh'), prompt],
                                 stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        pgid = child.pid
        def initial_identity():
            identity = read_stat(pgid)
            if identity is None or identity.pgid != pgid or pgid <= 1 or os.getpgrp() == pgid:
                raise InspectionError('verify-identity', pgid, IdentityMismatch())
            return identity
        identity = inspector.run(initial_identity, 'record-identity', deadline)
        start_time = identity.start_time
        group_file = os.path.join(os.path.dirname(result), 'agent-group.json')
        with open(group_file + '.tmp', 'w', encoding='utf-8') as out:
            json.dump({'pgid': pgid, 'startTime': str(start_time)}, out)
        os.replace(group_file + '.tmp', group_file)
        print(f'agent supervisor: pid/pgid={pgid} total deadline={timeout}s (protective ceiling, not target)', flush=True)
        reason = None
        drained_at = None
        while True:
            try:
                active = inspector.run(lambda: members(pgid), 'monitor', deadline)
            except InspectionError:
                reason = interrupted or ('timeout' if time.monotonic() >= deadline else 'inspection-failed')
                break
            if interrupted:
                reason = interrupted
                break
            if time.monotonic() >= deadline:
                reason = 'timeout'
                break
            if child.poll() is not None:
                if not active:
                    break
                if drained_at is None:
                    drained_at = time.monotonic()
                if time.monotonic() - drained_at >= drain:
                    reason = 'lingering-writer'
                    break
            time.sleep(0.1)

        if reason:
            for sig, wait_seconds in ((signal.SIGTERM, grace), (signal.SIGKILL, kill_wait)):
                limit = time.monotonic() + wait_seconds
                phase = f'before-{signal.Signals(sig).name}'
                try:
                    active = inspector.run(lambda: owned_members(pgid, start_time), phase, limit)
                except InspectionError:
                    break  # unknown ownership/membership is never permission to signal
                if not active:
                    break
                try:
                    os.killpg(pgid, sig)
                except OSError as exc:
                    if exc.errno != errno.ESRCH:
                        inspector.report(InspectionError('signal-group', pgid, exc), phase, 0)
                        break
                while time.monotonic() < limit:
                    try:
                        active = inspector.run(lambda: members(pgid), f'wait-{signal.Signals(sig).name}', limit)
                    except InspectionError:
                        active = None
                        break
                    if not active:
                        break
                    time.sleep(0.1)
                if active == []:
                    break
        child.poll()
        try:
            active = inspector.run(lambda: members(pgid), 'confirm-stopped', deadline)
        except InspectionError:
            active = None
            reason = reason or 'inspection-failed'
        stopped = active == []  # UNKNOWN (None) must never authorize rollback/publication
        rc = child.returncode if child.returncode is not None else None
    record = {'agentExitCode': rc, 'reason': reason or ('exit' if rc is not None else 'unknown'),
              'signal': interrupted, 'timedOut': reason == 'timeout', 'writerStopped': stopped,
              'remainingPids': active, 'pgid': pgid, 'elapsedSeconds': round(time.monotonic() - started, 3)}
    if inspector.errors:
        record['inspectionErrors'] = inspector.errors
    stage = result + '.tmp'
    with open(stage, 'w', encoding='utf-8') as out:
        json.dump(record, out)
    os.replace(stage, result)
    print('agent supervisor: ' + json.dumps(record), flush=True)
    if not stopped:
        return 125
    if reason == 'timeout':
        return 124
    if interrupted:
        return 130 if interrupted == 'SIGINT' else 143
    if reason:
        return 125
    return rc if rc is not None and rc > 0 else (1 if rc else 0)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        # Missing result is an unconfirmed writer; wrapper must preserve the tree.
        print(f'agent supervisor: FAILED ({exc}); writer status unconfirmed', file=sys.stderr)
        sys.exit(125)
