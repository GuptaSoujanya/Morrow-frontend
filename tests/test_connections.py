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
from selenium.common.exceptions import (NoSuchDriverException, SessionNotCreatedException,
                                        TimeoutException, WebDriverException)

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
        self.pages = {"tab-1": "about:blank"}
        self.current_window_handle = "tab-1"
        self.switch_to = SimpleNamespace(window=self.switch_window, new_window=self.new_window)
        self.visits = []
        self.redirects = {}
        self.closed = False
        self.cdp = []

    @property
    def current_url(self):
        return self.pages[self.current_window_handle]

    @current_url.setter
    def current_url(self, value):
        self.pages[self.current_window_handle] = value

    @property
    def window_handles(self):
        return list(self.pages)

    def switch_window(self, handle):
        assert threading.get_ident() == self.thread
        self.current_window_handle = handle

    def new_window(self, kind):
        assert threading.get_ident() == self.thread and kind == "tab"
        self.current_window_handle = "tab-" + str(len(self.pages) + 1)
        self.pages[self.current_window_handle] = "about:blank"

    def get(self, url):
        assert threading.get_ident() == self.thread
        self.current_url = self.redirects.get(url, url)
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
    assert Path(opened[0][0]) == service.root / "user/browser/naukri"
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
    assert opened[0][0] != str(service.root / "user/browser/naukri")


def test_shared_window_targets_one_provider_and_preserves_other_site_tabs(manager):
    service, opened = manager
    service.action(USER, True, "hirist", "open")
    first = wait(service)
    assert row(first, "hirist")["browser_active"]
    assert row(first, "cutshort")["browser_open"] and not row(first, "cutshort")["browser_active"]
    assert row(first, "cutshort")["browser_provider"] == "hirist"
    assert row(first, "hirist")["browser_group"] == "main"
    assert not row(first, "linkedin")["browser_open"]
    driver = opened[0][1]
    hirist_tab = driver.current_window_handle
    driver.pages[hirist_tab] = "https://www.hirist.tech/candidate/account"
    service.action(USER, True, "cutshort", "open")
    second = wait(service)
    cutshort_tab = driver.current_window_handle
    assert cutshort_tab != hirist_tab and len(opened) == 1
    assert row(second, "cutshort")["browser_active"] and not row(second, "hirist")["browser_active"]
    assert driver.pages[hirist_tab] == "https://www.hirist.tech/candidate/account"
    before = list(driver.visits)
    service.action(USER, True, "hirist", "check")
    assert row(wait(service), "hirist")["state"] == "connected"
    assert driver.current_window_handle == hirist_tab
    assert driver.pages[hirist_tab] == browser.PROVIDERS["hirist"].check
    assert driver.visits == before + [browser.PROVIDERS["hirist"].check]
    service.action(USER, True, "cutshort", "open")
    wait(service)
    assert driver.current_window_handle == cutshort_tab and len(driver.pages) == 2
    assert driver.visits == before + [browser.PROVIDERS["hirist"].check]


def test_reopening_checked_provider_preserves_verification_until_explicit_recheck(manager):
    service, opened = manager
    service.action(USER, True, "wellfound", "check", {"expected_account": "candidate@example.com"})
    before = row(wait(service), "wellfound")
    service.action(USER, True, "hirist", "open")
    wait(service)
    service.action(USER, True, "wellfound", "open")
    after = row(wait(service), "wellfound")
    assert after["state"] == "connected" and after["last_verified_at"] == before["last_verified_at"]
    assert after["verified_account"] == "candidate@example.com" and after["browser_active"]
    assert len(opened) == 1 and len(opened[0][1].pages) == 2


def test_check_preserves_google_oauth_tab_and_uses_completed_provider_popup(manager):
    service, opened = manager
    service.action(USER, True, "hirist", "open")
    wait(service)
    driver = opened[0][1]
    oauth_tab = driver.current_window_handle
    driver.pages[oauth_tab] = "https://accounts.google.com/signin/v2/identifier"
    observed = []
    service.verifier = lambda driver, provider, expected: observed.append(driver.current_url) or {"state": "needs_sign_in", "message": "Finish sign-in."}
    before = list(driver.visits)
    service.action(USER, True, "hirist", "check")
    wait(service)
    assert observed == [driver.pages[oauth_tab]] and driver.visits == before
    driver.pages["popup-result"] = "https://www.hirist.tech/candidate/account"
    service.action(USER, True, "hirist", "check")
    wait(service)
    assert observed[-1] == browser.PROVIDERS["hirist"].check
    assert driver.current_window_handle == "popup-result"
    assert driver.pages[oauth_tab] == "https://accounts.google.com/signin/v2/identifier"
    assert driver.visits == before + [browser.PROVIDERS["hirist"].check]


