"""One-shot continuation for the user's Nov 3 profile/application run.

Wait for this exact profile job, then ask the dashboard to start at most 100
Naukri applications. Never retry a POST whose delivery is uncertain.
"""
import argparse
import fcntl
import json
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = 'http://127.0.0.1:8100'


def request(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(BASE + path, data=data, headers={
        'Content-Type': 'application/json', 'Origin': BASE,
    })
    with urlopen(req, timeout=20) as reply:
        return json.load(reply)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile-run', required=True)
    parser.add_argument('--epoch', required=True)
    parser.add_argument('--state', type=Path, required=True)
    args = parser.parse_args()
    args.state.parent.mkdir(parents=True, exist_ok=True)
    with args.state.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.state.exists():
            print('This continuation has already been recorded; it will not run twice.', flush=True)
            return

        def record(state, **extra):
            data = {'state': state, 'profile_run': args.profile_run, 'limit': 100,
                    'updated_at': time.time(), **extra}
            temp = args.state.with_suffix('.tmp')
            temp.write_text(json.dumps(data, indent=2) + '\n')
            temp.replace(args.state)
            print(json.dumps(data), flush=True)

        record('waiting_for_profile')
        deadline = time.monotonic() + 3 * 60 * 60
        while time.monotonic() < deadline:
            try:
                snapshot = request('/api/run')
            except (OSError, ValueError, URLError):
                time.sleep(10)
                continue
            if snapshot.get('epoch') != args.epoch:
                record('cancelled', reason='Dashboard restarted; no application job was started.')
                return
            profile = next((run for run in snapshot.get('runs', []) if run.get('id') == args.profile_run), None)
            if not profile or profile.get('action') != 'profile':
                record('cancelled', reason='The expected profile run is no longer available.')
                return
            if profile.get('stopping') or profile.get('status') in ('stopped', 'cancelled'):
                record('cancelled', reason='The profile run was stopped.')
                return
            if profile.get('running'):
                time.sleep(10)
                continue
            record('submitting')
            try:
                result = request('/api/run', {'action': 'naukri', 'options': {
                    'limit': 100, 'dry_run': False, 'browser_mode': 'visible',
                }})
            except HTTPError as error:
                record('not_started', reason=f'Dashboard rejected the launch with HTTP {error.code}.')
                return
            except (OSError, ValueError, URLError):
                record('needs_review', reason='Launch response was lost. Check Activity; do not launch a duplicate.')
                return
            if result.get('ok') and result.get('id'):
                record('started', application_run=result['id'])
            else:
                record('needs_review', reason='Launch was not confirmed. Check Activity before retrying.')
            return
        record('expired', reason='Profile review did not finish within three hours; no application job was started.')


if __name__ == '__main__':
    main()
