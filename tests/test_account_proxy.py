"""HTTP boundary tests: existing shell, authenticated proxy, private tenant adapter.

Both HTTP servers use temporary data and synthetic sessions. No bots, real account
service, source workspace files, external OAuth provider or databases are touched.
"""

import http.client
import importlib.util
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

import pytest

spec = importlib.util.spec_from_file_location(
    "dashboard_account_proxy_tests", Path(__file__).parents[1] / "server.py"
)
dashboard = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = dashboard
spec.loader.exec_module(dashboard)


class AccountHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, status, value, headers=()):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for key, header_value in headers:
            self.send_header(key, header_value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def route(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.server.received.append(
            {
                "path": self.path,
                "method": self.command,
                "headers": dict(self.headers),
                "body": raw,
            }
        )
        path = urlsplit(self.path).path
        token = self.headers.get("Cookie", "").removeprefix("morrow_session=")
        user = self.server.users.get(token)
        if path == "/api/v1/auth/google":
            return self.respond(
                302,
                {},
                [
                    ("Location", self.server.origin + "/oauth-target"),
                    ("Set-Cookie", "oauth_state=signed; HttpOnly; Path=/"),
                ],
            )
        if path == "/oauth-target":
            self.server.oauth_followed += 1
            return self.respond(200, {"unexpected": True})
        if path == "/api/v1/echo":
            return self.respond(
                201,
                {"received": raw.decode(), "method": self.command},
                [
                    (
                        "Set-Cookie",
                        "morrow_session=synthetic; HttpOnly; SameSite=Lax; Path=/",
                    ),
                    ("Set-Cookie", "morrow_csrf=synthetic-csrf; SameSite=Lax; Path=/"),
                    ("Cache-Control", "no-store"),
                ],
            )
        if not user:
            return self.respond(401, {"detail": "Sign in first"})
        if path == "/api/v1/me":
            return self.respond(200, user)
        if self.command not in ("GET", "HEAD"):
            if self.headers.get("X-CSRF-Token") != "synthetic-csrf":
                return self.respond(403, {"detail": "CSRF token required"})
            if self.headers.get("Origin") not in (None, self.server.dashboard_origin):
                return self.respond(403, {"detail": "Origin is not allowed"})
        if path == "/api/v1/profile":
            if self.command == "PUT":
                value = json.loads(raw)
                if value["expected_version"] != self.server.profiles[token]["version"]:
                    return self.respond(409, {"detail": "Profile changed"})
                self.server.profiles[token] = {
                    "version": value["expected_version"] + 1,
                    "data": value["data"],
                }
            return self.respond(200, self.server.profiles[token])
        if path == "/api/v1/artifacts":
            return self.respond(
                200, {"items": self.server.artifacts[token], "limit": 100, "offset": 0}
            )
        if path.startswith("/api/v1/records/learning/") and self.command == "PUT":
            return self.respond(200, {"data": json.loads(raw)["data"]})
        if path in ("/api/v1/applications", "/api/v1/records"):
            return self.respond(200, {"items": [], "limit": 100, "offset": 0})
        return self.respond(404, {"detail": "Not found"})

    do_GET = route
    do_POST = route
    do_PUT = route
    do_PATCH = route
    do_DELETE = route
    do_HEAD = route


@pytest.fixture
def account_dashboard(monkeypatch, tmp_path):
    def forbidden(*args, **kwargs):
        raise AssertionError("Account requests must not read the shared workspace")

    # Any accidental fallback to shared profile, course, database or runner fails.
    monkeypatch.setattr(dashboard.server, "files", forbidden)
    monkeypatch.setattr(dashboard.server, "file_json", forbidden)
    monkeypatch.setattr(dashboard.state, "database", forbidden)
    monkeypatch.setattr(dashboard.state, "course_modules", forbidden)
    monkeypatch.setattr(dashboard.state, "APPLY", tmp_path)
    monkeypatch.setattr(dashboard.state, "REPORTS", tmp_path / "reports")
    monkeypatch.setattr(dashboard.state, "COURSE", tmp_path / "course")
    monkeypatch.setenv("MORROW_WORKSPACE_OWNER_EMAIL", "owner@example.test")
    backend = ThreadingHTTPServer(("127.0.0.1", 0), AccountHandler)
    backend.received, backend.oauth_followed = [], 0
    backend.origin = f"http://127.0.0.1:{backend.server_port}"
    backend.users = {
        "alice": {
            "id": "alice",
            "email": "alice@example.test",
            "name": "Alice",
            "role": "user",
            "modules": ["profile", "files", "applications", "research", "learning"],
        },
        "bob": {
            "id": "bob",
            "email": "bob@example.test",
            "name": "Bob",
            "role": "user",
            "modules": ["profile", "files", "applications"],
        },
        "owner": {
            "id": "owner",
            "email": "owner@example.test",
            "name": "Owner",
            "role": "admin",
            "modules": [
                "profile",
                "files",
                "applications",
                "research",
                "learning",
                "automations",
            ],
        },
        "admin": {
            "id": "other-admin",
            "email": "admin@example.test",
            "name": "Other Admin",
            "role": "admin",
            "modules": [
                "profile",
                "files",
                "applications",
                "research",
                "learning",
                "automations",
            ],
        },
    }
    backend.profiles = {
        token: {
            "version": 1,
            "data": {"name": user["name"], "private_note": f"Only {token}"},
        }
        for token, user in backend.users.items()
    }
    backend.artifacts = {token: [] for token in backend.users}
    app = dashboard.DashboardServer(0, account_url=backend.origin)
    backend.dashboard_origin = f"http://127.0.0.1:{app.server_port}"
    monkeypatch.setattr(app.runner, "snapshot", forbidden)
    monkeypatch.setattr(app.runner, "start", forbidden)
    monkeypatch.setattr(app.runner, "stop", forbidden)
    threads = [
        threading.Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
        )
        for server in (backend, app)
    ]
    for thread in threads:
        thread.start()
    yield SimpleNamespace(app=app, backend=backend)
    for server in (app, backend):
        server.shutdown()
        server.server_close()
    for thread in threads:
        thread.join(timeout=2)


def request(fixture, path, *, method="GET", token=None, body=None, headers=None):
    supplied = dict(headers or {})
    if token:
        supplied["Cookie"] = "morrow_session=" + token
    if isinstance(body, dict):
        body = json.dumps(body).encode()
        supplied.setdefault("Content-Type", "application/json")
    connection = http.client.HTTPConnection(
        "127.0.0.1", fixture.app.server_port, timeout=3
    )
    connection.request(method, path, body=body, headers=supplied)
    response = connection.getresponse()
    content = response.read()
    status, received_headers = response.status, response.getheaders()
    if (
        response.getheader("Content-Type", "").startswith("application/json")
        and content
    ):
        content = json.loads(content)
    connection.close()
    return status, received_headers, content


def test_public_shell_assets_load_without_disclosing_api_data(account_dashboard):
    fixture = account_dashboard
    for path in (
        "/",
        "/index.html",
        "/assets/main.js"
        if (dashboard.ROOT / "dist/index.html").is_file()
        else "/js/main.js",
    ):
        status, _, body = request(fixture, path)
        assert status == 200 and body
    assert (
        fixture.backend.received == []
    )  # Sign-in shell has no authentication dependency.
    for method, path in (
        ("GET", "/api/session"),
        ("GET", "/api/file?name=profile"),
        ("GET", "/api/run"),
        ("GET", "/api/events"),
        ("POST", "/api/run"),
    ):
        assert (
            request(
                fixture, path, method=method, body={} if method == "POST" else None
            )[0]
            == 401
        )


@pytest.mark.parametrize(
    "token,legacy",
    [("alice", False), ("bob", False), ("admin", False), ("owner", True)],
)
def test_session_identifies_only_explicit_admin_owner_as_legacy_capable(
    account_dashboard, token, legacy
):
    status, _, body = request(account_dashboard, "/api/session", token=token)
    assert status == 200
    assert body["mode"] == "accounts" and body["legacy_access"] is legacy
    assert body["user"]["id"] == account_dashboard.backend.users[token]["id"]


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_proxy_preserves_method_cookie_csrf_status_and_both_session_cookies(
    account_dashboard, method
):
    headers = {
        "X-CSRF-Token": "synthetic-csrf",
        "Origin": account_dashboard.backend.dashboard_origin,
        "X-Admin-Reason": "Synthetic proxy test",
        "Idempotency-Key": "synthetic-id",
        "Authorization": "Bearer synthetic",
    }
    status, response_headers, body = request(
        account_dashboard,
        "/api/v1/echo?value=one",
        method=method,
        token="alice",
        body={"value": "private fixture"},
        headers=headers,
    )
    assert status == 201 and body["method"] == method
    cookies = [
        value for name, value in response_headers if name.lower() == "set-cookie"
    ]
    assert len(cookies) == 2
    assert any("morrow_session=" in value and "HttpOnly" in value for value in cookies)
    assert any("morrow_csrf=" in value for value in cookies)
    captured = account_dashboard.backend.received[-1]
    assert captured["headers"]["Cookie"] == "morrow_session=alice"
    for key, value in headers.items():
        assert captured["headers"][key] == value
    assert captured["path"] == "/api/v1/echo?value=one"
    assert json.loads(captured["body"]) == {"value": "private fixture"}


def test_oauth_redirect_is_returned_to_browser_and_never_followed_by_proxy(
    account_dashboard,
):
    status, headers, _ = request(account_dashboard, "/api/v1/auth/google")
    assert status == 302
    assert ("Location", account_dashboard.backend.origin + "/oauth-target") in headers
    assert account_dashboard.backend.oauth_followed == 0
    assert any(
        key == "Set-Cookie" and "oauth_state=" in value for key, value in headers
    )


@pytest.mark.parametrize(
    "headers,expected",
    [
        ({"Content-Length": str(10 * 1024 * 1024 + 1)}, 413),
        ({"Content-Length": "-1"}, 413),
        ({"Content-Length": "not-a-number"}, 400),
        ({"Transfer-Encoding": "chunked"}, 400),
    ],
)
def test_proxy_rejects_unsafe_upload_framing_before_reading_or_forwarding(
    account_dashboard, headers, expected
):
    status, _, _ = request(
        account_dashboard,
        "/api/v1/artifacts",
        method="POST",
        token="alice",
        headers=headers,
    )
    assert status == expected
    assert account_dashboard.backend.received == []


@pytest.mark.parametrize("token", ["alice", "admin"])
def test_nonowner_cannot_reach_legacy_files_runners_courses_or_reports(
    account_dashboard, token
):
    paths = [
        "/api/run",
        "/api/run/browser?id=private-run",
        "/api/run/browsers",
        "/api/events",
        "/api/pipeline",
        "/api/bots",
        "/api/report?day=2026-01-01",
        "/api/file?name=env",
        "/api/file?name=../../.env",
        "/api/unknown",
        "/course/",
        "/course/README.md",
        "/reports/2026-01-01/report.md",
        "/.env",
    ]
    for path in paths:
        status, _, body = request(account_dashboard, path, token=token)
        assert status in (400, 403, 404), (path, status, body)
    for path in (
        "/api/run",
        "/api/events",
        "/api/stop",
        "/api/preview",
        "/api/answer",
        "/api/course/read",
    ):
        assert request(account_dashboard, path, method="POST", token=token, body={})[
            0
        ] in (403, 404)


def test_static_and_foreign_host_cannot_bypass_account_boundary(account_dashboard):
    for path in (
        "/assets/../../.env",
        "/js/../../web/state.py",
        "/assets/.env",
        "/styles/../.env",
    ):
        status, _, body = request(account_dashboard, path)
        assert status == 404
        assert b"DATABASE_URL" not in json.dumps(body).encode()
    for path in ("/", "/api/session", "/api/v1/me", "/api/file?name=profile"):
        assert (
            request(
                account_dashboard,
                path,
                token="alice",
                headers={"Host": "attacker.example"},
            )[0]
            == 403
        )


@pytest.mark.parametrize("token", ["alice", "bob", "owner", "admin"])
def test_every_account_including_owner_reads_its_database_profile(
    account_dashboard, token
):
    status, _, body = request(account_dashboard, "/api/file?name=profile", token=token)
    assert status == 200 and body["revision"] == "1"
    assert "Only " + token in body["text"]
    assert body["path"] == "Private workspace / profile.yaml"
    for other in set(account_dashboard.backend.users) - {token}:
        assert "Only " + other not in body["text"]


def test_profile_writes_forward_csrf_and_origin_and_preserve_conflicts(
    account_dashboard,
):
    fixture = account_dashboard
    data = {"name": "profile", "text": "name: Alice updated\n", "revision": "1"}
    assert (
        request(fixture, "/api/file", method="POST", token="alice", body=data)[0] == 403
    )
    assert (
        request(
            fixture,
            "/api/file",
            method="POST",
            token="alice",
            body=data,
            headers={
                "X-CSRF-Token": "synthetic-csrf",
                "Origin": "https://attacker.example",
            },
        )[0]
        == 403
    )
    headers = {
        "X-CSRF-Token": "synthetic-csrf",
        "Origin": fixture.backend.dashboard_origin,
    }
    assert (
        request(
            fixture,
            "/api/file",
            method="POST",
            token="alice",
            body=data,
            headers=headers,
        )[0]
        == 200
    )
    assert (
        request(
            fixture,
            "/api/file",
            method="POST",
            token="alice",
            body=data,
            headers=headers,
        )[0]
        == 409
    )
    assert fixture.backend.profiles["alice"]["data"]["name"] == "Alice updated"
    assert fixture.backend.profiles["bob"]["data"]["name"] == "Bob"


def test_invalid_json_is_an_http_error_and_does_not_disconnect(account_dashboard):
    status, _, body = request(
        account_dashboard,
        "/api/file",
        method="POST",
        token="alice",
        body=b"{invalid",
        headers={"Content-Type": "application/json", "X-CSRF-Token": "synthetic-csrf"},
    )
    assert status == 400 and body["error"]
    assert not any(row["method"] == "PUT" for row in account_dashboard.backend.received)


def test_head_and_wrong_methods_never_fall_back_to_shared_core_files(account_dashboard):
    for token in ("alice", "owner"):
        for path in ("/api/file?name=answers", "/api/file?name=profile"):
            status, _, body = request(
                account_dashboard, path, method="HEAD", token=token
            )
            assert status in (200, 400, 403, 405)
            assert body == b""
        for method in ("PUT", "PATCH", "DELETE"):
            status, _, _ = request(
                account_dashboard,
                "/api/file?name=profile",
                method=method,
                token=token,
                body={},
            )
            assert status in (400, 403, 404, 405)


def test_only_explicit_owner_can_open_local_configuration(
    account_dashboard, monkeypatch
):
    calls = []

    def local_config(name):
        assert name == "env"
        calls.append(name)
        return {
            "name": name,
            "path": "Synthetic local configuration",
            "text": "SYNTHETIC_OPTION=true\n",
        }

    monkeypatch.setattr(dashboard.server, "file_json", local_config)
    for token in ("alice", "admin"):
        assert request(account_dashboard, "/api/file?name=env", token=token)[0] == 403
    assert calls == []
    status, _, body = request(account_dashboard, "/api/file?name=env", token="owner")
    assert status == 200 and body["text"] == "SYNTHETIC_OPTION=true\n"
    assert calls == ["env"]


def test_paid_research_routes_enforce_modules_on_the_server(account_dashboard):
    for path in (
        "/api/library",
        "/api/document?id=artifact/00000000-0000-0000-0000-000000000001",
        "/api/research/learning",
    ):
        status, _, _ = request(account_dashboard, path, token="bob")
        assert status == 403
    # Bootstrap and basic user-owned exports remain usable on Free.
    assert request(account_dashboard, "/api/course", token="bob")[0] == 200
    assert request(account_dashboard, "/api/data", token="bob")[0] == 200


def test_owner_imported_reading_uses_private_account_storage(
    account_dashboard, monkeypatch
):
    fixture = account_dashboard
    identifier = "00000000-0000-0000-0000-000000000001"
    fixture.backend.artifacts["owner"] = [
        {
            "id": identifier,
            "filename": "Owner private research.md",
            "category": "legacy",
            "media_type": "text/markdown",
            "size_bytes": 20,
            "created_at": "2026-10-23T12:00:00+00:00",
        }
    ]

    def forbidden(*args, **kwargs):
        raise AssertionError(
            "Imported artifact completion must not write the local progress file"
        )

    monkeypatch.setattr(dashboard.research_learning, "mark", forbidden)
    headers = {
        "X-CSRF-Token": "synthetic-csrf",
        "Origin": fixture.backend.dashboard_origin,
    }
    for done in (True, False):
        status, _, body = request(
            fixture,
            "/api/research/read",
            method="POST",
            token="owner",
            body={"id": "artifact/" + identifier, "read": done},
            headers=headers,
        )
        assert status == 200 and body["read"] is done
        assert body["storage"] == "your private account"
        write = fixture.backend.received[-1]
        assert write["method"] == "PUT" and write["path"].startswith(
            "/api/v1/records/learning/"
        )
        assert write["headers"]["Cookie"] == "morrow_session=owner"
        assert json.loads(write["body"])["data"]["done"] is done
    # Another admin has no access to this owner's private artifact.
    assert (
        request(
            fixture,
            "/api/research/read",
            method="POST",
            token="admin",
            body={"id": "artifact/" + identifier, "read": True},
            headers=headers,
        )[0]
        == 404
    )


def test_owner_legacy_reading_keeps_local_progress_and_parses_body_once(
    account_dashboard, monkeypatch
):
    calls = []

    def mark(identifier, done):
        calls.append((identifier, done))
        return {"ok": True, "read": done, "storage": "synthetic local progress"}

    monkeypatch.setattr(dashboard.research_learning, "mark", mark)
    status, _, body = request(
        account_dashboard,
        "/api/research/read",
        method="POST",
        token="owner",
        body={"id": "research/daily/synthetic.md", "read": True},
        headers={"Origin": account_dashboard.backend.dashboard_origin},
    )
    assert status == 200 and body["storage"] == "synthetic local progress"
    assert calls == [("research/daily/synthetic.md", True)]
    assert not any(row["method"] == "PUT" for row in account_dashboard.backend.received)
    status, _, _ = request(
        account_dashboard,
        "/api/research/read",
        method="POST",
        token="owner",
        body={"id": "research/daily/synthetic.md", "read": False},
        headers={"Origin": "https://attacker.example"},
    )
    assert status == 403 and len(calls) == 1


def test_account_service_failure_fails_closed_but_leaves_sign_in_shell_available(
    account_dashboard, monkeypatch
):
    def offline(*args, **kwargs):
        raise OSError("synthetic offline")

    monkeypatch.setattr(account_dashboard.app.account_bridge, "request", offline)
    assert request(account_dashboard, "/")[0] == 200
    for path in ("/api/session", "/api/file?name=profile", "/api/run", "/api/events", "/api/v1/me"):
        assert request(account_dashboard, path, token="alice")[0] == 503


def test_browser_preview_is_private_to_the_current_workspace_owner(account_dashboard, monkeypatch):
    calls = []
    def preview(*args):
        calls.append(args)
        return {'state': 'ready', 'image': 'synthetic-owner-only-frame'}
    monkeypatch.setattr(account_dashboard.app.runner, 'browser_snapshot', preview)
    for token in (None, 'alice', 'bob', 'admin'):
        code, _, body = request(account_dashboard, '/api/run/browser?id=run-one', token=token)
        assert code in (401, 403)
        assert 'synthetic-owner-only-frame' not in json.dumps(body)
    assert calls == []
    code, headers, body = request(account_dashboard, '/api/run/browser?id=run-one', token='owner')
    assert code == 200 and body['image'] == 'synthetic-owner-only-frame'
    assert dict(headers)['Cache-Control'] == 'no-store'
    assert calls == [('run-one', '', '')]


def test_browser_inventory_is_private_to_the_current_workspace_owner(account_dashboard, monkeypatch):
    calls = []
    def inventory():
        calls.append(True)
        return {'runs': [{'id': 'private-run', 'label': 'Private owner agent', 'running': True,
                          'browser_state': 'ready', 'browsers': [{'id': 'private-browser',
                          'label': 'Chrome', 'state': 'ready', 'tabs': [{'id': 'tab',
                          'title': 'Private owner tab', 'site': 'private.example.test'}]}]}]}
    monkeypatch.setattr(account_dashboard.app.runner, 'browser_inventory', inventory)
    for token in (None, 'alice', 'bob', 'admin'):
        code, _, body = request(account_dashboard, '/api/run/browsers', token=token)
        assert code in (401, 403)
        assert not any(value in json.dumps(body) for value in ('Private owner', 'private.example.test', 'private-browser'))
    assert calls == []
    code, headers, body = request(account_dashboard, '/api/run/browsers', token='owner')
    assert code == 200 and body['runs'][0]['browsers'][0]['tabs'][0]['title'] == 'Private owner tab'
    assert dict(headers)['Cache-Control'] == 'no-store'
    assert calls == [True]
