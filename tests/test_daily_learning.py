"""Daily learning tests use temporary progress and the bundled course only."""
import datetime as dt
import importlib.util
import json
import http.client
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import threading
import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
from common import learning_memory as memory, learning_activity
import daily_dsa

COURSE = Path(__file__).parents[2] / 'course'
DAY = dt.date(2026, 10, 26)


def task(root, daily, name, done=True, problem=None):
    return daily_dsa.update(root, COURSE, {'date': daily['date'], 'topic': daily['lesson']['id'],
        'task': name, 'done': done, 'problem': problem}, today=dt.date.fromisoformat(daily['date']))


def finish(root, day=DAY):
    daily = daily_dsa.daily(root, COURSE, today=day)
    task(root, daily, 'read')
    for problem in daily['lesson']['practice']:
        task(root, daily, 'practice', problem=problem['id'])
    return task(root, daily, 'complete')


@pytest.mark.parametrize('topic', list(daily_dsa.CATALOG))
def test_all_topics_have_concepts_example_and_practice(topic):
    lesson = daily_dsa.lesson(COURSE, topic)
    assert lesson['concept_html'] and lesson['example']['prompt_html'] and lesson['example']['solution_html']
    assert lesson['practice']
    assert lesson['example']['id'] not in [problem['id'] for problem in lesson['practice']]
    assert all(problem['prompt_html'] and '<pre><code' in problem['solution_html'] for problem in lesson['practice'])


def test_daily_assignment_survives_reload_and_waits_until_tomorrow(tmp_path):
    assert daily_dsa.daily(tmp_path, COURSE, today=DAY)['lesson']['id'] == 'hashing'
    completed = finish(tmp_path)
    assert completed['progress']['completed_at'] and completed['activity']['xp'] == 50
    assert daily_dsa.daily(tmp_path, COURSE, today=DAY)['lesson']['id'] == 'hashing'
    tomorrow = daily_dsa.daily(tmp_path, COURSE, today=DAY + dt.timedelta(days=1))
    assert tomorrow['lesson']['id'] == 'array-patterns'
    assert not tomorrow['progress']['read'] and not tomorrow['progress']['practiced']
    assert tomorrow['activity']['current_streak'] == 1


def test_missing_days_does_not_skip_unfinished_topics(tmp_path):
    first = daily_dsa.daily(tmp_path, COURSE, today=DAY)
    task(tmp_path, first, 'read')
    task(tmp_path, first, 'practice', problem='2')
    later = daily_dsa.daily(tmp_path, COURSE, today=DAY + dt.timedelta(days=9))
    assert later['lesson']['id'] == first['lesson']['id'] and later['progress']['read']
    assert later['progress']['practiced'] == ['2'] and not later['progress']['completed_at']
    assert later['activity']['xp'] == 0


def test_partial_carry_uses_latest_past_assignment_without_mutating_history(tmp_path):
    first = daily_dsa.daily(tmp_path, COURSE, today=DAY)
    task(tmp_path, first, 'read')
    task(tmp_path, first, 'practice', problem='2')
    tomorrow = daily_dsa.daily(tmp_path, COURSE, today=DAY + dt.timedelta(days=1))
    task(tmp_path, tomorrow, 'read', False)
    task(tmp_path, tomorrow, 'practice', False, problem='2')
    future = daily_dsa.daily(tmp_path, COURSE, today=DAY + dt.timedelta(days=10))
    task(tmp_path, future, 'read')
    task(tmp_path, future, 'practice', problem='3')
    middle = daily_dsa.daily(tmp_path, COURSE, today=DAY + dt.timedelta(days=2))
    assert not middle['progress']['read'] and middle['progress']['practiced'] == []
    saved = memory.transact(tmp_path)
    assert saved['dsa']['days'][DAY.isoformat()]['read']
    assert saved['dsa']['days'][DAY.isoformat()]['practiced'] == ['2']


