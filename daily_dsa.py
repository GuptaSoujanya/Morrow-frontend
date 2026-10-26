"""Daily DSA lessons assembled from the bundled course, with durable local progress."""
from __future__ import annotations

import datetime as dt
from functools import lru_cache
from pathlib import Path
import re
from urllib.parse import quote

from markdown_it import MarkdownIt
from common import learning_activity, learning_memory as memory

# Stable IDs survive title changes. Problem numbers refer to bundled chapter headings.
TOPICS = (
    ('hashing', 'Hash sets & frequency maps', '01-arrays-strings-hashing', 1, (2, 3)),
    ('array-patterns', 'Grouping & array patterns', '01-arrays-strings-hashing', 4, (5, 6)),
    ('two-pointers', 'Two pointers', '02-two-pointers-sliding-window', 1, (2, 3)),
    ('sliding-window', 'Sliding windows', '02-two-pointers-sliding-window', 4, (5, 6)),
    ('stacks', 'Stacks & queues', '03-stack-queue-linkedlist', 1, (2, 6)),
    ('linked-lists', 'Linked lists', '03-stack-queue-linkedlist', 3, (4, 5)),
    ('binary-search', 'Binary search foundations', '04-binary-search', 1, (2, 3)),
    ('search-boundaries', 'Search boundaries & answers', '04-binary-search', 4, (5, 6)),
    ('tree-traversal', 'Walking through trees', '05-trees-bst', 1, (2, 3)),
    ('binary-search-trees', 'Binary search trees', '05-trees-bst', 5, (6, 7)),
    ('heaps', 'Heaps & priority queues', '06-heaps-priority-queues', 1, (2, 3)),
    ('heap-patterns', 'Scheduling & streaming with heaps', '06-heaps-priority-queues', 4, (5, 6)),
    ('graph-traversal', 'Exploring graphs & grids', '07-graphs', 1, (2, 5)),
    ('graph-paths', 'Graph dependencies & paths', '07-graphs', 3, (4, 6)),
    ('backtracking', 'Backtracking foundations', '08-backtracking', 1, (2, 3)),
    ('constraint-search', 'Searching with constraints', '08-backtracking', 4, (5, 6)),
    ('dynamic-programming', 'One-dimensional dynamic programming', '09-dynamic-programming', 1, (2, 3)),
    ('dp-grids', 'Dynamic programming on sequences', '09-dynamic-programming', 5, (6, 7)),
    ('greedy', 'Making greedy choices', '10-greedy-intervals', 1, (5, 6)),
    ('intervals', 'Working with intervals', '10-greedy-intervals', 2, (3, 4)),
    ('bits', 'Bit manipulation', '11-tries-bit-manipulation', 1, (2, 3)),
    ('tries', 'Tries & prefix search', '11-tries-bit-manipulation', 4, (5,)),
)
CATALOG = {row[0]: row for row in TOPICS}
CHAPTERS = tuple(dict.fromkeys(row[2] for row in TOPICS))
PROBLEM_STATUSES = ('todo', 'attempted', 'solved')
MAX_NOTES = 20_000


class Conflict(ValueError):
    pass


def render(text):
    md = MarkdownIt('commonmark', {'html': False}).enable(['table', 'strikethrough'])
    return md.render(text.strip().strip('-').strip())


@lru_cache(maxsize=64)
def _chapter(path, modified):
    text = Path(path).read_text(encoding='utf-8')
    concept = re.search(r'^## 1\. Concept\s*\n(.*?)(?=^## 3\.)', text, re.M | re.S)
    problems = {}
    for match in re.finditer(r'^### Problem (\d+): ([^\n]+)\n(.*?)(?=^### Problem |^## 5\.|\Z)', text, re.M | re.S):
        number, title, body = match.groups()
        approach = re.search(r'\*\*Approach[^*\n]*\*\*', body)
        if not approach:
            raise ValueError(f'The saved DSA problem {number} has no worked solution.')
        problems[int(number)] = {'id': number, 'title': title.strip(), 'prompt_html': render(body[:approach.start()]),
                                 'solution_html': render(body[approach.start():])}
    if not concept:
        raise ValueError('The saved DSA chapter has no concept section.')
    return render(concept[1]), problems


