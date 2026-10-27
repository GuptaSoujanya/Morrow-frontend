"""Personal notes, typed bookmarks, saved discovery and a resume curriculum map."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import uuid
from urllib.parse import urlsplit, urlunsplit, quote

from common import learning_memory as memory, learning_activity, paths
from pipeline.learning import split_days, days_of, week_of
from web import state
import learning_profile

KINDS = ('paper', 'dsa', 'repo', 'resource')
SOURCES = (
    ('papers', 'Research papers', '03-papers.md', 'brief:papers', 'paper'),
    ('tech', 'Technology radar', '04-tech-news.md', 'brief:tech-news', 'resource'),
    ('companies', 'Companies to explore', '05-companies.md', 'brief:companies', 'resource'),
    ('repos', 'GitHub discoveries', '06-repositories.md', 'brief:repositories', 'repo'),
)


def _text(value, name, limit, required=True):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ValueError(f'{name} must be {"1–" if required else "at most "}{limit} characters.')
    return value.strip()


def safe_url(value, kind='resource'):
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


def bookmark_id(kind, url):
    return hashlib.sha256((kind + ':' + safe_url(url, kind)).encode()).hexdigest()[:24]


def _collection(data):
    value = data.setdefault('workspace', {'notes': {}, 'bookmarks': {}})
    if not isinstance(value, dict) or any(not isinstance(value.get(k), dict) for k in ('notes', 'bookmarks')):
        raise ValueError('Your saved learning workspace is invalid. It has not been reset.')
    if any(not isinstance(item, dict) or not isinstance(item.get('updated_at'), str)
           for key in ('notes', 'bookmarks') for item in value[key].values()):
        raise ValueError('Your saved learning workspace is invalid. It has not been reset.')
    if not isinstance(value.setdefault('readings', {}), dict):
        raise ValueError('Your saved readings are invalid. They have not been reset.')
    documents = value.setdefault('reading_documents', {})
    if (not isinstance(documents, dict) or any(not isinstance(entry, dict)
            or not isinstance(entry.get('fingerprint'), str) or not isinstance(entry.get('items'), dict)
            or any(type(done) is not bool for done in entry['items'].values()) for entry in documents.values())):
        raise ValueError('Your saved reading documents are invalid. They have not been reset.')
    return value


def collection():
    data = _collection(memory.transact(state.APPLY, studied=state.STUDIED))
    return {key: sorted(data[key].values(), key=lambda item: item['updated_at'], reverse=True)
            for key in ('notes', 'bookmarks')}


def update(body):
    if not isinstance(body, dict):
        raise ValueError('Send a learning workspace object.')
    action = body.get('action')
    result = {}
    reading_section = None
    if action == 'reading':
        if type(body.get('read')) is not bool:
            raise ValueError('Reading completion must be true or false.')
        sections = discovery(body.get('date'))['sections']
        matching = [section for section in sections if (not body.get('document') or section['document'] == body['document'])
                    and any(item['id'] == body.get('id') for item in section['items'])]
        if len(matching) != 1:
            raise ValueError('This discovery is no longer available. Refresh before marking it complete.')
        reading_section = matching[0]

    def change(data):
        saved = _collection(data)
        now = memory.stamp()
        if action == 'reading':
            identifier = reading_section['document']
            entry = saved['reading_documents'].get(identifier)
            if entry is None or entry['fingerprint'] != reading_section['version']:
                raise ValueError('This discovery changed. Refresh before marking it complete.')
            entry['items'][body['id']] = body['read']
            complete = all(entry['items'].get(item['id'], False) for item in reading_section['items'])
            memory.record(data, 'research', identifier, reading_section['title'], complete)
            result.update(read=body['read'], section_complete=complete)
        elif action == 'bookmark':
            kind = body.get('kind')
            if kind not in KINDS or type(body.get('saved')) is not bool:
                raise ValueError('Choose a bookmark category and whether to save it.')
            url = safe_url(body.get('url'), kind)
            identifier = bookmark_id(kind, url)
            if body['saved']:
                title = _text(body.get('title'), 'Title', 300)
                previous = saved['bookmarks'].get(identifier, {})
                saved['bookmarks'][identifier] = {'id': identifier, 'kind': kind, 'url': url, 'title': title,
                    'created_at': previous.get('created_at', now), 'updated_at': now}
            else:
                saved['bookmarks'].pop(identifier, None)
            result.update(id=identifier, saved=body['saved'])
        elif action in ('note', 'delete_note'):
            identifier = body.get('id')
            if identifier is not None and (not isinstance(identifier, str) or not re.fullmatch(r'[a-f0-9]{32}', identifier)):
                raise ValueError('Invalid note ID.')
            previous = saved['notes'].get(identifier)
            if identifier and not previous:
                raise ValueError('This note no longer exists. Open a new note to save a copy.')
            if previous and (type(body.get('revision')) is not int or body['revision'] != previous['revision']):
                raise ValueError('This note changed in another window. Your draft is still here; reload the note before saving.')
            if action == 'delete_note':
                if not previous:
                    raise ValueError('Choose a saved note to delete.')
                del saved['notes'][identifier]
                result.update(deleted=True)
                return
            title = _text(body.get('title'), 'Title', 300)
            content = _text(body.get('body'), 'Note', 50000, required=False)
            kind = body.get('kind', 'resource')
            if kind not in KINDS:
                raise ValueError('Choose a note category.')
            url = safe_url(body['url'], kind) if body.get('url') else ''
            token = body.get('creation_token') if not identifier else None
            receipt = None
            if token is not None:
                if not isinstance(token, str) or not re.fullmatch(r'[a-f0-9]{32}', token):
                    raise ValueError('Invalid note creation token.')
                receipts = saved.setdefault('note_creations', {})
                if not isinstance(receipts, dict):
                    raise ValueError('Your saved note receipts are invalid. They have not been reset.')
                fingerprint = hashlib.sha256(json.dumps([title, content, kind, url], ensure_ascii=False).encode()).hexdigest()
                receipt = receipts.get(token)
                if receipt is not None:
                    existing = saved['notes'].get(receipt.get('id')) if isinstance(receipt, dict) and isinstance(receipt.get('id'), str) else None
                    if (not existing or receipt.get('fingerprint') != fingerprint or existing.get('revision') != 1
                            or any(existing.get(key) != value for key, value in
                                   (('title', title), ('body', content), ('kind', kind), ('url', url)))):
                        raise ValueError('This note was already saved and may have changed or been removed. Open it from your library or save your changed draft as a new note.')
                    result.update(note=existing)
                    return
            identifier = identifier or uuid.uuid4().hex
            note = {'id': identifier, 'title': title, 'body': content, 'kind': kind, 'url': url,
                    'revision': previous['revision'] + 1 if previous else 1,
                    'created_at': previous['created_at'] if previous else now, 'updated_at': now}
            saved['notes'][identifier] = note
            if token is not None:
                receipts[token] = {'id': identifier, 'fingerprint': fingerprint}
            result.update(note=note)
        else:
            raise ValueError('Choose a supported learning workspace action.')

    memory.transact(state.APPLY, change, studied=state.STUDIED)
    return result


def _plain(text):
    text = re.sub(r'```.*?```', '', text, flags=re.S)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    return ' '.join(re.sub(r'[*`#]', '', text).split())


def _resources(text, kind, document):
    """Keep real, linked sections; never substitute yesterday's material for today."""
    items, seen, sections = [], set(), []
    for section in re.split(r'^## ', text, flags=re.M)[1:]:
        title, _, body = section.partition('\n')
        if _plain(title).lower() in ('sources', 'industry map', 'reading order', 'where they sit', 'talking points', 'at a glance', 'try this week'):
            continue
        if document.endswith('/04-tech-news.md'):
            # News briefs use category headings, with several bold headlines
            # inside each. Keep each story's link and summary together.
            metadata = {'date', 'published', 'source', 'sources', 'link', 'links', 'why it matters',
                        'what happened', 'category', 'try it', 'why it matters for you'}
            headlines = [match for match in re.finditer(r'^\s*(?:(?:[-*]|\d+[.)])\s+)?\*\*([^\n*]+)\*\*', body, re.M)
                         if _plain(match[1]).strip(' :').lower() not in metadata]
            if headlines:
                for index, match in enumerate(headlines):
                    end = headlines[index + 1].start() if index + 1 < len(headlines) else len(body)
                    sections.append((match[1], body[match.end():end].lstrip(' :—–-')))
                continue
        sections.append((title, body))
    for raw_title, body in sections:
        title = _plain(raw_title)
        urls = re.findall(r'https?://[^\s<>\])"}]+', raw_title + '\n' + body)
        # Original papers take precedence over related implementation links.
        if kind == 'paper':
            def priority(url):
                try:
                    return urlsplit(url).hostname not in ('arxiv.org', 'www.arxiv.org', 'openreview.net', 'aclanthology.org', 'proceedings.mlr.press')
                except ValueError:
                    return True
            urls.sort(key=priority)
        elif document.endswith('/05-companies.md'):
            career_labels = {url.rstrip('.,;') for label, url in re.findall(r'\[([^\]]+)\]\((https?://[^\s)]+)\)', body)
                             if re.search(r'\b(careers?|jobs?|open (?:roles|positions)|join (?:us|our team)|hiring)\b', label, re.I)}
            def career_priority(url):
                try:
                    parsed = urlsplit(url)
                    host = (parsed.hostname or '').lower()
                    is_careers = (url.rstrip('.,;') in career_labels
                                  or host.startswith(('jobs.', 'careers.', 'job-boards.'))
                                  or host == 'boards.greenhouse.io' or host.endswith('.ashbyhq.com')
                                  or re.search(r'/(?:careers?|jobs?|join-us|join-our-team|open-positions|job-openings)(?:/|$)', parsed.path, re.I))
                    return not is_careers
                except ValueError:
                    return True
            urls.sort(key=career_priority)
        for url in urls:
            try:
                url = safe_url(url.rstrip('.,;'), kind)
            except ValueError:
                continue
            if url in seen:
                continue
            seen.add(url)
            items.append({'id': bookmark_id(kind, url), 'kind': kind, 'title': title[:300], 'url': url,
                          'excerpt': _plain(body)[:420], 'document': document})
            break
    return items


