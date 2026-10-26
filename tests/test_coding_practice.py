"""Integration checks for trusted judging, saved code, and daily learning credit.

All execution is injected. These tests never run learner programs or an AI CLI.
"""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import datetime as dt
import json
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
from urllib.parse import quote

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
import code_problem_catalog as catalog
import coding_practice as coding
import daily_dsa
import learning_practice as practice
import learning_scores as scores
from common import learning_activity, learning_memory as memory

COURSE = Path(__file__).parents[2] / 'course'
DAY = dt.date(2026, 10, 26)
PROBLEM = '01-arrays-strings-hashing/problem-1'
KEY = 'dsa/' + PROBLEM
PAPER_ID = 'p-' + 'a' * 32
PAPER_KEY = 'practice/' + PAPER_ID + '/q1'
HASHING = {'id': 'dsa/hashing', 'title': 'Hash sets & frequency maps', 'read': True,
           'route': '#/learning/dsa'}
TREES = {'id': 'dsa/tree-traversal', 'title': 'Walking through trees', 'read': True,
         'route': '#/learning/dsa'}


@pytest.fixture
def clock(monkeypatch):
    value = SimpleNamespace(day=DAY)
    monkeypatch.setattr(scores, '_stamp', lambda at=None: at or f'{value.day}T12:00:00+05:30')
    return value