def test_hirist_homepage_check_opens_own_profile_in_the_existing_browser_tab(manager):
    service, opened = manager
    provider = browser.PROVIDERS["hirist"]
    service.action(USER, True, "hirist", "open", {"expected_account": "candidate@example.com"})
    wait(service)
    driver = opened[0][1]
    original_tab = driver.current_window_handle
    assert driver.current_url == provider.login
    observed = []

    def verify(driver, selected, expected):
        observed.append((driver.current_window_handle, driver.current_url, selected.id, expected))
        return {"state": "connected", "message": "Own profile checked.", "last_verified_at": browser.now(),
                "verified_account": expected, "identity_verified": True}

    service.verifier = verify
    service.action(USER, True, "hirist", "check")
    checked = row(wait(service), "hirist")
    assert observed == [(original_tab, provider.check, "hirist", "candidate@example.com")]
    assert driver.visits == [provider.login, provider.check]
    assert driver.window_handles == [original_tab] and len(opened) == 1
    assert checked["state"] == "connected" and checked["identity_verified"]
    assert checked["browser_active"] and not driver.closed


@pytest.mark.parametrize("profile_url", [
    "https://www.hirist.tech/myprofile",
    "https://www.hirist.tech/myprofile/",
    "https://www.hirist.tech/myprofile/?section=experience#resume",
])
def test_hirist_check_does_not_reload_an_already_open_own_profile(manager, profile_url):
    service, opened = manager
    service.action(USER, True, "hirist", "open")
    wait(service)
    driver = opened[0][1]
    original_tab = driver.current_window_handle
    driver.pages[original_tab] = profile_url
    before = list(driver.visits)
    observed = []
    service.verifier = lambda driver, provider, expected: observed.append(driver.current_url) or {
        "state": "needs_attention", "message": "Synthetic profile details are still incomplete."}
    service.action(USER, True, "hirist", "check")
    checked = row(wait(service), "hirist")
    assert observed == [profile_url] and driver.visits == before
    assert driver.current_window_handle == original_tab and len(driver.pages) == 1
    assert checked["state"] == "needs_attention" and checked["browser_open"]


def test_hirist_profile_redirect_to_login_is_observed_and_clears_prior_verification(manager):
    service, opened = manager
    provider = browser.PROVIDERS["hirist"]
    service.action(USER, True, "hirist", "check", {"expected_account": "candidate@example.com"})
    assert row(wait(service), "hirist")["identity_verified"]
    driver = opened[0][1]
    original_tab = driver.current_window_handle
    driver.pages[original_tab] = provider.login
    login_url = "https://www.hirist.tech/login"
    driver.redirects[provider.check] = login_url
    observed = []

    def verify(driver, selected, expected):
        observed.append(driver.current_url)
        page = Page("Sign in to continue")
        page.current_url = driver.current_url
        return browser.verify(page, selected, expected)

    service.verifier = verify
    service.action(USER, True, "hirist", "check")
    checked = row(wait(service), "hirist")
    assert observed == [login_url] and driver.current_url == login_url
    assert driver.visits[-1] == provider.check
    assert checked["state"] == "needs_sign_in" and checked["browser_open"]
    assert checked["last_verified_at"] is None and checked["verified_account"] == ""
    assert checked["identity_verified"] is False
    assert len(opened) == 1 and driver.current_window_handle == original_tab and not driver.closed