def lesson(course, identifier):
    _, title, chapter, example, practices = CATALOG[identifier]
    path = Path(course) / '02-dsa' / (chapter + '.md')
    if not path.is_file():
        raise ValueError('This DSA lesson is missing from the local course. Restore the course files and retry.')
    concept, problems = _chapter(str(path), path.stat().st_mtime_ns)
    if any(number not in problems for number in (example, *practices)):
        raise ValueError('The saved DSA chapter is missing one of this lesson’s practice questions.')
    return {'id': identifier, 'title': title, 'number': list(CATALOG).index(identifier) + 1,
            'total': len(TOPICS), 'minutes': 30, 'concept_html': concept, 'example': problems[example],
            'practice': [problems[number] for number in practices], 'course_route': '02-dsa/' + chapter}


def _problem_progress(data):
    progress = data.setdefault('dsa', {'days': {}}).setdefault('problems', {})
    if not isinstance(progress, dict):
        raise ValueError('Invalid saved DSA problems. Your progress has not been reset.')
    for identifier, entry in progress.items():
        if (not isinstance(identifier, str) or not isinstance(entry, dict)
                or entry.get('status') not in PROBLEM_STATUSES
                or not isinstance(entry.get('notes', ''), str)
                or len(entry.get('notes', '')) > MAX_NOTES):
            raise ValueError('Invalid saved DSA problem progress. Your progress has not been reset.')
        if 'updated_at' in entry:
            try:
                dt.datetime.fromisoformat(entry['updated_at'])
            except (ValueError, TypeError) as exc:
                raise ValueError('Invalid saved DSA problem date. Your progress has not been reset.') from exc
    return progress


def _seed_problem_progress(data, today):
    """Import existing checklists once without undoing an explicit sheet reset."""
    progress = _problem_progress(data)
    for date, entry in sorted(data['dsa']['days'].items()):
        if date > today or entry['topic'] not in CATALOG:
            continue
        _, _, chapter, _, practices = CATALOG[entry['topic']]
        for number in entry['practiced']:
            if number not in {str(n) for n in practices}:
                continue
            identifier = f'{chapter}/problem-{number}'
            progress.setdefault(identifier, {'status': 'attempted', 'notes': '',
                'updated_at': entry.get('completed_at') or f'{date}T00:00:00'})
    return progress


def _problem_identity(identifier):
    if not isinstance(identifier, str) or len(identifier) > 160:
        raise ValueError('Choose a problem from the DSA practice sheet.')
    match = re.fullmatch(r'([a-z0-9-]+)/problem-([1-9][0-9]*)', identifier)
    if not match or match[1] not in CHAPTERS:
        raise ValueError('Choose a problem from the DSA practice sheet.')
    return match[1], int(match[2])


def _group_content(course, chapter):
    path = Path(course) / '02-dsa' / (chapter + '.md')
    if not path.is_file():
        raise ValueError('This DSA chapter is missing from the local course. Restore the course files and retry.')
    concept, problems = _chapter(str(path), path.stat().st_mtime_ns)
    if not problems:
        raise ValueError('The saved DSA chapter has no practice questions.')
    title = re.sub(r'^#\s*(?:Chapter\s+\d+:\s*)?', '', path.read_text(encoding='utf-8').splitlines()[0]).strip()
    return title, concept, problems


