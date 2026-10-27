"""AI practice tests use temporary state and injected responses, never real CLI calls."""
import datetime as dt
import json
import os
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
from common import learning_memory as memory
import learning_practice as practice

REAL_ASK = practice.ai_cli.ask

COURSE = Path(__file__).parents[2] / 'database/course'
DAY = dt.date(2026, 10, 26)


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(practice.ai_cli, 'chosen_cli', lambda: '')
    def no_cli(*args, **kwargs):
        raise AssertionError('Tests must not invoke a real AI CLI.')
    monkeypatch.setattr(practice.ai_cli, 'ask', no_cli)
    weeks = tmp_path / 'user/research/learning/weeks'
    weeks.mkdir(parents=True)
    (weeks / 'week-01.md').write_text('# Week 1\n\n## Day 1: Client and server\nA client sends a request.\n\n## Day 2: Caching\nA cache stores reusable results.\n')
    for date in (DAY - dt.timedelta(days=2), DAY):
        directory = tmp_path / 'user/research/daily' / str(date)
        directory.mkdir(parents=True)
        (directory / '03-papers.md').write_text(f'# Research papers {date}\nA saved paper measures retrieval accuracy. Its limited sample does not establish general performance.\n')
    return tmp_path


def context(prompt):
    return json.loads(prompt.split('SAVED_CONTEXT_JSON:\n', 1)[1])


def response(prompt):
    data = context(prompt)
    return json.dumps({'title': f"{data['kind']} practice", 'goal': 'Explain the saved source and apply its central idea.',
        'reason': 'This source is the next available topic in the supplied learning progress.',
        'questions': [{'prompt': f'Explain one supported idea and one limitation, example {index + 1}.',
            'hint': 'Refer to the saved source.', 'difficulty': 'easy', 'minutes': 5,
            'source_ids': [data['sources'][index % len(data['sources'])]['id']],
            'reference_answer': 'Use the central concept and identify its scope.',
            'rubric': ['Names the concept accurately.', 'Explains its scope.']}
            for index in range(data['question_count'])]})


def papers(result, mode='daily'):
    return {slot['kind']: slot['paper'] for slot in result[mode]['papers'] if slot['paper']}


def submit(root, value, day=DAY):
    for question in value['questions']:
        practice.update(root, COURSE, {'paper_id': value['id'], 'question_id': question['id'], 'answer': 'My saved answer.'}, today=day)
    return practice.update(root, COURSE, {'paper_id': value['id'], 'completed': True}, today=day)


def mark(root, identifier, date=DAY, day=None):
    memory.transact(root, lambda data: memory.record(data, 'research', identifier, identifier, True,
        at=f'{date}T12:00:00+05:30', day=day))


def test_status_has_real_configuration_and_no_generated_or_invented_progress(workspace):
    result = practice.status(workspace, COURSE, today=DAY)
    assert result['settings'] == {'automatic': False}
    assert not result['configured'] and result['provider'] == ''
    assert result['daily']['status'] == 'pending' and result['daily']['automatic_ready']
    assert result['weekly']['status'] == 'blocked'
    assert all(slot['paper'] is None for slot in result['daily']['papers'])
    assert memory.transact(workspace)['history'] == []
    assert practice.settings(workspace, {'automatic': True}) == {'automatic': True}
    assert practice.status(workspace, COURSE, today=DAY)['settings']['automatic']


def test_daily_sources_are_current_dsa_first_unfinished_plan_and_oldest_unread_paper(workspace):
    calls = []
    def ask(prompt):
        calls.append(context(prompt))
        return response(prompt)
    memory.transact(workspace)
    before = (workspace / 'user/memory/learning.json').read_bytes()
    result = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=ask)
    saved = papers(result)
    assert len(calls) == len(saved) == 3 and result['daily']['status'] == 'ready'
    assert saved['dsa']['source_ids'] == ['dsa/hashing']
    assert saved['learning']['source_ids'] == ['plan/day-1']
    assert saved['research']['source_ids'] == [f'research/daily/{DAY - dt.timedelta(days=2)}/03-papers.md']
    assert all(len(value['questions']) == 3 and value['goal'] and value['reason'] for value in saved.values())
    assert all(value['questions'][0]['reference_answer'] for value in saved.values())
    assert all(call['pending_sources'] for call in calls)
    assert not result['daily']['needs_generation'] and not result['daily']['automatic_ready']
    assert (workspace / 'user/memory/learning.json').read_bytes() == before