def test_hirist_lane_profile_check_leaves_main_browser_and_other_provider_tab_untouched(manager):
    service, opened = manager
    service.action(USER, True, "hirist", "open")
    wait(service)
    service.action(USER, True, "cutshort", "open")
    wait(service)
    main_driver = opened[0][1]
    main_pages = dict(main_driver.pages)
    main_visits = list(main_driver.visits)
    main_tab = main_driver.current_window_handle
    service.action(USER, True, "hirist", "open", {"scope": "lane:hirist"})
    wait(service, scope="lane:hirist")
    lane_driver = opened[1][1]
    hirist_tab = lane_driver.current_window_handle
    service.action(USER, True, "google", "open", {"scope": "lane:hirist"})
    wait(service, scope="lane:hirist")
    google_tab = lane_driver.current_window_handle
    google_url = lane_driver.pages[google_tab]
    lane_visits = list(lane_driver.visits)
    observed = []
    service.verifier = lambda driver, provider, expected: observed.append((driver, driver.current_url)) or {
        "state": "connected", "message": "Synthetic lane profile checked.", "last_verified_at": browser.now()}
    service.action(USER, True, "hirist", "check", {"scope": "lane:hirist"})
    checked = wait(service, scope="lane:hirist")
    assert observed == [(lane_driver, browser.PROVIDERS["hirist"].check)]
    assert lane_driver.current_window_handle == hirist_tab and lane_driver.pages[google_tab] == google_url
    assert lane_driver.visits == lane_visits + [browser.PROVIDERS["hirist"].check]
    assert main_driver.pages == main_pages and main_driver.visits == main_visits
    assert main_driver.current_window_handle == main_tab
    assert row(checked, "hirist")["state"] == "connected" and row(checked, "hirist")["browser_active"]
    assert row(service.list(USER, True), "hirist")["state"] == "needs_sign_in"
    assert row(service.list(USER, True), "cutshort")["browser_active"]
    assert len(opened) == 2 and len(lane_driver.pages) == 2


def test_owner_lane_maps_to_actual_pipeline_profile_without_copying_main(manager):
    service, opened = manager
    service.action(USER, True, "hirist", "open", {"scope": "lane:hirist"})
    data = wait(service, scope="lane:hirist")
    assert {item["id"] for item in data["connections"]} == {"google", "hirist"}
    assert opened[0][0] == str(service.root / "user/browser/lanes/hirist")
    assert not (service.root / "user/browser/naukri").exists()


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
    linked = service.root / "user/browser/naukri"
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
    status = service.list(USER, True)
    assert row(status)["profile_busy"] and row(status)["busy_reason"] == "workflow"
    assert "Activity" in row(status)["fix"]
    assert row(status, "linkedin")["can_open"] and row(status, "linkedin")["busy_reason"] == ""
    service.runner.runs = []
    profile = service.root / "user/browser/naukri/chrome"
    profile.mkdir(parents=True)
    (profile / "SingletonLock").symlink_to("host-999999")
    with pytest.raises(service_module.ConnectionError, match="already open"):
        service.action(USER, True, "google", "open")
    assert opened == []


def test_running_board_blocks_only_its_own_connection_lane(manager):
    service, opened = manager
    service.runner.runs = [{"running": True, "resources": ["browser:lane:hirist"]}]
    hirist = row(service.list(USER, True, "lane:hirist"), "hirist")
    assert hirist["profile_busy"] and hirist["busy_reason"] == "workflow"
    assert row(service.list(USER, True), "naukri")["can_open"]
    assert row(service.list(USER, True, "lane:instahyre"), "instahyre")["can_open"]
    with pytest.raises(service_module.ConnectionError, match="workflow"):
        service.action(USER, True, "hirist", "open", {"scope": "lane:hirist"})
    assert opened == []


def test_sign_in_window_reserves_the_matching_lane_only(manager):
    service, opened = manager
    service.action(USER, True, "hirist", "open", {"scope": "lane:hirist"})
    wait(service, scope="lane:hirist")
    hirist = Command("Hirist", ("synthetic", "--site", "hirist"))
    instahyre = Command("Instahyre", ("synthetic", "--site", "instahyre"))
    assert service.blocks_command(hirist, "boards")
    assert service.blocks_command(instahyre, "boards") == ""
    assert service.blocks_command(Command("Naukri", ("synthetic",)), "naukri") == ""
    assert len(opened) == 1


def test_main_sign_in_does_not_block_an_independent_board_lane(manager):
    service, opened = manager
    service.action(USER, True, "naukri", "open")
    wait(service)
    assert service.blocks_command(Command("Naukri", ("synthetic",)), "naukri")
    assert service.blocks_command(Command("Hirist", ("synthetic", "--site", "hirist")), "boards") == ""
    assert len(opened) == 1


