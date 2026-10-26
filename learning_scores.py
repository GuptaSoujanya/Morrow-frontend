"""Durable drafts and scores from server-verified code submissions.

The HTTP layer must call record_submission with its runner result, never with
client-provided pass counts. Running code or saving a draft does not award points.
"""
from __future__ import annotations

import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import uuid
from urllib.parse import quote

_LOCK = threading.RLock()
_KEY = re.compile(r'(?:dsa/[a-z0-9-]+/problem-[1-9][0-9]*|practice/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+)\Z')
_LANGUAGE = re.compile(r'[a-z][a-z0-9_+-]{0,31}\Z')
_IDENTIFIER = re.compile(r'[A-Za-z0-9_-]{1,100}\Z')
_FILE = 'code-practice.json'
MAX_CODE_LENGTH = 100_000


def _key(value):
    if not isinstance(value, str) or not _KEY.fullmatch(value):
        raise ValueError('Choose a saved DSA problem or practice question.')
    return value


def _language(value):
    if not isinstance(value, str) or not _LANGUAGE.fullmatch(value):
        raise ValueError('Choose a supported code language.')
    return value


def _code(value):
    if not isinstance(value, str) or len(value) > MAX_CODE_LENGTH:
        raise ValueError('Code must be text with at most 100,000 characters.')
    return value


def _day(value=None):
    if value is None:
        return dt.datetime.now().astimezone().date()
    if isinstance(value, dt.datetime):
        return value.date()
    return value if isinstance(value, dt.date) else dt.date.fromisoformat(value)


def _stamp(value=None):
    result = value or dt.datetime.now().astimezone()
    if isinstance(result, str):
        result = dt.datetime.fromisoformat(result)
    if not isinstance(result, dt.datetime):
        raise ValueError('A submission requires a valid timestamp.')
    if result.tzinfo is None:
        result = result.astimezone()
    return result.isoformat(timespec='microseconds')


def _route(key, route=None):
    if route is not None:
        if (not isinstance(route, str) or len(route) > 1000 or
                not re.match(r'^#/learning(?:/|\?|$)', route) or any(ord(char) < 32 for char in route)):
            raise ValueError('A score must link to a local learning page.')
        return route
    return ('#/learning/dsa/problem/' + quote(key[4:], safe='') if key.startswith('dsa/')
            else '#/learning/practice/paper/' + quote(key.split('/')[1], safe=''))


def _counts(passed, total):
    if type(passed) is not int or type(total) is not int or not 0 <= passed <= total or not 1 <= total <= 10_000:
        raise ValueError('A submission requires valid, server-verified test counts.')


def _validate(data):
    try:
        if (not isinstance(data, dict) or data.get('version') != 1 or not isinstance(data.get('drafts'), dict)
                or not isinstance(data.get('submissions'), list)):
            raise ValueError()
        for key, languages in data['drafts'].items():
            _key(key)
            if not isinstance(languages, dict):
                raise ValueError()
            for language, draft in languages.items():
                _language(language)
                if not isinstance(draft, dict):
                    raise ValueError()
                _code(draft.get('code'))
                dt.datetime.fromisoformat(draft['updated_at'])
        identifiers = set()
        for item in data['submissions']:
            if not isinstance(item, dict):
                raise ValueError()
            _key(item['problem_key']); _language(item['language']); _route(item['problem_key'], item['route'])
            _counts(item['passed'], item['total'])
            if (not isinstance(item['id'], str) or not _IDENTIFIER.fullmatch(item['id']) or item['id'] in identifiers
                    or item.get('submission_id') != item['id'] or not isinstance(item['title'], str)
                    or not item['title'].strip() or len(item['title']) > 240):
                raise ValueError()
            identifiers.add(item['id'])
            if (dt.datetime.fromisoformat(item['at']).date().isoformat() != item['date']
                    or type(item['score']) is not int or item['score'] != item['passed'] * 100 // item['total']
                    or type(item['verified']) is not bool or item['verified'] != (item['passed'] == item['total'])
                    or type(item['improvement']) is not int or not 0 <= item['improvement'] <= 100):
                raise ValueError()
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError('Saved code practice is invalid. Your drafts and scores have not been reset.') from exc
    return data


