"""Daily Learning reads existing material and preserves one shared completion history."""
import datetime as dt
import http.client
import importlib.util
import json
from pathlib import Path
import sys
import threading

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
from common import learning_activity, learning_memory as memory
from web import state
import daily_learning
import dashboard_data
import research_learning

DAY = dt.date.today()   # completions are stamped with the local date, so the suite moves with it


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    for key, relative in [('APPLY', '.'), ('COURSE', 'course'),
                          ('REPORTS', 'data/reports'), ('STUDIED', 'data/reports/studied.json')]:
        monkeypatch.setattr(state, key, tmp_path / relative)
    monkeypatch.setenv('COURSE_START_DATE', DAY.isoformat())
    course = state.COURSE / '01-system-design'; course.mkdir(parents=True)
    (state.COURSE / '_sidebar.md').write_text('- **Systems**\n  - [Introduction](01-system-design/intro.md)\n')
    (course / 'intro.md').write_text('# Introduction\nA saved lesson.')
    weeks = tmp_path / 'user/research/learning/weeks'; weeks.mkdir(parents=True)
    (weeks / 'week-01.md').write_text('''# Week 1

## Day 1: Client and server

Read the first topic. [External reference](https://example.test/reference).
<script>alert('unsafe')</script>
![Untrusted image](https://example.test/tracker.png)
[Private file](../../../../.env)

## Day 2: Caching

Read the second topic.
''')
    return tmp_path


def complete(root, day=1, date=DAY):
    return memory.transact(root, lambda data: memory.record(data, 'research', f'plan/day-{day}',
        f'Learning day {day}', True, at=f'{date}T12:00:00+05:30', day=day))


def test_saved_plan_and_course_are_available_without_fabricated_progress(workspace):
    result = daily_learning.daily(today=DAY)
    plan = result['plan']
    assert result['date'] == DAY.isoformat() and plan['available']
    assert plan['title'] == 'Client and server' and plan['day'] == 1 and plan['total'] == 90
    assert not plan['read'] and plan['completed'] == 0
    assert result['course']['title'] == 'Introduction' and not result['course']['read']
    assert result['course']['route'] == '01-system-design/intro'
    assert plan['route'] == '#/learning/plan' and result['extras'] == []
    assert not memory.transact(workspace)['history']


def test_plan_uses_existing_safe_document_renderer(workspace):
    html = daily_learning.daily(today=DAY)['plan']['content_html']
    assert '<script' not in html and '&lt;script&gt;' in html and '<img' not in html
    assert '[Image omitted]' in html and 'href="#"' in html
    assert 'rel="noopener noreferrer"' in html


def test_completed_reading_stays_today_then_advances_tomorrow(workspace):
    complete(workspace)
    before = memory.transact(workspace)
    today = daily_learning.daily(today=DAY)['plan']
    assert today['day'] == 1 and today['read'] and today['completed'] == 1
    tomorrow = daily_learning.daily(today=DAY + dt.timedelta(days=1))['plan']
    assert tomorrow['day'] == 2 and not tomorrow['read']
    assert memory.transact(workspace) == before
    activity = learning_activity.summary(before, DAY)
    assert activity['xp'] == 10 and activity['today_count'] == 1


def test_dated_document_fallback_preserves_completed_today(workspace):
    complete(workspace)
    memory.transact(workspace, lambda data: data['plan'].pop('marked'))
    assert daily_learning.daily(today=DAY)['plan']['day'] == 1
    assert daily_learning.daily(today=DAY)['plan']['read']
    assert daily_learning.daily(today=DAY + dt.timedelta(days=1))['plan']['day'] == 2


def test_reopened_day_is_available_to_finish_again(workspace):
    complete(workspace)
    research_learning.mark('plan/day-1', False)
    result = daily_learning.daily(today=DAY)
    assert result['plan']['day'] == 1 and not result['plan']['read']
    assert result['plan']['completed'] == 0
    assert learning_activity.summary(memory.transact(workspace), DAY)['xp'] == 10


