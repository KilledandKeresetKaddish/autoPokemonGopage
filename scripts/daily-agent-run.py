#!/usr/bin/env python3
"""Supervise only this invocation's isolated POSIX process group (Linux /proc)."""
import json
import os
import signal
import subprocess
import sys
import time


def members(pgid):
    """None means inspection failed; never infer termination from an unreadable /proc."""
    try:
        found = []
        for entry in os.scandir('/proc'):
            if not entry.name.isdecimal():
                continue
            try:
                text = open(f'{entry.path}/stat', encoding='ascii').read()
                fields = text[text.rfind(')') + 2:].split()
                if int(fields[2]) == pgid and fields[0] not in ('Z', 'X'):
                    found.append(int(entry.name))
            except FileNotFoundError:
                continue  # exited between enumeration and inspection
            except (OSError, ValueError, IndexError):
                return None
        return found
    except OSError:
        return None


def main():
    if len(sys.argv) == 3 and sys.argv[1] == 'check':
        directory = sys.argv[2]
        try:
            group = json.load(open(os.path.join(directory, 'agent-group.json'), encoding='utf-8'))
            pgid = group['pgid']
            active = members(pgid)
            try:
                stat = open(f'/proc/{pgid}/stat', encoding='ascii').read()
                start = stat[stat.rfind(')') + 2:].split()[19]
                if start != group['startTime']:
                    print(f'previous run {directory}: original group ID reused; inspect tree/snapshot')
                    return 0
            except FileNotFoundError:
                pass  # group leader reaped; other group members may still live
            if active is None or active:
                print(f'previous run {directory}: agent group {pgid} may still be writing; stop/inspect manually', file=sys.stderr)
                return 1
        except FileNotFoundError:
            if not os.path.exists(os.path.join(directory, 'agent-group.json')):
                print(f'previous run {directory}: no group identity recorded; verify no writer and resolve manually', file=sys.stderr)
                return 1
        except (OSError, KeyError, ValueError, IndexError) as exc:
            print(f'previous run {directory}: group status unknown ({exc}); inspect manually', file=sys.stderr)
            return 1
        print(f'previous run {directory}: writer group stopped; inspect tree/snapshot (no automatic cleanup)')
        return 0
    if len(sys.argv) != 5:
        sys.exit('usage: daily-agent-run.py PROMPT OUTPUT RESULT TIMEOUT')
    prompt, output, result, raw_timeout = sys.argv[1:]
    timeout = int(raw_timeout)
    grace = int(os.environ.get('AGENT_TERM_GRACE_SECONDS', '10'))
    drain = int(os.environ.get('AGENT_DRAIN_SECONDS', '10'))
    kill_wait = int(os.environ.get('AGENT_KILL_WAIT_SECONDS', '5'))
    interrupted = None

    def handle(sig, _frame):
        nonlocal interrupted
        interrupted = signal.Signals(sig).name

    signal.signal(signal.SIGTERM, handle)
    signal.signal(signal.SIGINT, handle)
    started = time.monotonic()
    # With start_new_session, pgid == PID; never send signals to our parent's group.
    with open(output, 'wb') as stream:
        child = subprocess.Popen(['bash', os.path.join(os.path.dirname(__file__), 'daily-agent.sh'), prompt],
                                 stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        pgid = child.pid
        if os.getpgid(pgid) != pgid or os.getpgrp() == pgid:
            raise RuntimeError('agent did not acquire an isolated process group')
        stat = open(f'/proc/{pgid}/stat', encoding='ascii').read()
        start_time = stat[stat.rfind(')') + 2:].split()[19]
        group_file = os.path.join(os.path.dirname(result), 'agent-group.json')
        with open(group_file + '.tmp', 'w', encoding='utf-8') as out:
            json.dump({'pgid': pgid, 'startTime': start_time}, out)
        os.replace(group_file + '.tmp', group_file)
        print(f'agent supervisor: pid/pgid={pgid} total deadline={timeout}s (protective ceiling, not target)', flush=True)
        reason = None
        drained_at = None
        while True:
            active = members(pgid)
            if active is None:
                reason = 'inspection-failed'
                break
            if interrupted:
                reason = interrupted
                break
            if time.monotonic() - started >= timeout:
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
            # Confirm group ownership before each signal: a reused PID must never
            # target a different task. A missing leader is safe only while original
            # group members remain (PGIDs cannot be reused while they remain).
            for sig, wait_seconds in ((signal.SIGTERM, grace), (signal.SIGKILL, kill_wait)):
                active = members(pgid)
                if active is None or not active:
                    break
                try:
                    leader_stat = open(f'/proc/{pgid}/stat', encoding='ascii').read()
                    if leader_stat[leader_stat.rfind(')') + 2:].split()[19] != start_time:
                        break
                except FileNotFoundError:
                    pass
                try:
                    os.killpg(pgid, sig)
                except ProcessLookupError:
                    pass
                limit = time.monotonic() + wait_seconds
                while time.monotonic() < limit:
                    active = members(pgid)
                    if active == []:
                        break
                    time.sleep(0.1)
                if active == []:
                    break
        child.poll()
        active = members(pgid)
        stopped = active == []
        rc = child.returncode if child.returncode is not None else None
    record = {'agentExitCode': rc, 'reason': reason or ('exit' if rc is not None else 'unknown'),
              'signal': interrupted, 'timedOut': reason == 'timeout', 'writerStopped': stopped,
              'remainingPids': active, 'pgid': pgid, 'elapsedSeconds': round(time.monotonic() - started, 3)}
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