def test_incomplete_papers_and_answers_carry_forward_without_new_ai_calls(workspace):
    initial = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=response)
    value = papers(initial)['learning']
    practice.update(workspace, COURSE, {'paper_id': value['id'], 'question_id': 'q1', 'answer': 'A durable partial answer.'}, today=DAY)
    later = DAY + dt.timedelta(days=10)
    def forbidden(prompt):
        raise AssertionError('Carried papers must not be regenerated.')
    result = practice.generate(workspace, COURSE, 'daily', today=later, ask=forbidden)
    assert {kind: item['id'] for kind, item in papers(result).items()} == {kind: item['id'] for kind, item in papers(initial).items()}
    assert papers(result)['learning']['questions'][0]['answer'] == 'A durable partial answer.'
    assert len(result['next_day']['carry']) == 3
    assert practice.update(workspace, COURSE, {'paper_id': value['id'], 'question_id': 'q2', 'answer': 'Saved after the date changed.'}, today=later)['questions'][1]['answer']


def test_completed_papers_wait_until_tomorrow_and_respect_source_completion(workspace):
    initial = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=response)
    for value in papers(initial).values():
        submit(workspace, value)
    same = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=lambda prompt: pytest.fail('Already completed today'))
    assert same['daily']['status'] == 'completed'
    # Submitting practice never silently completes the actual source lesson.
    assert not memory.transact(workspace)['documents']
    mark(workspace, 'plan/day-1', day=1)
    mark(workspace, papers(initial)['research']['source_ids'][0])
    def finish_dsa(data):
        data['dsa'] = {'days': {str(DAY): {'topic': 'hashing', 'read': True, 'practiced': ['2', '3'], 'completed_at': f'{DAY}T12:00:00+05:30'}}}
    memory.transact(workspace, finish_dsa)
    result = practice.generate(workspace, COURSE, 'daily', today=DAY + dt.timedelta(days=1), ask=response)
    next_papers = papers(result)
    assert next_papers['learning']['source_ids'] == ['plan/day-2']
    assert next_papers['dsa']['source_ids'] == ['dsa/array-patterns']
    assert next_papers['research']['source_ids'] == [f'research/daily/{DAY}/03-papers.md']
    assert all(next_papers[kind]['id'] != papers(initial)[kind]['id'] for kind in next_papers)


def test_submission_is_explicit_complete_idempotent_and_rejects_late_edits(workspace):
    value = papers(practice.generate(workspace, COURSE, 'daily', today=DAY, ask=response))['dsa']
    with pytest.raises(ValueError, match='every question'):
        practice.update(workspace, COURSE, {'paper_id': value['id'], 'completed': True}, today=DAY)
    submitted = submit(workspace, value)
    before = (workspace / 'user/memory/practice.json').read_bytes()
    again = practice.update(workspace, COURSE, {'paper_id': value['id'], 'completed': True}, today=DAY + dt.timedelta(days=1))
    assert again['completed_at'] == submitted['completed_at']
    assert (workspace / 'user/memory/practice.json').read_bytes() == before
    with pytest.raises(practice.Conflict, match='already submitted'):
        practice.update(workspace, COURSE, {'paper_id': value['id'], 'question_id': 'q1', 'answer': 'A replacement answer.'}, today=DAY)
    with pytest.raises(ValueError, match='question'):
        practice.update(workspace, COURSE, {'paper_id': value['id'], 'question_id': 'q99', 'answer': 'Invalid question.'}, today=DAY)
    assert practice.paper(workspace, value['id'])['completed_at']