def test_stored_legacy_progress_and_course_status_are_preserved(workspace):
    progress = workspace / 'user/research/learning/progress.json'
    progress.write_text('{"done":[1],"start":"2026-10-20"}')
    state.STUDIED.parent.mkdir(parents=True)
    state.STUDIED.write_text('["01-system-design/intro.md"]')
    result = daily_learning.daily(today=DAY)
    assert result['plan']['day'] == 2 and result['plan']['completed'] == 1
    assert result['course']['read']
    assert not memory.transact(workspace)['history']
    assert progress.read_text() == '{"done":[1],"start":"2026-10-20"}'


def test_missing_plan_is_explicit_and_course_still_works(workspace):
    path = workspace / 'user/research/learning/weeks/week-01.md'
    path.unlink()
    result = daily_learning.daily(today=DAY)
    assert not result['plan']['available'] and not result['plan']['content_html']
    assert 'no saved reading' in result['plan']['reason']
    assert result['plan']['route'] == '#/learning/library?category=Learning'
    assert result['course']['title'] == 'Introduction'
    assert not memory.transact(workspace)['history']


def test_unavailable_selected_day_does_not_substitute_a_different_reading(workspace):
    complete(workspace, day=1, date=DAY - dt.timedelta(days=1))
    complete(workspace, day=2, date=DAY - dt.timedelta(days=1))
    result = daily_learning.daily(today=DAY)
    assert result['plan']['day'] == 3 and not result['plan']['available']
    assert 'not in the saved' in result['plan']['reason']


def test_missing_completed_reading_preserves_its_known_completion(workspace):
    complete(workspace)
    (workspace / 'user/research/learning/weeks/week-01.md').unlink()
    result = daily_learning.daily(today=DAY)['plan']
    assert result['day'] == 1 and result['read'] and result['completed'] == 1
    assert not result['available'] and result['content_html'] == ''


def test_extras_only_include_the_selected_local_date(workspace):
    for date in [DAY, DAY - dt.timedelta(days=1)]:
        folder = workspace / f'user/research/daily/{date}'; folder.mkdir(parents=True)
        (folder / '01-goal.md').write_text('# A real learning goal\nRead and reflect.')
        (folder / '02-system-design.md').write_text('# A real design reading\nCompare two choices.')
    identifier = f'research/daily/{DAY}/01-goal.md'
    research_learning.mark(identifier, True)
    result = daily_learning.daily(today=DAY)
    assert len(result['extras']) == 2
    assert result['extras'][0]['id'] == identifier and result['extras'][0]['read']
    assert not result['extras'][1]['read']


def saved_briefing(root, date, *, filenames=None):
    folder = root / f'user/research/daily/{date}'
    folder.mkdir(parents=True, exist_ok=True)
    for filename in filenames or ['README.md', '01-goal.md', '02-system-design.md',
                                   '03-papers.md', '04-tech-news.md', '05-companies.md']:
        (folder / filename).write_text(f'# Saved {filename}\n\nAn actual saved note.\n\n## First idea\nRead and reflect.\n\n## Second idea\nTry it yourself.')
    return folder


def test_priority_readings_have_stable_order_real_previews_and_canonical_links(workspace):
    saved_briefing(workspace, DAY)
    before = memory.transact(workspace)
    result = daily_learning.daily(today=DAY)
    assert [item['key'] for item in result['readings']] == ['papers', 'goal', 'design', 'tech', 'companies']
    assert [item['title'] for item in result['readings']] == [
        'Research papers', 'Daily learning goal', 'System design', 'Tech news', 'Companies to apply to']
    for item in result['readings']:
        assert item['available'] and not item['read'] and not item['reason']
        assert item['date'] == DAY.isoformat()
        assert item['excerpt'] == 'An actual saved note.'
        assert item['id'].startswith(f'research/daily/{DAY}/')
        assert item['route'] == '#/learning/read/' + item['id'].replace('/', '%2F') + '?from=today'
    assert result['readings'][0]['preview'] == ['First idea', 'Second idea']
    assert result['readings'][0]['group'] == 'brief:papers'
    assert result['readings'][-1]['group'] == 'brief:companies'
    assert result['briefing']['digest']['id'] == f'research/daily/{DAY}/README.md'
    assert result['briefing']['latest'] == DAY.isoformat()
    assert memory.transact(workspace) == before


