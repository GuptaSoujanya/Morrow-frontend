from test_server import app, request


def test_local_setup_boundary_and_persistence(app):
    assert request(app, 'GET', '/api/local-setup', headers={'Host': 'evil.example'})[0] == 403
    status, data = request(app, 'GET', '/api/local-setup')
    assert status == 200 and data['needs_setup'] and not data['complete']
    profile = {'full_name': 'Test Person', 'email': 'test@example.com', 'phone': '5555555555', 'current_location': 'Pune',
               'titles': ['Engineer'], 'skills': ['Python'], 'total_experience_years': 0}
    payload = {'profile': profile, 'revision': data['revision']}
    assert request(app, 'POST', '/api/local-setup', payload, {'Origin': 'https://evil.example'})[0] == 403
    assert request(app, 'POST', '/api/local-setup', payload, {'Sec-Fetch-Site': 'cross-site'})[0] == 403
    status, saved = request(app, 'POST', '/api/local-setup', payload)
    assert status == 200 and saved['profile']['full_name'] == 'Test Person'
    assert request(app, 'GET', '/api/local-setup')[1]['profile'] == saved['profile']
    assert request(app, 'POST', '/api/local-setup', payload)[0] == 409
    assert request(app, 'GET', '/api/local-health')[1]['service'] == 'morrow'
    app[0].account_bridge = object()
    assert request(app, 'GET', '/api/local-setup')[0] == 404