def test_regeneration_adapts_to_real_attempt_counts_without_skipping_unread_source(workspace):
    initial = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=response)
    submit(workspace, papers(initial)['dsa'])
    seen = []
    def ask(prompt):
        seen.append(context(prompt))
        return response(prompt)
    result = practice.generate(workspace, COURSE, 'daily', today=DAY + dt.timedelta(days=1), ask=ask)
    assert len(seen) == 1 and seen[0]['kind'] == 'dsa'
    assert seen[0]['previous_completed_papers'] == 1 and seen[0]['previous_attempted_questions'] == 3
    assert papers(result)['dsa']['source_ids'] == ['dsa/hashing']
    assert len(seen[0]['previous_questions']) == 3


def test_weekly_exam_only_uses_completed_current_sources_in_last_seven_days(workspace):
    recent = DAY - dt.timedelta(days=1)
    mark(workspace, 'plan/day-1', recent, day=1)
    old_research = f'research/daily/{DAY - dt.timedelta(days=2)}/03-papers.md'
    mark(workspace, old_research, recent)
    mark(workspace, 'practice/p-not-learning-content', recent)
    def done(data):
        data['dsa'] = {'days': {
            str(recent): {'topic': 'hashing', 'read': True, 'practiced': ['2', '3'], 'completed_at': f'{recent}T12:00:00+05:30'},
            str(DAY - dt.timedelta(days=9)): {'topic': 'array-patterns', 'read': True, 'practiced': [], 'completed_at': f'{DAY - dt.timedelta(days=9)}T12:00:00+05:30'}}}
    memory.transact(workspace, done)
    seen = []
    def ask(prompt):
        seen.append(context(prompt))
        return response(prompt)
    result = practice.generate(workspace, COURSE, 'weekly', today=DAY, ask=ask)
    values = papers(result, 'weekly')
    assert len(values) == 3
    assert {source['id'] for call in seen for source in call['sources']} == {'dsa/hashing', 'plan/day-1', old_research}
    assert all(source['read'] for call in seen for source in call['sources'])
    assert all(not call['pending_sources'] and call['question_count'] == 5 for call in seen)
    assert result['weekly']['window_start'] == str(DAY - dt.timedelta(days=6))
    assert values['learning']['sources'][0]['route'] == '#/learning/read/plan%2Fday-1?from=practice'
    assert values['dsa']['sources'][0]['route'] == '/course/#/02-dsa/01-arrays-strings-hashing'
    assert all('reference_answer' not in question and 'rubric' not in question for value in values.values() for question in value['questions'])
    finished = submit(workspace, values['research'])
    assert all(question['reference_answer'] and question['rubric'] for question in finished['questions'])


def test_missing_research_is_blocked_and_never_fabricated(workspace):
    for path in (workspace / 'user/research/daily').glob('*/03-papers.md'):
        mark(workspace, 'research/' + path.relative_to(workspace / 'user/research').as_posix())
    seen = []
    def ask(prompt):
        seen.append(context(prompt)['kind'])
        return response(prompt)
    result = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=ask)
    slot = result['daily']['papers'][2]
    assert seen == ['dsa', 'learning'] and slot['status'] == 'blocked' and slot['paper'] is None
    assert 'No unread research' in slot['reason']


def test_missing_first_learning_day_does_not_jump_to_day_two(workspace):
    path = workspace / 'user/research/learning/weeks/week-01.md'
    path.write_text('## Day 2: Caching\nA real second lesson.\n')
    result = practice.generate(workspace, COURSE, 'daily', today=DAY + dt.timedelta(days=20), ask=response)
    assert result['daily']['papers'][1]['status'] == 'blocked'
    assert 'day 1' in result['daily']['papers'][1]['reason']


@pytest.mark.parametrize('invalid', ['not json', '{}', 'foreign-source', 'html', 'wrong-count', 'wrong-duration', 'duplicate-fields'])
def test_malformed_ai_never_becomes_saved_questions(workspace, invalid):
    def ask(prompt):
        if invalid in ('not json', '{}'):
            return invalid
        value = json.loads(response(prompt))
        if invalid == 'foreign-source':
            value['questions'][0]['source_ids'] = ['research/nonexistent.md']
        elif invalid == 'html':
            value['questions'][0]['prompt'] = '<script>unsafe</script>'
        elif invalid == 'wrong-count':
            value['questions'].pop()
        elif invalid == 'wrong-duration':
            value['questions'][0]['minutes'] = True
        else:
            return '{"title":"one","title":"two"}'
        return json.dumps(value)
    result = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=ask)
    assert result['daily']['status'] == 'error' and result['daily']['job']['status'] == 'error'
    assert not papers(result) and not result['daily']['automatic_ready']
    assert practice._transact(workspace)['papers'] == {}