def _level(index, total):
    # A learning stage based on chapter order, not an invented difficulty rating.
    return ('Foundation', 'Practice', 'Challenge')[min(2, index * 3 // total)]


def _problem_content(course, identifier):
    chapter, number = _problem_identity(identifier)
    group_title, concept, problems = _group_content(course, chapter)
    if number not in problems:
        raise ValueError('Choose a problem from the DSA practice sheet.')
    return {'id': identifier, 'group_id': chapter, 'group_title': group_title,
            'number': number, 'title': problems[number]['title'],
            'level': _level(sorted(problems).index(number), len(problems)),
            'concept_html': concept, 'prompt_html': problems[number]['prompt_html'],
            'solution_html': problems[number]['solution_html'],
            'route': '#/learning/dsa/problem/' + quote(identifier, safe='')}


def _saved_problem(content, progress):
    saved = progress.get(content['id'], {})
    return {**content, 'status': saved.get('status', 'todo'), 'notes': saved.get('notes', '')}


def sheet(root, course, query=None, *, studied=None):
    if query is not None and (not isinstance(query, str) or len(query) > 500):
        raise ValueError('Search the DSA sheet using up to 500 characters.')
    query = (query or '').strip().casefold()
    groups = []
    # Validate content before opening a new progress file.
    for index, chapter in enumerate(CHAPTERS):
        title, _, problems = _group_content(course, chapter)
        rows = [{'id': f'{chapter}/problem-{number}', 'number': number, 'title': item['title'],
                 'level': _level(i, len(problems)),
                 'route': '#/learning/dsa/problem/' + quote(f'{chapter}/problem-{number}', safe='')}
                for i, (number, item) in enumerate(sorted(problems.items()))]
        groups.append({'id': chapter, 'title': title, 'number': index + 1, 'problems': rows})
    data = memory.transact(root, lambda data: _seed_problem_progress(data, dt.date.today().isoformat()), studied=studied)
    progress = _problem_progress(data)
    total = solved = attempted = matched = 0
    visible = []
    for group in groups:
        rows = [{**row, 'status': progress.get(row['id'], {}).get('status', 'todo')} for row in group['problems']]
        completed = sum(row['status'] == 'solved' for row in rows)
        total += len(rows); solved += completed
        attempted += sum(row['status'] == 'attempted' for row in rows)
        selected = [row for row in rows if not query or query in (group['title'] + ' ' + row['title']).casefold()]
        matched += len(selected)
        if selected:
            visible.append({**group, 'total': len(rows), 'completed': completed, 'problems': selected})
    return {'groups': visible, 'total': total, 'solved': solved, 'attempted': attempted, 'matched': matched,
            'level_note': 'Foundation, Practice, and Challenge follow chapter order; they are learning stages, not difficulty ratings.'}


def problem(root, course, identifier, *, studied=None):
    content = _problem_content(course, identifier)
    data = memory.transact(root, lambda data: _seed_problem_progress(data, dt.date.today().isoformat()), studied=studied)
    return _saved_problem(content, _problem_progress(data))


def update_problem(root, course, body, *, today=None, studied=None, preserve_solved=False):
    if not isinstance(body, dict) or body.get('status') not in PROBLEM_STATUSES:
        raise ValueError('Choose a problem status: todo, attempted, or solved.')
    if 'notes' in body and (not isinstance(body['notes'], str) or len(body['notes']) > MAX_NOTES):
        raise ValueError(f'Keep problem notes to {MAX_NOTES:,} characters or fewer.')
    content = _problem_content(course, body.get('id'))
    day = today or dt.date.today()
    date = day.isoformat()
    def change(data):
        progress = _seed_problem_progress(data, date)
        before = progress.get(content['id'], {'status': 'todo', 'notes': ''})
        status, notes = body['status'], body.get('notes', before.get('notes', ''))
        if preserve_solved and before['status'] == 'solved' and status == 'attempted':
            status = 'solved'
        if before['status'] != status or before.get('notes', '') != notes or content['id'] not in progress:
            at = dt.datetime.combine(day, dt.datetime.now().astimezone().timetz()).isoformat(timespec='microseconds')
            progress[content['id']] = {**before, 'status': status, 'notes': notes, 'updated_at': at}
        entry = data['dsa']['days'].get(date)
        if entry and not entry.get('completed_at') and entry['topic'] in CATALOG:
            _, _, chapter, _, practices = CATALOG[entry['topic']]
            if chapter == content['group_id'] and content['number'] in practices:
                checks = set(entry['practiced'])
                checks.discard(str(content['number'])) if status == 'todo' else checks.add(str(content['number']))
                entry['practiced'] = sorted(checks)
    data = memory.transact(root, change, studied=studied)
    return _saved_problem(content, _problem_progress(data))


def _assign(data, today):
    progress = _seed_problem_progress(data, today)
    days = data['dsa']['days']
    if today in days and days[today]['topic'] not in CATALOG:
        raise ValueError('The saved DSA topic is unavailable. Your progress has not been reset.')
    if today not in days:
        completed = {entry['topic'] for date, entry in days.items() if date < today and entry.get('completed_at')}
        topic = next((row[0] for row in TOPICS if row[0] not in completed), None)
        if topic is None:
            # Revisit the topic least recently completed once the first pass is finished.
            last = {identifier: max((date for date, entry in days.items()
                    if date < today and entry['topic'] == identifier and entry.get('completed_at')), default='')
                    for identifier in CATALOG}
            topic = min(last, key=last.get)
        entry = {'topic': topic, 'read': False, 'practiced': [], 'completed_at': None}
        previous = max(((date, item) for date, item in days.items() if date < today and item['topic'] == topic), default=None, key=lambda pair: pair[0])
        if previous and not previous[1].get('completed_at'):
            entry['read'] = previous[1]['read']
            entry['practiced'] = list(previous[1]['practiced'])
        _, _, chapter, _, practices = CATALOG[topic]
        checks = set(entry['practiced'])
        for number in practices:
            saved = progress.get(f'{chapter}/problem-{number}', {})
            if saved.get('status') == 'solved' and saved.get('updated_at', '')[:10] <= today:
                checks.add(str(number))
        entry['practiced'] = sorted(checks)
        days[today] = entry
    return days[today]


def _response(data, course, today):
    entry = data['dsa']['days'][today]
    current = lesson(course, entry['topic'])
    complete = {item['topic'] for date, item in data['dsa']['days'].items() if date <= today and item.get('completed_at')}
    return {'date': today, 'lesson': current, 'progress': entry,
            'revision': any(date < today and item['topic'] == entry['topic'] and item.get('completed_at')
                            for date, item in data['dsa']['days'].items()),
            'completed_topics': len(complete),
            'topics': [{'id': identifier, 'title': title, 'number': i + 1, 'completed': identifier in complete,
                        'today': identifier == entry['topic']} for i, (identifier, title, *_) in enumerate(TOPICS)],
            'activity': learning_activity.summary(data, dt.date.fromisoformat(today))}


def daily(root, course, *, today=None, studied=None):
    today = (today or dt.date.today()).isoformat()
    def change(data):
        entry = _assign(data, today)
        lesson(course, entry['topic'])  # Missing course material must not create a broken assignment.
    data = memory.transact(root, change, studied=studied)
    return _response(data, course, today)


def update(root, course, body, *, today=None, studied=None):
    now = dt.datetime.now().astimezone()
    day = today or now.date()
    today = day.isoformat()
    if not isinstance(body, dict) or body.get('date') != today:
        raise Conflict('A new learning day has started. Refresh today’s lesson before saving.')
    if body.get('task') not in ('read', 'practice', 'complete') or type(body.get('done')) is not bool:
        raise ValueError('Choose a learning task and send done as true or false.')
    def change(data):
        entry = _assign(data, today)
        if body.get('topic') != entry['topic']:
            raise Conflict('Today’s topic has changed. Refresh the lesson before saving.')
        content = lesson(course, entry['topic'])
        practices = {problem['id'] for problem in content['practice']}
        task, done = body['task'], body['done']
        if task == 'practice' and (not isinstance(body.get('problem'), str) or body['problem'] not in practices):
            raise ValueError('Choose a practice question from today’s lesson.')
        if task == 'complete' and not done:
            raise ValueError('A completed daily lesson stays saved. Return tomorrow to keep learning.')
        if entry['completed_at']:
            if task == 'complete' and done:
                return  # Retrying a saved completion never awards it twice.
            raise Conflict('Today’s lesson is complete. Your progress is already saved.')
        if task == 'read':
            entry['read'] = done
        elif task == 'practice':
            attempted = set(entry['practiced'])
            attempted.add(body['problem']) if done else attempted.discard(body['problem'])
            entry['practiced'] = sorted(attempted)
            chapter = CATALOG[entry['topic']][2]
            progress = _problem_progress(data)
            identifier = f'{chapter}/problem-{body["problem"]}'
            before = progress.get(identifier, {'status': 'todo', 'notes': ''})
            status = 'solved' if before['status'] == 'solved' else 'attempted' if done else 'todo'
            if before['status'] != status or identifier not in progress:
                progress[identifier] = {**before, 'status': status,
                    'updated_at': dt.datetime.combine(day, now.timetz()).isoformat(timespec='microseconds')}
        else:
            if not entry['read'] or not practices.issubset(entry['practiced']):
                raise ValueError('Finish the reading and practice checklist before completing today’s topic.')
            at = dt.datetime.combine(day, now.timetz()).isoformat(timespec='microseconds')
            entry['completed_at'] = at
            data['history'].append({'at': at, 'kind': 'dsa', 'id': entry['topic'],
                                    'title': content['title'], 'action': 'completed'})
    data = memory.transact(root, change, studied=studied)
    return _response(data, course, today)