def _saved_discovery_sections():
    """Read saved source documents and the resources in their current content."""
    root = state.APPLY / paths.research_dir() / 'daily'
    sections = []
    for key, title, filename, group, kind in SOURCES:
        for path in sorted(root.glob('????-??-??/' + filename)):
            try:
                day = dt.date.fromisoformat(path.parent.name).isoformat()
                if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
                    continue
                text = path.read_text(encoding='utf-8')
            except (ValueError, OSError):
                continue
            identifier = f'research/daily/{day}/{filename}'
            items = _resources(text, kind, identifier)
            sections.append({'key': key, 'title': title, 'group': group, 'kind': kind,
                             'date': day, 'document': identifier, 'available': bool(text),
                             'version': hashlib.sha256(text.encode()).hexdigest(),
                             'items': items[:2] if kind == 'paper' else items})
    return sections


def _bind_discovery_progress(data, sections):
    """Bind legacy completion once, then keep resources local to their document.

    Replacing content changes the current reading queue, not its historical
    completion awards. Removed item states remain available to progress totals.
    """
    if not sections and 'workspace' not in data:
        return
    saved = _collection(data)
    migrating = saved.get('readings_version') != 2
    for section in sections:
        identifier = section['document']
        previous = data['documents'].get(identifier, {})
        was_complete = bool(previous.get('done'))
        entry = saved['reading_documents'].get(identifier)
        changed = entry is not None and entry['fingerprint'] != section['version']
        if entry is None:
            entry = {'fingerprint': section['version'], 'items': {}}
            saved['reading_documents'][identifier] = entry
        for item in section['items']:
            if item['id'] not in entry['items']:
                entry['items'][item['id']] = bool(saved['readings'].get(item['id'], was_complete)) if migrating else False
            item['read'] = entry['items'][item['id']]
        entry['fingerprint'] = section['version']
        complete = all(item['read'] for item in section['items']) if section['items'] else was_complete and not changed
        if complete != was_complete:
            # Content replacement is not a user completion/reopen action. Keep
            # earned history intact while bringing the current checklist in sync.
            data['documents'][identifier] = {**previous, 'done': complete, 'title': section['title'],
                'updated_at': memory.stamp(), 'completed_at': previous.get('completed_at') if complete else None}
    saved['readings_version'] = 2


