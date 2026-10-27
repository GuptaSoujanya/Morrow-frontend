"""Learning account adapters must preserve isolation and concurrent edits."""
import copy
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
from test_tenant_api import Bridge, Handler, adapter, artifact
from tenant_api import TenantAPI, now


class LearningBridge(Bridge):
    def __init__(self):
        super().__init__()
        self.setup = {'resume': None, 'readiness': {'resume_ready': False}}
        self.before_save = None

    def request(self, handler, path, method='GET', body=None, headers=None):
        if urlsplit(path).path == '/api/v1/onboarding':
            assert handler.headers['Cookie'] == 'morrow_session=alice'
            self.calls.append((path, method, body))
            return 200, [], json.dumps(self.setup).encode()
        if path == '/api/v1/profile' and method == 'PUT' and self.before_save:
            change, self.before_save = self.before_save, None
            change()
        return super().request(handler, path, method, body, headers)


def request(bridge, method, path, body=None, query=None, modules=None):
    api, handler = adapter(bridge, body, modules=modules)
    assert api.handle(method, path, query or {})
    return handler


def save(bridge, body):
    result = request(bridge, 'POST', '/api/learning/collection', body)
    assert result.status == 200, result.result
    return result.result


def test_bookmarks_are_typed_canonical_and_saved_only_in_account_profile():
    bridge = LearningBridge()
    first = save(bridge, {'action': 'bookmark', 'kind': 'paper', 'url': 'https://arxiv.org/pdf/2610.00001v2.pdf', 'title': 'Paper', 'saved': True})
    second = save(bridge, {'action': 'bookmark', 'kind': 'paper', 'url': 'https://arxiv.org/abs/2610.00001', 'title': 'Paper', 'saved': True})
    assert first['id'] == second['id']
    save(bridge, {'action': 'bookmark', 'kind': 'repo', 'url': 'https://github.com/Org/Tool.git/', 'title': 'Tool', 'saved': True})
    result = request(bridge, 'GET', '/api/learning/collection').result
    assert {item['kind'] for item in result['bookmarks']} == {'paper', 'repo'}
    assert bridge.profile['data']['name'] == 'Alice'
    assert len(bridge.profile['data']['_learning_workspace']['bookmarks']) == 2
    assert all(path == '/api/v1/profile' for path, _method, _body in bridge.calls)
    save(bridge, {'action': 'bookmark', 'kind': 'paper', 'url': 'https://arxiv.org/abs/2610.00001', 'saved': False})
    assert len(request(bridge, 'GET', '/api/learning/collection').result['bookmarks']) == 1


def test_notes_preserve_profile_fields_and_reject_stale_edits_and_deletes():
    bridge = LearningBridge()
    note = save(bridge, {'action': 'note', 'title': 'Caching', 'body': 'Think about invalidation.', 'kind': 'resource'})['note']
    edited = save(bridge, {**note, 'action': 'note', 'body': 'Choose a TTL.'})['note']
    assert edited['revision'] == 2
    for action in ('note', 'delete_note'):
        result = request(bridge, 'POST', '/api/learning/collection', {**note, 'action': action})
        assert result.status == 409 and 'another window' in result.result
    assert request(bridge, 'GET', '/api/learning/collection').result['notes'][0]['body'] == 'Choose a TTL.'
    save(bridge, {**edited, 'action': 'delete_note'})
    assert request(bridge, 'GET', '/api/learning/collection').result['notes'] == []
    assert bridge.profile['data']['name'] == 'Alice'


def test_independent_save_conflict_is_rebased_on_current_profile():
    bridge = LearningBridge()
    def competing_save():
        save(bridge, {'action': 'note', 'title': 'Other tab', 'body': 'Keep me.'})
        bridge.profile['data']['skills'] = ['Python']
    bridge.before_save = competing_save
    save(bridge, {'action': 'note', 'title': 'This tab', 'body': 'Keep this too.'})
    result = request(bridge, 'GET', '/api/learning/collection').result
    assert {note['title'] for note in result['notes']} == {'Other tab', 'This tab'}
    assert bridge.profile['data']['skills'] == ['Python']


def test_concurrent_changes_to_same_note_are_not_overwritten():
    bridge = LearningBridge()
    note = save(bridge, {'action': 'note', 'title': 'Caching', 'body': 'Original'})['note']
    bridge.before_save = lambda: save(bridge, {**note, 'action': 'note', 'body': 'Competing edit'})
    result = request(bridge, 'POST', '/api/learning/collection', {**note, 'action': 'note', 'body': 'Stale edit'})
    assert result.status == 409
    assert request(bridge, 'GET', '/api/learning/collection').result['notes'][0]['body'] == 'Competing edit'