def test_practice_sheet_uses_real_bundled_groups_and_safe_stable_problem_ids(tmp_path):
    sheet = daily_dsa.sheet(tmp_path, COURSE)
    assert len(sheet['groups']) == 11 and sheet['total'] == sheet['matched'] == 72
    assert sheet['solved'] == sheet['attempted'] == 0
    assert 'not difficulty ratings' in sheet['level_note']
    identifiers = [item['id'] for group in sheet['groups'] for item in group['problems']]
    assert len(set(identifiers)) == 72
    assert all(group['total'] == len(group['problems']) and group['completed'] == 0 for group in sheet['groups'])
    for group in sheet['groups']:
        assert group['problems'][0]['level'] == 'Foundation'
        assert group['problems'][-1]['level'] == 'Challenge'
        for item in group['problems']:
            detail = daily_dsa.problem(tmp_path, COURSE, item['id'])
            assert detail['group_id'] == group['id'] and detail['title'] == item['title']
            assert detail['concept_html'] and detail['prompt_html'] and detail['solution_html']
            assert detail['status'] == 'todo' and detail['notes'] == ''
            assert '%2Fproblem-' in item['route']
    filtered = daily_dsa.sheet(tmp_path, COURSE, 'valid anagram')
    assert filtered['total'] == 72 and filtered['matched'] == 1
    assert filtered['groups'][0]['problems'][0]['title'] == 'Valid Anagram'


def test_problem_status_and_notes_persist_without_duplicate_history_or_xp(tmp_path):
    identifier = '01-arrays-strings-hashing/problem-2'
    body = {'id': identifier, 'status': 'attempted', 'notes': 'Count characters; compare frequency maps.\nTry empty strings.'}
    attempted = daily_dsa.update_problem(tmp_path, COURSE, body, today=DAY)
    assert attempted['status'] == 'attempted' and attempted['notes'] == body['notes']
    solved = daily_dsa.update_problem(tmp_path, COURSE, {'id': identifier, 'status': 'solved'}, today=DAY)
    assert solved['notes'] == body['notes']
    path = tmp_path / '.memory/learning.json'; before = path.read_bytes()
    daily_dsa.update_problem(tmp_path, COURSE, {'id': identifier, 'status': 'solved'}, today=DAY)
    assert path.read_bytes() == before
    assert daily_dsa.problem(tmp_path, COURSE, identifier)['status'] == 'solved'
    sheet = daily_dsa.sheet(tmp_path, COURSE)
    assert sheet['solved'] == 1 and sheet['attempted'] == 0 and sheet['groups'][0]['completed'] == 1
    assert learning_activity.summary(memory.transact(tmp_path), DAY)['xp'] == 0
    assert not memory.transact(tmp_path)['history']
    reopened = daily_dsa.update_problem(tmp_path, COURSE, {'id': identifier, 'status': 'todo', 'notes': ''}, today=DAY)
    assert reopened['status'] == 'todo' and reopened['notes'] == ''


@pytest.mark.parametrize('identifier', ['../profile', '../../.env', '01-arrays-strings-hashing/../../.env',
    '01-arrays-strings-hashing/problem-0', '01-arrays-strings-hashing/problem-999',
    '01-arrays-strings-hashing/problem-02', 'unknown/problem-1', '01-arrays-strings-hashing%2Fproblem-2',
    '01-arrays-strings-hashing/problem-' + '1' * 200, None, [], {}])
def test_problem_ids_cannot_open_files_outside_the_catalog(tmp_path, identifier):
    for call in (lambda: daily_dsa.problem(tmp_path, COURSE, identifier),
                 lambda: daily_dsa.update_problem(tmp_path, COURSE, {'id': identifier, 'status': 'solved'})):
        with pytest.raises(ValueError, match='Choose a problem'):
            call()
    assert not (tmp_path / '.memory/learning.json').exists()


@pytest.mark.parametrize('change', [{'status': 'complete'}, {'status': []}, {'notes': None},
    {'notes': {}}, {'notes': 'a' * (daily_dsa.MAX_NOTES + 1)}])
def test_invalid_problem_updates_preserve_saved_progress(tmp_path, change):
    identifier = '01-arrays-strings-hashing/problem-2'
    daily_dsa.update_problem(tmp_path, COURSE, {'id': identifier, 'status': 'attempted', 'notes': 'Keep this note.'})
    path = tmp_path / '.memory/learning.json'; before = path.read_bytes()
    with pytest.raises(ValueError):
        daily_dsa.update_problem(tmp_path, COURSE, {'id': identifier, 'status': 'solved', **change})
    assert path.read_bytes() == before


