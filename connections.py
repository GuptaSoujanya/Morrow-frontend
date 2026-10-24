"""Authenticated local automation-browser connections, isolated by tenant.

The HTTP adapter supplies the authenticated identity and explicit legacy-owner
decision. Each profile has one worker thread; WebDriver never crosses threads.
"""
from __future__ import annotations

import contextlib
import json
import os
import queue
import shutil
import threading
import time
from pathlib import Path
from uuid import UUID

from common import connections as browser
from common.models import Settings

BOARDS = ("hirist", "instahyre", "cutshort", "wellfound")
OPERATIONS = ("open", "check", "close", "switch", "disconnect")
TRANSITIONAL = ("opening", "checking", "closing", "switching", "disconnecting")


class ConnectionError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Session:
    def __init__(self, service, base, resource, owner):
        self.service, self.base, self.resource, self.owner = service, base, resource, owner
        self.queue = queue.Queue()
        self.driver = None  # Accessed exclusively by this worker's thread.
        self.open = False
        self.pending = False
        self.current_provider = ""
        self.touched = time.monotonic()
        self.thread = threading.Thread(target=self.work, daemon=True, name="morrow-connection")
        self.thread.start()

    def work(self):
        while True:
            try:
                item = self.queue.get(timeout=1)
            except queue.Empty:
                with self.service.lock:
                    expired = self.open and not self.pending and time.monotonic() - self.touched > 900
                    if expired:
                        self.pending = True
                if expired:
                    self.close()
                    with self.service.lock:
                        self.service.sessions.pop(self.base, None)
                    return
                continue
            if item is None:
                self.close()
                return
            provider, operation = item
            try:
                self.perform(provider, operation)
            except Exception:
                # Driver exceptions can include page URLs, auth codes and debug
                # endpoints. Return a fixed explanation rather than their text.
                try:
                    self.service.set_record(self.base, provider.id, state="needs_attention",
                        message="The automation browser could not complete this step. Close any window using this profile, check Chrome is installed, then reconnect.",
                        last_verified_at=None, verified_account="", identity_verified=False)
                except OSError:
                    pass  # In-memory state is retained even when storage is full.
                finally:
                    self.close()
            finally:
                with self.service.lock:
                    self.pending = False
                    self.touched = time.monotonic()
                    retired = not self.open
                    if retired:
                        self.service.sessions.pop(self.base, None)
                self.queue.task_done()
            if retired:
                return

    def close(self):
        if self.driver is not None:
            try:
                self.driver.quit()
            except Exception:
                pass
        self.driver = None
        with self.service.lock:
            self.open = False
            self.current_provider = ""

    def perform(self, provider, operation):
        if operation == "close":
            previous = self.service.record(self.base, provider.id).get("before_close", "needs_sign_in")
            self.close()
            self.service.set_record(self.base, provider.id, state=previous,
                message="Browser closed. The saved session will be reused on this computer." if previous == "connected" else "Browser closed. Reopen it to finish sign-in.")
            return
        if self.driver is None:
            browser.private_dir(self.base)
            browser.mark_managed(self.base)
            self.driver = self.service.driver_factory(Settings(browser_profile_dir=str(self.base), session_only=True))
            with self.service.lock:
                self.open = True
        with self.service.lock:
            self.current_provider = provider.id
        if operation in ("switch", "disconnect"):
            browser.clear_provider(self.driver, provider)
            self.service.set_record(self.base, provider.id, state="needs_sign_in", last_verified_at=None,
                verified_account="", identity_verified=False,
                message="Saved sign-in removed. Sign in to the replacement account, then check." if operation == "switch" else "Saved sign-in removed from this automation profile.")
            if operation == "disconnect":
                self.close()
            return
        if operation != "check" or not browser.allowed_host(self.driver.current_url, provider):
            self.driver.get(provider.check if operation == "check" else provider.login)
        if operation == "open":
            self.service.set_record(self.base, provider.id, state="needs_sign_in",
                message="Sign in in the automation browser, complete any security check, then select Check sign-in.",
                last_verified_at=None, verified_account="", identity_verified=False)
            return
        expected = self.service.record(self.base, provider.id).get("expected_account", "")
        deadline = time.monotonic() + self.service.verify_timeout
        while True:
            result = self.service.verifier(self.driver, provider, expected)
            if result.get("state") != "needs_sign_in" or time.monotonic() >= deadline:
                break
            time.sleep(0.3)
        if result.get("state") != "connected":
            result.update(last_verified_at=None, verified_account="", identity_verified=False)
        self.service.set_record(self.base, provider.id, **result)


