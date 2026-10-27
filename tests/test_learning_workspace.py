import datetime as dt
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
import learning_workspace as workspace
from common import learning_memory as memory
from web import state


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(state, 'APPLY', tmp_path)
    monkeypatch.setattr(state, 'STUDIED', tmp_path / 'studied.json')
    return tmp_path


def test_bookmarks_are_durable_typed_idempotent_and_canonical():
    first = workspace.update({'action': 'bookmark', 'kind': 'paper', 'title': 'One paper', 'url': 'https://arxiv.org/pdf/2610.00001v2.pdf', 'saved': True})
    second = workspace.update({'action': 'bookmark', 'kind': 'paper', 'title': 'One paper', 'url': 'https://arxiv.org/abs/2610.00001', 'saved': True})
    assert first == second
    workspace.update({'action': 'bookmark', 'kind': 'repo', 'title': 'Tool', 'url': 'https://github.com/Org/Tool.git/', 'saved': True})
    items = workspace.collection()['bookmarks']
    assert len(items) == 2 and {item['kind'] for item in items} == {'paper', 'repo'}
    assert items[0]['url'] == 'https://github.com/org/tool'
    workspace.update({'action': 'bookmark', 'kind': 'paper', 'url': 'https://arxiv.org/abs/2610.00001', 'saved': False})
    assert len(workspace.collection()['bookmarks']) == 1
    assert memory.transact(state.APPLY)['history'] == []


@pytest.mark.parametrize('kind,url', [('repo', 'https://example.org/owner/repo'), ('repo', 'https://github.com/owner'),
    ('paper', 'javascript:alert(1)'), ('dsa', '//example.org'), ('paper', 'https://user:pass@example.org'),
    ('resource', 'https://example.org/\nfoo'), ('repo', 'https://github.com/org/repo/issues')])
def test_unsafe_and_non_repository_links_do_not_mutate_storage(kind, url):
    with pytest.raises(ValueError):
        workspace.update({'action': 'bookmark', 'kind': kind, 'title': 'No', 'url': url, 'saved': True})
    assert workspace.collection()['bookmarks'] == []


def test_notes_create_edit_conflict_delete_and_preserve_progress():
    memory.transact(state.APPLY, lambda data: memory.record(data, 'research', 'plan/day-1', 'Learn', True, day=1))
    before = memory.transact(state.APPLY)['history']
    note = workspace.update({'action': 'note', 'title': 'Hashing', 'body': 'Use a set.', 'kind': 'dsa', 'url': '#/learning/dsa'})['note']
    edited = workspace.update({**note, 'action': 'note', 'body': 'O(n) time and O(n) space.'})['note']
    assert edited['id'] == note['id'] and edited['revision'] == 2
    with pytest.raises(ValueError, match='changed in another window'):
        workspace.update({**note, 'action': 'note', 'body': 'Stale overwrite'})
    assert workspace.collection()['notes'][0]['body'] == edited['body']
    with pytest.raises(ValueError, match='changed in another window'):
        workspace.update({**note, 'action': 'delete_note'})
    workspace.update({**edited, 'action': 'delete_note'})
    assert workspace.collection()['notes'] == []
    assert memory.transact(state.APPLY)['history'] == before


def test_parallel_saves_preserve_every_bookmark_and_note():
    def save(n):
        workspace.update({'action': 'bookmark', 'kind': 'repo', 'title': f'Project {n}', 'url': f'https://github.com/org/project-{n}', 'saved': True})
        workspace.update({'action': 'note', 'title': f'Note {n}', 'body': 'Idea'})
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(save, range(12)))
    result = workspace.collection()
    assert len(result['bookmarks']) == len(result['notes']) == 12


def test_new_note_creation_token_makes_parallel_and_lost_response_retries_idempotent():
    body = {'action': 'note', 'title': 'One draft', 'body': 'Saved once.', 'creation_token': 'a' * 32}
    with ThreadPoolExecutor(max_workers=6) as pool:
        notes = list(pool.map(lambda _: workspace.update(body)['note'], range(6)))
    assert all(note == notes[0] for note in notes)
    assert workspace.update(body)['note'] == notes[0]
    assert workspace.collection()['notes'] == [notes[0]]