def test_sheet_and_daily_checklists_share_attempts_without_claiming_solutions(tmp_path):
    first = daily_dsa.daily(tmp_path, COURSE, today=DAY)
    identifier = '01-arrays-strings-hashing/problem-2'
    task(tmp_path, first, 'practice', problem='2')
    assert daily_dsa.problem(tmp_path, COURSE, identifier)['status'] == 'attempted'
    daily_dsa.update_problem(tmp_path, COURSE, {'id': identifier, 'status': 'solved', 'notes': 'Solved with a frequency map.'}, today=DAY)
    task(tmp_path, first, 'practice', False, problem='2')
    assert daily_dsa.problem(tmp_path, COURSE, identifier)['status'] == 'solved'
    daily_dsa.update_problem(tmp_path, COURSE, {'id': identifier, 'status': 'solved'}, today=DAY)
    refreshed = daily_dsa.daily(tmp_path, COURSE, today=DAY)
    assert refreshed['progress']['practiced'] == ['2'] and not refreshed['progress']['completed_at']
    assert not refreshed['progress']['read'] and refreshed['activity']['xp'] == 0
    daily_dsa.update_problem(tmp_path, COURSE, {'id': identifier, 'status': 'todo'}, today=DAY)
    assert daily_dsa.daily(tmp_path, COURSE, today=DAY)['progress']['practiced'] == []
    # Explicitly reopening in the sheet is not undone by an older daily checklist.
    assert daily_dsa.problem(tmp_path, COURSE, identifier)['status'] == 'todo'
    daily_dsa.update_problem(tmp_path, COURSE, {'id': '02-two-pointers-sliding-window/problem-2', 'status': 'solved'}, today=DAY)
    assert daily_dsa.daily(tmp_path, COURSE, today=DAY)['progress']['practiced'] == []


def test_sheet_saved_before_opening_today_seeds_practice_but_never_completion(tmp_path):
    daily_dsa.update_problem(tmp_path, COURSE, {'id': '01-arrays-strings-hashing/problem-2', 'status': 'solved'}, today=DAY)
    current = daily_dsa.daily(tmp_path, COURSE, today=DAY)
    assert current['progress']['practiced'] == ['2'] and not current['progress']['read']
    assert current['activity']['xp'] == 0 and not current['progress']['completed_at']
    completed = finish(tmp_path)
    before = dict(completed['progress'])
    daily_dsa.update_problem(tmp_path, COURSE, {'id': '01-arrays-strings-hashing/problem-2', 'status': 'todo'}, today=DAY)
    assert daily_dsa.daily(tmp_path, COURSE, today=DAY)['progress'] == before


def test_future_sheet_progress_is_not_used_to_fill_an_earlier_daily_assignment(tmp_path):
    daily_dsa.update_problem(tmp_path, COURSE, {'id': '01-arrays-strings-hashing/problem-2', 'status': 'solved'},
                             today=DAY + dt.timedelta(days=10))
    current = daily_dsa.daily(tmp_path, COURSE, today=DAY)
    assert current['progress']['practiced'] == [] and not current['progress']['read']


def test_existing_daily_attempts_import_once_and_preserve_unknown_future_fields(tmp_path):
    first = daily_dsa.daily(tmp_path, COURSE, today=DAY)
    task(tmp_path, first, 'practice', problem='2')
    def legacy(data):
        data['dsa'].pop('problems')
        data['dsa']['future_metadata'] = {'keep': True}
    memory.transact(tmp_path, legacy)
    assert daily_dsa.sheet(tmp_path, COURSE)['attempted'] == 1
    future = {'status': 'solved', 'notes': 'Keep this archived topic.', 'review_count': 3}
    memory.transact(tmp_path, lambda data: data['dsa']['problems'].update({'future-topic/problem-1': future}))
    daily_dsa.update_problem(tmp_path, COURSE, {'id': '01-arrays-strings-hashing/problem-2', 'status': 'todo'}, today=DAY)
    assert daily_dsa.sheet(tmp_path, COURSE)['attempted'] == 0
    assert memory.transact(tmp_path)['dsa']['future_metadata'] == {'keep': True}
    assert memory.transact(tmp_path)['dsa']['problems']['future-topic/problem-1'] == future


