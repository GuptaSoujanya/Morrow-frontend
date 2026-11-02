"""Learning views backed exclusively by the requesting account's API session.

Notes and bookmarks live in one versioned profile field because generic record
updates have no compare-and-swap support. No local workspace or runner is read.
"""
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import quote, urlsplit, urlunsplit
from uuid import uuid4

from common import interview_course, learning_activity, learning_memory
import daily_dsa


KINDS = ('paper', 'dsa', 'repo', 'resource')
SECTIONS = (
    ('papers', 'Research papers', 'brief:papers'),
    ('tech', 'Technology radar', 'brief:tech-news'),
    ('companies', 'Companies to explore', 'brief:companies'),
    ('repos', 'GitHub discoveries', 'brief:repositories'),
)
GENERATION_MESSAGE = 'Learning generation is not connected to this account yet. You can save notes, bookmarks and private research now.'
COURSE_GENERATION_MESSAGE = (
    'The shared 90-day lessons are ready to study. Daily web research is not connected '
    'to this account yet. Your course progress, notes and saved research stay in your account.'
)
PUBLIC_COURSE = Path(__file__).resolve().parents[1] / 'database' / 'course'


def _text(value, name, limit, required=True):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ValueError(f'{name} must be {"1–" if required else "at most "}{limit} characters.')
    return value.strip()


def _url(value, kind):
    value = _text(value, 'Link', 2048)
    if any(ord(char) < 33 for char in value) or '\\' in value:
        raise ValueError('Use a valid web link or learning page.')
    if value.startswith('#/learning/') and kind != 'repo':
        return value
    parsed = urlsplit(value)
    if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Use an http or https link.')
    if kind == 'repo':
        if parsed.hostname.lower() not in ('github.com', 'www.github.com') or not re.fullmatch(r'/[\w.-]+/[\w.-]+/?', parsed.path):
            raise ValueError('Use a GitHub repository link: https://github.com/owner/repository.')
        return 'https://github.com/' + parsed.path.strip('/').removesuffix('.git').lower()
    if parsed.hostname.lower() in ('arxiv.org', 'www.arxiv.org'):
        match = re.fullmatch(r'/(?:abs|pdf)/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?/?', parsed.path)
        if match:
            return 'https://arxiv.org/abs/' + match[1]
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, parsed.query, parsed.fragment))


def _safe_focus(value):
    if not isinstance(value, str):
        return ''
    value = ' '.join(value.split())
    if len(value) > 240 or re.search(r'@|https?://|www\.|(?:linkedin|github)\.com/|'
                                  r'(?:\+?\d[\s().-]*){7,}|^(?:FILL|TODO)\b|^N/?A$', value, re.I):
        return ''
    return value


def _focus_list(value, limit=12):
    if isinstance(value, str):
        value = value.split(',')
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        item = _safe_focus(item)
        if item and item.casefold() not in {prior.casefold() for prior in result}:
            result.append(item)
        if len(result) >= limit:
            break
    return result


