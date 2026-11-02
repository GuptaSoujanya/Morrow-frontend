"""Daily preparation is opt-in, claimed once and never loops on AI failures."""
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import learning_feed as feed
from common import learning_memory


DAY = dt.date(2026, 11, 2)
NOW = dt.datetime(2026, 11, 2, 9, 0, tzinfo=dt.timezone(dt.timedelta(hours=5, minutes=30)))


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(feed.ai_cli, 'chosen_cli', lambda: 'claude')
    monkeypatch.setattr(feed, '_now', lambda: NOW)
    return tmp_path


def run_snapshot(attempt, *, running=True, status='running', exit=None, action='learning-feed'):
    return {'epoch': 'this-server', 'runs': [{
        'id': 'owned-feed-run', 'action': action, 'day': attempt['date'],
        'started_at': attempt['started_at'], 'running': running, 'status': status, 'exit': exit,
    }]}


def test_fetching_defaults_off_and_does_not_start_an_ai_request(workspace, monkeypatch):
    monkeypatch.setattr(feed.ai_cli, 'ask', lambda *_args, **_kwargs: pytest.fail('Scheduling must not invoke AI.'))
    result = feed.status(workspace, today=DAY)
    assert result['automatic'] is False and result['configured'] is True
    assert result['last_attempt'] is None and result['running'] is False
    assert feed.claim(workspace, automatic=True, today=DAY) is None
    assert not feed.automatic_enabled(workspace)
    assert feed.update_settings(workspace, {'automatic': True})['automatic']
    assert feed.automatic_enabled(workspace)


def test_settings_and_claims_preserve_course_and_legacy_progress(workspace):
    def initial(data):
        data['plan'] = {'done': [3], 'marked': {'2024-01-01': 3}}
        data['course']['01-system-design/intro.md'] = {'done': True}
    learning_memory.transact(workspace, initial)
    feed.update_settings(workspace, {'automatic': True})
    attempt = feed.claim(workspace, automatic=True, today=DAY)
    assert attempt['date'] == str(DAY)
    saved = learning_memory.transact(workspace)
    assert saved['plan']['done'] == [3]
    assert saved['course']['01-system-design/intro.md']['done']


@pytest.mark.parametrize('body', [{}, {'automatic': 'true'}, {'automatic': 1}, {'automatic': True, 'run': True}, None])
def test_invalid_settings_do_not_enable_fetching(workspace, body):
    with pytest.raises(ValueError):
        feed.update_settings(workspace, body)
    assert not feed.automatic_enabled(workspace)


def test_missing_cli_is_truthful_and_does_not_consume_daily_attempt(workspace, monkeypatch):
    monkeypatch.setattr(feed.ai_cli, 'chosen_cli', lambda: '')
    feed.update_settings(workspace, {'automatic': True})
    assert not feed.status(workspace)['configured']
    assert feed.claim(workspace, automatic=True, today=DAY) is None
    with pytest.raises(LookupError, match='Connect Claude CLI'):
        feed.claim(workspace, today=DAY)
    assert feed.status(workspace)['last_attempt'] is None


def test_one_claim_wins_concurrent_ticks_and_manual_requests(workspace):
    feed.update_settings(workspace, {'automatic': True})
    with ThreadPoolExecutor(max_workers=8) as pool:
        claims = list(pool.map(lambda i: feed.claim(workspace, automatic=bool(i % 2), today=DAY), range(16)))
    assert sum(item is not None for item in claims) == 1
    assert feed.status(workspace, today=DAY)['running']


def test_finished_daily_run_stays_done_and_next_date_can_run(workspace, monkeypatch):
    feed.update_settings(workspace, {'automatic': True})
    attempt = feed.claim(workspace, automatic=True, today=DAY)
    feed.started(workspace, attempt['id'], 'owned-feed-run', runner_epoch='this-server')
    running = feed.status(workspace, run_snapshot(attempt), today=DAY)
    assert running['last_attempt']['status'] == 'running'
    finished = feed.status(workspace, run_snapshot(attempt, running=False, status='completed', exit=0), today=DAY)
    assert finished['last_attempt']['status'] == 'completed' and not finished['running']
    assert feed.claim(workspace, automatic=True, today=DAY) is None
    monkeypatch.setattr(feed, '_now', lambda: NOW + dt.timedelta(days=1))
    assert feed.status(workspace)['automatic_ready']
    assert feed.claim(workspace, automatic=True) is not None