def test_problem_saves_are_atomic_for_different_questions(tmp_path):
    identifiers = ['01-arrays-strings-hashing/problem-2', '01-arrays-strings-hashing/problem-3']
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(daily_dsa.update_problem, tmp_path, COURSE,
            {'id': identifier, 'status': 'solved', 'notes': identifier}, today=DAY) for identifier in identifiers]
        for future in futures:
            future.result()
    for identifier in identifiers:
        saved = daily_dsa.problem(tmp_path, COURSE, identifier)
        assert saved['status'] == 'solved' and saved['notes'] == identifier


@pytest.mark.parametrize('broken', [[], {'a': {'status': 'bad'}}, {'a': {'status': 'todo', 'notes': []}},
    {'a': {'status': 'todo', 'notes': '', 'updated_at': 'invalid'}}])
def test_corrupt_sheet_progress_is_reported_without_reset(tmp_path, broken):
    daily_dsa.daily(tmp_path, COURSE, today=DAY)
    path = tmp_path / '.memory/learning.json'
    data = json.loads(path.read_text()); data['dsa']['problems'] = broken
    path.write_text(json.dumps(data)); before = path.read_bytes()
    with pytest.raises(ValueError, match='not been reset'):
        daily_dsa.sheet(tmp_path, COURSE)
    assert path.read_bytes() == before


def test_completion_requires_checklist_and_retries_award_once(tmp_path):
    first = daily_dsa.daily(tmp_path, COURSE, today=DAY)
    with pytest.raises(ValueError, match='checklist'):
        task(tmp_path, first, 'complete')
    task(tmp_path, first, 'read')
    with pytest.raises(ValueError, match='checklist'):
        task(tmp_path, first, 'complete')
    complete = finish(tmp_path)
    repeated = task(tmp_path, complete, 'complete')
    assert repeated['activity']['xp'] == 50 and repeated['activity']['today_count'] == 1
    assert len(memory.transact(tmp_path)['history']) == 1
    with pytest.raises(daily_dsa.Conflict, match='already saved'):
        task(tmp_path, complete, 'read', False)


@pytest.mark.parametrize('change', [{'done': 'true'}, {'task': 'anything'}, {'task': 'practice', 'problem': '999'},
    {'task': 'practice', 'problem': []}, {'task': 'complete', 'done': False}])
def test_invalid_changes_do_not_mutate_saved_progress(tmp_path, change):
    daily_dsa.daily(tmp_path, COURSE, today=DAY)
    path = tmp_path / '.memory/learning.json'; before = path.read_bytes()
    with pytest.raises(ValueError):
        daily_dsa.update(tmp_path, COURSE, {'date': DAY.isoformat(), 'topic': 'hashing', 'task': 'read', 'done': True, **change}, today=DAY)
    assert path.read_bytes() == before


def test_stale_date_and_wrong_topic_do_not_complete_another_day(tmp_path):
    daily_dsa.daily(tmp_path, COURSE, today=DAY)
    for body, today in [({'date': DAY.isoformat(), 'topic': 'hashing'}, DAY + dt.timedelta(days=1)),
                        ({'date': DAY.isoformat(), 'topic': 'tries'}, DAY)]:
        with pytest.raises(daily_dsa.Conflict):
            daily_dsa.update(tmp_path, COURSE, {**body, 'task': 'read', 'done': True}, today=today)
    assert not memory.transact(tmp_path)['history']


def test_concurrent_checklist_saves_preserve_each_step(tmp_path):
    first = daily_dsa.daily(tmp_path, COURSE, today=DAY)
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(task, tmp_path, first, 'read')]
        futures += [executor.submit(task, tmp_path, first, 'practice', True, problem['id']) for problem in first['lesson']['practice']]
        for future in futures:
            future.result()
    assert task(tmp_path, first, 'complete')['activity']['xp'] == 50