class ConnectionService:
    MAX_OPEN = 3

    def __init__(self, root, runner=None, *, driver_factory=None, verifier=None, availability=None, verify_timeout=6):
        self.root = Path(root).resolve()
        self.runner = runner
        self.lock = threading.RLock()
        self.sessions = {}
        self.records = {}
        self.driver_factory = driver_factory or browser.create_driver
        self.verifier = verifier or browser.verify
        self.availability = availability or browser.chrome_binary
        self.verify_timeout = verify_timeout
        self.closed = False

    def _tenant(self, user, owner):
        if user is None and owner:
            return "local"
        try:
            return str(UUID(str((user or {}).get("tenant_id") or (user or {}).get("id") or "")))
        except ValueError:
            raise ConnectionError(403, "A verified workspace identity is required.") from None

    def _scope(self, scope):
        if scope not in ("main", *("lane:" + board for board in BOARDS)):
            raise ConnectionError(400, "Choose Main browser or a supported parallel board lane.")
        return scope

    def _owner_base(self, provider, scope):
        # Read only the two configured paths; never expose .env or credentials.
        from dotenv import dotenv_values
        values = dotenv_values(self.root / ".env")
        main = os.getenv("BROWSER_PROFILE_DIR") or values.get("BROWSER_PROFILE_DIR") or "data/browser/naukri"
        linkedin = os.getenv("LINKEDIN_BROWSER_PROFILE_DIR") or values.get("LINKEDIN_BROWSER_PROFILE_DIR") or "data/browser/linkedin"
        base = Path(linkedin if provider == "linkedin" else main).expanduser()
        if not base.is_absolute():
            base = self.root / base
        if scope.startswith("lane:"):
            base = base.parent / "lanes" / scope.split(":", 1)[1]
        return base

    def _base(self, user, owner, provider, scope):
        tenant = self._tenant(user, owner)
        self._scope(scope)
        if provider not in browser.PROVIDERS:
            raise ConnectionError(404, "Choose a supported account provider.")
        if scope != "main" and provider not in ("google", scope.split(":", 1)[1]):
            raise ConnectionError(400, "This provider is not used by the selected parallel lane.")
        if owner:
            path = self._owner_base(provider, scope)
        else:
            group = "linkedin" if provider == "linkedin" else "main" if scope == "main" else scope.replace(":", "-")
            path = self.root / "data" / "private" / "connections" / tenant / group
        # Reject traversal and symlink aliases, including links to personal
        # Chrome. Configuration does not authorize importing those profiles.
        try:
            relative = path.relative_to(self.root)
        except ValueError:
            raise ConnectionError(409, "Move the automation profile inside this workspace before connecting it.") from None
        current = self.root
        for part in relative.parts:
            if part in ("..", "."):
                raise ConnectionError(409, "Use a dedicated automation profile inside this workspace.")
            current /= part
            if current.is_symlink():
                raise ConnectionError(409, "Automation profiles cannot link to another browser profile.")
        return path

    def record(self, base, provider):
        with self.lock:
            if base not in self.records:
                self.records[base] = browser.read_metadata(base)
            result = self.records[base].get(provider, {})
            return dict(result) if isinstance(result, dict) else {}

    def set_record(self, base, provider, **values):
        with self.lock:
            prior = self.record(base, provider)
            prior.update(values)
            self.records[base][provider] = prior
            browser.write_metadata(base, self.records[base])

    def _resource(self, provider):
        return "browser:linkedin" if provider == "linkedin" else "browser:main"

    def _run_busy(self, resource, owner):
        if not owner or not self.runner:
            return False
        active = getattr(self.runner, "runs", None)
        if isinstance(active, dict):
            # Callers hold runner.lock. Avoid copying private activity output
            # merely to check whether a browser resource is reserved.
            return any(run.result is None and (resource in run.resources or "workspace" in run.resources)
                       for run in active.values())
        runs = self.runner.snapshot(after=0).get("runs", [])
        return any(row.get("running") and (resource in row.get("resources", []) or "workspace" in row.get("resources", [])) for row in runs)

    def list(self, user, owner=False, scope="main"):
        self._tenant(user, owner)
        self._scope(scope)
        rows = []
        runner_lock = self.runner.lock if self.runner else contextlib.nullcontext()
        with runner_lock, self.lock:
            for key, provider in browser.PROVIDERS.items():
                if scope != "main" and key not in ("google", scope.split(":", 1)[1]):
                    continue
                try:
                    base = self._base(user, owner, key, scope)
                    saved = self.record(base, key)
                    session = self.sessions.get(base)
                    opened = bool(session and session.open)
                    pending = bool(session and session.pending)
                    busy = self._run_busy(self._resource(key), owner) or (not opened and browser.profile_locked(base))
                    state = saved.get("state", "not_connected")
                    if state in TRANSITIONAL and not pending:
                        state = "needs_sign_in"
                        saved["message"] = "Browser setup was interrupted. Reopen the automation browser to continue."
                    row = {"id": key, "label": provider.label, "state": state,
                        "message": saved.get("message", "Connect your account in its private automation browser."),
                        "expected_account": saved.get("expected_account", ""),
                        "account_configured": bool(saved),
                        "verified_account": saved.get("verified_account", ""),
                        "identity_verified": bool(saved.get("identity_verified")),
                        "last_verified_at": saved.get("last_verified_at"),
                        "browser_open": opened, "profile_busy": busy, "pending": pending,
                        "session_scope": "LinkedIn browser" if key == "linkedin" else "Main browser · Google, Naukri and boards" if scope == "main" else "Parallel lane · " + scope.split(":", 1)[1],
                        "can_open": not busy and not pending and bool(self.availability()),
                        "can_check": not busy and not pending and bool(self.availability()),
                        "can_close": opened and not pending,
                        "fix": "Close the running bot or browser before changing this login." if busy else "Finish sign-in, check it, then close the browser before running a workflow."}
                except ConnectionError as exc:
                    row = {"id": key, "label": provider.label, "state": "needs_attention", "message": str(exc),
                           "fix": str(exc), "browser_open": False, "profile_busy": True, "pending": False,
                           "can_open": False, "can_check": False, "can_close": False}
                rows.append(row)
            active = sum(bool(item.open or item.pending) for item in self.sessions.values())
        chrome = bool(self.availability())
        return {"connections": rows, "scope": scope, "scopes": [{"id": "main", "label": "Main browser"},
                    *({"id": "lane:" + board, "label": "Parallel lane · " + browser.PROVIDERS[board].label} for board in BOARDS)],
                "browser_available": chrome, "automation_available": bool(owner),
                "runtime": {"available": True, "chrome_available": chrome, "automation_available": bool(owner),
                            "active_browsers": active, "max_browsers": self.MAX_OPEN,
                            "claude_installed": bool(shutil.which("claude")), "kiro_installed": bool(shutil.which("kiro-cli")),
                            "pdftotext_available": bool(shutil.which("pdftotext")),
                            "location": "This computer", "containers_supported": False}}

    def action(self, user, owner, provider, operation, payload=None):
        payload = {} if payload is None else payload
        if not isinstance(payload, dict) or set(payload) - {"scope", "expected_account"}:
            raise ConnectionError(400, "Send only the scope and optional account email.")
        if operation not in OPERATIONS:
            raise ConnectionError(404, "Choose a supported connection action.")
        scope = payload.get("scope", "main")
        base = self._base(user, owner, provider, scope)
        try:
            hint = browser.account_hint(payload["expected_account"]) if "expected_account" in payload else None
        except ValueError as exc:
            raise ConnectionError(400, str(exc)) from None
        # Same lock ordering as Runner.start_guard; reservation and the active
        # run check are atomic with launching a job.
        runner_lock = self.runner.lock if self.runner else contextlib.nullcontext()
        with runner_lock:
            with self.lock:
                if self.closed:
                    raise ConnectionError(503, "The connection service is shutting down.")
                session = self.sessions.get(base)
                if session and session.pending:
                    raise ConnectionError(409, "This browser is finishing the previous action. Wait a moment.")
                if self._run_busy(self._resource(provider), owner):
                    raise ConnectionError(409, "A workflow is using this browser. Wait until it finishes before changing the login.")
                if not (session and session.open) and browser.profile_locked(base):
                    raise ConnectionError(409, "This profile is already open. Close its other browser window, then reconnect.")
                if operation == "close" and not (session and session.open):
                    return self.list(user, owner, scope)
                if not self.availability():
                    raise ConnectionError(409, "Install Google Chrome on this computer before connecting an account.")
                if not (session and session.open) and sum(bool(item.open or item.pending) for item in self.sessions.values()) >= self.MAX_OPEN:
                    raise ConnectionError(409, "Close another automation browser before opening this one.")
                previous = self.record(base, provider)
                if hint is not None and hint != previous.get("expected_account", ""):
                    previous.update(expected_account=hint, last_verified_at=None, verified_account="", identity_verified=False, state="needs_sign_in")
                previous["before_close"] = previous.get("state") if previous.get("state") == "connected" else "needs_sign_in"
                previous.update(state={"open": "opening", "check": "checking", "close": "closing", "switch": "switching", "disconnect": "disconnecting"}[operation],
                                message="The automation browser is updating this connection.")
                self.set_record(base, provider, **previous)
                if not session:
                    session = Session(self, base, self._resource(provider), owner)
                    self.sessions[base] = session
                session.pending = True
                session.touched = time.monotonic()
                session.queue.put((browser.PROVIDERS[provider], operation))
        return self.list(user, owner, scope)

    def blocks_command(self, command, action):
        from web.runner import resources_for
        resources = resources_for(command, action)
        with self.lock:
            if any(item.owner and (item.open or item.pending) and (item.resource in resources or "workspace" in resources)
                   for item in self.sessions.values()):
                return "Close the automation sign-in browser in Connections before starting this workflow. Your saved login will be reused."
        return ""

    def shutdown(self):
        with self.lock:
            self.closed = True
            sessions = list(self.sessions.values())
        for session in sessions:
            session.queue.put(None)
        for session in sessions:
            session.thread.join(timeout=2)