@pytest.mark.parametrize('status,exit', [('failed', 1), ('stopped', 0), ('completed', 1), ('completed', None)])
def test_failed_or_unconfirmed_run_requires_explicit_retry_even_next_day(workspace, monkeypatch, status, exit):
    feed.update_settings(workspace, {'automatic': True})
    attempt = feed.claim(workspace, automatic=True, today=DAY)
    feed.started(workspace, attempt['id'], 'owned-feed-run')
    failed = feed.status(workspace, run_snapshot(attempt, running=False, status=status, exit=exit), today=DAY)
    assert failed['last_attempt']['status'] == 'error'
    assert not failed['automatic_ready'] and not failed['running']
    assert feed.claim(workspace, automatic=True, today=DAY) is None
    monkeypatch.setattr(feed, '_now', lambda: NOW + dt.timedelta(days=1))
    assert feed.claim(workspace, automatic=True) is None
    retry = feed.claim(workspace)
    assert retry and retry['id'] != attempt['id']


def test_start_failure_uses_general_message_and_late_old_completion_does_not_change_retry(workspace):
    first = feed.claim(workspace, today=DAY)
    feed.finish(workspace, first['id'], success=False, message='SECRET_API_KEY=hidden private@example.com')
    assert 'SECRET' not in json.dumps(learning_memory.transact(workspace))
    retry = feed.claim(workspace, today=DAY)
    feed.finish(workspace, first['id'], success=True)
    assert feed.status(workspace, today=DAY)['last_attempt']['id'] == retry['id']
    assert feed.status(workspace, today=DAY)['last_attempt']['status'] == 'queued'


def test_abandoned_start_expires_but_runner_attach_gap_is_recovered(workspace, monkeypatch):
    attempt = feed.claim(workspace, today=DAY)
    feed.reconcile(workspace, run_snapshot(attempt))
    recovered = feed.status(workspace, today=DAY)['last_attempt']
    assert recovered['status'] == 'running' and recovered['run_id'] == 'owned-feed-run'
    feed.finish(workspace, attempt['id'], success=True)
    next_attempt = feed.claim(workspace, today=DAY)
    feed.reconcile(workspace, {'runs': []}, now=NOW + dt.timedelta(seconds=feed.START_TIMEOUT_SECONDS + 1))
    expired = feed.status(workspace, today=DAY)['last_attempt']
    assert expired['id'] == next_attempt['id'] and expired['status'] == 'error'


def test_restart_cannot_cancel_a_live_dashboard_claim_but_dead_owner_pauses_it(workspace, monkeypatch):
    attempt = feed.claim(workspace, today=DAY)
    feed.started(workspace, attempt['id'], 'owned-feed-run', runner_epoch='other-server')
    monkeypatch.setattr(feed, '_owner_alive', lambda _pid: True)
    feed.reconcile(workspace, {'epoch': 'this-server', 'runs': []})
    assert feed.status(workspace, today=DAY)['running']
    monkeypatch.setattr(feed, '_owner_alive', lambda _pid: False)
    feed.reconcile(workspace, {'epoch': 'this-server', 'runs': []})
    assert feed.status(workspace, today=DAY)['last_attempt']['status'] == 'error'


def test_missing_run_in_its_own_server_snapshot_does_not_stay_running_forever(workspace, monkeypatch):
    attempt = feed.claim(workspace, today=DAY)
    feed.started(workspace, attempt['id'], 'owned-feed-run', runner_epoch='same-server')
    monkeypatch.setattr(feed, '_owner_alive', lambda _pid: True)
    feed.reconcile(workspace, {'epoch': 'same-server', 'runs': []}, now=NOW + dt.timedelta(seconds=121))
    assert feed.status(workspace, today=DAY)['last_attempt']['status'] == 'error'


def test_unrelated_runs_cannot_finish_or_replace_a_learning_attempt(workspace):
    attempt = feed.claim(workspace, today=DAY)
    feed.started(workspace, attempt['id'], 'owned-feed-run')
    feed.reconcile(workspace, run_snapshot(attempt, running=False, status='completed', exit=0, action='pipeline'))
    result = feed.status(workspace, today=DAY)
    assert result['last_attempt']['status'] == 'running'


def test_disabling_automatic_preserves_active_run_but_prevents_future_claims(workspace):
    feed.update_settings(workspace, {'automatic': True})
    attempt = feed.claim(workspace, automatic=True, today=DAY)
    feed.update_settings(workspace, {'automatic': False})
    assert feed.status(workspace, today=DAY)['running']
    feed.finish(workspace, attempt['id'], success=True)
    assert feed.claim(workspace, automatic=True, today=DAY + dt.timedelta(days=1)) is None


def test_corrupt_schedule_state_is_never_silently_reset(workspace):
    def corrupt(data):
        data['learning_feed'] = {'settings': {'automatic': 'yes'}, 'attempts': {}}
    learning_memory.transact(workspace, corrupt)
    before = (workspace / 'user/memory/learning.json').read_bytes()
    for action in (lambda: feed.status(workspace), lambda: feed.update_settings(workspace, {'automatic': True}),
                   lambda: feed.claim(workspace, today=DAY)):
        with pytest.raises(ValueError, match='has not been reset'):
            action()
    assert (workspace / 'user/memory/learning.json').read_bytes() == before
