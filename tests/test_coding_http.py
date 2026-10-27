"""HTTP authority checks use temporary state and controlled runner results.

Real sandboxed Python/JavaScript/C++ execution is covered by runner tests and the
compiler browser suite; these tests verify what the HTTP boundary may authorize.
"""
from pathlib import Path
from urllib.parse import quote

import pytest

from test_server import app, request, dashboard
from test_learning_practice import response as ai_response

KEY = 'dsa/01-arrays-strings-hashing/problem-1'


@pytest.fixture
def coding_app(app, monkeypatch):
    root = dashboard.state.APPLY
    monkeypatch.setattr(dashboard.state, 'COURSE', Path(__file__).parents[2] / 'database/course')
    monkeypatch.setattr(dashboard.state, 'STUDIED', root / 'old-studied.json')
    calls = []
    def run(body, *, tests=None):
        calls.append((body, tests))
        return {'status': 'ok', 'stdout': 'true', 'stderr': '', 'duration_ms': 4,
                'passed': 999, 'total': 999,
                'tests': [{'passed': body['code'] == 'correct', 'expected': case['expected'], 'actual': case['expected'] if body['code'] == 'correct' else None}
                          for case in tests or []]}
    monkeypatch.setattr(dashboard.coding_practice.local_code_runner, 'execute', run)
    yield app, calls


def execute(app, action='submit', code='correct', **extra):
    return request(app, 'POST', '/api/learning/code/execute', {'key': KEY, 'language': 'python', 'code': code, 'action': action, **extra})


def test_empty_or_untouched_solution_is_a_validation_error(coding_app):
    app, calls = coding_app
    descriptor = request(app, 'GET', '/api/learning/code/problem?key=' + quote(KEY))[1]
    for source in ('', '   ', descriptor['starter']['python']):
        status, result = execute(app, code=source)
        assert status == 400 and result['error']
    assert calls == []


def test_drafts_are_separate_by_language_and_never_score(coding_app):
    app, calls = coding_app
    for language, code in [('python', 'print(True)'), ('javascript', 'console.log(true)')]:
        status, value = request(app, 'POST', '/api/learning/code/draft', {'key': KEY, 'language': language, 'code': code})
        assert status == 200 and value['code'] == code
        status, descriptor = request(app, 'GET', '/api/learning/code/problem?key=' + quote(KEY) + '&language=' + language)
        assert status == 200 and descriptor['draft']['code'] == code
        assert descriptor['problem_key'] == KEY and descriptor['test_count'] >= 2
        assert all('expected' in case for case in descriptor['samples'])
    assert request(app, 'GET', '/api/learning/code/progress')[1]['totals']['attempts'] == 0
    assert not calls


def test_samples_and_custom_runs_do_not_award_score_or_xp(coding_app):
    app, calls = coding_app
    before = request(app, 'GET', '/api/learning/activity')[1]['xp']
    assert execute(app, 'samples')[1]['scored'] is False
    assert execute(app, 'custom', stdin='{"nums":[1,2,1]}')[1]['scored'] is False
    assert len(calls) == 2 and calls[1][1] is None
    assert request(app, 'GET', '/api/learning/code/progress')[1]['totals']['attempts'] == 0
    assert request(app, 'GET', '/api/learning/activity')[1]['xp'] == before


def test_server_derives_test_counts_best_scores_and_idempotent_completion(coding_app):
    app, calls = coding_app
    before = request(app, 'GET', '/api/learning/activity')[1]['xp']
    status, failed = execute(app, code='wrong', submission_id='server-1')
    assert status == 200 and failed['scored'] and failed['submission']['score'] == 0
    status, accepted = execute(app, submission_id='server-2')
    assert status == 200 and accepted['scored']
    assert accepted['passed'] == accepted['total'] == len(calls[-1][1]) != 999
    assert accepted['submission']['score'] == accepted['submission']['improvement'] == 100
    status, repeated = execute(app, submission_id='server-3')
    assert status == 200 and repeated['submission']['improvement'] == 0
    assert execute(app, submission_id='server-3')[1]['submission'] == repeated['submission']
    progress = request(app, 'GET', '/api/learning/code/progress')[1]
    assert progress['today']['score'] == 100 and progress['totals']['attempts'] == 3
    assert progress['totals']['verified_solves'] == 1 and progress['badges'][0]['earned_at']
    assert request(app, 'GET', '/api/learning/activity')[1]['xp'] == before + 10
    problem = request(app, 'GET', '/api/learning/dsa/problem?id=01-arrays-strings-hashing%2Fproblem-1')[1]
    assert problem['status'] == 'solved'


