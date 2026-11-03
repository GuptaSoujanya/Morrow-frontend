"""The shared course starts without a resume and keeps old work separate."""
import datetime as dt
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
from common import interview_course, interview_lessons, learning_memory as memory
from web import state
import daily_learning
import dashboard_data
import learning_workspace
import research_learning

COURSE = Path(__file__).parents[2] / 'database/course'


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(state, 'APPLY', tmp_path)
    monkeypatch.setattr(state, 'COURSE', COURSE)
    monkeypatch.setattr(state, 'STUDIED', tmp_path / 'old-studied.json')
    monkeypatch.setattr(state, 'REPORTS', tmp_path / 'user/reports')
    return tmp_path


def test_all_ninety_days_have_real_public_reading_and_practice():
    for day in range(1, 91):
        info = interview_lessons.lesson(day, COURSE)
        assert info['id'] == f'interview/day-{day}' and info['source'] == 'bundled'
        assert len(info['text']) > 1200
        assert all(name in info['text'] for name in ('## Build and test', '## DSA practice', '## Interview and recall', '## Review and finish'))
        assert all(info['lesson'][key] for key in ('ai_ml', 'system_design', 'full_stack', 'dsa'))
        assert '\nFalse\n' not in info['text'] and '\nTrue\n' not in info['text']
    first = interview_lessons.lesson(1, COURSE)['text']
    assert 'summarise_sessions' in first and 'mean_minutes' in first
    assert 'add_five' not in first and 'POST /api/study-summary' in first
    assert 'contiguous block' not in first and 'Reference reading:' not in first


def test_new_course_ignores_resume_and_keeps_legacy_completions(workspace, monkeypatch):
    memory.transact(workspace, lambda data: memory.record(data, 'research', 'plan/day-1', 'Earlier course', True, day=1))
    monkeypatch.setenv('RESUME_PATH', str(workspace / 'missing-resume.pdf'))
    before = memory.transact(workspace)
    current = daily_learning.daily()['plan']
    assert current['available'] and current['source'] == 'bundled'
    assert current['day'] == 1 and current['completed'] == 0
    assert learning_workspace.curriculum()['next_day'] == 1
    research_learning.mark('interview/day-1', True)
    saved = memory.transact(workspace)
    assert saved['plan'] == before['plan'] and saved['documents']['plan/day-1'] == before['documents']['plan/day-1']
    assert interview_course.completed_days(saved) == [1]


def test_course_progress_waits_for_reading_and_survives_missed_dates(workspace):
    day = dt.date(2026, 11, 2)
    assert daily_learning.daily(today=day)['plan']['day'] == 1
    assert daily_learning.daily(today=day + dt.timedelta(days=20))['plan']['day'] == 1
    memory.transact(workspace, lambda data: interview_course.record_completion(data, 1, True, at=f'{day}T12:00:00+05:30'))
    assert daily_learning.daily(today=day)['plan']['read']
    assert daily_learning.daily(today=day + dt.timedelta(days=1))['plan']['day'] == 2
    assert learning_workspace.curriculum()['completed'] == 1


def test_curriculum_is_complete_before_any_generation(workspace):
    result = learning_workspace.curriculum()
    assert result['course']['shared'] and result['total'] == 90
    lessons = [day for week in result['weeks'] for day in week['days']]
    assert [day['day'] for day in lessons] == list(range(1, 91))
    assert all(day['available'] and not day['read'] for day in lessons)
    assert len(result['weeks']) == 13 and len(result['weeks'][-1]['days']) == 6


def test_metadata_views_do_not_assemble_lessons_and_readers_still_work(workspace, monkeypatch):
    memory.transact(workspace, lambda data: interview_course.record_completion(data, 1, True))
    before = interview_course.completed_days(memory.transact(workspace))
    with monkeypatch.context() as patch:
        def no_assembly(*args, **kwargs):
            pytest.fail('Metadata endpoints must not assemble or render a public lesson.')
        patch.setattr(interview_lessons, 'lesson', no_assembly)
        patch.setattr(interview_lessons, 'saved_lesson', no_assembly)
        patch.setattr(interview_lessons, 'render', no_assembly)
        catalog = learning_workspace.curriculum()
        assert catalog['completed'] == 1 and catalog['next_day'] == 2
        assert all(day['available'] and day['source'] == 'bundled'
                   for week in catalog['weeks'] for day in week['days'])
        patch.setattr(learning_workspace, 'curriculum', no_assembly)
        overview = learning_workspace.overview()
        track = next(item for item in overview['tracks'] if item['key'] == 'curriculum')
        assert track['completed'] == 1 and track['total'] == 90
        assert overview['course'] == catalog['course'] and overview['profile'] == catalog['profile']
    material = dashboard_data.artifact('interview/day-2')
    assert material['source'] == 'bundled' and 'Words you need' in material['html']
    assert interview_course.completed_days(memory.transact(workspace)) == before