def test_partial_generation_failure_keeps_other_papers_and_retry_only_fills_missing(workspace):
    def partial(prompt):
        if context(prompt)['kind'] == 'learning':
            raise RuntimeError('private secret from CLI stderr')
        return response(prompt)
    first = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=partial)
    assert set(papers(first)) == {'dsa', 'research'} and first['daily']['status'] == 'partial'
    assert 'private secret' not in json.dumps(first)
    seen = []
    def retry(prompt):
        seen.append(context(prompt)['kind'])
        return response(prompt)
    second = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=retry)
    assert seen == ['learning'] and second['daily']['status'] == 'ready'
    assert papers(first)['dsa']['id'] == papers(second)['dsa']['id']


def test_missing_cli_is_clear_and_does_not_attempt_process_launch(workspace):
    result = practice.generate(workspace, COURSE, 'daily', today=DAY)
    assert result['daily']['status'] == 'error'
    assert 'No configured AI CLI' in result['daily']['job']['error']
    assert not papers(result)


def test_generation_claim_prevents_parallel_duplicate_calls(workspace):
    started, release = threading.Event(), threading.Event()
    calls = []
    def slow(prompt):
        calls.append(context(prompt)['kind'])
        started.set()
        assert release.wait(10)
        return response(prompt)
    with ThreadPoolExecutor(max_workers=2) as pool:
        future = pool.submit(practice.generate, workspace, COURSE, 'daily', today=DAY, ask=slow)
        assert started.wait(10)
        second = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=lambda prompt: pytest.fail('Duplicate CLI call'))
        assert second['daily']['status'] == 'generating'
        release.set()
        assert future.result()['daily']['status'] == 'ready'
    assert calls == ['dsa', 'learning', 'research']


def test_expired_claim_recovers_without_losing_saved_answers(workspace):
    initial = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=response)
    value = papers(initial)['dsa']
    practice.update(workspace, COURSE, {'paper_id': value['id'], 'question_id': 'q1', 'answer': 'Preserved.'}, today=DAY)
    practice._transact(workspace, lambda data: data['jobs']['daily'].update(status='running', expires_at=0))
    recovered = practice.status(workspace, COURSE, today=DAY)
    assert recovered['daily']['job']['status'] == 'error'
    assert papers(recovered)['dsa']['questions'][0]['answer'] == 'Preserved.'
    retried = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=lambda prompt: pytest.fail('No missing paper'))
    assert retried['daily']['job']['status'] == 'completed'


def test_superseded_worker_cannot_overwrite_recovered_generation(workspace):
    started, release = threading.Event(), threading.Event()
    def old_worker(prompt):
        started.set()
        assert release.wait(10)
        return response(prompt)
    with ThreadPoolExecutor(max_workers=2) as pool:
        old = pool.submit(practice.generate, workspace, COURSE, 'daily', today=DAY, ask=old_worker)
        assert started.wait(10)
        practice._transact(workspace, lambda data: data['jobs']['daily'].update(expires_at=0))
        replacement = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=response)
        ids = {kind: value['id'] for kind, value in papers(replacement).items()}
        release.set()
        finished = old.result()
    assert {kind: value['id'] for kind, value in papers(finished).items()} == ids
    assert len(practice._transact(workspace)['papers']) == 3
    assert finished['daily']['job']['status'] == 'completed'


def test_source_context_is_bounded_and_omits_contact_details(workspace):
    path = workspace / 'user/research/learning/weeks/week-01.md'
    path.write_text('## Day 1: Learning\nContact someone@example.test or +91 9876543210.\n' + 'A saved concept. ' * 2000)
    seen = []
    def ask(prompt):
        seen.append(context(prompt))
        return response(prompt)
    practice.generate(workspace, COURSE, 'daily', today=DAY, ask=ask)
    learning = next(value for value in seen if value['kind'] == 'learning')
    text = learning['sources'][0]['text']
    assert len(text) <= 6000 and 'someone@example.test' not in text and '9876543210' not in text
    assert '[email omitted]' in text and '[number omitted]' in text