def test_dead_local_linkedin_lock_allows_open_without_deleting_leftover_profile_links(manager, monkeypatch):
    service, opened = manager
    profile = service.root / "user/browser/linkedin/chrome"
    profile.mkdir(parents=True)
    targets = {"SingletonLock": "synthetic-local-host-654321", "SingletonSocket": "/synthetic/missing/socket", "SingletonCookie": "synthetic-cookie"}
    for name, target in targets.items():
        (profile / name).symlink_to(target)
    monkeypatch.setattr(browser.socket, "gethostname", lambda: "synthetic-local-host")
    probes = []

    def dead_process(pid, signal):
        probes.append((pid, signal))
        assert (pid, signal) == (654321, 0)
        raise ProcessLookupError("Synthetic lock owner no longer exists")

    monkeypatch.setattr(browser.os, "kill", dead_process)
    before = service.list(USER, True)
    assert row(before, "linkedin")["state"] == "not_connected"
    assert row(before, "linkedin")["can_open"] and not row(before, "linkedin")["profile_busy"]
    assert row(before, "linkedin")["busy_reason"] == ""
    assert row(before, "google")["can_open"] and opened == []
    service.action(USER, True, "linkedin", "open")
    after = wait(service)
    assert row(after, "linkedin")["browser_open"] and row(after, "linkedin")["browser_active"]
    assert row(after, "linkedin")["state"] == "needs_sign_in"
    assert len(opened) == 1 and opened[0][0] == str(profile.parent)
    assert not row(after, "google")["browser_open"] and row(after, "google")["can_open"]
    assert probes and all(probe == (654321, 0) for probe in probes)
    for name, target in targets.items():
        assert (profile / name).is_symlink() and os.readlink(profile / name) == target


@pytest.mark.parametrize("locked_provider,free_provider,directory", [
    ("linkedin", "google", "linkedin"),
    ("google", "linkedin", "naukri"),
])
def test_live_local_profile_lock_blocks_only_its_own_browser_group(manager, monkeypatch, locked_provider, free_provider, directory):
    service, opened = manager
    profile = service.root / "user/browser" / directory / "chrome"
    profile.mkdir(parents=True)
    (profile / "SingletonLock").symlink_to("synthetic-local-host-654322")
    monkeypatch.setattr(browser.socket, "gethostname", lambda: "synthetic-local-host")
    probes = []

    def live_process(pid, signal):
        probes.append((pid, signal))
        assert (pid, signal) == (654322, 0)

    monkeypatch.setattr(browser.os, "kill", live_process)
    before = service.list(USER, True)
    blocked = row(before, locked_provider)
    assert blocked["profile_busy"] and blocked["busy_reason"] == "browser_profile"
    assert not blocked["can_open"] and not blocked["can_check"]
    assert "profile is in use" in blocked["fix"] and "Check connection status" in blocked["fix"]
    assert row(before, free_provider)["can_open"] and row(before, free_provider)["busy_reason"] == ""
    main_rows = [item for item in before["connections"] if item["id"] != "linkedin"]
    if locked_provider == "linkedin":
        assert all(item["can_open"] and item["busy_reason"] == "" for item in main_rows)
    else:
        assert all(not item["can_open"] and item["busy_reason"] == "browser_profile" for item in main_rows)
    with pytest.raises(service_module.ConnectionError, match="already open"):
        service.action(USER, True, locked_provider, "open")
    assert opened == []
    service.action(USER, True, free_provider, "open")
    after = wait(service)
    assert row(after, free_provider)["browser_open"] and row(after, free_provider)["browser_active"]
    assert row(after, locked_provider)["profile_busy"] and not row(after, locked_provider)["browser_open"]
    assert len(opened) == 1 and Path(opened[0][0]) != profile.parent
    assert probes and all(probe == (654322, 0) for probe in probes)
    assert os.readlink(profile / "SingletonLock") == "synthetic-local-host-654322"


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