def test_creation_token_survives_lost_response_and_concurrent_create_retry():
    bridge = LearningBridge()
    body = {'action': 'note', 'title': 'One draft', 'body': 'Saved once.', 'creation_token': 'a' * 32}
    competing = []
    bridge.before_save = lambda: competing.append(save(bridge, body)['note'])
    note = save(bridge, body)['note']
    assert note == competing[0]
    assert save(bridge, body)['note'] == note
    assert request(bridge, 'GET', '/api/learning/collection').result['notes'] == [note]


def test_creation_retry_conflict_preserves_changed_and_deleted_notes():
    bridge = LearningBridge()
    body = {'action': 'note', 'title': 'One draft', 'body': 'Original', 'creation_token': 'b' * 32}
    original = save(bridge, body)['note']
    conflict = request(bridge, 'POST', '/api/learning/collection', {**body, 'body': 'Changed after an unknown save'})
    assert conflict.status == 409 and 'already saved' in conflict.result
    edited = save(bridge, {**original, 'action': 'note', 'body': 'Edited elsewhere'})['note']
    conflict = request(bridge, 'POST', '/api/learning/collection', body)
    assert conflict.status == 409 and 'already saved' in conflict.result
    assert request(bridge, 'GET', '/api/learning/collection').result['notes'] == [edited]
    save(bridge, {**edited, 'action': 'delete_note'})
    conflict = request(bridge, 'POST', '/api/learning/collection', body)
    assert conflict.status == 409 and 'already saved' in conflict.result
    assert request(bridge, 'GET', '/api/learning/collection').result['notes'] == []
    assert save(bridge, {**body, 'creation_token': 'c' * 32})['note']['id'] != original['id']


@pytest.mark.parametrize('token', ['', True, 123, 'not-a-token', 'A' * 32])
def test_invalid_creation_tokens_do_not_write_account_profile(token):
    bridge = LearningBridge()
    before = copy.deepcopy(bridge.profile)
    result = request(bridge, 'POST', '/api/learning/collection', {'action': 'note', 'title': 'Invalid', 'body': '', 'creation_token': token})
    assert result.status == 400 and 'creation token' in result.result
    assert bridge.profile == before


def test_repeated_cas_conflicts_leave_the_unsaved_note_untouched():
    bridge = LearningBridge()
    def change_each_attempt():
        bridge.profile['version'] += 1
        bridge.before_save = change_each_attempt
    bridge.before_save = change_each_attempt
    result = request(bridge, 'POST', '/api/learning/collection', {'action': 'note', 'title': 'Unsaved', 'body': 'Keep my draft'})
    assert result.status == 409 and 'draft is still here' in result.result
    assert '_learning_workspace' not in bridge.profile['data']


@pytest.mark.parametrize('kind,url', [('repo', 'https://example.com/org/repo'), ('paper', 'javascript:alert(1)'),
                                    ('repo', 'https://github.com/org/repo/issues'), ('paper', 'https://user:pass@example.com')])
def test_invalid_links_do_not_write_profile(kind, url):
    bridge = LearningBridge()
    before = copy.deepcopy(bridge.profile)
    result = request(bridge, 'POST', '/api/learning/collection', {'action': 'bookmark', 'kind': kind, 'url': url, 'title': 'Invalid', 'saved': True})
    assert result.status == 400 and bridge.profile == before


def test_empty_generation_is_truthful_and_focus_uses_only_account_inputs():
    bridge = LearningBridge()
    bridge.profile['data'].update(skills=['Python', 'FastAPI', 'private@example.com'], titles=['Backend Engineer'],
                                  email='private@example.com', full_name='Private Person', _dashboard_files={'answers': 'Private answer'})
    bridge.setup = {'resume': {'sha256': 'a' * 64, 'created_at': now().isoformat(), 'filename': 'Private Name.pdf'},
                    'readiness': {'resume_ready': True}}
    result = request(bridge, 'GET', '/api/learning/curriculum')
    assert result.status == 200
    data = result.result
    assert len(data['weeks']) == 13 and sum(len(week['days']) for week in data['weeks']) == 90
    assert not any(day['available'] for week in data['weeks'] for day in week['days'])
    assert not data['generation_available'] and data['completed'] == 0
    assert data['profile']['skills'] == ['Python', 'FastAPI']
    assert data['profile']['target_roles'] == ['Backend Engineer']
    assert data['profile']['resume_fingerprint'] == 'a' * 64
    public = json.dumps(data)
    assert all(secret not in public for secret in ('private@example.com', 'Private Person', 'Private Name.pdf', 'Private answer'))
    discovery = request(bridge, 'GET', '/api/learning/discovery', query={'date': '2026-10-27'}).result
    assert discovery['date'] == '2026-10-27' and not discovery['dates']
    assert len(discovery['sections']) == 4 and not any(section['available'] for section in discovery['sections'])
    assert request(bridge, 'GET', '/api/learning/discovery', query={'date': '../../secrets'}).status == 400