def test_distinct_concurrent_answer_saves_are_not_lost(workspace):
    value = papers(practice.generate(workspace, COURSE, 'daily', today=DAY, ask=response))['dsa']
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(practice.update, workspace, COURSE,
            {'paper_id': value['id'], 'question_id': question['id'], 'answer': question['id'] + ' saved'}, today=DAY)
            for question in value['questions']]
        for future in futures:
            future.result()
    final = practice.paper(workspace, value['id'])
    assert all(question['answer'] == question['id'] + ' saved' for question in final['questions'])


def test_production_generation_uses_configured_cli_without_tools(workspace, monkeypatch):
    monkeypatch.setattr(practice.ai_cli, 'chosen_cli', lambda: 'claude')
    calls = []
    def ask(prompt, **kwargs):
        calls.append(kwargs)
        return response(prompt)
    monkeypatch.setattr(practice.ai_cli, 'ask', ask)
    result = practice.generate(workspace, COURSE, 'daily', today=DAY)
    assert result['configured'] and result['provider'] == 'claude'
    assert calls == [{'cli': 'claude', 'timeout_s': 180, 'web': False}] * 3


def test_corrupt_practice_storage_is_not_reset(workspace):
    practice.status(workspace, COURSE, today=DAY)
    path = workspace / 'user/memory/practice.json'
    path.write_text('{broken')
    with pytest.raises(ValueError, match='not been reset'):
        practice.status(workspace, COURSE, today=DAY)
    assert path.read_text() == '{broken'


def test_automatic_settings_read_has_no_side_effects_and_invalid_settings_fail_closed(tmp_path):
    assert practice.get_settings(tmp_path) == {'automatic': False}
    assert not practice.automatic_enabled(tmp_path)
    assert not (tmp_path / 'user/memory').exists()
    practice.settings(tmp_path, {'automatic': True})
    assert practice.automatic_enabled(tmp_path)
    path = tmp_path / 'user/memory/practice.json'
    data = json.loads(path.read_text())
    data['settings']['automatic'] = 'yes'
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match='paused'):
        practice.automatic_enabled(tmp_path)


def test_stopped_worker_reconciles_immediately_and_stays_paused_next_day(workspace, monkeypatch):
    monkeypatch.setenv('MORROW_RUN_ID', 'owned-run')
    first = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=response)
    practice._transact(workspace, lambda data: data['jobs']['daily'].update(status='running'))
    practice.reconcile_jobs(workspace, {'runs': [{'id': 'owned-run', 'action': 'learning-practice',
        'shown': 'python learning_practice.py --generate daily', 'running': False, 'status': 'stopped',
        'started_at': f'{DAY}T12:00:00+05:30', 'day': str(DAY), 'exit': -9}]})
    current = practice.status(workspace, COURSE, today=DAY)
    assert current['daily']['job']['status'] == 'error'
    assert papers(current)['dsa']['id'] == papers(first)['dsa']['id']
    later = practice.status(workspace, COURSE, today=DAY + dt.timedelta(days=1))
    assert not later['daily']['automatic_ready'] and later['daily']['job']['status'] == 'error'


def test_preclaim_worker_failure_is_remembered_but_unrelated_failures_are_ignored(workspace):
    practice.reconcile_jobs(workspace, {'runs': [{'id': 'broken-import', 'action': 'learning-practice',
        'shown': 'python learning_practice.py --generate daily', 'running': False, 'status': 'failed',
        'started_at': f'{DAY}T12:00:00+05:30', 'day': str(DAY), 'exit': 1},
        {'id': 'unrelated', 'action': 'pipeline', 'shown': 'python pipeline --generate weekly', 'running': False,
         'status': 'failed', 'started_at': f'{DAY}T13:00:00+05:30', 'day': str(DAY), 'exit': 1}]})
    current = practice.status(workspace, COURSE, today=DAY)
    assert current['daily']['job']['status'] == 'error' and not current['daily']['automatic_ready']
    assert current['weekly']['job'] is None
    retry = practice.generate(workspace, COURSE, 'daily', today=DAY, ask=response)
    assert retry['daily']['job']['status'] == 'completed'