def test_full_path_then_revision(tmp_path):
    partial = daily_dsa.daily(tmp_path, COURSE, today=DAY - dt.timedelta(days=1))
    task(tmp_path, partial, 'read')
    task(tmp_path, partial, 'practice', problem='2')
    for offset in range(len(daily_dsa.TOPICS)):
        result = finish(tmp_path, DAY + dt.timedelta(days=offset))
    assert result['completed_topics'] == len(daily_dsa.TOPICS)
    next_day = daily_dsa.daily(tmp_path, COURSE, today=DAY + dt.timedelta(days=len(daily_dsa.TOPICS)))
    assert next_day['revision'] and next_day['lesson']['id'] == 'hashing'
    assert not next_day['progress']['completed_at']
    assert not next_day['progress']['read'] and next_day['progress']['practiced'] == []


def test_existing_progress_survives_initialization(tmp_path):
    memory.set_course(tmp_path, 'intro.md', True, 'Introduction')
    memory.set_document(tmp_path, 'plan/day-1', 'Learning day 1', True, day=1)
    before = memory.transact(tmp_path)
    daily_dsa.daily(tmp_path, COURSE, today=DAY)
    after = memory.transact(tmp_path)
    assert all(after[key] == before[key] for key in ('course', 'documents', 'plan', 'history'))


def test_missing_content_and_corrupt_progress_are_not_reset(tmp_path):
    with pytest.raises(ValueError, match='missing'):
        daily_dsa.daily(tmp_path, tmp_path / 'absent', today=DAY)
    assert not (tmp_path / '.memory/learning.json').exists()
    daily_dsa.daily(tmp_path, COURSE, today=DAY)
    path = tmp_path / '.memory/learning.json'
    data = json.loads(path.read_text()); data['dsa']['days'][DAY.isoformat()]['practiced'] = 'broken'
    path.write_text(json.dumps(data)); before = path.read_bytes()
    with pytest.raises(ValueError, match='not been reset'):
        daily_dsa.daily(tmp_path, COURSE, today=DAY)
    assert path.read_bytes() == before


def activity(events, today=DAY):
    return learning_activity.summary({'history': [dict(at=date, id=identifier, kind=kind, title=identifier, action=action)
        for date, identifier, kind, action in events]}, today)


def test_activity_unifies_sources_and_deduplicates_rechecks():
    data = activity([
        ('2026-10-26T01:00:00+05:30', 'a', 'course', 'completed'),
        ('2026-10-26T02:00:00+05:30', 'a', 'course', 'reopened'),
        ('2026-10-26T03:00:00+05:30', 'a', 'course', 'completed'),
        ('2026-10-26T04:00:00+05:30', 'a', 'research', 'completed'),
        ('2026-10-26T05:00:00+05:30', 'hashing', 'dsa', 'completed'),
        ('2026-10-27T01:00:00+05:30', 'future', 'dsa', 'completed'),
    ])
    assert data['today_count'] == 3 and data['xp'] == 80 and data['current_streak'] == 1
    assert data['days'][-1]['count'] == 3 and data['badges'][0]['earned_at'] == '2026-10-26'


def test_streak_local_dates_leap_day_year_end_and_gaps():
    events = [(f'{date}T23:50:00-10:00', date, 'course', 'completed') for date in
              ['2023-12-31', '2024-01-01', '2024-02-28', '2024-02-29', '2024-03-01']]
    data = activity(events, dt.date(2024, 3, 2))
    assert data['current_streak'] == data['best_streak'] == 3
    assert next(item for item in data['days'] if item['date'] == '2024-02-29')['count'] == 1
    assert activity(events, dt.date(2024, 3, 3))['current_streak'] == 0
    assert activity(events, dt.date(2024, 1, 1))['current_streak'] == 2
    assert next(badge for badge in data['badges'] if badge['id'] == 'three-days')['earned_at'] == '2024-03-01'


def test_badges_and_levels_come_from_real_completions():
    events = [(f'2026-10-{day:02}T12:00:00+05:30', f'topic-{day}', 'dsa', 'completed') for day in range(20, 27)]
    data = activity(events)
    assert data['current_streak'] == data['best_streak'] == 7
    assert data['level'] == 4 and data['level_progress'] == 50 and data['xp'] == 350
    assert {badge['id'] for badge in data['badges'] if badge['earned_at']} == {'first-step', 'three-days', 'seven-days', 'dsa-five'}