def sync_discovery_progress():
    """Reconcile changed briefing content before showing a daily checklist."""
    sections = []
    def change(data):
        sections.extend(_saved_discovery_sections())
        _bind_discovery_progress(data, sections)
    data = memory.transact(state.APPLY, change, studied=state.STUDIED)
    return data, sections


def discovery(date=None):
    if date and (not isinstance(date, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date)):
        raise ValueError('Choose a discovery date in YYYY-MM-DD format.')
    day = dt.date.fromisoformat(date) if date else dt.date.today()
    date = day.isoformat()
    root = state.APPLY / paths.research_dir() / 'daily'
    dates = []
    for path in root.iterdir() if root.exists() else []:
        try:
            if path.is_dir() and re.fullmatch(r'\d{4}-\d{2}-\d{2}', path.name):
                dates.append(dt.date.fromisoformat(path.name).isoformat())
        except ValueError:
            continue
    dates.sort(reverse=True)
    _, saved_sections = sync_discovery_progress()
    by_document = {section['document']: section for section in saved_sections}
    sections = []
    for key, title, filename, group, kind in SOURCES:
        document = f'research/daily/{date}/{filename}'
        saved = by_document.get(document)
        sections.append(saved if saved and saved['available'] else {'key': key, 'title': title, 'group': group,
                         'available': False, 'document': None, 'items': [], 'version': ''})
    return {'date': date, 'dates': dates, 'sections': sections}