def test_restart_reconciles_a_dead_owned_worker_without_signalling_it(workspace, monkeypatch):
    monkeypatch.setenv('MORROW_RUN_ID', 'old-server-run')
    practice.generate(workspace, COURSE, 'daily', today=DAY, ask=response)
    practice._transact(workspace, lambda data: data['jobs']['daily'].update(status='running'))
    calls = []
    def gone(pid, sig):
        calls.append((pid, sig))
        raise ProcessLookupError
    monkeypatch.setattr(practice.os, 'kill', gone)
    practice.reconcile_jobs(workspace, {'runs': []})
    assert calls == [(os.getpid(), 0)]
    assert practice.status(workspace, COURSE, today=DAY)['daily']['job']['status'] == 'error'


def test_keyboard_cancellation_records_error_and_preserves_partial_papers(workspace):
    def interrupted(prompt):
        if context(prompt)['kind'] == 'learning':
            raise KeyboardInterrupt
        return response(prompt)
    with pytest.raises(KeyboardInterrupt):
        practice.generate(workspace, COURSE, 'daily', today=DAY, ask=interrupted)
    result = practice.status(workspace, COURSE, today=DAY)
    assert set(papers(result)) == {'dsa'}
    assert result['daily']['job']['status'] == 'error' and not result['daily']['automatic_ready']


def test_runner_cli_proxy_keeps_children_in_owned_group_and_restores_normal_calls(monkeypatch):
    original = practice.ai_cli.subprocess
    calls = []
    fake = SimpleNamespace(Popen=lambda *args, **kwargs: calls.append(kwargs))
    monkeypatch.setattr(practice.ai_cli, 'subprocess', fake)
    monkeypatch.setenv('MORROW_RUN_ID', 'owned-run')
    monkeypatch.setattr(practice.os, 'getpgrp', os.getpid)
    with practice._runner_cli_group():
        practice.ai_cli.subprocess.Popen(['test'], start_new_session=True, text=True)
    assert calls == [{'start_new_session': False, 'text': True}]
    assert practice.ai_cli.subprocess is fake
    monkeypatch.delenv('MORROW_RUN_ID')
    with practice._runner_cli_group():
        assert practice.ai_cli.subprocess is fake
    assert original is not fake


def test_runner_proxy_preserves_ai_timeout_cleanup_and_explicit_retry(workspace, monkeypatch):
    real_subprocess = practice.ai_cli.subprocess
    instances = []
    class TimedOut:
        pid = 987654321
        returncode = -9
        def __init__(self):
            self.waits = 0
            self.killed = False
        def communicate(self, timeout):
            self.waits += 1
            if self.waits == 1:
                raise real_subprocess.TimeoutExpired('test-ai', timeout)
            return '', ''
        def kill(self):
            self.killed = True
    def popen(*args, **kwargs):
        assert kwargs['start_new_session'] is False
        value = TimedOut()
        instances.append(value)
        return value
    fake = SimpleNamespace(Popen=popen, DEVNULL=real_subprocess.DEVNULL, PIPE=real_subprocess.PIPE,
                           TimeoutExpired=real_subprocess.TimeoutExpired)
    monkeypatch.setattr(practice.ai_cli, 'subprocess', fake)
    monkeypatch.setattr(practice.ai_cli, 'ask', REAL_ASK)
    monkeypatch.setattr(practice.ai_cli, 'chosen_cli', lambda wanted=None: 'claude')
    monkeypatch.setenv('MORROW_RUN_ID', 'owned-run')
    monkeypatch.setattr(practice.os, 'getpgrp', os.getpid)
    def no_child_group(pid, sig):
        raise ProcessLookupError
    monkeypatch.setattr(practice.os, 'killpg', no_child_group)
    with practice._runner_cli_group():
        result = practice.generate(workspace, COURSE, 'daily', today=DAY)
    assert len(instances) == 3 and all(value.killed and value.waits == 2 for value in instances)
    assert result['daily']['job']['status'] == 'error' and not result['daily']['automatic_ready']
