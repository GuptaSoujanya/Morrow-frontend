"""Practice HTTP/scheduler integration with temporary files and no AI processes."""
import copy
import threading
from types import SimpleNamespace

import pytest

from test_server import app, request, dashboard
from test_learning_practice import response


@pytest.fixture
def practice_app(app, monkeypatch):
    instance = app[0]
    runs, starts = [], []
    monkeypatch.setattr(dashboard.learning_practice.ai_cli, 'chosen_cli', lambda: 'claude')
    def forbidden(*args, **kwargs):
        raise AssertionError('HTTP tests must not call an AI CLI.')
    monkeypatch.setattr(dashboard.learning_practice.ai_cli, 'ask', forbidden)
    def start(command, **kwargs):
        starts.append((command, kwargs))
        identifier = f'practice-{len(starts)}'
        runs.append({'id': identifier, 'shown': command.shown, 'running': True, **kwargs})
        return identifier
    monkeypatch.setattr(instance.runner, 'start', start)
    monkeypatch.setattr(instance.runner, 'snapshot', lambda: {'runs': copy.deepcopy(runs)})
    yield app, runs, starts


def test_generate_is_opt_in_and_returns_running_before_worker_claim(practice_app):
    app, runs, starts = practice_app
    status, result = request(app, 'POST', '/api/learning/practice/generate', {'mode': 'daily', 'automatic': True})
    assert status == 200 and not result['started'] and not starts
    assert request(app, 'POST', '/api/learning/practice/settings', {'automatic': True}) == (200, {'automatic': True})
    status, result = request(app, 'POST', '/api/learning/practice/generate', {'mode': 'daily', 'automatic': True})
    assert status == 202 and result['started']
    assert result['status']['daily']['job']['status'] == 'running'
    assert result['run_id'] == runs[0]['id']
    assert starts[0][1]['action'] == 'learning-practice'
    assert '--generate daily' in starts[0][0].shown
    assert request(app, 'POST', '/api/learning/practice/generate', {'mode': 'daily'})[1]['started'] is False
    assert len(starts) == 1


def test_missing_cli_and_blocked_weekly_never_start_a_process(practice_app, monkeypatch):
    app, runs, starts = practice_app
    assert request(app, 'POST', '/api/learning/practice/generate', {'mode': 'weekly'})[1]['started'] is False
    monkeypatch.setattr(dashboard.learning_practice.ai_cli, 'chosen_cli', lambda: '')
    assert request(app, 'POST', '/api/learning/practice/generate', {'mode': 'daily'})[0] == 503
    assert not runs and not starts


def test_submit_is_explicit_idempotent_and_records_only_practice_credit(practice_app):
    app, _, starts = practice_app
    root, course = app[0].practice_root, app[0].practice_course
    result = dashboard.learning_practice.generate(root, course, 'daily', ask=response)
    paper = result['daily']['papers'][0]['paper']
    body = {'paper_id': paper['id'], 'completed': True}
    assert request(app, 'POST', '/api/learning/practice/answer', body)[0] == 400
    for question in paper['questions']:
        assert request(app, 'POST', '/api/learning/practice/answer', {
            'paper_id': paper['id'], 'question_id': question['id'], 'answer': 'A reasoned answer.'})[0] == 200
    assert request(app, 'POST', '/api/learning/practice/answer', body)[1]['completed_at']
    assert request(app, 'POST', '/api/learning/practice/answer', body)[0] == 200
    status, value = request(app, 'GET', '/api/learning/activity')
    assert status == 200 and value['xp'] == 10
    saved = dashboard.learning_memory.transact(root)
    assert saved['documents']['practice/' + paper['id']]['done']
    assert not any(item.get('completed_at') for item in saved.get('dsa', {}).get('days', {}).values())
    assert request(app, 'POST', '/api/learning/practice/answer', {
        'paper_id': paper['id'], 'question_id': paper['questions'][0]['id'], 'answer': 'Changed'})[0] == 409
    assert request(app, 'POST', '/api/learning/practice/generate', {'mode': 'daily'})[1]['started'] is False
    assert not starts


@pytest.mark.parametrize('path,body', [
    ('settings', {'automatic': True}), ('generate', {'mode': 'daily'}),
    ('answer', {'paper_id': 'unknown', 'completed': True}),
])
def test_practice_rejects_cross_origin_writes(practice_app, path, body):
    app, _, starts = practice_app
    assert request(app, 'POST', '/api/learning/practice/' + path, body,
                   {'Origin': 'https://unrelated.example'})[0] == 403
    assert not starts


def test_another_account_cannot_access_local_papers_or_start_generation(practice_app):
    app, _, starts = practice_app
    class Bridge:
        def identity(self, handler):
            return {'id': 'guest', 'role': 'user', 'modules': ['learning'], 'email': 'guest@example.test'}
        def is_owner(self, handler, user): return False
    app[0].account_bridge = Bridge()
    for path in ('/api/learning/practice', '/api/learning/practice/paper?id=anything'):
        assert request(app, 'GET', path)[0] == 403
    for path, body in [('settings', {'automatic': True}), ('generate', {'mode': 'daily'}),
                       ('answer', {'paper_id': 'anything', 'completed': True})]:
        assert request(app, 'POST', '/api/learning/practice/' + path, body)[0] == 403
    assert not starts


@pytest.mark.parametrize('enabled', [False, True])
def test_background_preparation_obeys_persisted_opt_in(tmp_path, monkeypatch, enabled):
    stop, calls = threading.Event(), []
    class Tick:
        def is_set(self): return stop.is_set()
        def wait(self, seconds):
            assert seconds == 60
            stop.set()
    instance = SimpleNamespace(practice_stop=Tick(), practice_root=tmp_path,
                               start_practice=lambda *args, **kwargs: calls.append((args, kwargs)))
    monkeypatch.setattr(dashboard.learning_practice, 'automatic_enabled', lambda root: enabled)
    dashboard.DashboardServer._prepare_daily_practice(instance)
    assert calls == ([(('daily',), {'automatic': True})] if enabled else [])