def test_priority_readings_never_replace_missing_today_with_an_older_briefing(workspace):
    yesterday = DAY - dt.timedelta(days=1)
    saved_briefing(workspace, yesterday)
    saved_briefing(workspace, DAY, filenames=['03-papers.md'])
    research_learning.mark(f'research/daily/{yesterday}/01-goal.md', True)
    result = daily_learning.daily(today=DAY)
    assert result['readings'][0]['available']
    for item in result['readings'][1:]:
        assert not item['available'] and item['id'] is None and not item['read']
        assert item['preview'] == [] and item['excerpt'] == ''
        assert DAY.isoformat() in item['reason']
        assert item['route'] == '#/learning'
    assert result['briefing']['digest'] is None
    assert result['briefing']['available_dates'] == [DAY.isoformat(), yesterday.isoformat()]
    assert len(memory.transact(workspace)['history']) == 1


def test_saved_goal_is_distinct_from_plan_aliases_and_shares_existing_completion(workspace):
    saved_briefing(workspace, DAY)
    learning = workspace / 'user/research/learning'
    (learning / 'daily').mkdir()
    (learning / 'today.md').write_text('# Learning Day 1\n\nThe plan alias.')
    (learning / f'daily/{DAY}.md').write_text('# Learning Day 1\n\nThe same plan day.')
    research_learning.mark('research/learning/today.md', True)
    research_learning.mark(f'research/learning/daily/{DAY}.md', True)
    result = daily_learning.daily(today=DAY)
    assert result['plan']['read'] and result['plan']['completed'] == 1
    assert len(result['readings']) == 5 and not result['readings'][1]['read']
    goal = result['readings'][1]['id']
    research_learning.mark(goal, True)
    research_learning.mark(goal, True)
    assert daily_learning.daily(today=DAY)['readings'][1]['read']
    data = memory.transact(workspace)
    assert len(data['history']) == 2
    assert {event['id'] for event in data['history']} == {'plan/day-1', goal}


def test_reviewing_companies_marks_only_the_reading_and_does_not_create_an_application(workspace):
    saved_briefing(workspace, DAY)
    company = daily_learning.daily(today=DAY)['readings'][-1]
    before = {path.relative_to(workspace) for path in workspace.rglob('*') if path.is_file()}
    research_learning.mark(company['id'], True)
    result = daily_learning.daily(today=DAY)
    assert result['readings'][-1]['read']
    assert all(not item['read'] for item in result['readings'][:-1])
    assert not result['plan']['read'] and not result['course']['read']
    data = memory.transact(workspace)
    assert len(data['history']) == 1
    assert data['history'][0]['kind'] == 'research' and data['history'][0]['id'] == company['id']
    assert {path.relative_to(workspace) for path in workspace.rglob('*') if path.is_file()} == before


def test_empty_daily_material_has_no_digest_or_phantom_progress(workspace):
    result = daily_learning.daily(today=DAY)
    assert len(result['readings']) == 5 and all(not item['available'] for item in result['readings'])
    assert result['briefing'] == {'latest': None, 'available_dates': [], 'digest': None}
    assert not memory.transact(workspace)['history']


