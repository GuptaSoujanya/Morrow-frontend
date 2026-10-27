"""Learning views backed exclusively by the requesting account's API session.

Notes and bookmarks live in one versioned profile field because generic record
updates have no compare-and-swap support. No local workspace or runner is read.
"""
import copy
import datetime as dt
import hashlib
import json
import re
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from common import learning_activity


KINDS = ('paper', 'dsa', 'repo', 'resource')
SECTIONS = (
    ('papers', 'Research papers', 'brief:papers'),
    ('tech', 'Technology radar', 'brief:tech-news'),
    ('companies', 'Companies to explore', 'brief:companies'),
    ('repos', 'GitHub discoveries', 'brief:repositories'),
)
GENERATION_MESSAGE = 'Learning generation is not connected to this account yet. You can save notes, bookmarks and private research now.'


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
        for attempt in range(3):
            saved_profile = self.api.profile()
            payload = copy.deepcopy(saved_profile['data'])
            saved = copy.deepcopy(self._saved(saved_profile))
            try:
                result = self._change(saved, body, created_id)
            except self.error:
                raise
            except ValueError as exc:
                raise self.error(400, str(exc)) from None
            if len(json.dumps(saved, ensure_ascii=False).encode()) > 1024 * 1024:
                raise self.error(413, 'Your learning notes and bookmarks have reached 1 MB. Shorten or remove an item before saving more.')
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
            'guidance': ('Your saved skills and target roles are shown. Your selected resume is ready for a connected learning workflow.'
                         if available else 'Choose your resume in account setup to prepare for learning based on your own skills and target roles.'),
        }

    def curriculum(self, query=None):
        self.require_access()
        weeks = [{'number': week, 'title': f'Week {week}', 'completed': 0, 'days': [
            {'day': day, 'title': f'Day {day}', 'available': False, 'read': False, 'resume_status': 'missing', 'route': '#/learning/weekly'}
            for day in range((week - 1) * 7 + 1, min(week * 7, 90) + 1)]} for week in range(1, 14)]
        return {'weeks': weeks, 'completed': 0, 'total': 90, 'next_day': 1, 'current_week': 1,
                'profile': self.focus(), 'generation_available': False, 'generation_message': GENERATION_MESSAGE}

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
        history = []
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
                'scope': 'Currently completed items in your private library'}

    def overview(self, query=None):
        self.require_access()
        saved, activity = self.collection(), self.activity()
        docs, progress = self.api.documents(), self.api.reading_progress()
        tracks = [{'key': 'library', 'title': 'Private research library', 'completed': sum(bool(progress.get(item['id'], {}).get('done')) for item in docs),
                   'total': len(docs), 'unit': 'documents read', 'route': '#/learning/library'}]
        for key, title, route in (('curriculum', 'Job-ready curriculum', 'weekly'), ('resume', 'Resume learning', 'resume'),
                                 ('dsa', 'DSA practice', 'dsa'), ('courses', 'Course library', 'courses')):
            tracks.append({'key': key, 'title': title, 'completed': 0, 'total': 0, 'unit': 'activities complete', 'route': '#/learning/' + route})
        for key, title, _group in SECTIONS:
            tracks.append({'key': key, 'title': title, 'completed': 0, 'total': 0, 'unit': 'items read', 'route': '#/learning/discover?tab=' + key})
        for track in tracks:
            track['percent'] = round(100 * track['completed'] / track['total']) if track['total'] else 0
        return {'date': activity['date'], 'profile': self.focus(), 'today_completed': activity['today_count'],
                'current_day': 1, 'current_week': 1, 'tracks': tracks, 'course_tracks': [],
                'week': activity['days'][-7:], 'activity': activity, 'total_completions': activity['total_completions'], 'solved_problems': 0,
                'notes': len(saved['notes']), 'bookmarks': len(saved['bookmarks']),
                'generation_available': False, 'generation_message': GENERATION_MESSAGE}