def test_client_cannot_supply_test_counts_cases_or_arbitrary_source_paths(coding_app):
    app, calls = coding_app
    for extra in ({'passed': 4, 'total': 4}, {'tests': [{'passed': True}]}, {'expected': True}, {'cwd': '/tmp'}):
        assert execute(app, **extra)[0] == 400
    for key in ('../../private', 'dsa/../../private/problem-1', 'dsa/unknown/problem-1', 'practice/not-a-real-paper/q1'):
        assert request(app, 'POST', '/api/learning/code/execute', {'key': key, 'language': 'python', 'code': 'correct', 'action': 'submit'})[0] == 400
    assert not calls
    assert request(app, 'GET', '/api/learning/code/progress')[1]['totals']['attempts'] == 0


def test_invalid_custom_input_and_unsupported_languages_never_execute(coding_app):
    app, calls = coding_app
    assert execute(app, 'custom', stdin='{bad')[0] == 400
    assert request(app, 'POST', '/api/learning/code/execute', {'key': KEY, 'language': 'shell', 'code': 'echo test', 'action': 'submit'})[0] == 400
    assert not calls


@pytest.mark.parametrize('path,body', [
    ('draft', {'key': KEY, 'language': 'python', 'code': 'correct'}),
    ('execute', {'key': KEY, 'language': 'python', 'code': 'correct', 'action': 'submit'}),
])
def test_code_mutations_reject_cross_origin_requests(coding_app, path, body):
    app, calls = coding_app
    assert request(app, 'POST', '/api/learning/code/' + path, body, {'Origin': 'https://unrelated.example'})[0] == 403
    assert request(app, 'POST', '/api/learning/code/' + path, body, {'Sec-Fetch-Site': 'cross-site'})[0] == 403
    assert not calls


def test_another_account_cannot_read_drafts_or_execute_local_code(coding_app):
    app, calls = coding_app
    class Bridge:
        def identity(self, handler):
            return {'id': 'guest', 'role': 'user', 'modules': ['learning'], 'email': 'guest@example.test'}
        def is_owner(self, handler, user): return False
    app[0].account_bridge = Bridge()
    for path in ('capabilities', 'progress', 'problem?key=' + quote(KEY)):
        assert request(app, 'GET', '/api/learning/code/' + path)[0] == 403
    assert execute(app)[0] == 403
    assert request(app, 'POST', '/api/learning/code/draft', {'key': KEY, 'language': 'python', 'code': 'correct'})[0] == 403
    assert not calls


def test_concurrency_limit_rejects_extra_execution_before_runner(coding_app):
    app, calls = coding_app
    slots = app[0].code_slots
    assert slots.acquire(blocking=False) and slots.acquire(blocking=False)
    try:
        assert execute(app)[0] == 409
        assert not calls
    finally:
        slots.release(); slots.release()


def test_unavailable_sandbox_never_awards_submission(coding_app, monkeypatch):
    app, calls = coding_app
    monkeypatch.setattr(dashboard.coding_practice.local_code_runner, 'execute', lambda *args, **kwargs: {'status': 'unavailable', 'tests': [], 'reason': 'Isolation is unavailable.'})
    status, result = execute(app)
    assert status == 200 and not result['scored']
    assert request(app, 'GET', '/api/learning/code/progress')[1]['totals']['attempts'] == 0


def test_ai_companion_and_sheet_share_one_score_and_one_draft(coding_app, monkeypatch):
    app, calls = coding_app
    root, course = dashboard.state.APPLY, dashboard.state.COURSE
    monkeypatch.setattr(dashboard.learning_practice.ai_cli, 'chosen_cli', lambda: '')
    generated = dashboard.learning_practice.generate(root, course, 'daily', ask=ai_response)
    paper = next(slot['paper'] for slot in generated['daily']['papers'] if slot['kind'] == 'dsa')
    alias = f'practice/{paper["id"]}/{paper["questions"][0]["id"]}'
    status, descriptor = request(app, 'GET', '/api/learning/code/problem?key=' + quote(alias))
    assert status == 200 and descriptor['problem_key'] == KEY
    assert request(app, 'POST', '/api/learning/code/draft', {'key': alias, 'language': 'python', 'code': 'correct'})[0] == 200
    assert request(app, 'GET', '/api/learning/code/problem?key=' + quote(KEY))[1]['draft']['code'] == 'correct'
    assert execute(app)[1]['submission']['improvement'] == 100
    status, result = request(app, 'POST', '/api/learning/code/execute', {'key': alias, 'language': 'python', 'code': 'correct', 'action': 'submit'})
    assert status == 200 and result['submission']['improvement'] == 0
    assert request(app, 'GET', '/api/learning/code/progress')[1]['totals']['verified_solves'] == 1