@pytest.mark.parametrize(("error_type", "error_code"), [
    (TimeoutException, "page_load_timeout"),
    (WebDriverException, "page_load_failed"),
])
def test_linkedin_navigation_failure_keeps_live_window_and_check_recovers(manager, caplog, error_type, error_code):
    service, opened = manager
    secret = "private-cookie-token"
    private_url = "https://www.linkedin.com/login?auth_code=" + secret

    class SlowPageDriver(Driver):
        failed = False
        failed_url_reads = 0

        @Driver.current_url.getter
        def current_url(self):
            if self.failed:
                self.failed_url_reads += 1
            return self.pages[self.current_window_handle]

        def get(self, url):
            super().get(url)
            if len(self.visits) == 1:
                self.failed = True
                raise error_type("Cookie=" + secret + " " + private_url)

    def factory(settings):
        driver = SlowPageDriver()
        opened.append((settings.browser_profile_dir, driver))
        return driver

    service.driver_factory = factory
    service.action(USER, True, "linkedin", "open", {"expected_account": "candidate@example.com"})
    failed_data = wait(service)
    failed = row(failed_data, "linkedin")
    driver = opened[0][1]
    handle = driver.current_window_handle
    assert failed["state"] == "needs_attention"
    assert (failed["error_code"], failed["error_phase"]) == (error_code, "navigating")
    assert "still open" in failed["message"] and "Check sign-in" in failed["message"]
    assert failed["browser_open"] and failed["browser_active"]
    assert failed["can_check"] and failed["can_close"] and not failed["pending"]
    assert failed["expected_account"] == "candidate@example.com"
    assert not failed["identity_verified"] and not failed["last_verified_at"]
    assert not driver.closed and driver.window_handles == [handle]
    assert driver.visits == [browser.PROVIDERS["linkedin"].login]
    assert driver.failed_url_reads == 0  # Liveness must not query a possibly hung page.
    metadata = (Path(opened[0][0]) / browser.METADATA).read_text()
    for output in (json.dumps(failed_data), metadata, caplog.text):
        assert secret not in output and private_url not in output
    assert "phase=navigating" in caplog.text and "code=" + error_code in caplog.text

    # The person finishes sign-in in the retained tab; Check uses that same session.
    driver.failed = False
    driver.pages[handle] = browser.PROVIDERS["linkedin"].check
    service.action(USER, True, "linkedin", "check")
    recovered = row(wait(service), "linkedin")
    assert recovered["state"] == "connected" and recovered["identity_verified"]
    assert recovered["verified_account"] == "candidate@example.com"
    assert recovered["error_code"] == recovered["error_phase"] == ""
    assert len(opened) == 1 and driver.current_window_handle == handle
    assert driver.window_handles == [handle] and not driver.closed
    assert driver.visits == [browser.PROVIDERS["linkedin"].login]
    saved = browser.read_metadata(Path(opened[0][0]))["linkedin"]
    assert saved["error_code"] == saved["error_phase"] == ""
    service.action(USER, True, "linkedin", "close")
    closed = row(wait(service), "linkedin")
    assert closed["state"] == "connected" and not closed["browser_open"]
    assert driver.closed


def test_linkedin_navigation_timeout_with_closed_window_releases_session(manager, caplog):
    service, opened = manager
    factory = service.driver_factory

    def dead_browser(settings):
        driver = factory(settings)
        get = driver.get

        def close_during_navigation(url):
            get(url)
            driver.pages.clear()
            raise TimeoutException("Cookie=never-expose-timeout https://example.test/?token=never-expose-timeout")

        driver.get = close_during_navigation
        return driver

    service.driver_factory = dead_browser
    service.action(USER, True, "linkedin", "open")
    data = wait(service)
    failed = row(data, "linkedin")
    assert failed["state"] == "needs_attention"
    assert (failed["error_code"], failed["error_phase"]) == ("browser_disconnected", "navigating")
    assert "Open sign-in" in failed["message"]
    assert not failed["browser_open"] and not failed["can_close"]
    assert failed["can_open"] and not failed["pending"]
    assert opened[0][1].closed and not service.sessions
    metadata = (Path(opened[0][0]) / browser.METADATA).read_text()
    assert "never-expose-timeout" not in json.dumps(data) + metadata + caplog.text

    service.driver_factory = factory
    service.action(USER, True, "linkedin", "open")
    assert row(wait(service), "linkedin")["browser_open"]
    assert len(opened) == 2 and not opened[1][1].closed