@pytest.fixture(autouse=True)
def no_external_execution(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('A test attempted to run real code or an AI CLI.')
    monkeypatch.setattr(coding.local_code_runner, 'execute', forbidden)
    monkeypatch.setattr(practice.ai_cli, 'ask', forbidden)


@pytest.fixture
def runner(monkeypatch):
    state = SimpleNamespace(passed=4, status=None, calls=[])
    def execute(payload, tests=None):
        state.calls.append({'payload': deepcopy(payload), 'tests': deepcopy(tests)})
        if state.status == 'unavailable':
            return {'status': 'unavailable', 'stderr': 'Test runtime unavailable.', 'stdout': '', 'duration_ms': 0}
        if tests is None:
            return {'status': 'ok', 'stdout': '{"local":true}\n', 'stderr': '', 'duration_ms': 1}
        passed = 0 if payload['code'] == 'fail' else min(state.passed, len(tests))
        return {'status': state.status or ('accepted' if passed == len(tests) else 'failed'),
                # Deliberately bogus aggregates ensure the integration recalculates
                # scores from the actual server-owned case outcomes.
                'passed': 999, 'total': 999, 'stdout': '', 'stderr': '', 'duration_ms': 1,
                'tests': [{'id': case['id'], 'passed': index < passed,
                           'actual': case['expected'] if index < passed else None,
                           'expected': case['expected'], 'status': 'ok'}
                          for index, case in enumerate(tests)]}
    monkeypatch.setattr(coding.local_code_runner, 'execute', execute)
    return state


def payload(key=KEY, *, action='submit', code='pass', identifier=None, **extra):
    return {'key': key, 'language': 'python', 'code': code, 'action': action,
            **({'submission_id': identifier} if identifier is not None else {}), **extra}


def raw_paper(*, references=None, problem_ids=None):
    references = references or [['dsa/hashing']] * 3
    return {'title': 'Saved DSA practice', 'goal': 'Apply the saved topic.',
            'reason': 'Practice the completed source material.',
            'questions': [{'prompt': f'Implement this exercise and explain your approach ({index + 1}).',
                           'hint': 'Use the provided JSON contract.', 'difficulty': 'easy', 'minutes': 10,
                           'source_ids': refs, 'reference_answer': 'Explain a correct algorithm.',
                           'rubric': ['Returns correct results.', 'Explains edge cases.'],
                           **({'problem_id': problem_ids[index]} if problem_ids and problem_ids[index] is not None else {})}
                          for index, refs in enumerate(references)]}


def save_paper(root, *, sources=None, references=None, problem_ids=None):
    sources = sources or [HASHING]
    generated = practice._generated(json.dumps(raw_paper(references=references, problem_ids=problem_ids)), 3, sources)
    paper = {**generated, 'id': PAPER_ID, 'kind': 'dsa', 'mode': 'daily',
             'date': DAY.isoformat(), 'created_at': f'{DAY}T08:00:00+05:30',
             'completed_at': None, 'source_ids': [source['id'] for source in sources],
             'sources': deepcopy(sources)}
    practice._transact(root, lambda data: data['papers'].__setitem__(PAPER_ID, paper))
    return paper


def activity(root, day=DAY):
    return learning_activity.summary(memory.transact(root), today=day)


def test_legacy_companions_stay_with_each_questions_cited_source(tmp_path):
    save_paper(tmp_path, sources=[HASHING, TREES],
               references=[['dsa/tree-traversal'], ['dsa/hashing'], ['dsa/tree-traversal']])
    expected = ['05-trees-bst/problem-1', '01-arrays-strings-hashing/problem-2', '05-trees-bst/problem-3']
    for index, identifier in enumerate(expected, 1):
        exercise = coding.resolve(tmp_path, f'practice/{PAPER_ID}/q{index}')
        assert exercise['id'] == identifier and exercise['companion'] is True
        assert exercise['problem_key'] == 'dsa/' + identifier
        assert exercise['route'] == '#/learning/practice/paper/' + PAPER_ID
        assert exercise['samples'] == catalog.problem(identifier)['samples']


def test_explicit_ai_problem_uses_canonical_contract_and_persistent_draft(tmp_path):
    save_paper(tmp_path, problem_ids=[PROBLEM, None, None])
    resolved = coding.resolve(tmp_path, PAPER_KEY)
    assert resolved['id'] == PROBLEM and resolved['companion'] is False
    assert resolved['problem_key'] == KEY
    saved = coding.save_draft(tmp_path, {'key': PAPER_KEY, 'language': 'python', 'code': 'def solve(input): return True'})
    assert coding.descriptor(tmp_path, KEY)['draft'] == saved
    assert coding.descriptor(tmp_path, PAPER_KEY)['draft'] == saved
    assert coding.resolve(tmp_path, KEY)['route'] == '#/learning/dsa/problem/' + quote(PROBLEM, safe='')


def test_ai_binding_rejects_problem_from_another_source_in_same_paper(tmp_path):
    raw = raw_paper(problem_ids=['05-trees-bst/problem-1', None, None])
    with pytest.raises(ValueError, match='question’s saved DSA topics'):
        practice._generated(json.dumps(raw), 3, [HASHING, TREES])
    save_paper(tmp_path, sources=[HASHING, TREES], problem_ids=[PROBLEM, None, None])
    path = tmp_path / '.memory/practice.json'
    stored = json.loads(path.read_text())
    stored['papers'][PAPER_ID]['questions'][0]['problem_id'] = '05-trees-bst/problem-1'
    path.write_text(json.dumps(stored))
    original = path.read_bytes()
    with pytest.raises(ValueError, match='question’s saved DSA topics'):
        coding.resolve(tmp_path, PAPER_KEY)
    assert path.read_bytes() == original


@pytest.mark.parametrize('identifier', ['../../secret', '01-arrays-strings-hashing/problem-99', '', None, 1])
def test_ai_binding_rejects_unknown_or_invalid_problem_ids(identifier):
    raw = raw_paper()
    raw['questions'][0]['problem_id'] = identifier
    with pytest.raises(ValueError, match='question’s saved DSA topics'):
        practice._generated(json.dumps(raw), 3, [HASHING])


def test_saved_paper_and_sheet_share_daily_best_score_without_double_credit(tmp_path, runner, clock):
    save_paper(tmp_path, problem_ids=[PROBLEM, None, None])
    runner.passed = 2
    first = coding.execute(tmp_path, COURSE, payload(PAPER_KEY, identifier='paper-half'))
    assert first['scored'] and first['passed'] == 2 and first['total'] == 4
    assert first['submission']['score'] == first['submission']['improvement'] == 50
    assert daily_dsa.problem(tmp_path, COURSE, PROBLEM)['status'] == 'attempted'
    assert activity(tmp_path)['xp'] == 0
    runner.passed = 4
    second = coding.execute(tmp_path, COURSE, payload(identifier='sheet-full'))
    assert second['submission']['score'] == 100 and second['submission']['improvement'] == 50
    third = coding.execute(tmp_path, COURSE, payload(PAPER_KEY, identifier='paper-full'))
    assert third['submission']['improvement'] == 0
    summary = scores.summary(tmp_path, DAY)
    assert summary['today']['score'] == summary['today']['max_score'] == 100
    assert summary['today']['problems'] == summary['totals']['verified_solves'] == 1
    assert summary['today']['attempts'] == 3
    assert activity(tmp_path)['xp'] == 10
    assert daily_dsa.problem(tmp_path, COURSE, PROBLEM)['status'] == 'solved'
    assert {entry['problem_key'] for entry in summary['history']} == {KEY}
    assert {entry['route'] for entry in summary['history']} == {
        '#/learning/practice/paper/' + PAPER_ID,
        '#/learning/dsa/problem/' + quote(PROBLEM, safe=''),
    }


@pytest.mark.parametrize('action', ['samples', 'custom'])
def test_practice_runs_save_code_without_awarding_score_or_progress(tmp_path, runner, clock, action):
    result = coding.execute(tmp_path, COURSE, payload(action=action, stdin='{"nums":[1,1]}'))
    assert result['scored'] is False and 'submission' not in result
    assert scores.summary(tmp_path, DAY)['totals']['attempts'] == 0
    assert activity(tmp_path)['xp'] == activity(tmp_path)['total_completions'] == 0
    assert daily_dsa.problem(tmp_path, COURSE, PROBLEM)['status'] == 'todo'
    assert scores.get_draft(tmp_path, KEY, 'python')['code'] == 'pass'
    tests = runner.calls[0]['tests']
    assert tests is None if action == 'custom' else tests == catalog.cases(PROBLEM, samples_only=True)


def test_submit_counts_only_literal_passed_true_for_trusted_cases(tmp_path, monkeypatch, clock):
    def result(payload, tests):
        assert len(tests) == 4
        return {'status': 'accepted', 'passed': 4, 'total': 4,
                'tests': [{'passed': True}, {'passed': 1}, {'passed': 'true'}, {'passed': False}]}
    monkeypatch.setattr(coding.local_code_runner, 'execute', result)
    saved = coding.execute(tmp_path, COURSE, payload())
    assert saved['passed'] == 1 and saved['total'] == 4
    assert saved['submission']['score'] == 25 and not saved['submission']['verified']
    assert activity(tmp_path)['xp'] == 0


def test_unavailable_runtime_cannot_create_a_scored_attempt(tmp_path, runner, clock):
    runner.status = 'unavailable'
    result = coding.execute(tmp_path, COURSE, payload())
    assert result['status'] == 'unavailable' and result['scored'] is False
    assert scores.summary(tmp_path, DAY)['today']['attempts'] == 0
    assert activity(tmp_path)['xp'] == 0
    assert daily_dsa.problem(tmp_path, COURSE, PROBLEM)['status'] == 'todo'


def test_failed_suite_with_unavailable_case_never_records_score_or_attempt(tmp_path, monkeypatch, clock):
    def interrupted(payload, tests):
        assert len(tests) == 4
        return {'status': 'failed', 'passed': 1, 'total': 4, 'stdout': '', 'stderr': '',
                'tests': [{'id': case['id'], 'passed': index == 0,
                           'status': ['ok', 'unavailable', 'not_run', 'not_run'][index],
                           'stderr': 'The local process could not start.' if index == 1 else ''}
                          for index, case in enumerate(tests)]}
    monkeypatch.setattr(coding.local_code_runner, 'execute', interrupted)
    result = coding.execute(tmp_path, COURSE, payload(identifier='interrupted-suite'))
    assert result['status'] == 'unavailable' and result['scored'] is False
    assert 'submission' not in result
    summary = scores.summary(tmp_path, DAY)
    assert summary['today']['attempts'] == summary['today']['score'] == 0
    assert summary['totals']['verified_solves'] == 0 and summary['history'] == []
    assert activity(tmp_path)['xp'] == activity(tmp_path)['total_completions'] == 0
    assert daily_dsa.problem(tmp_path, COURSE, PROBLEM)['status'] == 'todo'
    # Keep the draft even when the machine cannot complete its test suite.
    assert scores.get_draft(tmp_path, KEY, 'python')['code'] == 'pass'


@pytest.mark.parametrize('identifier', ['', '../run', 'x' * 101, None, 0, [], {}])
def test_invalid_submission_id_rejected_before_runner_or_draft_write(tmp_path, runner, identifier):
    body = payload()
    body['submission_id'] = identifier
    with pytest.raises(ValueError, match='valid submission identifier'):
        coding.execute(tmp_path, COURSE, body)
    assert runner.calls == []
    assert not (tmp_path / '.memory/code-practice.json').exists()


@pytest.mark.parametrize('stdin', ['{broken', '[1,]', '"unterminated', '[' * 2_000 + ']' * 1_999],
                         ids=['broken-object', 'trailing-comma', 'unclosed-string', 'unclosed-deep-array'])
def test_malformed_custom_input_rejected_before_runner_or_draft_write(tmp_path, runner, stdin):
    with pytest.raises(ValueError, match='valid JSON'):
        coding.execute(tmp_path, COURSE, payload(action='custom', stdin=stdin))
    assert runner.calls == []
    assert not (tmp_path / '.memory/code-practice.json').exists()


def test_caller_cannot_supply_test_cases_or_score_totals(tmp_path, runner):
    for extra in ({'tests': [{'input': {}, 'expected': True}]}, {'passed': 4}, {'total': 4}, {'score': 100}):
        with pytest.raises(ValueError, match='coding exercise and its code'):
            coding.execute(tmp_path, COURSE, payload(**extra))
    assert runner.calls == []


def test_verified_solution_gets_ten_xp_once_per_day_and_new_day_heatmap_credit(tmp_path, runner, clock):
    first = coding.execute(tmp_path, COURSE, payload(identifier='first'))
    coding.execute(tmp_path, COURSE, payload(identifier='repeat'))
    assert first['submission']['improvement'] == 100
    initial = activity(tmp_path)
    assert initial['xp'] == 10 and initial['today_count'] == 1 and initial['current_streak'] == 1
    clock.day += dt.timedelta(days=1)
    # A transport retry of yesterday's submission remains yesterday's event.
    retried = coding.execute(tmp_path, COURSE, payload(identifier='first'))
    assert retried['submission'] == first['submission']
    before_revision = activity(tmp_path, clock.day)
    assert before_revision['xp'] == 10 and before_revision['today_count'] == 0
    revision = coding.execute(tmp_path, COURSE, payload(identifier='tomorrow-revision'))
    assert revision['submission']['date'] == clock.day.isoformat()
    assert revision['submission']['improvement'] == 100
    summary = activity(tmp_path, clock.day)
    assert summary['xp'] == 20 and summary['today_count'] == 1 and summary['current_streak'] == 2
    counted = [day for day in summary['days'] if day['count']]
    assert [day['date'] for day in counted] == [DAY.isoformat(), clock.day.isoformat()]
    assert all(day['items'][0]['id'] == 'code/' + KEY for day in counted)
    events = memory.transact(tmp_path)['history']
    assert [event['at'] for event in events] == [first['submission']['at'], revision['submission']['at']]
    totals = scores.summary(tmp_path, clock.day)
    assert totals['today']['score'] == 100 and totals['totals']['score'] == 200
    assert totals['totals']['verified_solves'] == 1


def test_parallel_failed_submission_cannot_downgrade_verified_solve(tmp_path, runner, clock, monkeypatch):
    reached_attempt = threading.Event()
    release_attempt = threading.Event()
    real_update = daily_dsa.update_problem
    def delayed_update(root, course, body, **kwargs):
        if body['status'] == 'attempted':
            reached_attempt.set()
            assert release_attempt.wait(timeout=5), 'The concurrent success did not finish.'
        return real_update(root, course, body, **kwargs)
    monkeypatch.setattr(daily_dsa, 'update_problem', delayed_update)
    with ThreadPoolExecutor(max_workers=2) as pool:
        failed = pool.submit(coding.execute, tmp_path, COURSE, payload(code='fail', identifier='failed-first'))
        try:
            assert reached_attempt.wait(timeout=5), 'Failed submission did not reach progress update.'
            success = coding.execute(tmp_path, COURSE, payload(identifier='passed-second'))
            assert success['submission']['verified']
        finally:
            release_attempt.set()
        assert failed.result(timeout=5)['submission']['score'] == 0
    assert daily_dsa.problem(tmp_path, COURSE, PROBLEM)['status'] == 'solved'
    assert scores.summary(tmp_path, DAY)['today']['score'] == 100
    assert activity(tmp_path)['xp'] == 10


def test_concurrent_successes_keep_one_calendar_event_and_one_daily_score(tmp_path, runner, clock):
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda i: coding.execute(tmp_path, COURSE, payload(identifier=f'run-{i}')), range(12)))
    assert sum(result['submission']['improvement'] for result in results) == 100
    assert scores.summary(tmp_path, DAY)['today']['attempts'] == 12
    assert scores.summary(tmp_path, DAY)['totals']['verified_solves'] == 1
    assert activity(tmp_path)['xp'] == 10 and len(memory.transact(tmp_path)['history']) == 1
    assert daily_dsa.problem(tmp_path, COURSE, PROBLEM)['status'] == 'solved'
