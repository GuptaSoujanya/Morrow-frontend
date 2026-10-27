"""Dashboard integration checks use only temporary files and never start the bots."""
import importlib.util
import json
import sys
import threading
import http.client
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('dashboard_server', Path(__file__).parents[1] / 'server.py')
dashboard = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = dashboard
spec.loader.exec_module(dashboard)

@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setattr(dashboard.state, 'APPLY', tmp_path)
    profile = tmp_path / 'profile.yaml'
    profile.write_text('name: Before\n')
    monkeypatch.setattr(dashboard.server, 'files', lambda: {'profile': profile})
    server = dashboard.DashboardServer(0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server, profile
    server.shutdown()
    server.server_close()
    thread.join()

def request(app, method, path, body=None, headers=None):
    server, _ = app
    connection = http.client.HTTPConnection('127.0.0.1', server.server_port)
    connection.request(method, path, body=json.dumps(body) if body is not None else None,
                       headers={'Content-Type': 'application/json', **(headers or {})})
    response = connection.getresponse()
    text = response.read()
    result = json.loads(text) if response.getheader('Content-Type').startswith('application/json') else text
    connection.close()
    return response.status, result

def test_dashboard_and_modules_are_served(app):
    assert request(app, 'GET', '/')[0] == 200
    assert request(app, 'GET', '/assets/main.js' if (dashboard.ROOT / 'dist/index.html').exists() else '/js/main.js')[0] == 200
    assert request(app, 'GET', '/.env')[0] == 404
    assert request(app, 'GET', '/../web/state.py')[0] == 404


def test_beta_opens_local_workspace_without_a_session(app):
    status, session = request(app, 'GET', '/api/session')
    assert status == 200
    assert session == {'mode': 'local', 'user': None, 'legacy_access': True}
    assert request(app, 'GET', '/api/file?name=profile')[1]['text'] == 'name: Before\n'
    assert app[0].server_address[0] == '127.0.0.1'


@pytest.mark.parametrize('method,path', [
    ('GET', '/api/v1/me'), ('GET', '/api/v1/auth/options'),
    ('POST', '/api/v1/auth/login'), ('POST', '/api/v1/auth/signup'),
    ('GET', '/api/v1/plans'), ('POST', '/api/v1/billing/checkout'),
    ('PUT', '/api/v1/admin/users/example'), ('POST', '/api/runner/setup'),
])
def test_beta_detaches_account_and_billing_endpoints(app, method, path):
    status, body = request(app, method, path)
    assert status == 404
    assert 'disabled in the free beta' in body['error']


def test_beta_preserves_local_host_and_write_origin_checks(app):
    assert request(app, 'GET', '/api/session', headers={'Host': 'other.example'})[0] == 403
    original = request(app, 'GET', '/api/file?name=profile')[1]
    assert request(app, 'POST', '/api/file', {
        'name': 'profile', 'revision': original['revision'], 'text': 'changed',
    }, headers={'Origin': 'https://other.example'})[0] == 403
    assert app[1].read_text() == 'name: Before\n'


def test_beta_is_default_even_with_old_account_configuration(monkeypatch):
    monkeypatch.delenv('MORROW_MODE', raising=False)
    monkeypatch.setenv('MORROW_API_URL', 'http://127.0.0.1:1')
    options = dashboard.launch_options([])
    assert options.mode == 'beta' and options.account_url is None
    monkeypatch.setenv('MORROW_MODE', 'accounts')
    assert dashboard.launch_options([]).account_url == 'http://127.0.0.1:1'
    assert dashboard.launch_options(['--mode', 'beta']).account_url is None


def test_accounts_mode_requires_valid_explicit_configuration(monkeypatch):
    monkeypatch.delenv('MORROW_API_URL', raising=False)
    assert dashboard.launch_options(['--mode', 'accounts']).account_url == 'http://127.0.0.1:8200'
    monkeypatch.setenv('MORROW_MODE', 'typo')
    with pytest.raises(SystemExit):
        dashboard.launch_options([])
    monkeypatch.setenv('MORROW_API_URL', '')
    with pytest.raises(SystemExit):
        dashboard.launch_options(['--mode', 'accounts'])


def test_beta_does_not_use_account_runner_snapshot(monkeypatch, tmp_path):
    monkeypatch.setattr(dashboard.state, 'APPLY', tmp_path)
    monkeypatch.setenv('MORROW_WORKSPACE_OWNER_EMAIL', 'old-owner@example.com')
    monkeypatch.setattr(dashboard.runner_setup, 'runtime_environment', lambda root, email: {'OWNER': email} if email else {})
    app = dashboard.DashboardServer(0, dashboard.launch_options(['--mode', 'beta']).account_url)
    try:
        assert app.workspace_owner_email == ''
        assert app.runner.environment_provider(None, None) == {}
    finally:
        app.server_close()


DOCUMENT_HEADERS = {'Accept': 'text/html', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate'}


@pytest.mark.parametrize('method', ['GET', 'HEAD'])
def test_missing_browser_page_is_a_static_html_404_without_account_lookup(app, method):
    class UnavailableAccounts:
        def identity(self, handler):
            raise AssertionError('The public missing page must not look up an account')
    app[0].account_bridge = UnavailableAccounts()
    connection = http.client.HTTPConnection('127.0.0.1', app[0].server_port)
    connection.request(method, '/does-not-exist/nested?token=must-not-appear', headers=DOCUMENT_HEADERS)
    response = connection.getresponse()
    body = response.read()
    assert response.status == 404
    assert response.getheader('Content-Type') == 'text/html; charset=utf-8'
    assert int(response.getheader('Content-Length')) > 100
    if method == 'HEAD':
        assert body == b''
    else:
        assert b'A little off course.' in body and b'Back to Morrow' in body
        assert b'href="/#/"' in body and b'<script' not in body
        assert b'must-not-appear' not in body and b'/api/' not in body
    connection.close()


@pytest.mark.parametrize('path', [
    '/api/status', '/api/unknown', '/course', '/course/missing', '/reports/missing',
    '/profile.yaml', '/.env', '/does-not-exist%2f..%2fprofile', '/does-not-exist/../profile',
])
def test_missing_document_does_not_bypass_private_or_ambiguous_paths(app, path):
    class SignedOutAccounts:
        def identity(self, handler):
            return None
    app[0].account_bridge = SignedOutAccounts()
    status, body = request(app, 'GET', path, headers=DOCUMENT_HEADERS)
    assert status == 401 and isinstance(body, dict)


def test_missing_document_keeps_host_methods_and_assets_protected(app):
    class SignedOutAccounts:
        def identity(self, handler):
            return None
    app[0].account_bridge = SignedOutAccounts()
    assert request(app, 'GET', '/does-not-exist', headers={**DOCUMENT_HEADERS, 'Host': 'untrusted.example'})[0] == 403
    assert request(app, 'POST', '/does-not-exist', {}, DOCUMENT_HEADERS)[0] == 401
    assert request(app, 'GET', '/does-not-exist')[0] == 401
    for path in ['/assets/missing.js', '/styles/missing.css', '/js/missing.js', '/fonts/missing.woff2']:
        status, body = request(app, 'GET', path, headers=DOCUMENT_HEADERS)
        assert status == 404 and isinstance(body, dict)

def test_foreign_origin_and_host_cannot_change_files(app):
    assert request(app, 'GET', '/api/file?name=profile', headers={'Host': 'untrusted.example'})[0] == 403
    assert request(app, 'POST', '/api/file', {'name': 'profile', 'text': 'changed'}, {'Origin': 'https://untrusted.example'})[0] == 403
    assert app[1].read_text() == 'name: Before\n'

def test_file_saving_is_versioned_and_backed_up(app):
    _, original = request(app, 'GET', '/api/file?name=profile')
    assert request(app, 'POST', '/api/file', {'name': 'profile', 'revision': original['revision'], 'text': 'name: After\n'})[0] == 200
    assert app[1].read_text() == 'name: After\n'
    backups = list((app[1].parent / 'user/inputs/backups').glob('*.bak'))
    assert len(backups) == 1 and backups[0].read_text() == 'name: Before\n'
    assert request(app, 'POST', '/api/file', {'name': 'profile', 'revision': original['revision'], 'text': 'stale edit'})[0] == 409
    assert app[1].read_text() == 'name: After\n'

def test_board_command_is_bounded_and_does_not_shell_interpolate():
    cmd = dashboard.board_command({'board': 'hirist', 'dry_run': True, 'limit': '5'})
    assert cmd.argv[1:] == ('-m', 'sites_bot.platforms', '--site', 'hirist', '--dry-run', '--limit', '5')
    for options in [{'board': ';touch bad'}, {'limit': '-1'}, {'mode': 'shell'}, {'limit': '1.5'}]:
        with pytest.raises(ValueError): dashboard.board_command(options)

def test_pipeline_only_accepts_supported_groups():
    cmd = dashboard.pipeline_command({'group': 'apply', 'dry_run': True})
    assert cmd.argv[1:] == ('-m', 'pipeline', 'continue', '--only', 'apply', '--dry-run')
    with pytest.raises(ValueError): dashboard.pipeline_command({'group': '--shell'})
    with pytest.raises(ValueError): dashboard.pipeline_command({'command': 'delete'})

def test_missing_checkpoint_is_an_honest_empty_state(app):
    status, data = request(app, 'GET', '/api/pipeline')
    assert status == 200 and data['stages'] == [] and data['status'] == 'not started'
    assert {'site': 'hirist', 'url': data['watch'][2]['url']} in data['watch'] and ':6083/vnc.html' in data['watch'][2]['url']

def test_bot_inventory_never_claims_an_unfinished_record_is_live(monkeypatch):
    monkeypatch.setattr(dashboard.state, '_query', lambda *args: [
        {'started_at':'2026-10-22T12:00:00Z','finished_at':None,'summary_json':json.dumps({'board':'hirist','collected':23})},
        {'started_at':'2026-10-21T12:00:00Z','finished_at':'2026-10-21T13:00:00Z','summary_json':'[]'},
    ])
    data=dashboard.bots_status(dashboard.server.Runner())
    assert len(data['bots']) == 18
    assert not any(bot['running'] for bot in data['bots'])
    hirist=next(bot for bot in data['bots'] if bot['id']=='hirist')
    assert hirist['last_run']['finished'] is False and hirist['last_run']['found']==23

def test_bot_status_matches_the_selected_board_only(monkeypatch):
    monkeypatch.setattr(dashboard.state, '_query', lambda *args: [])
    class FakeRunner:
        def snapshot(self):
            return {'running':True,'action':'boards','shown':'python -m sites_bot.platforms --site hirist --dry-run'}
    data=dashboard.bots_status(FakeRunner())
    assert [bot['id'] for bot in data['bots'] if bot['running']] == ['hirist']


def test_bot_status_includes_each_parallel_run_and_ignores_completed_runs(monkeypatch):
    monkeypatch.setattr(dashboard.state, '_query', lambda *args: [])
    class FakeRunner:
        def snapshot(self):
            return {'running': True, 'action': 'boards', 'runs': [
                {'id': 'jobs', 'running': True, 'action': 'boards',
                 'shown': 'python -m sites_bot.platforms --site hirist --dry-run'},
                {'id': 'learn', 'running': True, 'action': 'pipeline',
                 'shown': 'python -m pipeline continue --only learn'},
                {'id': 'news', 'running': True, 'action': 'pipeline',
                 'shown': 'python -m pipeline continue --only brief:tech-news'},
                {'id': 'finished', 'running': False, 'action': 'linkedin', 'shown': 'python -m linkedin_bot'},
            ]}
    bots = {bot['id']: bot for bot in dashboard.bots_status(FakeRunner())['bots']}
    assert {key for key, bot in bots.items() if bot['running']} == {'hirist', 'learn', 'brief'}
    assert bots['hirist']['run_ids'] == ['jobs']
    assert bots['learn']['run_ids'] == ['learn']
    assert bots['brief']['run_ids'] == ['news']
    assert bots['linkedin']['run_ids'] == []


@pytest.mark.parametrize('selection,expected', [
    ('--only apply', {'naukri', *dashboard.BOARDS}),
    ('--only profile --skip profile:linkedin', {'profile', *(board + '_profile' for board in dashboard.BOARDS)}),
    ('--only apply:wellfound', {'wellfound'}),
    ('--only profile:linkedin', {'linkedin_profile'}),
    ('--only research:resume', {'research'}),
    ('--only brief:tech-news --only brief:papers', {'brief'}),
    ('--skip apply --skip profile', {'learn', 'research', 'brief'}),
])
def test_pipeline_inventory_matches_selected_stages_and_skips(monkeypatch, selection, expected):
    monkeypatch.setattr(dashboard.state, '_query', lambda *args: [])
    class FakeRunner:
        def snapshot(self):
            return {'running': True, 'runs': [
                {'id': 'flow', 'running': True, 'action': 'pipeline',
                 'shown': 'python -m pipeline continue ' + selection},
            ]}
    bots = dashboard.bots_status(FakeRunner())['bots']
    assert {bot['id'] for bot in bots if bot['running']} == expected
    assert all(bot['run_ids'] == ['flow'] for bot in bots if bot['running'])


@pytest.mark.parametrize('command', ['status', 'check', 'learn --done'])
def test_pipeline_checkpoint_commands_do_not_claim_agents_are_running(monkeypatch, command):
    monkeypatch.setattr(dashboard.state, '_query', lambda *args: [])
    class FakeRunner:
        def snapshot(self):
            return {'running': True, 'action': 'pipeline', 'shown': 'python -m pipeline ' + command}
    assert not any(bot['running'] for bot in dashboard.bots_status(FakeRunner())['bots'])


def test_missing_database_is_honest_and_bot_endpoint_is_local(app,monkeypatch):
    monkeypatch.setattr(dashboard.state,'database',lambda:app[1].parent/'missing.db')
    status,data=request(app,'GET','/api/bots')
    assert status==200 and len(data['bots'])==18
    assert all(bot['last_run'] is None and not bot['running'] for bot in data['bots'])
    assert request(app,'GET','/api/bots',headers={'Host':'untrusted.example'})[0]==403

def test_schedule_command_cannot_target_an_arbitrary_service():
    cmd=dashboard.schedule_command('profile','disable')
    assert cmd.argv[-2:]==('profile','disable')
    with pytest.raises(ValueError): dashboard.schedule_command('com.apple.other','disable')
    with pytest.raises(ValueError): dashboard.schedule_command('profile','delete')

def test_schedule_disable_preserves_files_and_only_calls_expected_service(monkeypatch):
    from types import SimpleNamespace
    spec=importlib.util.spec_from_file_location('dashboard_schedule',dashboard.ROOT/'schedule.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module.sys,'platform','darwin')
    calls=[]
    def fake_run(argv,**kwargs):
        calls.append(argv)
        return SimpleNamespace(returncode=0)
    module.change_schedule('linkedin','disable',run=fake_run,uid=501)
    target='gui/501/com.naukri-bot.linkedin-post'
    assert calls==[['/bin/launchctl','disable',target],['/bin/launchctl','bootout',target]]


@pytest.mark.parametrize('board',['hirist','instahyre','cutshort','wellfound','all'])
def test_profile_crew_commands_and_live_status_are_separate_from_applications(monkeypatch,board):
    monkeypatch.setattr(dashboard.state,'_query',lambda *args:[])
    cmd=dashboard.board_command({'board':board,'mode':'profile','dry_run':True})
    assert '--profile-only' in cmd.argv and '--create-profile' in cmd.argv and '--dry-run' in cmd.argv
    class FakeRunner:
        def snapshot(self):return {'running':True,'action':'boards','shown':cmd.shown}
    active=[bot['id'] for bot in dashboard.bots_status(FakeRunner())['bots'] if bot['running']]
    expected=[name+'_profile' for name in dashboard.BOARDS] if board=='all' else [board+'_profile']
    assert active==expected


def test_profile_history_is_not_borrowed_from_application_runs(monkeypatch):
    monkeypatch.setattr(dashboard.state,'_query',lambda *args:[
        {'started_at':'2026-10-22','finished_at':'2026-10-22','summary_json':json.dumps({'board':'wellfound','applied':3})}])
    bots={b['id']:b for b in dashboard.bots_status(dashboard.server.Runner())['bots']}
    assert bots['wellfound']['last_run']['sent']==3
    assert bots['wellfound_profile']['last_run'] is None


def test_resume_api_is_download_only_and_contained(app,monkeypatch):
    root=app[1].parent/'resumes';root.mkdir();(root/'demo.pdf').write_bytes(b'%PDF fixture')
    monkeypatch.setattr(dashboard.state,'RESUMES',root)
    assert request(app,'GET','/api/resume-file?file=demo.pdf')==(200,b'%PDF fixture')
    assert request(app,'GET','/api/resume-file?file=../profile.yaml')[0]==400
    assert request(app,'GET','/api/resume-file?file=demo.pdf',headers={'Host':'evil.example'})[0]==403


def test_resume_preview_is_inline_but_download_is_explicit(app,monkeypatch):
    root=app[1].parent/'pdfs';root.mkdir();(root/'preview.pdf').write_bytes(b'%PDF fixture')
    monkeypatch.setattr(dashboard.state,'RESUMES',root)
    for query,expected in [('', 'attachment'),('&preview=1','inline')]:
        connection=http.client.HTTPConnection('127.0.0.1',app[0].server_port)
        connection.request('GET','/api/resume-file?file=preview.pdf'+query)
        response=connection.getresponse()
        assert response.status==200
        assert response.getheader('Content-Disposition').startswith(expected+';')
        assert response.getheader('Content-Type')=='application/pdf'
        assert response.getheader('Cache-Control')=='no-store'
        assert response.read()==b'%PDF fixture'
        connection.close()


def test_course_legacy_deep_links_redirect_to_the_hash_reader(app,monkeypatch):
    root=app[1].parent/'course';(root/'01-system-design').mkdir(parents=True)
    (root/'index.html').write_text('<h1>Reader</h1>')
    (root/'_sidebar.md').write_text('- **Systems**\n  - [System design](01-system-design/README.md)\n')
    (root/'01-system-design/README.md').write_text('# System design')
    monkeypatch.setattr(dashboard.state,'COURSE',root)
    connection=http.client.HTTPConnection('127.0.0.1',app[0].server_port)
    connection.request('GET','/course/01-system-design/')
    response=connection.getresponse();response.read()
    assert response.status in (301,302,303,307,308)
    assert response.getheader('Location')=='/course/#/01-system-design/'
    connection.close()
    assert request(app,'GET','/course/')[0]==200
    assert request(app,'GET','/course/01-system-design/README.md')==(200,b'# System design')
    assert request(app,'GET','/course/not-a-lesson/')[0]==404
    assert request(app,'GET','/course/../../profile.yaml')[0]==404


def test_research_progress_endpoint_is_local_validated_and_durable(app,monkeypatch):
    root=app[1].parent/ 'user/research/learning/weeks';root.mkdir(parents=True)
    (root/'week-01.md').write_text('## Day 1: First lesson\nRead this.\n\n## Day 2: Second lesson\nRead next.')
    monkeypatch.setattr(dashboard.state,'STUDIED',app[1].parent/'studied.json')
    assert request(app,'GET','/api/document?id=plan/day-1')[1]['read'] is False
    body={'id':'plan/day-1','read':True}
    assert request(app,'POST','/api/research/read',body,{'Origin':'https://evil.example'})[0]==403
    assert request(app,'POST','/api/research/read',{'id':'plan/day-1','read':'false'})[0]==400
    assert request(app,'POST','/api/research/read',body)[0]==200
    assert request(app,'GET','/api/research/learning')[1]['focus']['day']==2
    # A second server instance has no in-memory completion state to inherit.
    second=dashboard.DashboardServer(0)
    thread=threading.Thread(target=second.serve_forever,daemon=True);thread.start()
    try:
        assert request((second,app[1]),'GET','/api/document?id=plan/day-1')[1]['read'] is True
    finally:
        second.shutdown();second.server_close();thread.join()
    saved=json.loads((app[1].parent/ 'user/memory/learning.json').read_text())
    assert saved['plan']['done']==[1] and len(saved['history'])==1


def test_board_profile_jobs_open_a_visible_browser_but_applications_keep_the_env(monkeypatch):
    monkeypatch.setattr(dashboard.state,'_query',lambda *args:[])
    profile=dashboard.board_command({'board':'hirist','mode':'profile'})
    assert dict(profile.env)=={'BACKGROUND':'false','HEADLESS':'false'} and '--profile-only' in profile.argv
    assert dashboard.board_command({'board':'hirist','mode':'apply'}).env==()


def test_file_backups_are_private_from_creation(app, monkeypatch):
    monkeypatch.setattr(Path, "chmod", lambda self, mode: pytest.fail("chmod is too late"))
    _, original = request(app, 'GET', '/api/file?name=profile')
    assert request(app, 'POST', '/api/file', {'name': 'profile', 'revision': original['revision'], 'text': 'name: After\n'})[0] == 200
    backups = list((app[1].parent / 'user/inputs/backups').glob('*.bak'))
    assert len(backups) == 1 and backups[0].stat().st_mode & 0o777 == 0o600

def test_every_reply_refuses_to_be_framed_by_other_sites(app):
    server, _ = app
    for method, path in (('GET', '/'), ('GET', '/api/file?name=profile'), ('GET', '/nope'), ('POST', '/api/stop')):
        connection = http.client.HTTPConnection('127.0.0.1', server.server_port)
        connection.request(method, path, body='{}' if method == 'POST' else None, headers={'Content-Type': 'application/json'})
        response = connection.getresponse()
        response.read()
        assert response.getheader('X-Frame-Options') == 'SAMEORIGIN', (method, path)
        assert response.getheader('X-Content-Type-Options') == 'nosniff', (method, path)
        connection.close()