def material_resume_status(path, fingerprint, day=None):
    """Only label material current when its generation provenance agrees."""
    try:
        metadata = json.loads(path.with_suffix('.meta.json').read_text(encoding='utf-8'))
        source = metadata.get('day_resume_sha256', {}).get(str(day), '') if day else metadata.get('resume_sha256', '')
    except (OSError, ValueError, AttributeError):
        source = ''
    return 'current' if source and source == fingerprint else 'previous' if source else 'unverified'


def curriculum(environment=None):
    data = memory.transact(state.APPLY, studied=state.STUDIED)
    profile = learning_profile.profile(environment)
    root = state.APPLY / paths.research_dir() / 'learning'
    done = set(data['plan'].get('done', []))
    done.update(n for n in range(1, 91) if data['documents'].get(f'plan/day-{n}', {}).get('done'))
    next_day = next((n for n in range(1, 91) if n not in done), None)
    weeks = []
    for number in range(1, 14):
        path = root / 'weeks' / f'week-{number:02d}.md'
        text = path.read_text(encoding='utf-8') if path.is_file() and path.resolve().is_relative_to(root.resolve()) else ''
        days = split_days(text)
        lessons = []
        for day in days_of(number):
            title = re.sub(r'^## Day \d+\s*[:—-]?\s*', '', days.get(day, '').split('\n')[0]).strip()
            lessons.append({'day': day, 'title': title or f'Day {day}', 'available': day in days, 'read': day in done,
                            'resume_status': material_resume_status(path, profile['resume_fingerprint'], day) if day in days else 'missing',
                            'route': '#/learning/read/' + quote(f'plan/day-{day}', safe='') + '?from=weekly'})
        weeks.append({'number': number, 'title': _plain(text.split('\n')[0]) or f'Week {number}',
                      'days': lessons, 'completed': sum(lesson['read'] for lesson in lessons)})
    return {'weeks': weeks, 'completed': len(done), 'total': 90, 'next_day': next_day, 'profile': profile,
            'current_week': week_of(next_day) if next_day else 13}


def mark_discovery_document(info, done):
    """Whole-briefing actions and individual discovery actions share completion."""
    date = info['id'].split('/')[2]
    section = next((section for section in discovery(date)['sections'] if section['document'] == info['id']), {'items': []})
    def change(data):
        saved = _collection(data)
        memory.record(data, 'research', info['key'], info['title'], done)
        entry = saved['reading_documents'].get(info['id'])
        for item in section['items']:
            entry['items'][item['id']] = done
    memory.transact(state.APPLY, change, studied=state.STUDIED)


