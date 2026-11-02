"""Daily preparation claims for the shared course and its discovery feed.

This module schedules no timers, invokes no AI, and starts no commands. The
dashboard owns those actions; this store only makes its opt-in and daily claims
durable alongside learning progress.
"""
from __future__ import annotations

import copy
import datetime as dt
import os
import re
from uuid import uuid4

from common import ai_cli, learning_memory as memory


ACTION = 'learning-feed'
START_TIMEOUT_SECONDS = 120
_ACTIVE = ('queued', 'running')
_STATUSES = (*_ACTIVE, 'completed', 'error')
_INVALID = 'Invalid saved daily learning settings. Automatic fetching is paused; your progress has not been reset.'


def _now():
    return dt.datetime.now().astimezone()


def _date(value=None):
    value = _now().date() if value is None else value
    if isinstance(value, str):
        parsed = dt.date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError('Choose a learning date in YYYY-MM-DD format.')
        return parsed.isoformat()
    if not isinstance(value, dt.date) or isinstance(value, dt.datetime):
        raise ValueError('Choose a learning date in YYYY-MM-DD format.')
    return value.isoformat()


def _moment(value):
    parsed = dt.datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.astimezone()


def _feed(data, *, create=False):
    saved = data.get('learning_feed')
    if saved is None:
        saved = {'settings': {'automatic': False}, 'attempts': {}}
        if create:
            data['learning_feed'] = saved
    if (not isinstance(saved, dict) or not isinstance(saved.get('settings'), dict)
            or type(saved['settings'].get('automatic')) is not bool
            or not isinstance(saved.get('attempts'), dict)):
        raise ValueError(_INVALID)
    try:
        for day, attempt in saved['attempts'].items():
            if (not isinstance(day, str) or _date(day) != day or not isinstance(attempt, dict)
                    or not isinstance(attempt.get('id'), str) or not re.fullmatch(r'[a-f0-9]{32}', attempt['id'])
                    or attempt.get('date') != day or attempt.get('status') not in _STATUSES
                    or type(attempt.get('automatic')) is not bool
                    or not isinstance(attempt.get('message', ''), str)
                    or len(attempt.get('message', '')) > 800
                    or (attempt.get('run_id') is not None and not isinstance(attempt['run_id'], str))
                    or (attempt.get('runner_epoch') is not None and not isinstance(attempt['runner_epoch'], str))
                    or type(attempt.get('owner_pid')) is not int or attempt['owner_pid'] <= 0):
                raise ValueError(_INVALID)
            _moment(attempt['started_at'])
            if attempt.get('finished_at'):
                _moment(attempt['finished_at'])
    except (ValueError, TypeError, KeyError) as exc:
        raise ValueError(_INVALID) from exc
    return saved


def _latest(feed):
    return max(feed['attempts'].values(), key=lambda item: (_moment(item['started_at']), item['date']), default=None)


def _owner_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _failure(attempt, message, now):
    attempt.update(status='error', message=message, finished_at=now.isoformat())


def _reconcile(feed, snapshot, now):
    if snapshot is None:
        return
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get('runs', []), list):
        raise ValueError('Expected a runner snapshot.')
    runs = [run for run in snapshot.get('runs', []) if isinstance(run, dict) and run.get('action') == ACTION]
    by_id = {run.get('id'): run for run in runs if isinstance(run.get('id'), str)}
    for attempt in feed['attempts'].values():
        if attempt['status'] not in _ACTIVE:
            continue
        run = by_id.get(attempt.get('run_id'))
        age = (now - _moment(attempt['started_at'])).total_seconds()
        if run is None and attempt['status'] == 'queued':
            # Recover the narrow gap between runner.start() and started().
            candidates = []
            for item in runs:
                try:
                    if item.get('day') == attempt['date'] and _moment(item['started_at']) >= _moment(attempt['started_at']):
                        candidates.append(item)
                except (ValueError, TypeError, KeyError):
                    continue
            run = min(candidates, key=lambda item: _moment(item['started_at']), default=None)
            if run:
                attempt.update(status='running', run_id=run.get('id'), runner_epoch=snapshot.get('epoch'))
        if run is not None:
            if run.get('running'):
                attempt['status'] = 'running'
                continue
            failed = run.get('status') in ('failed', 'stopped') or bool(run.get('stopped')) or run.get('exit') != 0
            if failed:
                _failure(attempt, 'Daily learning preparation stopped before finishing. Retry when you are ready.', now)
            else:
                attempt.update(status='completed', finished_at=now.isoformat(),
                               message='Your next course lesson and today’s discoveries have been prepared.')
            continue
        if attempt['status'] == 'queued' and age >= START_TIMEOUT_SECONDS:
            _failure(attempt, 'Daily learning preparation did not start. Retry when you are ready.', now)
        elif attempt['status'] == 'running' and (
                not _owner_alive(attempt['owner_pid'])
                or (attempt.get('runner_epoch') and attempt['runner_epoch'] == snapshot.get('epoch')
                    and age >= START_TIMEOUT_SECONDS)):
            # A different live dashboard must not cancel another server's claim.
            # An interrupted server never causes an automatic second AI run.
            _failure(attempt, 'The previous preparation session ended. Retry when you are ready.', now)