def test_undated_imports_never_fabricate_a_streak(tmp_path):
    path = tmp_path / 'data/reports/studied.json'; path.parent.mkdir(parents=True); path.write_text('["old.md"]')
    data = learning_activity.summary(memory.transact(tmp_path), DAY)
    assert data['current_streak'] == data['xp'] == data['total_completions'] == 0
    assert all(day['count'] == 0 for day in data['days'])
    assert len(data['days']) >= 365 and dt.date.fromisoformat(data['days'][0]['date']).weekday() == 0


@pytest.fixture
def http_app(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location('daily_dsa_http_server', Path(__file__).parents[1] / 'server.py')
    dashboard = importlib.util.module_from_spec(spec); spec.loader.exec_module(dashboard)
    monkeypatch.setattr(dashboard.state, 'APPLY', tmp_path)
    monkeypatch.setattr(dashboard.state, 'STUDIED', tmp_path / 'old-studied.json')
    monkeypatch.setattr(dashboard.state, 'COURSE', COURSE)
    app = dashboard.DashboardServer(0)
    thread = threading.Thread(target=app.serve_forever, daemon=True); thread.start()
    def request(method, path, body=None, headers=None):
        client = http.client.HTTPConnection('127.0.0.1', app.server_port)
        client.request(method, path, json.dumps(body) if body is not None else None, {'Content-Type': 'application/json', **(headers or {})})
        response = client.getresponse(); value = json.loads(response.read()); client.close()
        return response.status, value
    yield request, app
    app.shutdown(); app.server_close(); thread.join()


def test_http_no_login_and_same_origin_enforced(http_app):
    request, _ = http_app
    status, daily = request('GET', '/api/learning/dsa')
    assert status == 200 and daily['lesson']['id'] == 'hashing'
    body = {'date': daily['date'], 'topic': 'hashing', 'task': 'read', 'done': True}
    assert request('POST', '/api/learning/dsa', body, {'Origin': 'https://other.example'})[0] == 403
    assert request('POST', '/api/learning/dsa', body, {'Sec-Fetch-Site': 'cross-site'})[0] == 403
    assert request('GET', '/api/learning/activity', headers={'Host': 'other.example'})[0] == 403
    assert request('POST', '/api/learning/dsa', body)[1]['progress']['read']
    assert request('GET', '/api/learning/activity')[1]['today_count'] == 0
    assert request('POST', '/api/learning/dsa', {**body, 'date': '2020-01-01'})[0] == 409


def test_http_practice_sheet_and_problem_progress_are_validated_and_saved(http_app):
    request, _ = http_app
    status, sheet = request('GET', '/api/learning/dsa/sheet')
    assert status == 200 and sheet['total'] == 72
    identifier = sheet['groups'][0]['problems'][1]['id']
    body = {'id': identifier, 'status': 'solved', 'notes': 'Use a character frequency map.'}
    assert request('POST', '/api/learning/dsa/problem', body, {'Origin': 'https://other.example'})[0] == 403
    assert request('POST', '/api/learning/dsa/problem', body, {'Sec-Fetch-Site': 'cross-site'})[0] == 403
    assert request('POST', '/api/learning/dsa/problem', body)[0] == 200
    status, saved = request('GET', '/api/learning/dsa/problem?id=' + identifier)
    assert status == 200 and saved['status'] == 'solved' and saved['notes'] == body['notes']
    assert request('GET', '/api/learning/dsa/sheet')[1]['solved'] == 1
    assert request('GET', '/api/learning/dsa/problem?id=../profile')[0] == 400
    assert request('POST', '/api/learning/dsa/problem', {**body, 'notes': None})[0] == 400
    assert request('GET', '/api/learning/activity')[1]['today_count'] == 0


def test_account_mode_cannot_read_another_users_learning(http_app):
    request, app = http_app
    class Bridge:
        def identity(self, handler):
            return {'id': 'guest', 'role': 'user', 'modules': [], 'email': 'guest@example.test'}
        def is_owner(self, handler, user):
            return False
    app.account_bridge = Bridge()
    for path in ('/api/learning/dsa', '/api/learning/activity', '/api/learning/dsa/sheet',
                 '/api/learning/dsa/problem?id=01-arrays-strings-hashing/problem-2'):
        assert request('GET', path)[0] == 403