def test_creation_token_does_not_overwrite_changed_drafts_or_resurrect_deleted_notes():
    body = {'action': 'note', 'title': 'One draft', 'body': 'Original', 'creation_token': 'b' * 32}
    original = workspace.update(body)['note']
    with pytest.raises(ValueError, match='already saved'):
        workspace.update({**body, 'body': 'Changed after an unknown save'})
    edited = workspace.update({**original, 'action': 'note', 'body': 'Updated elsewhere'})['note']
    with pytest.raises(ValueError, match='already saved'):
        workspace.update(body)
    assert workspace.collection()['notes'] == [edited]
    workspace.update({**edited, 'action': 'delete_note'})
    with pytest.raises(ValueError, match='already saved'):
        workspace.update(body)
    assert workspace.collection()['notes'] == []
    assert workspace.update({**body, 'creation_token': 'c' * 32})['note']['id'] != original['id']


@pytest.mark.parametrize('token', ['', True, 123, 'not-a-token', 'A' * 32])
def test_invalid_note_creation_token_does_not_create_note(token):
    with pytest.raises(ValueError, match='creation token'):
        workspace.update({'action': 'note', 'title': 'Invalid', 'body': '', 'creation_token': token})
    assert workspace.collection()['notes'] == []


@pytest.mark.parametrize('action', ['note', 'delete_note'])
def test_note_revision_rejects_boolean_true(action):
    note = workspace.update({'action': 'note', 'title': 'One note', 'body': ''})['note']
    with pytest.raises(ValueError, match='another window'):
        workspace.update({**note, 'action': action, 'revision': True})
    assert workspace.collection()['notes'] == [note]


def test_discovery_keeps_date_original_links_and_two_papers(isolated):
    folder = isolated / 'user/research/daily/2026-10-27'
    folder.mkdir(parents=True)
    (folder / '03-papers.md').write_text('# Papers\n\n' + ''.join(
        f'## Paper {n} (2026)\n[Related](https://github.com/org/tool-{n})\n[Source](https://arxiv.org/abs/2610.0000{n})\nA method.\n' for n in range(1, 4)))
    (folder / '06-repositories.md').write_text('# Repositories\n\n## org/tool\nhttps://github.com/org/tool\nA useful project.\n## Unsafe\njavascript:alert(1)\n')
    discovery = workspace.discovery('2026-10-27')
    papers = discovery['sections'][0]['items']
    assert len(papers) == 2 and papers[0]['url'] == 'https://arxiv.org/abs/2610.00001'
    assert len(discovery['sections'][-1]['items']) == 1
    assert all(not section['available'] for section in workspace.discovery('2026-10-28')['sections'])
    with pytest.raises(ValueError):
        workspace.discovery('../../other')


def test_curriculum_shares_progress_and_does_not_invent_missing_days(isolated):
    root = isolated / 'user/research/learning/weeks'
    root.mkdir(parents=True)
    (root / 'week-01.md').write_text('# Week 1: Reliable APIs\n\n## Day 1: Requests\nLearn.\n\n## Day 2: Caching\nTry.\n')
    memory.transact(state.APPLY, lambda data: memory.record(data, 'research', 'plan/day-1', 'Requests', True, day=1))
    data = workspace.curriculum()
    assert data['completed'] == 1 and data['next_day'] == 2
    assert len(data['weeks']) == 13 and sum(len(week['days']) for week in data['weeks']) == 90
    assert data['weeks'][0]['days'][0]['read'] and data['weeks'][0]['days'][1]['available']
    assert not data['weeks'][0]['days'][2]['available']


def test_paper_progress_is_individual_and_completes_daily_reading_once(isolated, monkeypatch):
    monkeypatch.setattr(state, 'COURSE', isolated / 'course')
    folder = isolated / 'user/research/daily/2026-10-27'
    folder.mkdir(parents=True)
    (folder / '03-papers.md').write_text('# Papers\n\n## A (2026)\nhttps://arxiv.org/abs/2610.00001\n\n## B (2026)\nhttps://arxiv.org/abs/2610.00002\n')
    items = workspace.discovery('2026-10-27')['sections'][0]['items']
    body = {'action': 'reading', 'date': '2026-10-27', 'id': items[0]['id'], 'read': True}
    assert not workspace.update(body)['section_complete']
    assert not memory.transact(isolated)['history']
    result = workspace.discovery('2026-10-27')['sections'][0]['items']
    assert result[0]['read'] and not result[1]['read']
    assert workspace.update({**body, 'id': items[1]['id']})['section_complete']
    workspace.update({**body, 'id': items[1]['id']})
    assert len(memory.transact(isolated)['history']) == 1
    workspace.update({**body, 'read': False})
    assert not memory.transact(isolated)['documents']['research/daily/2026-10-27/03-papers.md']['done']
    assert workspace.discovery('2026-10-27')['sections'][0]['items'][1]['read']
    workspace.mark_discovery_document({'id': 'research/daily/2026-10-27/03-papers.md', 'key': 'research/daily/2026-10-27/03-papers.md', 'title': 'Papers'}, True)
    assert all(item['read'] for item in workspace.discovery('2026-10-27')['sections'][0]['items'])
    workspace.mark_discovery_document({'id': 'research/daily/2026-10-27/03-papers.md', 'key': 'research/daily/2026-10-27/03-papers.md', 'title': 'Papers'}, False)
    assert not any(item['read'] for item in workspace.discovery('2026-10-27')['sections'][0]['items'])


