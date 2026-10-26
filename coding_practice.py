"""Resolve learning exercises and judge code on this computer, never in the browser."""
from __future__ import annotations

import json
import re
from urllib.parse import quote

import code_problem_catalog as catalog
import daily_dsa
import learning_practice
import learning_scores
import local_code_runner
from common import learning_memory


def paper_problem_ids(sources):
    """Known coding exercises attached to the paper's actual saved DSA topics."""
    identifiers = []
    for source in sources:
        topic = source['id'].removeprefix('dsa/')
        if source['id'].startswith('dsa/') and topic in daily_dsa.CATALOG:
            _, _, chapter, example, practice = daily_dsa.CATALOG[topic]
            identifiers.extend(f'{chapter}/problem-{number}' for number in (example, *practice))
    return list(dict.fromkeys(identifiers))


def resolve(root, key):
    if not isinstance(key, str) or len(key) > 200:
        raise ValueError('Choose a DSA coding exercise.')
    companion = False
    if key.startswith('dsa/'):
        identifier = key[4:]
        route = '#/learning/dsa/problem/' + quote(identifier, safe='')
    else:
        match = re.fullmatch(r'practice/(p-[a-f0-9]{32})/(q[1-9][0-9]*)', key)
        if not match:
            raise ValueError('Choose a saved DSA question.')
        paper = learning_practice.paper(root, match[1])
        question = next((q for q in paper['questions'] if q['id'] == match[2]), None)
        if paper['kind'] != 'dsa' or question is None:
            raise ValueError('This question is a written review, not a coding exercise.')
        choices = paper_problem_ids([source for source in paper['sources'] if source['id'] in question['source_ids']])
        if not choices:
            raise ValueError('This paper has no saved DSA topic for coding practice.')
        identifier = question.get('problem_id')
        companion = not identifier
        if not identifier:
            identifier = choices[(int(match[2][1:]) - 1) % len(choices)]
        if identifier not in choices:
            raise ValueError('This coding exercise does not belong to the paper’s saved topics.')
        route = '#/learning/practice/paper/' + match[1]
    problem = catalog.problem(identifier)
    return {**problem, 'key': key, 'problem_key': 'dsa/' + identifier,
            'route': route, 'companion': companion}


def descriptor(root, key, language='python'):
    problem = resolve(root, key)
    problem['draft'] = learning_scores.get_draft(root, problem['problem_key'], language)
    return problem


def save_draft(root, body):
    if not isinstance(body, dict) or set(body) != {'key', 'language', 'code'}:
        raise ValueError('Send the exercise, language, and code to save.')
    problem = resolve(root, body['key'])
    return learning_scores.save_draft(root, problem['problem_key'], body['language'], body['code'])


def execute(root, course, body, *, studied=None):
    if not isinstance(body, dict) or set(body) - {'key', 'language', 'code', 'action', 'stdin', 'submission_id'}:
        raise ValueError('Send a coding exercise and its code.')
    action = body.get('action')
    if action not in ('samples', 'custom', 'submit'):
        raise ValueError('Choose Run examples, Run input, or Submit solution.')
    if 'submission_id' in body and (not isinstance(body['submission_id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', body['submission_id'])):
        raise ValueError('Use a valid submission identifier.')
    problem = resolve(root, body.get('key'))
    language, code = body.get('language'), body.get('code')
    if language not in ('python', 'javascript', 'cpp') or not isinstance(code, str) or not code.strip() or len(code) > 100_000:
        raise ValueError('Choose Python, JavaScript, or C++ and enter up to 100,000 characters of code.')
    stdin = body.get('stdin', '{}')
    if not isinstance(stdin, str) or len(stdin) > 20_000:
        raise ValueError('Keep custom input to 20,000 characters of JSON.')
    if action == 'custom':
        try:
            json.loads(stdin)
        except (ValueError, RecursionError) as exc:
            raise ValueError('Custom input must be valid JSON matching the exercise input format.') from exc
    learning_scores.save_draft(root, problem['problem_key'], language, code)
    cases = None if action == 'custom' else catalog.cases(problem['id'], samples_only=action == 'samples')
    result = local_code_runner.execute({'language': language, 'code': code, 'stdin': stdin}, tests=cases)
    result.update(action=action, problem_key=problem['problem_key'])
    result['scored'] = False
    unavailable = result.get('status') == 'unavailable' or any(test.get('status') == 'unavailable' for test in result.get('tests', []))
    if unavailable:
        result['status'] = 'unavailable'
    if action == 'submit' and not unavailable:
        # The server, never the request, supplies the authoritative test counts.
        total = len(cases)
        passed = sum(test.get('passed') is True for test in result.get('tests', []))
        value = {'problem_key': problem['problem_key'], 'title': problem['title'], 'route': problem['route'],
                 'passed': passed, 'total': total, 'language': language}
        if body.get('submission_id'):
            value['submission_id'] = body['submission_id']
        submission = learning_scores.record_submission(root, value)
        result.update(submission=submission, passed=passed, total=total, scored=True)
        if passed == total:
            daily_dsa.update_problem(root, course, {'id': problem['id'], 'status': 'solved'}, studied=studied)
            identifier = 'code/' + problem['problem_key']
            def credit(data):
                # A fresh successful revision counts on its local day; retries
                # cannot duplicate that day's calendar event or XP.
                if any(event['id'] == identifier and event['action'] == 'completed' and event['at'][:10] == submission['date'] for event in data['history']):
                    return
                data['documents'][identifier] = {'done': True, 'title': problem['title'], 'updated_at': submission['at'], 'completed_at': submission['at']}
                data['history'].append({'kind': 'research', 'id': identifier, 'title': problem['title'], 'action': 'completed', 'at': submission['at']})
            learning_memory.transact(root, credit, studied=studied)
        else:
            daily_dsa.update_problem(root, course, {'id': problem['id'], 'status': 'attempted'}, studied=studied, preserve_solved=True)
    return result