def test_overview_and_activity_count_only_owned_existing_read_documents():
    bridge = LearningBridge()
    identifier = artifact(bridge, 'Study.md', b'# Study')
    save(bridge, {'action': 'note', 'title': 'One note', 'body': 'Saved.'})
    request(bridge, 'POST', '/api/research/read', {'id': 'artifact/' + identifier, 'read': True})
    bridge.items['records'].append({'collection': 'learning', 'data': {
        'id': 'artifact/deleted-file', 'done': True, 'completed_at': now().isoformat()}})
    result = request(bridge, 'GET', '/api/learning/overview').result
    library = next(track for track in result['tracks'] if track['key'] == 'library')
    assert library['completed'] == library['total'] == 1
    assert library['percent'] == 100 and result['notes'] == 1
    assert result['total_completions'] == result['today_completed'] == 1
    assert result['activity']['total_completions'] == 1
    assert sum(day['count'] for day in result['week']) == 1
    activity = request(bridge, 'GET', '/api/learning/activity').result
    assert activity['total_completions'] == 1 and activity['current_streak'] == 1
    assert activity['badges'][0]['earned_at']


def test_profile_editor_hides_and_preserves_learning_data():
    bridge = LearningBridge()
    save(bridge, {'action': 'note', 'title': 'Do not export into resume', 'body': 'A personal note'})
    original = copy.deepcopy(bridge.profile['data']['_learning_workspace'])
    result = request(bridge, 'GET', '/api/file', query={'name': 'profile'})
    assert '_learning_workspace' not in result.result['text'] and 'A personal note' not in result.result['text']
    updated = request(bridge, 'POST', '/api/file', {'name': 'profile', 'text': 'name: Alice Updated\n_learning_workspace: {}\n', 'revision': str(bridge.profile['version'])})
    assert updated.status == 200 and bridge.profile['data']['_learning_workspace'] == original
    assert bridge.profile['data']['name'] == 'Alice Updated'


@pytest.mark.parametrize('path', ['/api/learning/collection', '/api/learning/curriculum', '/api/learning/discovery', '/api/learning/overview', '/api/learning/activity'])
def test_learning_entitlements_are_checked_before_backend_reads(path):
    bridge = LearningBridge()
    result = request(bridge, 'GET', path, modules=['profile', 'files'])
    assert result.status == 403 and bridge.calls == []
    result = request(bridge, 'POST', '/api/learning/collection', {'action': 'note', 'title': 'No', 'body': ''}, modules=['profile', 'files'])
    assert result.status == 403 and bridge.calls == []


def test_malformed_saved_workspace_is_not_reset():
    bridge = LearningBridge()
    bridge.profile['data']['_learning_workspace'] = {'notes': []}
    before = copy.deepcopy(bridge.profile)
    result = request(bridge, 'GET', '/api/learning/collection')
    assert result.status == 409 and bridge.profile == before


def test_separate_account_sessions_never_share_notes():
    class SessionBridge:
        def __init__(self):
            self.accounts = {'alice': LearningBridge(), 'bob': LearningBridge()}
            self.sessions = []

        def request(self, handler, path, method='GET', body=None, headers=None):
            session = handler.headers['Cookie'].split('=')[-1]
            self.sessions.append(session)
            forwarded = copy.copy(handler)
            forwarded.headers = {**handler.headers, 'Cookie': 'morrow_session=alice', 'X-CSRF-Token': 'alice-csrf'}
            return self.accounts[session].request(forwarded, path, method, body, headers)

    bridge = SessionBridge()
    user = {'role': 'user', 'modules': ['profile', 'files', 'learning']}
    alice = Handler({'action': 'note', 'title': 'Alice private', 'body': 'Secret'})
    TenantAPI(bridge, alice, user).handle('POST', '/api/learning/collection', {})
    assert alice.status == 200
    bob = Handler()
    bob.headers['Cookie'] = 'morrow_session=bob'
    TenantAPI(bridge, bob, user).handle('GET', '/api/learning/collection', {})
    assert bob.status == 200 and bob.result == {'notes': [], 'bookmarks': []}
    assert bridge.sessions == ['alice', 'alice', 'bob']