def test_archive_filters_saved_day_before_pagination_without_using_modification_dates(workspace):
    yesterday = DAY - dt.timedelta(days=1)
    saved_briefing(workspace, yesterday)
    saved_briefing(workspace, DAY)
    legacy = workspace / f'user/research/daily/{yesterday}.md'
    legacy.write_text('# An older standalone daily note\n\nSaved earlier.')
    result = dashboard_data.artifacts({'date': yesterday.isoformat(), 'size': '2', 'page': '2'})
    assert result['total'] == 7 and result['pages'] == 4 and len(result['items']) == 2
    all_items = dashboard_data.artifacts({'date': yesterday.isoformat(), 'size': '100'})['items']
    assert {item['path'] for item in all_items} == {
        *(f'daily/{yesterday}/{name}' for name in ['README.md', '01-goal.md', '02-system-design.md',
                                                '03-papers.md', '04-tech-news.md', '05-companies.md']),
        f'daily/{yesterday}.md'}
    assert dashboard_data.artifacts({'date': yesterday.isoformat(), 'category': 'Learning'})['total'] == 0
    assert dashboard_data.artifacts({'date': yesterday.isoformat(), 'q': 'standalone'})['total'] == 1
    assert dashboard_data.artifacts({'date': (DAY + dt.timedelta(days=1)).isoformat()})['items'] == []


@pytest.mark.parametrize('date', ['2026-02-30', 'yesterday', '20261026'])
def test_archive_rejects_invalid_dates(workspace, date):
    with pytest.raises(ValueError, match='research date'):
        dashboard_data.artifacts({'date': date})


def test_archive_dates_include_legacy_notes_but_ignore_invalid_calendar_folders(workspace):
    daily = workspace / 'user/research/daily'
    daily.mkdir(parents=True)
    (daily / f'{DAY}.md').write_text('# A standalone daily note')
    saved_briefing(workspace, '2026-02-30')
    result = daily_learning.daily(today=DAY)
    assert result['briefing']['latest'] == DAY.isoformat()
    assert result['briefing']['available_dates'] == [DAY.isoformat()]
    assert not any(item['available'] for item in result['readings'])
    assert result['briefing']['digest'] is None


def test_completed_plan_is_explicit_without_a_fake_next_day(workspace):
    memory.transact(workspace, lambda data: data['plan'].update(done=list(range(1, 91))))
    result = daily_learning.daily(today=DAY)['plan']
    assert result['completed'] == 90 and not result['available']
    assert result['id'] is None and result['day'] is None
    assert 'completed all 90' in result['reason']


@pytest.fixture
def http_app(workspace):
    spec = importlib.util.spec_from_file_location('daily_learning_hub_http_server', Path(__file__).parents[1] / 'server.py')
    dashboard = importlib.util.module_from_spec(spec); spec.loader.exec_module(dashboard)
    app = dashboard.DashboardServer(0)
    thread = threading.Thread(target=app.serve_forever, daemon=True); thread.start()
    def request(method, path, body=None, headers=None):
        client = http.client.HTTPConnection('127.0.0.1', app.server_port)
        client.request(method, path, json.dumps(body) if body is not None else None,
                       {'Content-Type': 'application/json', **(headers or {})})
        response = client.getresponse(); value = json.loads(response.read()); client.close()
        return response.status, value
    yield request, app
    app.shutdown(); app.runner.shutdown(); app.server_close(); thread.join()


def test_http_reading_completion_uses_existing_history_and_stays_visible(http_app):
    request, _ = http_app
    code, result = request('GET', '/api/learning/daily')
    assert code == 200 and result['plan']['day'] == 1
    body = {'id': result['plan']['id'], 'read': True}
    assert request('POST', '/api/research/read', body, {'Origin': 'https://other.example'})[0] == 403
    assert request('POST', '/api/research/read', body)[0] == 200
    assert request('POST', '/api/research/read', body)[0] == 200
    assert request('GET', '/api/learning/daily')[1]['plan']['read']
    activity = request('GET', '/api/learning/activity')[1]
    assert activity['today_count'] == 1 and activity['xp'] == 10
    assert request('GET', '/api/learning/daily', headers={'Host': 'other.example'})[0] == 403


def test_account_guard_blocks_other_users_local_learning(http_app):
    request, app = http_app
    class Bridge:
        def identity(self, handler):
            return {'id': 'guest', 'role': 'user', 'modules': ['learning'], 'email': 'guest@example.test'}
        def is_owner(self, handler, user):
            return False
    app.account_bridge = Bridge()
    assert request('GET', '/api/learning/daily')[0] == 403
