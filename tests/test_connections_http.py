"""HTTP authorization checks using fake browser sessions and temporary workspaces."""

import http.client
import importlib.util
import json
import sys
import threading
from pathlib import Path
from uuid import UUID

import pytest

spec = importlib.util.spec_from_file_location(
    "dashboard_connection_http_tests", Path(__file__).parents[1] / "server.py"
)
dashboard = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = dashboard
spec.loader.exec_module(dashboard)


class BrowserFixture:
    def __init__(self, root, runner):
        self.calls = []

    def list(self, user, owner, scope):
        self.calls.append(("list", user["tenant_id"], owner, scope))
        return {"connections": [], "scope": scope, "automation_available": owner}

    def action(self, user, owner, provider, operation, body):
        if set(body) - {"scope", "expected_account"}:
            raise dashboard.ConnectionError(400, "Send only the scope and optional account email.")
        self.calls.append(("action", user["tenant_id"], owner, provider, operation, body))
        return {"accepted": True, "automation_available": owner}

    def blocks_command(self, *args):
        raise AssertionError("These HTTP tests must never invoke the workflow runner")

    def shutdown(self):
        pass


class AccountsFixture:
    def __init__(self):
        self.users = {
            "alice": {"id": str(UUID(int=1)), "tenant_id": str(UUID(int=101)),
                      "email": "alice@example.test", "role": "user", "modules": ["profile", "files"]},
            "bob": {"id": str(UUID(int=2)), "tenant_id": str(UUID(int=102)),
                    "email": "bob@example.test", "role": "user", "modules": ["automations", "files"]},
            "owner": {"id": str(UUID(int=3)), "tenant_id": str(UUID(int=103)),
                      "email": "owner@example.test", "role": "admin", "modules": ["automations", "files"]},
            "admin": {"id": str(UUID(int=4)), "tenant_id": str(UUID(int=104)),
                      "email": "admin@example.test", "role": "admin", "modules": ["automations", "files"]},
        }

    def identity(self, handler):
        return self.users.get(handler.headers.get("Cookie", "").removeprefix("morrow_session="))

    @staticmethod
    def is_owner(handler, user):
        return user["role"] == "admin" and user["email"] == "owner@example.test"


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setattr(dashboard.state, "APPLY", tmp_path)
    monkeypatch.setattr(dashboard, "ConnectionService", BrowserFixture)
    server = dashboard.DashboardServer(0)
    server.account_bridge = AccountsFixture()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()
    thread.join()


def request(app, method, path, body=None, identity="alice", headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", app.server_port)
    connection.request(
        method,
        path,
        body=None if body is None else json.dumps(body),
        headers={"Content-Type": "application/json", "Cookie": "morrow_session=" + identity,
                 **(headers or {})},
    )
    response = connection.getresponse()
    data = response.read()
    status, result, cache = response.status, json.loads(data) if data else None, response.getheader("Cache-Control")
    connection.close()
    return status, result, cache


def test_free_and_paid_users_can_manage_only_their_authenticated_connection_scope(app):
    assert request(app, "GET", "/api/connections?scope=main")[0] == 200
    assert request(app, "POST", "/api/connections/naukri/open", {"scope": "main"})[0] == 200
    assert request(app, "POST", "/api/connections/google/check", {"scope": "main"}, "bob")[0] == 200
    assert app.connections.calls == [
        ("list", str(UUID(int=101)), False, "main"),
        ("action", str(UUID(int=101)), False, "naukri", "open", {"scope": "main"}),
        ("action", str(UUID(int=102)), False, "google", "check", {"scope": "main"}),
    ]
    assert request(app, "POST", "/api/connections/naukri/open", {"tenant_id": str(UUID(int=102))})[0] == 400
    assert len(app.connections.calls) == 3


@pytest.mark.parametrize("identity", ["alice", "bob", "admin"])
def test_private_connections_do_not_grant_shared_owner_execution(app, identity):
    status, data, _ = request(app, "GET", "/api/connections", identity=identity)
    assert status == 200 and data["automation_available"] is False
    for path in ("/api/run", "/api/preview"):
        status, data, _ = request(app, "POST", path, {"action": "pipeline", "options": {}}, identity)
        assert status == 403
        assert "individual workspace" in data["error"]


def test_only_configured_owner_has_legacy_connection_scope(app):
    status, data, _ = request(app, "GET", "/api/connections", identity="owner")
    assert status == 200 and data["automation_available"] is True
    assert app.connections.calls == [("list", str(UUID(int=103)), True, "main")]


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/api/connections", None),
    ("POST", "/api/connections/naukri/open", {}),
    ("POST", "/api/connections/naukri/disconnect", {}),
])
def test_unauthenticated_requests_never_reach_browser_manager(app, method, path, body):
    assert request(app, method, path, body, "signed-out")[0] == 401
    assert app.connections.calls == []


@pytest.mark.parametrize("headers", [
    {"Origin": "https://untrusted.example"},
    {"Host": "untrusted.example"},
    {"Sec-Fetch-Site": "cross-site"},
    {"Content-Type": "text/plain"},
])
def test_cross_origin_and_simple_form_actions_are_rejected(app, headers):
    assert request(app, "POST", "/api/connections/naukri/switch", {}, headers=headers)[0] == 403
    assert app.connections.calls == []


def test_status_is_private_and_head_has_no_body(app):
    status, _, cache = request(app, "GET", "/api/connections")
    assert status == 200 and cache == "no-store"
    status, body, cache = request(app, "HEAD", "/api/connections")
    assert status == 200 and body is None and cache == "no-store"