@pytest.mark.parametrize(("error_type", "error_code"), [
    (NoSuchDriverException, "driver_unavailable"),
    (SessionNotCreatedException, "browser_start_failed"),
])
def test_linkedin_driver_start_failure_has_safe_specific_diagnostics(manager, caplog, error_type, error_code):
    service, opened = manager
    attempts = []

    def fail(settings):
        attempts.append(settings.browser_profile_dir)
        raise error_type("Cookie=private-start-secret https://example.test/?token=private-start-secret")

    service.driver_factory = fail
    service.action(USER, True, "linkedin", "open")
    data = wait(service)
    failed = row(data, "linkedin")
    assert failed["state"] == "needs_attention"
    assert (failed["error_code"], failed["error_phase"]) == (error_code, "starting")
    assert "Open sign-in" in failed["message"]
    assert failed["can_open"] and not failed["browser_open"] and not failed["can_close"]
    assert len(attempts) == 1 and opened == [] and not service.sessions
    metadata = (Path(attempts[0]) / browser.METADATA).read_text()
    assert "private-start-secret" not in json.dumps(data) + metadata + caplog.text
    assert "phase=starting" in caplog.text and "code=" + error_code in caplog.text


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
    assert any("NAUKRI_PASSWORD" in problem and "connected browser session" in problem for problem in Settings().validate())


def test_signed_out_managed_naukri_session_never_attempts_password_login(tmp_path, monkeypatch):
    from naukri_bot import auth
    monkeypatch.setattr(auth, "is_logged_in", lambda *a, **kw: False)
    monkeypatch.setattr(auth, "safe_get", lambda *a: True)
    monkeypatch.setattr(auth, "_wait_for_signed_in", lambda *a: False)
    monkeypatch.setattr(auth, "_wait_for_visible_sign_in", lambda driver, failure: failure)
    monkeypatch.setattr(auth, "login", lambda *a: pytest.fail("A password login was attempted"))
    browser.write_metadata(tmp_path, {"naukri": {"state": "connected"}})
    driver = SimpleNamespace(current_url="https://www.naukri.com/nlogin/login",
                             find_elements=lambda *args: [], find_element=lambda *args: SimpleNamespace(text=""))
    result = auth.ensure_logged_in(driver, Settings(session_only=True, browser_profile_dir=str(tmp_path),
                                                   email="old@example.com", password="unused"))
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
        return self.controls if selector == browser._CONTROLS else []


def test_board_verification_needs_positive_marker_and_expected_identity():
    provider = browser.PROVIDERS["hirist"]
    logout = SimpleNamespace(is_displayed=lambda: True, get_attribute=lambda key: "", text="Log out")
    assert browser.verify(Page("Welcome"), provider)["state"] == "needs_attention"
    assert browser.verify(Page("Log out\nother@example.com", controls=[logout]), provider, "expected@example.com")["state"] == "needs_attention"
    # An email in a job description or post is never account identity proof.
    assert browser.verify(Page("Log out\nexpected@example.com", controls=[logout]), provider, "expected@example.com")["state"] == "needs_attention"
    verified = browser.verify(Page("Log out", controls=[logout], email="expected@example.com"), provider, "expected@example.com")
    assert verified["state"] == "connected" and verified["identity_verified"]
    discovered = browser.verify(Page("Log out", controls=[logout], email="actual@example.com"), provider)
    assert discovered["verified_account"] == "actual@example.com" and discovered["identity_verified"]
    outsider = Page("Log out\nexpected@example.com")
    outsider.current_url = "https://hirist.tech.attacker.example/profile"
    assert browser.verify(outsider, provider)["state"] == "needs_sign_in"


@pytest.mark.parametrize("transient", ["loading", "stale"])
def test_loading_or_replaced_account_controls_retry_without_closing_browser(manager, transient):
    from selenium.common.exceptions import StaleElementReferenceException
    service, opened = manager
    calls = []
    def verify(driver, provider, expected):
        calls.append(provider.id)
        if len(calls) == 1:
            if transient == "stale":
                raise StaleElementReferenceException()
            return {"state": "needs_attention", "retryable": True, "message": "Loading account controls."}
        return {"state": "connected", "message": "Synthetic account checked.", "last_verified_at": browser.now()}
    service.verify_timeout = 1
    service.verifier = verify
    service.action(USER, True, "hirist", "check")
    status = row(wait(service), "hirist")
    assert status["state"] == "connected" and status["browser_active"]
    assert calls == ["hirist", "hirist"] and not opened[0][1].closed
    assert "retryable" not in service.record(Path(opened[0][0]), "hirist")
