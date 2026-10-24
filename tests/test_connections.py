"""Synthetic browser sessions only: no Chrome, account logins or profile reads."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import time
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).parents[2]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("dashboard_connections", ROOT / "froned-dashbord" / "connections.py")
service_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service_module)
from common import connections as browser
from common.models import Settings
from web.state import Command

USER = {"id": "00000000-0000-0000-0000-000000000001", "tenant_id": "10000000-0000-0000-0000-000000000001"}
OTHER = {"id": "00000000-0000-0000-0000-000000000002", "tenant_id": "10000000-0000-0000-0000-000000000002"}


class Driver:
    def __init__(self):
        self.thread = threading.get_ident()
        self.current_url = "about:blank"
        self.visits = []
        self.closed = False
        self.cdp = []

    def get(self, url):
        assert threading.get_ident() == self.thread
        self.current_url = url
        self.visits.append(url)

    def quit(self):
        assert threading.get_ident() == self.thread
        self.closed = True

    def execute_cdp_cmd(self, method, params):
        assert threading.get_ident() == self.thread
        self.cdp.append((method, params))
        if method == "Network.getAllCookies":
            return {"cookies": [{"name": "google-session", "domain": ".google.com", "value": "never-expose-this"},
                                {"name": "naukri-session", "domain": ".naukri.com", "value": "never-expose-other"}]}
        return {}


class Runner:
    def __init__(self):
        self.lock = threading.RLock()
        self.runs = []

    def snapshot(self, after=0):
        with self.lock:
            return {"runs": self.runs}


@pytest.fixture
def manager(tmp_path, monkeypatch):
    monkeypatch.delenv("BROWSER_PROFILE_DIR", raising=False)
    monkeypatch.delenv("LINKEDIN_BROWSER_PROFILE_DIR", raising=False)
    opened = []

    def factory(settings):
        assert settings.session_only and not settings.password and not settings.google_password
        driver = Driver()
        opened.append((settings.browser_profile_dir, driver))
        return driver

    def verify(driver, provider, expected):
        assert threading.get_ident() == driver.thread
        return {"state": "connected", "message": "Verified synthetic session", "last_verified_at": browser.now(),
                "verified_account": expected, "identity_verified": bool(expected)}

    service = service_module.ConnectionService(tmp_path, Runner(), driver_factory=factory,
        verifier=verify, availability=lambda: "/synthetic/chrome", verify_timeout=0)
    yield service, opened
    service.shutdown()


def wait(service, user=USER, owner=True, scope="main"):
    until = time.monotonic() + 3
    while time.monotonic() < until:
        data = service.list(user, owner, scope)
        if not any(row["pending"] for row in data["connections"]):
            return data
        time.sleep(0.01)
    pytest.fail("Synthetic browser action did not finish")


def row(data, provider="google"):
    return next(item for item in data["connections"] if item["id"] == provider)


def test_status_is_read_only_and_does_not_start_browser(manager):
    service, opened = manager
    assert row(service.list(USER, True))["state"] == "not_connected"
    assert opened == []
    assert list(service.root.iterdir()) == []


def test_open_check_close_reuses_exact_profile_on_one_worker_thread(manager):
    service, opened = manager
    service.action(USER, True, "google", "open", {"expected_account": "test@example.com"})
    assert row(wait(service))["state"] == "needs_sign_in"
    service.action(USER, True, "google", "check")
    checked = row(wait(service))
    assert checked["state"] == "connected" and checked["verified_account"] == "test@example.com"
    assert len(opened) == 1
    assert Path(opened[0][0]) == service.root / "data/browser/naukri"
    service.action(USER, True, "google", "close")
    closed = row(wait(service))
    assert closed["state"] == "connected" and not closed["browser_open"]
    assert opened[0][1].closed
    assert opened[0][1].thread != threading.get_ident()


def test_tenant_sessions_never_use_owner_profiles_or_leak_between_accounts(manager):
    service, opened = manager
    service.action(USER, False, "naukri", "open", {"expected_account": "private@example.com"})
    wait(service, owner=False)
    other = service.list(OTHER, False)
    assert row(other, "naukri")["expected_account"] == ""
    assert row(other, "naukri")["browser_open"] is False
    assert other["automation_available"] is False
    assert USER["tenant_id"] in opened[0][0]
    assert opened[0][0] != str(service.root / "data/browser/naukri")


def test_owner_lane_maps_to_actual_pipeline_profile_without_copying_main(manager):
    service, opened = manager
    service.action(USER, True, "hirist", "open", {"scope": "lane:hirist"})
    data = wait(service, scope="lane:hirist")
    assert {item["id"] for item in data["connections"]} == {"google", "hirist"}
    assert opened[0][0] == str(service.root / "data/browser/lanes/hirist")
    assert not (service.root / "data/browser/naukri").exists()


@pytest.mark.parametrize("user,provider,operation,payload", [
    ({"id": "../owner"}, "google", "open", {}),
    (USER, "../google", "open", {}),
    (USER, "google", "execute", {}),
    (USER, "google", "open", {"url": "https://attacker.example"}),
    (USER, "google", "open", {"path": "/private/profile"}),
    (USER, "google", "open", {"scope": "../owner"}),
    (USER, "linkedin", "open", {"scope": "lane:hirist"}),
    (USER, "google", "open", {"expected_account": "a@example.com\nCOOKIE=secret"}),
])
def test_api_accepts_no_arbitrary_identity_path_url_or_operation(manager, user, provider, operation, payload):
    service, opened = manager
    with pytest.raises(service_module.ConnectionError):
        service.action(user, False, provider, operation, payload)
    assert opened == []


def test_symlink_cannot_import_personal_chrome(manager, tmp_path):
    service, opened = manager
    target = service.root / "personal"
    target.mkdir()
    linked = service.root / "data/browser/naukri"
    linked.parent.mkdir(parents=True)
    linked.symlink_to(target, target_is_directory=True)
    with pytest.raises(service_module.ConnectionError, match="link"):
        service.action(USER, True, "google", "open")
    assert opened == []


def test_active_run_and_chrome_profile_locks_block_connection(manager):
    service, opened = manager
    service.runner.runs = [{"running": True, "resources": ["browser:main"]}]
    with pytest.raises(service_module.ConnectionError, match="workflow"):
        service.action(USER, True, "google", "open")
    assert row(service.list(USER, True))["profile_busy"]
    service.runner.runs = []
    profile = service.root / "data/browser/naukri/chrome"
    profile.mkdir(parents=True)
    (profile / "SingletonLock").symlink_to("host-999999")
    with pytest.raises(service_module.ConnectionError, match="already open"):
        service.action(USER, True, "google", "open")
    assert opened == []


def test_run_guard_reserves_shared_main_but_not_unrelated_linkedin(manager):
    service, opened = manager
    service.action(USER, True, "google", "open")
    wait(service)
    command = Command("Synthetic", ["python", "-m", "naukri_bot"])
    assert service.blocks_command(command, "naukri")
    assert service.blocks_command(command, "linkedin") == ""
    service.action(USER, True, "google", "close")
    wait(service)
    assert service.blocks_command(command, "naukri") == ""


def test_switch_clears_selected_provider_only_and_never_returns_cookies(manager):
    service, opened = manager
    service.action(USER, True, "google", "open")
    wait(service)
    service.action(USER, True, "google", "check")
    wait(service)
    service.action(USER, True, "google", "switch", {"expected_account": "new@example.com"})
    data = wait(service)
    selected = row(data)
    assert selected["state"] == "needs_sign_in" and selected["last_verified_at"] is None
    deleted = [params for command, params in opened[0][1].cdp if command == "Network.deleteCookies"]
    assert deleted == [{"name": "google-session", "domain": ".google.com", "path": "/"}]
    assert "never-expose" not in json.dumps(data)
    assert "never-expose" not in (Path(opened[0][0]) / browser.METADATA).read_text()


def test_disconnect_removes_session_and_closes_browser(manager):
    service, opened = manager
    service.action(USER, True, "naukri", "open")
    wait(service)
    service.action(USER, True, "naukri", "disconnect")
    data = wait(service)
    assert row(data, "naukri")["state"] == "needs_sign_in"
    assert not row(data, "naukri")["browser_open"] and opened[0][1].closed


def test_hint_change_invalidates_prior_identity_even_when_closing(manager):
    service, _ = manager
    service.action(USER, True, "google", "check", {"expected_account": "old@example.com"})
    assert row(wait(service))["identity_verified"]
    service.action(USER, True, "google", "close", {"expected_account": "new@example.com"})
    changed = row(wait(service))
    assert changed["state"] == "needs_sign_in" and not changed["identity_verified"]
    assert changed["last_verified_at"] is None and not changed["verified_account"]


def test_failure_is_redacted_and_never_falls_back_to_temporary_profile(manager):
    service, opened = manager
    calls = []
    def fail(settings):
        calls.append(settings.browser_profile_dir)
        raise RuntimeError("Cookie=secret https://site.example/?token=secret")
    service.driver_factory = fail
    service.action(USER, True, "google", "open")
    data = wait(service)
    assert row(data)["state"] == "needs_attention"
    assert "secret" not in json.dumps(data)
    assert len(calls) == 1 and opened == []


def test_private_modes_and_status_survive_service_restart(manager):
    service, opened = manager
    service.action(USER, True, "google", "check")
    wait(service)
    service.action(USER, True, "google", "close")
    wait(service)
    base = Path(opened[0][0])
    assert base.stat().st_mode & 0o777 == 0o700
    assert (base / browser.METADATA).stat().st_mode & 0o777 == 0o600
    assert (base / browser.MARKER).stat().st_mode & 0o777 == 0o600
    second = service_module.ConnectionService(service.root, availability=lambda: "chrome")
    assert row(second.list(USER, True))["state"] == "connected"
    assert not row(second.list(USER, True))["browser_open"]
    second.shutdown()


def test_managed_profile_configuration_accepts_session_only_without_password(tmp_path, monkeypatch):
    from common import config
    from linkedin_bot.config import LinkedInSettings
    base = tmp_path / "managed"
    browser.mark_managed(base)
    settings = config.load_settings(str(tmp_path / "missing.env"), {"browser_profile_dir": str(base), "email": "", "password": ""})
    assert settings.session_only
    assert "NAUKRI_PASSWORD is not set" not in settings.validate()
    assert "NAUKRI_EMAIL is not set" not in settings.validate()
    linkedin = LinkedInSettings(naukri=settings)
    assert "LINKEDIN_PASSWORD is not set" not in linkedin.validate(True)
    assert "NAUKRI_PASSWORD is not set" in Settings().validate()


def test_expired_managed_naukri_session_never_attempts_password_login(monkeypatch):
    from naukri_bot import auth
    monkeypatch.setattr(auth, "is_logged_in", lambda *a, **kw: False)
    monkeypatch.setattr(auth, "safe_get", lambda *a: True)
    monkeypatch.setattr(auth, "_wait_for_signed_in", lambda *a: False)
    monkeypatch.setattr(auth, "login", lambda *a: pytest.fail("A password login was attempted"))
    result = auth.ensure_logged_in(object(), Settings(session_only=True, email="old@example.com", password="unused"))
    assert not result.ok and "Reconnect" in result.reason


def test_expired_managed_linkedin_session_never_attempts_password_login(monkeypatch):
    from linkedin_bot import publisher
    from linkedin_bot.config import LinkedInSettings
    monkeypatch.setattr(publisher, "safe_get", lambda *a: True)
    monkeypatch.setattr(publisher, "human_pause", lambda *a: None)
    monkeypatch.setattr(publisher, "is_logged_in", lambda *a: False)
    monkeypatch.setattr(publisher, "_find", lambda *a: pytest.fail("Login form was accessed"))
    result = publisher.ensure_logged_in(object(), LinkedInSettings(naukri=Settings(session_only=True)))
    assert not result.ok and "Reconnect" in result.reason


def test_managed_browser_has_no_anonymous_fallback(monkeypatch):
    from common import browser as runtime
    calls = []
    def strict(settings):
        calls.append(settings)
        raise ValueError("Profile locked")
    monkeypatch.setattr(browser, "create_driver", strict)
    monkeypatch.setattr(runtime, "_try_create_driver", lambda *a, **kw: pytest.fail("Anonymous fallback attempted"))
    with pytest.raises(ValueError, match="locked"):
        runtime.create_driver(Settings(session_only=True))
    assert len(calls) == 1


def test_expired_managed_google_session_never_types_saved_password(monkeypatch):
    from sites_bot import accounts
    monkeypatch.setattr(accounts.ext, "safe_get", lambda *a: True)
    monkeypatch.setattr(accounts, "_wait_for", lambda *a: None)
    monkeypatch.setattr(accounts, "google_signed_in", lambda *a: False)
    monkeypatch.setattr(browser, "verify", lambda *a: {"state": "needs_sign_in"})
    monkeypatch.setattr(accounts.ext, "set_text", lambda *a: pytest.fail("A login field was filled"))
    ok, reason = accounts.google_login(object(), Settings(session_only=True, google_email="old@example.com", google_password="unused"), 0)
    assert not ok and "Reconnect Google" in reason


def test_connected_google_without_hint_never_inherits_old_environment_identity(tmp_path, monkeypatch):
    from common import config
    from sites_bot import accounts
    base = tmp_path / "managed"
    browser.mark_managed(base)
    browser.write_metadata(base, {"google": {"state": "connected", "verified_account": "", "identity_verified": False}})
    monkeypatch.setenv("GOOGLE_EMAIL", "old@example.com")
    settings = config.load_settings(str(tmp_path / "missing.env"), {"browser_profile_dir": str(base)})
    assert settings.session_only and settings.google_email == ""
    monkeypatch.setattr(accounts.ext, "safe_get", lambda *a: True)
    monkeypatch.setattr(accounts, "_wait_for", lambda *a: None)
    seen = []
    monkeypatch.setattr(browser, "verify", lambda driver, provider, expected: seen.append(expected) or {"state": "connected"})
    assert accounts.google_login(object(), settings, 0)[0]
    assert seen == [""]


def test_strict_driver_refuses_locked_profile_before_starting_webdriver(tmp_path, monkeypatch):
    from selenium import webdriver
    profile = tmp_path / "private" / "chrome"
    profile.mkdir(parents=True)
    (profile / "SingletonLock").symlink_to("host-100")
    monkeypatch.setattr(webdriver, "Chrome", lambda **kw: pytest.fail("A browser was launched"))
    with pytest.raises(ValueError, match="already open"):
        browser.create_driver(Settings(browser_profile_dir=str(profile.parent), session_only=True))


def test_close_shutdown_and_global_capacity_release_profiles(manager):
    service, opened = manager
    for index in range(3):
        user = {"tenant_id": "10000000-0000-0000-0000-%012d" % (index + 1)}
        service.action(user, False, "google", "open")
        wait(service, user, False)
    fourth = {"tenant_id": "10000000-0000-0000-0000-000000000004"}
    with pytest.raises(service_module.ConnectionError, match="Close another"):
        service.action(fourth, False, "google", "open")
    assert len(service.sessions) == 3
    service.shutdown()
    assert all(driver.closed for _, driver in opened)


def test_cookie_disconnect_navigation_opens_provider_login(manager):
    service, opened = manager
    service.action(USER, True, "google", "switch")
    wait(service)
    assert opened[0][1].current_url == browser.PROVIDERS["google"].login


class Page:
    current_url = "https://www.hirist.tech/profile"
    def __init__(self, text="", controls=(), email=""):
        self.text, self.controls, self.email = text, controls, email
    def execute_script(self, *_):
        return self.text
    def find_elements(self, _by, selector):
        if "[data-testid='account-email']" in selector and self.email:
            return [SimpleNamespace(is_displayed=lambda: True, get_attribute=lambda key: self.email if key == "data-email" else "", text=self.email)]
        return self.controls if "logout" in selector else []


def test_board_verification_needs_positive_marker_and_expected_identity():
    provider = browser.PROVIDERS["hirist"]
    assert browser.verify(Page("Welcome"), provider)["state"] == "needs_sign_in"
    assert browser.verify(Page("Log out\nother@example.com"), provider, "expected@example.com")["state"] == "needs_attention"
    # An email in a job description or post is never account identity proof.
    assert browser.verify(Page("Log out\nexpected@example.com"), provider, "expected@example.com")["state"] == "needs_attention"
    verified = browser.verify(Page("Log out", email="expected@example.com"), provider, "expected@example.com")
    assert verified["state"] == "connected" and verified["identity_verified"]
    discovered = browser.verify(Page("Log out", email="actual@example.com"), provider)
    assert discovered["verified_account"] == "actual@example.com" and discovered["identity_verified"]
    outsider = Page("Log out\nexpected@example.com")
    outsider.current_url = "https://hirist.tech.attacker.example/profile"
    assert browser.verify(outsider, provider)["state"] == "needs_sign_in"