def reconcile(root, snapshot, *, now=None):
    now = now or _now()
    def change(data):
        feed = _feed(data)
        _reconcile(feed, snapshot, now)
    memory.transact(root, change)


def status(root, snapshot=None, *, today=None):
    if snapshot is not None:
        reconcile(root, snapshot)
    feed = _feed(memory.transact(root))
    day = _date(today)
    latest = _latest(feed)
    running = any(attempt['status'] in _ACTIVE for attempt in feed['attempts'].values())
    configured = bool(ai_cli.chosen_cli())
    automatic = feed['settings']['automatic']
    failed = bool(latest and latest['status'] == 'error')
    if running:
        message = 'Preparing your next course lesson, research papers, tech news and GitHub projects.'
    elif failed:
        message = latest['message'] or 'Daily learning preparation did not finish. Retry when you are ready.'
    elif latest and latest['date'] == day and latest['status'] == 'completed':
        message = 'Your next course lesson and today’s discoveries have been prepared.'
    elif not configured:
        message = 'Connect Claude CLI or Kiro CLI on this computer to fetch current learning material.'
    elif automatic:
        message = 'Daily fetching is enabled while this dashboard is running. Unfinished lessons stay in your queue.'
    else:
        message = 'Prepare today’s learning now, or enable daily fetching while this dashboard is running.'
    return {'automatic': automatic, 'configured': configured, 'date': day,
            'last_attempt': copy.deepcopy(latest), 'message': message, 'running': running,
            'automatic_ready': automatic and configured and not running and not failed and day not in feed['attempts']}


def update_settings(root, body):
    if not isinstance(body, dict) or set(body) != {'automatic'} or type(body.get('automatic')) is not bool:
        raise ValueError('Choose whether daily learning should be fetched automatically.')
    def change(data):
        _feed(data, create=True)['settings']['automatic'] = body['automatic']
    memory.transact(root, change)
    return status(root)


def automatic_enabled(root):
    return _feed(memory.transact(root))['settings']['automatic']


def claim(root, *, automatic=False, snapshot=None, today=None):
    if type(automatic) is not bool:
        raise ValueError('Choose an automatic or manual learning fetch.')
    configured = bool(ai_cli.chosen_cli())
    if not configured:
        if automatic:
            return None
        raise LookupError('Connect Claude CLI or Kiro CLI on this computer, then retry learning preparation.')
    day, now, result = _date(today), _now(), []
    def change(data):
        feed = _feed(data, create=True)
        _reconcile(feed, snapshot, now)
        latest = _latest(feed)
        if any(attempt['status'] in _ACTIVE for attempt in feed['attempts'].values()):
            return
        if automatic and (not feed['settings']['automatic'] or day in feed['attempts'] or (latest and latest['status'] == 'error')):
            return
        attempt = {'id': uuid4().hex, 'date': day, 'automatic': automatic, 'status': 'queued',
                   'started_at': now.isoformat(), 'finished_at': None, 'run_id': None,
                   'runner_epoch': None, 'owner_pid': os.getpid(), 'message': ''}
        feed['attempts'][day] = attempt
        # Keep more than a course's worth of outcomes; completion history is
        # stored separately and is never pruned by scheduling.
        for old in sorted(feed['attempts'])[:-120]:
            if feed['attempts'][old]['status'] not in _ACTIVE:
                del feed['attempts'][old]
        result.append(copy.deepcopy(attempt))
    memory.transact(root, change)
    return result[0] if result else None


def started(root, attempt_id, run_id, *, runner_epoch=None):
    if not isinstance(run_id, str) or not run_id or len(run_id) > 160:
        raise ValueError('A runner ID is required to track learning preparation.')
    if runner_epoch is not None and (not isinstance(runner_epoch, str) or len(runner_epoch) > 160):
        raise ValueError('Use a valid runner session ID.')
    def change(data):
        for attempt in _feed(data)['attempts'].values():
            if attempt['id'] == attempt_id and attempt['status'] in _ACTIVE:
                attempt.update(status='running', run_id=run_id, runner_epoch=runner_epoch)
                return
    memory.transact(root, change)


def finish(root, attempt_id, *, success, message=''):
    if type(success) is not bool or not isinstance(message, str):
        raise ValueError('Choose whether learning preparation completed successfully.')
    # Do not persist runner output, CLI errors, credentials, or whole snapshots.
    summary = ('Your next course lesson and today’s discoveries have been prepared.' if success
               else 'Daily learning preparation did not finish. Retry when you are ready.')
    def change(data):
        for attempt in _feed(data)['attempts'].values():
            if attempt['id'] == attempt_id and attempt['status'] in _ACTIVE:
                attempt.update(status='completed' if success else 'error', message=summary, finished_at=_now().isoformat())
                return
    memory.transact(root, change)
