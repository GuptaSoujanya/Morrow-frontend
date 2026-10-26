"""One daily queue drawn from today's saved readings and shared progress."""
from __future__ import annotations

import datetime as dt
import re
from urllib.parse import quote

import dashboard_data
import research_learning
from common import learning_memory as memory
from web import state


READINGS = (
    ('papers', 'Research papers'),
    ('goal', 'Daily learning goal'),
    ('design', 'System design'),
    ('tech', 'Tech news'),
    ('companies', 'Companies to apply to'),
)


def _daily_readings(items, data, date):
    """Missing material stays missing; older briefings are an explicit archive."""
    research = [research_learning.document_info(item['id'], items)
                for item in items if item['id'].startswith('research/')]
    briefing = research_learning.daily_research(research, data, date)
    sections = {section['key']: section for section in briefing['sections']}
    readings = []
    for key, title in READINGS:
        section = sections[key]
        document = section['document']
        identifier = document['id'] if document else None
        readings.append({
            'key': key, 'title': title, 'available': document is not None,
            'id': identifier, 'read': bool(document and document['read']),
            'preview': document['preview'] if document else [],
            'excerpt': document['excerpt'] if document else '',
            'group': section['group'], 'date': date,
            'reason': '' if document else f'No {title.lower()} saved for {date} yet.',
            'route': '#/learning/read/' + quote(identifier, safe='') + '?from=today' if identifier
                     else '#/learning',
        })
    digest = sections['digest']['document']
    if digest:
        digest = {**digest, 'route': '#/learning/read/' + quote(digest['id'], safe='') + '?from=today'}
    return readings, {'latest': briefing['latest'],
                      'available_dates': briefing['available_dates'], 'digest': digest}


def _plan_day(data, date):
    """Keep today's completed reading on screen until the next local date."""
    done = set(data['plan'].get('done', []))
    marked = data['plan'].get('marked', {}).get(date)
    if type(marked) is int and 1 <= marked <= 90 and research_learning.completion(
            {'key': f'plan/day-{marked}', 'day': marked}, data):
        return marked
    # Older or externally imported state can have a dated document completion
    # without the CLI's day-to-reading lookup.
    completed = []
    for identifier, value in data['documents'].items():
        match = re.fullmatch(r'plan/day-(\d{1,2})', identifier)
        if (match and 1 <= int(match[1]) <= 90 and value.get('done')
                and str(value.get('completed_at') or '')[:10] == date):
            completed.append((value['completed_at'], int(match[1])))
    if completed:
        return max(completed)[1]
    return next((day for day in range(1, 91) if day not in done and not
                 data['documents'].get(f'plan/day-{day}', {}).get('done')), None)


def _plan(data, date):
    day = _plan_day(data, date)
    result = {'available': False, 'id': f'plan/day-{day}' if day else None,
              'title': f'Learning day {day}' if day else '90-day plan complete',
              'day': day, 'total': 90,
              'read': bool(day and research_learning.completion({'key': f'plan/day-{day}', 'day': day}, data)),
              'content_html': '',
              'reason': '', 'route': '#/learning/library?category=Learning',
              'completed': sum(research_learning.completion({'key': f'plan/day-{n}', 'day': n}, data)
                               for n in range(1, 91))}
    if day is None:
        result['reason'] = 'You have completed all 90 days. Revisit a saved reading in your learning library.'
        return result
    try:
        info = research_learning.plan_document(day)
        # Share the research reader's HTML escaping, image removal and safe
        # local-link handling instead of creating another Markdown renderer.
        rendered = dashboard_data.artifact(info['id'])['html']
    except ValueError as exc:
        result['reason'] = str(exc)
        return result
    result.update(available=True, title=info['title'] or result['title'],
                  read=research_learning.completion(info, data), content_html=rendered,
                  route='#/learning/plan')
    return result


def daily(*, today=None):
    today = today or dt.date.today()
    date = today.isoformat()
    data = memory.transact(state.APPLY, studied=state.STUDIED)
    modules = state.course_modules(state.COURSE)
    assignment = state.todays_module(modules, today=today, course=state.COURSE)
    course = None
    if assignment:
        module = assignment.module
        course = {'title': module.title, 'path': module.path, 'route': module.route,
                  'read': bool(data['course'].get(module.path, {}).get('done')),
                  'number': assignment.number, 'total': assignment.total,
                  'track': module.track, 'revising': assignment.revising}
    artifacts = dashboard_data.artifacts()['items']
    readings, briefing = _daily_readings(artifacts, data, date)
    items = {item['id']: item for item in artifacts}
    extras = []
    for filename, caption in (('01-goal.md', "Today's learning goal"),
                              ('02-system-design.md', "Today's system design reading")):
        identifier = f'research/daily/{date}/{filename}'
        item = items.get(identifier)
        if item:
            extras.append({'id': identifier, 'title': item['title'],
                           'read': bool(data['documents'].get(identifier, {}).get('done')),
                           'caption': caption,
                           'route': '#/learning/read/' + quote(identifier, safe='') + '?from=today'})
    return {'date': date, 'plan': _plan(data, date), 'course': course, 'extras': extras,
            'readings': readings, 'briefing': briefing}