@pytest.mark.parametrize('metadata,body,expected', [
    (None, '## Day 1: Saved lesson\n\nSaved explanation.', 'bundled'),
    ([], '## Day 1: Saved lesson\n\nSaved explanation.', 'bundled'),
    ({'course_id': 'earlier-plan', 'course_version': 1}, '## Day 1: Saved lesson\n\nSaved explanation.', 'bundled'),
    ({'course_id': 'interview-90', 'course_version': 0}, '## Day 1: Saved lesson\n\nSaved explanation.', 'bundled'),
    ({'course_id': 'interview-90', 'course_version': 1}, '## Day 1: Saved lesson\n\nSaved explanation.', 'bundled'),
    ({'course_id': 'interview-90', 'course_version': 1, 'day_sources': []}, '## Day 1: Saved lesson\n\nSaved explanation.', 'bundled'),
    ({'course_id': 'interview-90', 'course_version': 1, 'day_sources': {'1': {'source': 'generated', 'teaching_version': interview_course.TEACHING_VERSION - 1}}},
     '## Day 1: Saved lesson\n\nSaved explanation.', 'bundled'),
    ({'course_id': 'interview-90', 'course_version': 1, 'day_sources': {'1': {'source': 'bundled', 'teaching_version': interview_course.TEACHING_VERSION}}},
     '## Day 1: Saved lesson\n\nSaved explanation.', 'bundled'),
    ({'course_id': 'interview-90', 'course_version': 1, 'day_sources': {'1': {'source': 'generated', 'teaching_version': interview_course.TEACHING_VERSION}}},
     '## Day 2: Another day\n\nSaved explanation.', 'bundled'),
    ({'course_id': 'interview-90', 'course_version': 1, 'day_sources': {'1': {'source': 'generated', 'teaching_version': interview_course.TEACHING_VERSION}}},
     '## Day 1: Saved lesson\n\nSaved explanation.', 'generated'),
])
def test_roadmap_source_matches_the_actual_reader(workspace, metadata, body, expected):
    path = workspace / 'user/research/learning/interview-90/weeks/week-01.md'
    path.parent.mkdir(parents=True)
    path.write_text(body)
    if metadata is not None:
        path.with_suffix('.meta.json').write_text(json.dumps(metadata))
    catalog = learning_workspace.curriculum()['weeks'][0]['days'][0]
    material = dashboard_data.artifact('interview/day-1')
    assert catalog['available'] and catalog['source'] == material['source'] == expected
    if expected == 'generated':
        assert 'Saved explanation' in material['html']
    else:
        assert 'Words you need' in material['html'] and 'Saved explanation' not in material['html']


def test_missing_optional_chapters_do_not_block_the_lesson(tmp_path):
    info = interview_lessons.lesson(1, tmp_path / 'missing-references')
    assert '### A small example' in info['text'] and '### Check your answer' in info['text']
    assert not info['readings'] and '/course/#/' not in info['text']


def test_generated_course_is_used_only_with_current_provenance(workspace):
    root = workspace / 'user/research/learning'
    path = root / 'interview-90/weeks/week-01.md'
    path.parent.mkdir(parents=True)
    path.write_text('## Day 1: Generated lesson\n\nA generated explanation.\n')
    path.with_suffix('.meta.json').write_text(json.dumps({'course_id': 'earlier-plan', 'course_version': 1}))
    assert research_learning.interview_document(1)['source'] == 'bundled'
    path.with_suffix('.meta.json').write_text(json.dumps({'course_id': 'interview-90', 'course_version': 1}))
    assert research_learning.interview_document(1)['source'] == 'bundled'
    assert 'A generated explanation' in path.read_text()  # Old reading remains saved.
    path.with_suffix('.meta.json').write_text(json.dumps({'course_id': 'interview-90', 'course_version': 1,
        'day_sources': {'1': {'source': 'generated', 'teaching_version': interview_course.TEACHING_VERSION}}}))
    result = dashboard_data.artifact('interview/day-1')
    assert result['source'] == 'generated' and 'A generated explanation' in result['html']


def test_reader_blocks_active_html_trackers_and_private_links():
    result = interview_lessons.render('<script>alert(1)</script>\n\n![image](https://example.test/pixel)\n\n'
        '[private](../../.env) [external](https://example.test/docs) [lesson](#/learning/dsa)')
    assert '<script' not in result and '&lt;script&gt;' in result and '<img' not in result
    assert '[Image omitted]' in result and 'href="#"' in result
    assert 'rel="noopener noreferrer"' in result and 'href="#/learning/dsa"' in result


def test_answers_and_reference_reading_are_closed_disclosures():
    from bs4 import BeautifulSoup
    result = interview_lessons.render(interview_lessons.lesson(1, COURSE)['text'])
    soup = BeautifulSoup(result, 'html.parser')
    answers = [part for part in soup.find_all('details') if part.summary.text == 'Check your answer']
    assert len(answers) == 3 and all(not part.has_attr('open') for part in answers)
    assert all(len(part.text) > 40 for part in answers)
    assert not any(part.find('h2') for part in answers)
    extra = soup.find_all('details')[-1]
    assert extra.summary.text == 'Extra reading (optional)' and extra.find('a')
    assert not soup.find('script')


def test_generated_subject_labels_stay_outside_closed_answers():
    from bs4 import BeautifulSoup
    text = ('### Check your answer\n\nThe answer is 8.\n\n'
            '**System Design: Requests** (25 min)\n\n### Words you need\n\nA request asks for something.')
    soup = BeautifulSoup(interview_lessons.render(text), 'html.parser')
    assert 'System Design' not in soup.details.text
    assert soup.find('strong').find_parent('details') is None


def test_nested_answer_headings_do_not_hide_later_subjects():
    from bs4 import BeautifulSoup
    result = interview_lessons.render('### Check your answer\n\nFirst answer.\n\n'
        '#### Check your answer\n\nSecond answer.\n\n## Next subject\n\nVisible explanation.')
    soup = BeautifulSoup(result, 'html.parser')
    assert result.count('<details>') == result.count('</details>') == 2
    assert soup.h2.find_parent('details') is None
    assert soup.find_all('p')[-1].find_parent('details') is None