def overview(environment=None):
    """Separate denominators for every learning area, using saved work only."""
    import dashboard_data
    import daily_dsa
    import daily_learning
    data, _ = sync_discovery_progress()
    collection_data = _collection(data)
    activity = learning_activity.summary(data)
    plan = curriculum(environment)
    documents = dashboard_data.artifacts()['items']
    resume = [item for item in documents if re.match(r'research/resume-learning/\d{2}-', item['id'])]
    modules = state.course_modules(state.COURSE)
    course_tracks = {}
    for module in modules:
        track = course_tracks.setdefault(module.track, {'title': module.track, 'completed': 0, 'total': 0})
        track['total'] += 1
        track['completed'] += bool(data['course'].get(module.path, {}).get('done'))
    topics = {item['topic'] for item in data.get('dsa', {}).get('days', {}).values() if item.get('completed_at') and item['topic'] in daily_dsa.CATALOG}
    tracks = [
        {'key': 'curriculum', 'title': 'Job-ready curriculum', 'completed': plan['completed'], 'total': plan['total'], 'unit': 'days complete', 'route': '#/learning/weekly'},
        {'key': 'resume', 'title': 'Resume learning', 'completed': sum(bool(data['documents'].get(item['id'], {}).get('done')) for item in resume), 'total': len(resume), 'unit': 'topics complete', 'route': '#/learning/resume'},
        {'key': 'dsa', 'title': 'DSA practice', 'completed': len(topics), 'total': len(daily_dsa.TOPICS), 'unit': 'daily topics complete', 'route': '#/learning/dsa'},
        {'key': 'courses', 'title': 'Course library', 'completed': sum(track['completed'] for track in course_tracks.values()), 'total': len(modules), 'unit': 'lessons complete', 'route': '#/learning/courses'},
    ]
    for key, title, filename, group, kind in SOURCES:
        entries = [item for item in documents if re.fullmatch(r'research/daily/\d{4}-\d{2}-\d{2}/' + re.escape(filename), item['id'])]
        if kind in ('paper', 'repo'):
            resources = {}
            for identifier, entry in collection_data['reading_documents'].items():
                if re.fullmatch(r'research/daily/\d{4}-\d{2}-\d{2}/' + re.escape(filename), identifier):
                    for resource_id, read in entry['items'].items():
                        resources[resource_id] = resources.get(resource_id, False) or read
            total, completed = len(resources), sum(bool(value) for value in resources.values())
        else:
            total = len(entries)
            completed = sum(bool(data['documents'].get(item['id'], {}).get('done')) for item in entries)
        tracks.append({'key': key, 'title': title, 'completed': completed, 'total': total,
                       'unit': 'papers read' if kind == 'paper' else 'repositories explored' if kind == 'repo' else 'briefings read', 'route': '#/learning/discover?tab=' + key})
    for key, title, filename in (('goals', 'Daily learning goals', '01-goal.md'), ('design', 'System design deep dives', '02-system-design.md')):
        entries = [item for item in documents if re.fullmatch(r'research/daily/\d{4}-\d{2}-\d{2}/' + re.escape(filename), item['id'])]
        tracks.append({'key': key, 'title': title, 'completed': sum(bool(data['documents'].get(item['id'], {}).get('done')) for item in entries),
                       'total': len(entries), 'unit': 'briefings read', 'route': '#/learning'})
    solved = sum(item.get('status') == 'solved' for item in data.get('dsa', {}).get('problems', {}).values())
    for track in tracks:
        track['percent'] = round(100 * track['completed'] / track['total']) if track['total'] else 0
    today_day = daily_learning._plan_day(data, activity['date'])
    return {'date': activity['date'], 'profile': plan['profile'], 'today_completed': activity['today_count'], 'current_day': today_day,
            'current_week': week_of(today_day) if today_day else 13, 'tracks': tracks, 'course_tracks': list(course_tracks.values()),
            'week': activity['days'][-7:], 'total_completions': activity['total_completions'], 'solved_problems': solved,
            'notes': len(collection_data['notes']), 'bookmarks': len(collection_data['bookmarks'])}