class LearningWorkspace:
    def __init__(self, api, error):
        self.api, self.error = api, error

    def require_access(self):
        if self.api.user.get('role') != 'admin' and 'learning' not in self.api.user.get('modules', []):
            raise self.error(403, 'Your plan does not include this module.')

    def _saved(self, profile):
        value = profile['data'].get('_learning_workspace', {'notes': {}, 'bookmarks': {}})
        if (not isinstance(value, dict)
                or any(not isinstance(value.get(key), dict) for key in ('notes', 'bookmarks'))
                or any(not isinstance(item, dict) or not isinstance(item.get('updated_at'), str)
                       for key in ('notes', 'bookmarks') for item in value[key].values())):
            raise self.error(409, 'Your saved learning workspace is invalid. It has not been reset.')
        return value

    def collection(self, query=None):
        self.require_access()
        data = self._saved(self.api.profile())
        return {key: sorted(data[key].values(), key=lambda item: item['updated_at'], reverse=True)
                for key in ('notes', 'bookmarks')}

    def update(self, body):
        self.require_access()
        if not isinstance(body, dict):
            raise self.error(400, 'Send a learning workspace object.')
        # The same new ID is reused if another independent save wins the CAS.
        created_id = uuid4().hex
        return self._mutate(lambda saved: self._change(saved, body, created_id))

    def _mutate(self, change):
        """Rebase independent edits against the requesting account's profile."""
        self.require_access()
        for attempt in range(3):
            saved_profile = self.api.profile()
            payload = copy.deepcopy(saved_profile['data'])
            saved = copy.deepcopy(self._saved(saved_profile))
            try:
                result = change(saved)
            except self.error:
                raise
            except ValueError as exc:
                raise self.error(400, str(exc)) from None
            if saved == self._saved(saved_profile):
                return result
            if len(json.dumps(saved, ensure_ascii=False).encode()) > 1024 * 1024:
                raise self.error(413, 'Your learning workspace has reached 1 MB. Shorten or remove a note or bookmark before saving more.')
            payload['_learning_workspace'] = saved
            try:
                updated = self.api.json('/api/v1/profile', 'PUT', {
                    'expected_version': saved_profile['version'], 'data': payload,
                })
            except self.error as exc:
                if exc.status != 409:
                    raise
                self.api._cache.pop('profile', None)
                if attempt == 2:
                    raise self.error(409, 'Your workspace changed in another window. Your draft is still here; retry saving.') from None
                continue
            self.api._cache['profile'] = updated
            return result

    def _progress(self, saved=None):
        """Adapt private profile values to pure progress helpers, without disk IO."""
        saved = self._saved(self.api.profile()) if saved is None else saved
        data = {'version': 1, 'course': {}, 'plan': {},
                'documents': copy.deepcopy(saved.get('course_documents', {})),
                'history': copy.deepcopy(saved.get('course_history', [])),
                'dsa': copy.deepcopy(saved.get('dsa', {'days': {}}))}
        if 'interview_course' in saved:
            data['interview_course'] = copy.deepcopy(saved['interview_course'])
        try:
            learning_memory._validate(data)
            interview_course.ensure_course_state(data)
            interview_course.completed_days(data)
            daily_dsa._problem_progress(data)
        except (ValueError, TypeError, KeyError) as exc:
            raise self.error(409, 'Your saved course progress is invalid. It has not been reset.') from exc
        return data

    @staticmethod
    def _store_progress(saved, data):
        for target, source in (('interview_course', 'interview_course'), ('course_documents', 'documents'),
                               ('course_history', 'history'), ('dsa', 'dsa')):
            saved[target] = data[source]

    @staticmethod
    def _course_day(data, today):
        done = set(interview_course.completed_days(data))
        marked = data['interview_course'].get('marked', {}).get(today)
        if type(marked) is int and marked in done:
            return marked
        return next((day for day in range(1, 91) if day not in done), None)

    def _lesson(self, day):
        from common import interview_lessons
        try:
            return interview_lessons.lesson(day, PUBLIC_COURSE)
        except (ValueError, OSError) as exc:
            raise self.error(404, 'This shared course lesson is unavailable. Please retry after the course files are restored.') from exc

    def document(self, identifier):
        self.require_access()
        from common.interview_lessons import render
        match = re.fullmatch(r'interview/day-([1-9][0-9]?)', str(identifier))
        if not match or int(match[1]) > 90:
            raise self.error(404, 'Choose a lesson from the 90-day course.')
        content = self._lesson(int(match[1]))
        data = self._progress()
        # The complete reference viewer is a local-runner route. Its relevant
        # reading is already embedded in the public lesson for account users.
        text = re.sub(r'\[([^\]]+)\]\(/course/[^)]+\)', r'\1', content['text'])
        return {'id': content['id'], 'day': content['day'], 'title': content['title'],
                'html': render(text),
                'read': content['day'] in interview_course.completed_days(data),
                'source': 'bundled', 'lesson': content['lesson']}

    def mark_course_read(self, body):
        self.require_access()
        if not isinstance(body, dict) or type(body.get('read')) is not bool:
            raise self.error(400, 'read must be true or false.')
        document = self.document(body.get('id'))
        stamp = dt.datetime.now().astimezone().isoformat(timespec='microseconds')
        def change(saved):
            data = self._progress(saved)
            interview_course.record_completion(data, document['day'], body['read'], stamp)
            self._store_progress(saved, data)
            return {'ok': True, 'read': body['read'], 'storage': 'your private account'}
        return self._mutate(change)

    def daily(self, query=None):
        self.require_access()
        today = dt.date.today().isoformat()
        data = self._progress()
        day = self._course_day(data, today)
        completed = len(interview_course.completed_days(data))
        plan = {'id': f'interview/day-{day}' if day else None, 'day': day, 'total': 90,
                'title': '90-day interview course complete', 'available': False, 'read': False,
                'completed': completed, 'content_html': '', 'route': '#/learning/weekly',
                'reason': 'You have completed all 90 days. Revisit a lesson in the course roadmap.'}
        if day:
            document = self.document(f'interview/day-{day}')
            plan.update(title=document['title'], available=True, read=document['read'],
                        content_html=document['html'], route='#/learning/plan', reason='',
                        lesson=document['lesson'], source='bundled')
        return {'date': today, 'plan': plan, 'course': None, 'extras': [], 'readings': [],
                'course_plan': interview_course.course_info(),
                'briefing': {'latest': None, 'available_dates': [], 'digest': None},
                'generation_available': False, 'generation_message': COURSE_GENERATION_MESSAGE}

    def dsa(self, query=None):
        self.require_access()
        today = dt.date.today().isoformat()
        def change(saved):
            data = self._progress(saved)
            entry = daily_dsa._assign(data, today)
            daily_dsa.lesson(PUBLIC_COURSE, entry['topic'])
            self._store_progress(saved, data)
            return {**daily_dsa._response(data, PUBLIC_COURSE, today), 'execution_available': False}
        return self._mutate(change)

    def update_dsa(self, body):
        self.require_access()
        today = dt.date.today().isoformat()
        if not isinstance(body, dict) or body.get('date') != today:
            raise self.error(409, 'A new learning day has started. Refresh today’s lesson before saving.')
        if body.get('task') not in ('read', 'practice', 'complete') or type(body.get('done')) is not bool:
            raise self.error(400, 'Choose a learning task and send done as true or false.')
        def change(saved):
            data = self._progress(saved)
            entry = daily_dsa._assign(data, today)
            if body.get('topic') != entry['topic']:
                raise self.error(409, 'Today’s topic has changed. Refresh the lesson before saving.')
            content = daily_dsa.lesson(PUBLIC_COURSE, entry['topic'])
            practices = {str(problem['id']) for problem in content['practice']}
            task, done = body['task'], body['done']
            if task == 'practice' and (not isinstance(body.get('problem'), str) or body['problem'] not in practices):
                raise ValueError('Choose a practice question from today’s lesson.')
            if task == 'complete' and not done:
                raise ValueError('A completed daily lesson stays saved. Return tomorrow to keep learning.')
            if entry['completed_at']:
                if task != 'complete':
                    raise self.error(409, 'Today’s lesson is complete. Your progress is already saved.')
            elif task == 'read':
                entry['read'] = done
            elif task == 'practice':
                checks = set(entry['practiced'])
                checks.add(body['problem']) if done else checks.discard(body['problem'])
                entry['practiced'] = sorted(checks)
                identifier = f"{daily_dsa.CATALOG[entry['topic']][2]}/problem-{body['problem']}"
                progress = daily_dsa._problem_progress(data)
                prior = progress.get(identifier, {'status': 'todo', 'notes': ''})
                progress[identifier] = {**prior, 'status': 'solved' if prior['status'] == 'solved' else 'attempted' if done else 'todo',
                                        'updated_at': dt.datetime.now().astimezone().isoformat(timespec='microseconds')}
            else:
                if not entry['read'] or not practices.issubset(entry['practiced']):
                    raise ValueError('Finish the reading and practice checklist before completing today’s topic.')
                stamp = dt.datetime.now().astimezone().isoformat(timespec='microseconds')
                entry['completed_at'] = stamp
                data['history'].append({'at': stamp, 'kind': 'dsa', 'id': entry['topic'],
                                        'title': content['title'], 'action': 'completed'})
            self._store_progress(saved, data)
            return {**daily_dsa._response(data, PUBLIC_COURSE, today), 'execution_available': False}
        return self._mutate(change)

    def dsa_sheet(self, query=None):
        self.require_access()
        search = (query or {}).get('q', '')
        if not isinstance(search, str) or len(search) > 500:
            raise self.error(400, 'Search the DSA sheet using up to 500 characters.')
        search = search.strip().casefold()
        data = self._progress()
        progress = daily_dsa._seed_problem_progress(data, dt.date.today().isoformat())
        groups, total, solved, attempted, matched = [], 0, 0, 0, 0
        for index, chapter in enumerate(daily_dsa.CHAPTERS):
            title, _, problems = daily_dsa._group_content(PUBLIC_COURSE, chapter)
            rows = [{'id': f'{chapter}/problem-{number}', 'number': number, 'title': item['title'],
                     'level': daily_dsa._level(i, len(problems)),
                     'route': '#/learning/dsa/problem/' + quote(f'{chapter}/problem-{number}', safe=''),
                     'status': progress.get(f'{chapter}/problem-{number}', {}).get('status', 'todo')}
                    for i, (number, item) in enumerate(sorted(problems.items()))]
            completed = sum(row['status'] == 'solved' for row in rows)
            total += len(rows)
            solved += completed
            attempted += sum(row['status'] == 'attempted' for row in rows)
            visible = [row for row in rows if not search or search in (title + ' ' + row['title']).casefold()]
            matched += len(visible)
            if visible:
                groups.append({'id': chapter, 'title': title, 'number': index + 1,
                               'total': len(rows), 'completed': completed, 'problems': visible})
        return {'groups': groups, 'total': total, 'solved': solved, 'attempted': attempted, 'matched': matched,
                'execution_available': False,
                'level_note': 'Foundation, Practice, and Challenge follow chapter order. Progress is self-reported; code is not executed in this account.'}

    def dsa_problem(self, query=None):
        self.require_access()
        try:
            content = daily_dsa._problem_content(PUBLIC_COURSE, (query or {}).get('id'))
        except ValueError as exc:
            raise self.error(400, str(exc)) from None
        data = self._progress()
        progress = daily_dsa._seed_problem_progress(data, dt.date.today().isoformat())
        return {**daily_dsa._saved_problem(content, progress), 'execution_available': False}

    def update_dsa_problem(self, body):
        self.require_access()
        if not isinstance(body, dict) or body.get('status') not in daily_dsa.PROBLEM_STATUSES:
            raise self.error(400, 'Choose a problem status: todo, attempted, or solved.')
        if 'notes' in body and (not isinstance(body['notes'], str) or len(body['notes']) > daily_dsa.MAX_NOTES):
            raise self.error(400, 'Keep problem notes to 20,000 characters or fewer.')
        try:
            content = daily_dsa._problem_content(PUBLIC_COURSE, body.get('id'))
        except ValueError as exc:
            raise self.error(400, str(exc)) from None
        today = dt.date.today().isoformat()
        def change(saved):
            data = self._progress(saved)
            progress = daily_dsa._seed_problem_progress(data, today)
            prior = progress.get(content['id'], {'status': 'todo', 'notes': ''})
            status, notes = body['status'], body.get('notes', prior.get('notes', ''))
            if prior['status'] != status or prior.get('notes', '') != notes or content['id'] not in progress:
                progress[content['id']] = {**prior, 'status': status, 'notes': notes,
                    'updated_at': dt.datetime.now().astimezone().isoformat(timespec='microseconds')}
            entry = data['dsa']['days'].get(today)
            if entry and not entry.get('completed_at') and entry['topic'] in daily_dsa.CATALOG:
                _, _, chapter, _, practices = daily_dsa.CATALOG[entry['topic']]
                if chapter == content['group_id'] and content['number'] in practices:
                    checks = set(entry['practiced'])
                    checks.discard(str(content['number'])) if status == 'todo' else checks.add(str(content['number']))
                    entry['practiced'] = sorted(checks)
            self._store_progress(saved, data)
            return {**daily_dsa._saved_problem(content, progress), 'execution_available': False}
        return self._mutate(change)

    def _change(self, saved, body, created_id):
        action = body.get('action')
        stamp = dt.datetime.now(dt.UTC).isoformat()
        if action == 'bookmark':
            kind = body.get('kind')
            if kind not in KINDS or type(body.get('saved')) is not bool:
                raise ValueError('Choose a bookmark category and whether to save it.')
            url = _url(body.get('url'), kind)
            identifier = hashlib.sha256((kind + ':' + url).encode()).hexdigest()[:24]
            if body['saved']:
                title = _text(body.get('title'), 'Title', 300)
                prior = saved['bookmarks'].get(identifier, {})
                saved['bookmarks'][identifier] = {'id': identifier, 'kind': kind, 'url': url, 'title': title,
                    'created_at': prior.get('created_at', stamp), 'updated_at': stamp}
            else:
                saved['bookmarks'].pop(identifier, None)
            return {'id': identifier, 'saved': body['saved']}
        if action not in ('note', 'delete_note'):
            raise ValueError('Choose a supported learning workspace action.')
        identifier = body.get('id')
        if identifier is not None and (not isinstance(identifier, str) or not re.fullmatch(r'[a-f0-9]{32}', identifier)):
            raise ValueError('Invalid note ID.')
        previous = saved['notes'].get(identifier)
        if identifier and not previous:
            raise self.error(409, 'This note no longer exists. Open a new note to save a copy.')
        if previous and (type(body.get('revision')) is not int or body['revision'] != previous.get('revision')):
            raise self.error(409, 'This note changed in another window. Your draft is still here; reload the note before saving.')
        if action == 'delete_note':
            if not previous:
                raise ValueError('Choose a saved note to delete.')
            del saved['notes'][identifier]
            return {'deleted': True}
        title = _text(body.get('title'), 'Title', 300)
        content = _text(body.get('body'), 'Note', 50000, required=False)
        kind = body.get('kind', 'resource')
        if kind not in KINDS:
            raise ValueError('Choose a note category.')
        url = _url(body['url'], kind) if body.get('url') else ''
        token = body.get('creation_token') if not identifier else None
        if token is not None:
            if not isinstance(token, str) or not re.fullmatch(r'[a-f0-9]{32}', token):
                raise ValueError('Invalid note creation token.')
            receipts = saved.setdefault('note_creations', {})
            if not isinstance(receipts, dict):
                raise self.error(409, 'Your saved note receipts are invalid. They have not been reset.')
            fingerprint = hashlib.sha256(json.dumps([title, content, kind, url], ensure_ascii=False).encode()).hexdigest()
            receipt = receipts.get(token)
            if receipt is not None:
                existing = saved['notes'].get(receipt.get('id')) if isinstance(receipt, dict) and isinstance(receipt.get('id'), str) else None
                if (not existing or receipt.get('fingerprint') != fingerprint or existing.get('revision') != 1
                        or any(existing.get(key) != value for key, value in
                               (('title', title), ('body', content), ('kind', kind), ('url', url)))):
                    raise self.error(409, 'This note was already saved and may have changed or been removed. Open it from your library or save your changed draft as a new note.')
                return {'note': existing}
        identifier = identifier or created_id
        note = {'id': identifier, 'title': title, 'body': content, 'kind': kind, 'url': url,
                'revision': previous['revision'] + 1 if previous else 1,
                'created_at': previous['created_at'] if previous else stamp, 'updated_at': stamp}
        saved['notes'][identifier] = note
        if token is not None:
            receipts[token] = {'id': identifier, 'fingerprint': fingerprint}
        return {'note': note}

    def focus(self):
        data = self.api.profile()['data']
        setup = self.api.json('/api/v1/onboarding')
        resume = setup.get('resume') or {}
        available = bool(resume and setup.get('readiness', {}).get('resume_ready'))
        skills, roles = _focus_list(data.get('skills'), 24), _focus_list(data.get('titles'), 6)
        topics = _focus_list(data.get('learning_topics')) or skills[:6]
        focus = _safe_focus(data.get('learning_focus')) or ' · '.join(topics[:3])
        goal = _safe_focus(data.get('learning_goal'))
        fingerprint = str(resume.get('sha256', ''))
        return {
            'resume_available': available, 'status': 'ready' if available else 'missing_resume',
            'source_label': 'Your account profile', 'skills': skills, 'topics': topics,
            'target_roles': roles, 'focus': focus, 'goal': goal,
            'provenance': {key: 'saved_profile' if value else '' for key, value in
                           (('skills', skills), ('topics', topics), ('target_roles', roles), ('focus', focus), ('goal', goal))},
            'resume_fingerprint': fingerprint if available and re.fullmatch(r'[a-f0-9]{64}', fingerprint) else '',
            'resume_updated_at': resume.get('created_at', '') if available else '',
            'guidance': ('Your saved skills and target roles can guide optional career research. '
                         'Everyone follows the same interview course; a resume is not required.'),
        }

    def curriculum(self, query=None):
        self.require_access()
        data = self._progress()
        done = set(interview_course.completed_days(data))
        next_day = interview_course.next_day(data)
        # This syllabus is public application content. Generated files from the
        # workspace owner are deliberately never a tenant lesson source.
        weeks = [{**week, 'completed': sum(day['day'] in done for day in week['days']), 'days': [
            {**day, 'available': True, 'read': day['day'] in done, 'resume_status': 'not_required',
             'course_status': 'current', 'source': 'bundled',
             'route': '#/learning/read/' + quote(f"interview/day-{day['day']}", safe='') + '?from=weekly'}
            for day in week['days']]} for week in interview_course.syllabus()]
        return {'weeks': weeks, 'completed': len(done), 'total': 90, 'next_day': next_day,
                'current_week': (next_day - 1) // 7 + 1 if next_day else 13,
                'course': interview_course.course_info(), 'profile': self.focus(),
                'generation_available': False, 'generation_message': COURSE_GENERATION_MESSAGE}

    def discovery(self, query=None):
        self.require_access()
        try:
            date = dt.date.fromisoformat((query or {}).get('date') or dt.date.today().isoformat()).isoformat()
        except (ValueError, TypeError):
            raise self.error(400, 'Choose a discovery date in YYYY-MM-DD format.') from None
        return {'date': date, 'dates': [], 'sections': [
            {'key': key, 'title': title, 'group': group, 'available': False, 'document': None, 'items': []}
            for key, title, group in SECTIONS], 'generation_available': False, 'generation_message': GENERATION_MESSAGE}

    def activity(self, query=None):
        self.require_access()
        history = list(self._progress()['history'])
        docs = {item['id']: item for item in self.api.documents()}
        for identifier, value in self.api.reading_progress().items():
            if identifier not in docs or not value.get('done'):
                continue
            try:
                stamp = dt.datetime.fromisoformat(value['completed_at']).isoformat()
            except (KeyError, ValueError, TypeError):
                continue
            history.append({'id': identifier, 'title': docs[identifier]['title'],
                            'action': 'completed', 'kind': 'research', 'at': stamp})
        return {**learning_activity.summary({'history': history}),
                'scope': 'Your course, DSA practice and private library activity'}

    def overview(self, query=None):
        self.require_access()
        saved, activity = self.collection(), self.activity()
        course_progress = self._progress()
        course_completed = len(interview_course.completed_days(course_progress))
        current_day = self._course_day(course_progress, dt.date.today().isoformat())
        dsa_completed = {entry['topic'] for entry in course_progress['dsa']['days'].values()
                         if entry.get('completed_at') and entry['topic'] in daily_dsa.CATALOG}
        problem_progress = daily_dsa._problem_progress(course_progress)
        docs, progress = self.api.documents(), self.api.reading_progress()
        tracks = [{'key': 'library', 'title': 'Private research library', 'completed': sum(bool(progress.get(item['id'], {}).get('done')) for item in docs),
                   'total': len(docs), 'unit': 'documents read', 'route': '#/learning/library'}]
        for key, title, route in (('curriculum', '90-day interview course', 'weekly'), ('resume', 'Resume learning', 'resume'),
                                 ('dsa', 'DSA practice', 'dsa'), ('courses', 'Course library', 'courses')):
            tracks.append({'key': key, 'title': title,
                           'completed': course_completed if key == 'curriculum' else len(dsa_completed) if key == 'dsa' else 0,
                           'total': 90 if key == 'curriculum' else len(daily_dsa.TOPICS) if key == 'dsa' else 0,
                           'unit': 'course days complete' if key == 'curriculum' else 'activities complete', 'route': '#/learning/' + route})
        for key, title, _group in SECTIONS:
            tracks.append({'key': key, 'title': title, 'completed': 0, 'total': 0, 'unit': 'items read', 'route': '#/learning/discover?tab=' + key})
        for track in tracks:
            track['percent'] = round(100 * track['completed'] / track['total']) if track['total'] else 0
        return {'date': activity['date'], 'profile': self.focus(), 'course': interview_course.course_info(),
                'today_completed': activity['today_count'],
                'current_day': current_day, 'current_week': (current_day - 1) // 7 + 1 if current_day else 13,
                'tracks': tracks, 'course_tracks': [],
                'week': activity['days'][-7:], 'activity': activity, 'total_completions': activity['total_completions'],
                'solved_problems': sum(value['status'] == 'solved' for value in problem_progress.values()),
                'notes': len(saved['notes']), 'bookmarks': len(saved['bookmarks']),
                'generation_available': False, 'generation_message': GENERATION_MESSAGE}