def test_progress_area_counts_use_real_totals_and_keep_resume_separate(isolated, monkeypatch):
    monkeypatch.setattr(state, 'COURSE', isolated / 'course')
    resume = isolated / 'user/research/resume-learning'
    resume.mkdir(parents=True)
    (resume / '01-serving.md').write_text('# Serving\n\nResume topic.')
    (resume / '02-evaluation.md').write_text('# Evaluation\n\nResume topic.')
    memory.transact(isolated, lambda data: memory.record(data, 'research', 'research/resume-learning/01-serving.md', 'Serving', True))
    data = workspace.overview()
    tracks = {track['key']: track for track in data['tracks']}
    assert tracks['resume']['completed'] == 1 and tracks['resume']['total'] == 2 and tracks['resume']['percent'] == 50
    assert tracks['curriculum']['completed'] == 0 and tracks['curriculum']['total'] == 90
    assert tracks['papers']['total'] == 0 and tracks['courses']['total'] == 0
    assert len(data['week']) == 7
    memory.transact(isolated, lambda data: memory.record(data, 'research', 'plan/day-1', 'Today', True, day=1))
    assert workspace.overview()['current_day'] == 1
    assert workspace.curriculum()['next_day'] == 2


def test_news_discovery_keeps_each_headline_and_its_own_source():
    text = '''# Tech news

## Models and labs
**A new evaluation release** — 2026-10-27
Teams can compare their models.
**Source:** [Release](https://example.org/evaluation)

- **A smaller model arrives** — 2026-10-26
Run a local experiment. [Announcement](https://example.org/small-model)

## Tools and frameworks
1. **[A new tracing tool](https://example.org/tracing)**
Inspect agent calls and compare timings.
**Why it matters:** Easier debugging.

**An unverified story**
No source was provided.

## At a glance
[Category counts](https://example.org/counts)
## Try this week
[An exercise](https://example.org/exercise)
## Sources
[More sources](https://example.org/sources)
'''
    items = workspace._resources(text, 'resource', 'research/daily/2026-10-27/04-tech-news.md')
    assert [item['title'] for item in items] == [
        'A new evaluation release', 'A smaller model arrives', 'A new tracing tool']
    assert [item['url'] for item in items] == [
        'https://example.org/evaluation', 'https://example.org/small-model', 'https://example.org/tracing']
    assert 'local experiment' not in items[0]['excerpt']
    assert 'Easier debugging' in items[2]['excerpt']


def test_news_discovery_keeps_existing_single_story_headings():
    text = '# News\n## An engineering release\n**Date:** 2026-10-27\n[Source](https://example.org/release)\n'
    items = workspace._resources(text, 'resource', 'research/daily/2026-10-27/04-tech-news.md')
    assert len(items) == 1 and items[0]['title'] == 'An engineering release'
    assert items[0]['url'] == 'https://example.org/release'


@pytest.mark.parametrize('careers', [
    '[Careers](https://example.org/team)',
    'https://company.example/careers',
    'https://jobs.company.example/engineering',
    'https://boards.greenhouse.io/company',
    'https://jobs.ashbyhq.com/company',
])
def test_company_discovery_prefers_careers_to_earlier_news(careers):
    text = '# Companies\n## Example\n[Engineering news](https://company.example/blog/release)\n' + careers
    items = workspace._resources(text, 'resource', 'research/daily/2026-10-27/05-companies.md')
    assert len(items) == 1
    expected = careers.split('](', 1)[1][:-1] if careers.startswith('[') else careers
    assert items[0]['url'] == expected


def test_company_discovery_retains_source_without_inventing_careers_link():
    text = '# Companies\n## Example\n[Engineering news](https://company.example/blog/release)\n'
    items = workspace._resources(text, 'resource', 'research/daily/2026-10-27/05-companies.md')
    assert items[0]['url'] == 'https://company.example/blog/release'