def _transact(root, change=None):
    folder = Path(root) / '.memory'
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / _FILE
    with _LOCK, (folder / 'code-practice.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            data = _validate(json.loads(path.read_text(encoding='utf-8')))
        except FileNotFoundError:
            data = {'version': 1, 'drafts': {}, 'submissions': []}
        except (json.JSONDecodeError, OSError) as exc:
            raise ValueError('Cannot read saved code practice. Your drafts and scores have not been reset.') from exc
        before = json.dumps(data, sort_keys=True)
        if change:
            change(data)
        _validate(data)
        if not path.exists() or before != json.dumps(data, sort_keys=True):
            name = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=folder, prefix='.code-practice-', delete=False) as output:
                    name = output.name
                    json.dump(data, output, indent=2, ensure_ascii=False)
                    output.write('\n'); output.flush(); os.fsync(output.fileno())
                os.replace(name, path)
                descriptor = os.open(folder, os.O_RDONLY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
            finally:
                if name and os.path.exists(name):
                    os.unlink(name)
        return data


def get_draft(root, key, language):
    key, language = _key(key), _language(language)
    value = _transact(root)['drafts'].get(key, {}).get(language, {'code': '', 'updated_at': None})
    return {'problem_key': key, 'language': language, **value}


def save_draft(root, key, language, code):
    key, language, code = _key(key), _language(language), _code(code)
    def change(data):
        versions = data['drafts'].setdefault(key, {})
        if versions.get(language, {}).get('code') != code:
            versions[language] = {'code': code, 'updated_at': _stamp()}
    data = _transact(root, change)
    return {'problem_key': key, 'language': language, **data['drafts'][key][language]}


def record_submission(root, submission, *, at=None):
    """Persist one executed submission; optional server ID makes request retries safe."""
    if not isinstance(submission, dict):
        raise ValueError('A verified submission is required.')
    key = _key(submission.get('problem_key'))
    language = _language(submission.get('language'))
    passed, total = submission.get('passed'), submission.get('total')
    _counts(passed, total)
    title = submission.get('title', key)
    if not isinstance(title, str) or not title.strip():
        raise ValueError('A submission requires a problem title.')
    identifier = submission.get('submission_id') or submission.get('id') or uuid.uuid4().hex
    if not isinstance(identifier, str) or not _IDENTIFIER.fullmatch(identifier):
        raise ValueError('A submission requires a valid server identifier.')
    stamp = _stamp(at)
    value = {'id': identifier, 'submission_id': identifier, 'problem_key': key, 'title': title.strip()[:240],
             'route': _route(key, submission.get('route')), 'language': language, 'passed': passed, 'total': total,
             'at': stamp, 'date': stamp[:10], 'score': passed * 100 // total, 'verified': passed == total}
    result = []
    def change(data):
        previous = next((item for item in data['submissions'] if item['id'] == identifier), None)
        if previous:
            if any(previous[field] != value[field] for field in ('problem_key', 'language', 'passed', 'total')):
                raise ValueError('This submission identifier already belongs to a different result.')
            result.append(previous)
            return
        best = max((item['score'] for item in data['submissions'] if item['date'] == value['date'] and item['problem_key'] == key), default=0)
        value['improvement'] = max(0, value['score'] - best)
        data['submissions'].append(value); result.append(value)
    _transact(root, change)
    return result[0]


def _stats(items, date=None):
    best, solved = {}, set()
    for item in items:
        best[item['problem_key']] = max(best.get(item['problem_key'], 0), item['score'])
        if item['verified']:
            solved.add(item['problem_key'])
    passed, total = sum(item['passed'] for item in items), sum(item['total'] for item in items)
    return {**({'date': date} if date else {}), 'score': sum(best.values()), 'max_score': len(best) * 100,
            'problems': len(best), 'attempts': len(items), 'passed': passed, 'total': total,
            'pass_rate': round(passed * 100 / total, 1) if total else 0, 'verified_solves': len(solved)}


def summary(root, today=None):
    day = _day(today)
    date = day.isoformat()
    items = [item for item in _transact(root)['submissions'] if item['date'] <= date]
    ordered = sorted(items, key=lambda item: dt.datetime.fromisoformat(item['at']))
    by_day = {}
    for item in ordered:
        by_day.setdefault(item['date'], []).append(item)
    days = [_stats(by_day.get(str(day - dt.timedelta(days=offset)), []), str(day - dt.timedelta(days=offset))) for offset in range(13, -1, -1)]
    active = sorted(by_day)
    best_streak = streak = 0
    streak_earned = None
    previous = None
    for current in active:
        this_day = dt.date.fromisoformat(current)
        streak = streak + 1 if previous and (this_day - previous).days == 1 else 1
        best_streak = max(best_streak, streak)
        if streak >= 7 and streak_earned is None:
            streak_earned = by_day[current][0]['at']
        previous = this_day
    current_streak = streak if previous and (day - previous).days <= 1 else 0
    solved, earned = set(), {}
    for item in ordered:
        if item['verified'] and item['problem_key'] not in solved:
            solved.add(item['problem_key'])
            for target in (1, 5, 10, 25):
                if len(solved) >= target and target not in earned:
                    earned[target] = item['at']
    badges = [{'id': f'verified-{target}', 'name': name, 'description': f'Pass every test for {target} distinct problem{"s" if target != 1 else ""}.',
               'target': target, 'progress': min(len(solved), target), 'earned_at': earned.get(target)}
              for target, name in ((1, 'First verified solve'), (5, 'Five solved'), (10, 'Ten solved'), (25, 'Twenty-five solved'))]
    badges.append({'id': 'submissions-7', 'name': 'A week of practice', 'description': 'Submit code on 7 consecutive days. Every real submission counts.',
                   'target': 7, 'progress': min(best_streak, 7), 'earned_at': streak_earned})
    totals = _stats(items)
    totals['score'] = sum(_stats(values)['score'] for values in by_day.values())
    totals['max_score'] = sum(_stats(values)['max_score'] for values in by_day.values())
    totals['active_days'] = len(by_day)
    return {'date': date, 'start': days[0]['date'], 'today': days[-1], 'days': days, 'totals': totals,
            'current_streak': current_streak, 'best_streak': best_streak, 'badges': badges,
            'history': list(reversed(ordered))[:20]}
