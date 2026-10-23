from types import SimpleNamespace
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from auth_bridge import AccountBridge


class Handler:
    path = "/api/file?name=profile"
    headers = {}

    def __init__(self):
        self.server = SimpleNamespace(workspace_owner_email="owner@example.com")
        self.result = None

    def error(self, status, message):
        self.result = status


def test_unauthenticated_api_is_blocked(monkeypatch):
    bridge = AccountBridge("http://127.0.0.1:8200")
    monkeypatch.setattr(bridge, "identity", lambda handler: None)
    handler = Handler()
    assert bridge.guard(handler) is True
    assert handler.result == 401


def test_only_named_admin_can_access_legacy_workspace(monkeypatch):
    bridge = AccountBridge("http://127.0.0.1:8200")
    for identity in ({"role": "user", "email": "owner@example.com"}, {"role": "admin", "email": "other@example.com"}):
        monkeypatch.setattr(bridge, "identity", lambda handler: identity)
        handler = Handler()
        assert bridge.guard(handler) is True
        assert handler.result == 403
    monkeypatch.setattr(bridge, "identity", lambda handler: {"role": "admin", "email": "owner@example.com"})
    assert bridge.guard(Handler()) is False


def test_account_service_failure_fails_closed(monkeypatch):
    bridge = AccountBridge("http://127.0.0.1:8200")
    def unavailable(handler):
        raise OSError("offline")
    monkeypatch.setattr(bridge, "identity", unavailable)
    handler = Handler()
    assert bridge.guard(handler) is True
    assert handler.result == 503