def test_refreshed_papers_start_unread_and_preserve_historical_progress(isolated, monkeypatch):
    monkeypatch.setattr(state, 'COURSE', isolated / 'course')
    folder = isolated / 'user/research/daily/2026-10-27'
    folder.mkdir(parents=True)
    path = folder / '03-papers.md'
    def papers(numbers):
        path.write_text('# Papers\n\n' + '\n'.join(f'## Paper {n} (2026)\nhttps://arxiv.org/abs/2610.0000{n}\n' for n in numbers))
    papers([1, 2])
    identifier = 'research/daily/2026-10-27/03-papers.md'
    workspace.mark_discovery_document({'id': identifier, 'key': identifier, 'title': 'Papers'}, True)
    history = memory.transact(isolated)['history']
    assert len(history) == 1

    papers([3, 4])
    # Progress can be the first reader after generation; it must reconcile before
    # counting completions, without erasing the previous reading's earned history.
    progress = workspace.overview()
    current = workspace.discovery('2026-10-27')['sections'][0]['items']
    assert not any(item['read'] for item in current)
    stored = memory.transact(isolated)
    assert not stored['documents'][identifier]['done']
    assert stored['history'] == history
    paper_progress = next(track for track in progress['tracks'] if track['key'] == 'papers')
    assert (paper_progress['completed'], paper_progress['total']) == (2, 4)
    workspace.update({'action': 'reading', 'date': '2026-10-27', 'id': current[0]['id'], 'read': True})
    assert not memory.transact(isolated)['documents'][identifier]['done']
    workspace.update({'action': 'reading', 'date': '2026-10-27', 'id': current[1]['id'], 'read': True})
    assert memory.transact(isolated)['documents'][identifier]['done']


def test_repeated_repository_readings_are_independent_between_dates(isolated, monkeypatch):
    monkeypatch.setattr(state, 'COURSE', isolated / 'course')
    def prepare(date):
        folder = isolated / 'user/research/daily' / date
        folder.mkdir(parents=True)
        (folder / '06-repositories.md').write_text('# Repositories\n\n## org/tool\nhttps://github.com/org/tool\n')
        return workspace.discovery(date)['sections'][-1]['items'][0]
    first = prepare('2026-10-26')
    workspace.update({'action': 'reading', 'date': '2026-10-26', 'id': first['id'], 'read': True})
    second = prepare('2026-10-27')
    assert first['id'] == second['id'] and not second['read']
    workspace.update({'action': 'reading', 'date': '2026-10-27', 'id': second['id'], 'read': True})
    workspace.update({'action': 'reading', 'date': '2026-10-26', 'id': first['id'], 'read': False})
    assert not workspace.discovery('2026-10-26')['sections'][-1]['items'][0]['read']
    assert workspace.discovery('2026-10-27')['sections'][-1]['items'][0]['read']
    stored = memory.transact(isolated)
    assert not stored['documents']['research/daily/2026-10-26/06-repositories.md']['done']
    assert stored['documents']['research/daily/2026-10-27/06-repositories.md']['done']
    repositories = next(track for track in workspace.overview()['tracks'] if track['key'] == 'repos')
    assert (repositories['completed'], repositories['total']) == (1, 1)


def test_legacy_document_completion_binds_once_to_its_saved_content(isolated):
    folder = isolated / 'user/research/daily/2026-10-27'
    folder.mkdir(parents=True)
    path = folder / '06-repositories.md'
    path.write_text('# Repositories\n\n## org/old\nhttps://github.com/org/old\n')
    identifier = 'research/daily/2026-10-27/06-repositories.md'
    memory.transact(isolated, lambda data: memory.record(data, 'research', identifier, 'Repositories', True))
    history = memory.transact(isolated)['history']
    assert workspace.discovery('2026-10-27')['sections'][-1]['items'][0]['read']
    path.write_text('# Repositories\n\n## org/new\nhttps://github.com/org/new\n')
    assert not workspace.discovery('2026-10-27')['sections'][-1]['items'][0]['read']
    assert memory.transact(isolated)['history'] == history


def test_same_source_in_two_categories_requires_its_document(isolated):
    folder = isolated / 'user/research/daily/2026-10-27'
    folder.mkdir(parents=True)
    for filename in ['04-tech-news.md', '05-companies.md']:
        (folder / filename).write_text('# Discovery\n\n## Company\nhttps://company.example/jobs\n')
    tech = workspace.discovery('2026-10-27')['sections'][1]
    company = workspace.discovery('2026-10-27')['sections'][2]
    body = {'action': 'reading', 'date': '2026-10-27', 'id': tech['items'][0]['id'], 'read': True}
    with pytest.raises(ValueError, match='Refresh'):
        workspace.update(body)
    workspace.update({**body, 'document': company['document']})
    current = workspace.discovery('2026-10-27')['sections']
    assert not current[1]['items'][0]['read'] and current[2]['items'][0]['read']
