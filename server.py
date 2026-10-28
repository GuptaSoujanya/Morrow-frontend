"""Serve the dashboard and the existing job-hunt API from one localhost origin."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import http.client
import gzip
import json
import os
import re
from pathlib import Path
import sys
import tempfile
import shlex
import sqlite3
from http import HTTPStatus
from urllib.parse import parse_qs, urlsplit, quote

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
sys.path.insert(0, str(ROOT))
from web import server, state
import commands
import dashboard_data
import research_learning
import daily_dsa
import daily_learning
import learning_practice
import coding_practice
import local_code_runner
import learning_scores
import learning_workspace
from common import learning_activity, learning_memory, paths
from common.local_setup import LocalSetup, SetupError as LocalSetupError
import pipeline_status as flow_status
from connections import ConnectionService, ConnectionError
import runner_setup
import user_repo

BOARDS = ("hirist", "instahyre", "cutshort", "wellfound")
BOT_IDS = ("naukri", *BOARDS, "external", "profile", "linkedin", "linkedin_profile", "cold_email", "resume", "learn", "brief", "research", *(board + '_profile' for board in BOARDS))


def board_command(options, save=False):
    board = str(options.get("board") or "all")
    if board not in (*BOARDS, "all"):
        raise ValueError("Choose a supported job board.")
    args = ["-m", "sites_bot.platforms", "--site", board]
    mode = options.get("mode") or "apply"
    if mode not in ("apply", "profile"):
        raise ValueError("Choose applications or profile update.")
    if mode == "profile":
        args += ["--profile-only", "--create-profile"]
    elif server._on(options,'update_profile'):
        args += ['--update-profile']
    if options.get("dry_run"):
        args.append("--dry-run")
    limit = server._limit(options)
    if limit is not None:
        if not 1 <= limit <= 500:
            raise ValueError("The limit must be between 1 and 500.")
        args += ["--limit", str(limit)]
    name = "All job boards" if board == "all" else state.board_name(board)
    if mode == 'profile':
        name = 'All board profiles' if board == 'all' else name + ' profile'
    cmd = state.py(name + " · " + ("practice" if options.get("dry_run") else mode), *args)
    return state.Command(cmd.label, cmd.argv, state.VISIBLE_BROWSER) if mode == 'profile' else cmd


def pipeline_command(options, save=False):
    return commands.pipeline_command(options, save)


def pipeline_status(day=None, runner=None):
    return flow_status.read_status(state.APPLY, day, runner.snapshot(after=0) if runner else None)


def revision(text):
    return hashlib.sha256(text.encode()).hexdigest()


def schedule_command(schedule, mode):
    if schedule not in ("profile", "linkedin") or mode not in ("enable", "disable"):
        raise ValueError("Choose a supported schedule and action.")
    return state.py(f"{schedule.title()} schedule · {mode}", str(ROOT / "schedule.py"), schedule, mode)


def bots_status(runner):
    """Inventory and recorded runs, without treating old checkpoints as live processes."""
    run = runner.snapshot()
    latest = {}
    history_error = ""
    try:
        rows = state._query(state.database(), "SELECT started_at, finished_at, summary_json FROM runs ORDER BY started_at DESC, id DESC")
        for row in rows:
            try:
                summary = json.loads(row["summary_json"] or "{}")
            except (ValueError, TypeError):
                continue
            if not isinstance(summary, dict):
                continue
            key = summary.get("board") or "naukri"
            if summary.get('profile_only') or summary.get('mode') == 'profile':
                key = 'profile' if key == 'naukri' else key + '_profile'
            if key in BOT_IDS and key not in latest:
                latest[key] = {"at": row["started_at"], "finished": bool(row["finished_at"]),
                               "practice": bool(summary.get("dry_run")), "sent": summary.get("applied"),
                               "found": summary.get("collected")}
    except (OSError, sqlite3.Error):
        history_error = "Run history is unavailable. Bot controls are still available."
    active = {}
    # The legacy snapshot represents one run; newer runners retain it alongside
    # the complete list so older clients and test doubles remain compatible.
    runs = run.get("runs") if isinstance(run.get("runs"), list) else [run]
    for entry in runs:
        if not entry.get("running"):
            continue
        try:
            tokens = shlex.split(entry.get("shown") or "")
        except ValueError:
            tokens = []
        selected = []
        action = entry.get("action")
        if action == "boards" and "--site" in tokens:
            index = tokens.index("--site") + 1
            board = tokens[index] if index < len(tokens) else ""
            selected = list(BOARDS) if board == "all" else [board]
            if '--profile-only' in tokens:
                selected = [key + '_profile' for key in selected]
            elif '--update-profile' in tokens:
                selected += [key + '_profile' for key in selected]
        elif action == "pipeline":
            def values(flag):
                return [tokens[index + 1] for index, token in enumerate(tokens[:-1]) if token == flag]

            command_index = tokens.index('pipeline') + 1 if 'pipeline' in tokens else len(tokens)
            command = tokens[command_index] if command_index < len(tokens) else ''
            only = ['learn'] if command == 'learn' else values('--only')
            skipped = values('--skip')

            def matches(stage, choices):
                return any(stage == choice or stage.startswith(choice + ':') for choice in choices)

            stages = [] if command in ('status', 'check') or '--done' in tokens else [
                stage for stage in commands.STAGES
                if (not only or matches(stage, only)) and not matches(stage, skipped)
            ]
            for stage in stages:
                group, _, name = stage.partition(':')
                if group == 'profile':
                    selected.append('profile' if name == 'naukri' else name + '_profile')
                elif group == 'apply':
                    selected.append(name)
                else:
                    selected.append(group)
        elif action in BOT_IDS:
            selected = [action]
        for key in selected:
            if key in BOT_IDS:
                ids = active.setdefault(key, [])
                if entry.get('id') and entry['id'] not in ids:
                    ids.append(entry['id'])
    return {"bots": [{"id": key, "running": key in active,
                      "status": "running" if key in active else "idle", "run_ids": active.get(key, []),
                      "last_run": latest.get(key)}
                     for key in BOT_IDS], "run": run, "history_error": history_error}


class DashboardHandler(server.Handler):
    def coding_request(self, path):
        if not self.host_ok() or not self.change_ok() or self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.error(403, 'Only this dashboard can run code on this computer.')
        try:
            body = self.body()
            if path == '/api/learning/code/draft':
                return self.json(coding_practice.save_draft(state.APPLY, body))
            if path != '/api/learning/code/execute':
                return self.error(404, 'Coding endpoint not found.')
            if not self.server.code_slots.acquire(blocking=False):
                return self.error(409, 'Two code runs are already active. Wait for a result before trying again.')
            try:
                return self.json(coding_practice.execute(state.APPLY, state.COURSE, body, studied=state.STUDIED))
            finally:
                self.server.code_slots.release()
        except (ValueError, server.ApiError) as exc:
            return self.error(400, str(exc))
        except OSError:
            return self.error(503, 'The local code workspace could not be opened or saved. Your editor draft is still available.')

    def practice_status(self):
        return self.server.practice_status()

    def practice_request(self, path):
        if not self.host_ok() or not self.change_ok() or self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.error(403, 'Only this dashboard can update AI practice.')
        try:
            body = self.body()
            if not isinstance(body, dict):
                raise ValueError('Send a practice request as an object.')
            if path == '/api/learning/practice/settings':
                return self.json(learning_practice.settings(state.APPLY, body))
            if path == '/api/learning/practice/answer':
                learning_practice.update(state.APPLY, state.COURSE, body)
                paper = learning_practice.paper(state.APPLY, body.get('paper_id', ''))
                if paper.get('completed_at'):
                    learning_memory.set_document(state.APPLY, 'practice/' + paper['id'], paper['title'], True)
                return self.json(paper)
            if path != '/api/learning/practice/generate':
                return self.error(404, 'Practice endpoint not found.')
            mode = body.get('mode', 'daily')
            if mode not in ('daily', 'weekly') or type(body.get('automatic', False)) is not bool:
                raise ValueError('Choose daily practice or the weekly exam.')
            result = self.server.start_practice(mode, automatic=body.get('automatic', False))
            return self.json(result, HTTPStatus.ACCEPTED if result['started'] else HTTPStatus.OK)
        except learning_practice.Conflict as exc:
            return self.error(409, str(exc))
        except LookupError as exc:
            return self.error(503, str(exc))
        except (ValueError, server.ApiError) as exc:
            return self.error(400, str(exc))
        except RuntimeError as exc:
            return self.error(409, str(exc))
        except OSError:
            return self.error(503, 'Your practice could not be saved. Please retry.')

    def connection_request(self, user=None, owner=False):
        url = urlsplit(self.path)
        if url.path != '/api/connections' and not url.path.startswith('/api/connections/'):
            return False
        try:
            if self.command in ('GET', 'HEAD') and url.path == '/api/connections':
                scope = parse_qs(url.query).get('scope', ['main'])[-1]
                self.json(self.server.connections.list(user, owner, scope))
            elif self.command == 'POST':
                if not self.change_ok() or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                    self.error(403, 'Only this dashboard can change browser connections.')
                    return True
                parts = url.path.strip('/').split('/')
                if len(parts) != 4:
                    self.error(404, 'Choose a supported connection action.')
                else:
                    self.json(self.server.connections.action(user, owner, parts[2], parts[3], self.body()))
            else:
                self.error(405, 'Method not supported for browser connections.')
        except ConnectionError as exc:
            self.error(exc.status, str(exc))
        except server.ApiError as exc:
            self.error(exc.status, str(exc))
        except OSError:
            self.error(503, 'The browser connection could not be saved. Check this computer’s storage and try again.')
        return True

    def missing_document(self, path):
        """Serve only a fixed public error page; never fall through to private files."""
        if (self.command not in ("GET", "HEAD")
                or self.headers.get("Sec-Fetch-Dest") != "document"
                or self.headers.get("Sec-Fetch-Mode") != "navigate"
                or "text/html" not in self.headers.get("Accept", "")):
            return False
        # Browser page addresses only. Encoded/dotted paths and all API, asset and
        # legacy-content namespaces retain their existing authentication boundary.
        if not re.fullmatch(r"/[A-Za-z0-9][A-Za-z0-9_-]*(?:/[A-Za-z0-9][A-Za-z0-9_-]*)*/?", path):
            return False
        if path.startswith(("/api", "/course", "/reports", "/assets", "/js", "/styles", "/fonts", "/static")):
            return False
        assets = ROOT / 'dist' if (ROOT / 'dist' / 'index.html').is_file() else ROOT / 'app'
        target = server.inside(assets, path.lstrip("/"))
        if target is None or target.is_file() or (target / 'index.html').is_file():
            return False
        document = assets / '404.html'
        if not document.is_file():
            document = ROOT / 'app' / '404.html'
        try:
            body = document.read_bytes()
        except OSError:
            return False
        self.send(HTTPStatus.NOT_FOUND, body, 'text/html; charset=utf-8')
        return True

    def repo_request(self, path, owner, bridge):
        """GET /api/runner/repo, POST /api/runner/repo, POST /api/runner/repo/sync (workspace owner only)."""
        if path not in ('/api/runner/repo', '/api/runner/repo/sync'):
            return False
        if not owner:
            self.error(403, 'Only the workspace owner can connect this computer to a private user repo.')
            return True
        try:
            if path == '/api/runner/repo' and self.command == 'GET':
                self.json(user_repo.status(state.APPLY))
                return True
            if self.command != 'POST':
                self.error(405, 'Use GET to read the repo status or POST to connect it.')
                return True
            if not self.change_ok() or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                self.error(403, 'Only this dashboard can change the private user repo.')
                return True
            data = self.body()
            if path == '/api/runner/repo':
                if self.server.runner.running:
                    raise user_repo.RepoError(409, 'A workflow is running. Connect the repo after it stops.')
                self.json(user_repo.connect(state.APPLY, data.get('repo') or None))
                return True
            if bridge is None:
                raise user_repo.RepoError(404, 'Accounts are disabled in the free beta; edit user/inputs directly.')
            if not user_repo.status(state.APPLY)['is_repo']:
                raise user_repo.RepoError(409, 'Connect your private user repo before copying your saved details into it.')
            setup = bridge.json_request(self, '/api/v1/onboarding')
            if data.get('version') != setup.get('version') or data.get('profile_version') != setup.get('profile', {}).get('version'):
                raise user_repo.RepoError(409, 'Your saved setup changed. Reload it before copying it into your repo.')
            content = b''
            resume = setup.get('resume')
            if resume:
                code, _, content = bridge.request(self, '/api/v1/artifacts/' + str(resume['id']) + '/content')
                if code != 200:
                    raise user_repo.RepoError(409, 'The selected resume is no longer available in your account.')
            with self.server.file_lock:
                self.json(user_repo.sync_account_inputs(state.APPLY, setup, content))
        except user_repo.RepoError as exc:
            self.error(exc.status, str(exc))
        return True

    def account_request(self):
        """Account APIs and tenant adapters run before legacy file/bot handlers."""
        if not self.host_ok():
            self.error(HTTPStatus.FORBIDDEN, "Only this dashboard can use this service.")
            return True
        bridge = getattr(self.server, "account_bridge", None)
        url = urlsplit(self.path)
        if url.path == '/api/local-health' and self.command in ('GET', 'HEAD'):
            self.json({'service': 'morrow', 'workspace': hashlib.sha256(str(state.APPLY).encode()).hexdigest()[:16],
                       'mode': 'accounts' if bridge else 'beta'})
            return True
        if url.path.startswith('/api/local-setup'):
            if bridge:
                self.error(404, 'Local setup is available in local mode only.')
                return True
            try:
                setup = self.server.local_setup
                if self.command in ('GET', 'HEAD') and url.path == '/api/local-setup':
                    self.json(setup.status())
                elif self.command == 'POST':
                    if not self.change_ok() or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                        self.error(403, 'Only this dashboard can save your local setup.')
                        return True
                    actions = {'/api/local-setup': setup.save, '/api/local-setup/resume': setup.upload_resume,
                               '/api/local-setup/extract': setup.extract_resume, '/api/local-setup/draft': setup.save_draft,
                               '/api/local-setup/finish': setup.start}
                    if url.path not in actions:
                        self.error(404, 'Setup action not found.')
                    else:
                        self.json(actions[url.path](self.body()))
                else:
                    self.error(405, 'Use GET to read setup or POST to save it.')
            except (LocalSetupError, server.ApiError) as exc:
                self.error(exc.status, str(exc))
            except (OSError, UnicodeError):
                self.error(503, 'Your setup could not be read or saved. Check free disk space and folder permissions, then retry.')
            return True
        if self.missing_document(url.path):
            return True
        if not bridge:
            if url.path.startswith('/api/v1/') or url.path == '/api/runner/setup':
                self.error(404, 'Accounts and billing are disabled in the free beta.')
                return True
            if url.path == "/api/session":
                self.json({"mode": "local", "user": None, "legacy_access": True})
                return True
            if url.path.startswith('/api/runner/repo'):
                # The free beta has no account to copy from; connecting the repo still works.
                return self.repo_request(url.path, owner=True, bridge=None)
            if self.connection_request(owner=True):
                return True
            return False
        if url.path.startswith("/api/v1/"):
            bridge.proxy(self)
            return True
        if self.command in ("GET", "HEAD") and (url.path in ("/", "/index.html") or url.path.startswith(("/assets/", "/js/", "/styles/", "/fonts/"))):
            return False
        try:
            from auth_bridge import BackendError, Unavailable
            user = bridge.identity(self)
            if not user:
                self.error(401, "Sign in to your Morrow account first.")
                return True
            owner = bridge.is_owner(self, user)
            if url.path.startswith('/api/runner/repo'):
                return self.repo_request(url.path, owner, bridge)
            if url.path == '/api/runner/setup':
                if self.command != 'POST':
                    self.error(405, 'Use POST to prepare this computer.')
                    return True
                if not self.change_ok() or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                    self.error(403, 'Only this dashboard can prepare local runner inputs.')
                    return True
                try:
                    expected = self.body()
                    setup = bridge.json_request(self, '/api/v1/onboarding')
                    resume = setup.get('resume')
                    if not resume:
                        raise runner_setup.SetupError(409, 'Choose a private resume before preparing this computer.')
                    code, _, content = bridge.request(self, '/api/v1/artifacts/' + str(resume['id']) + '/content')
                    if code != 200:
                        raise runner_setup.SetupError(409, 'The selected resume is no longer available in your account.')
                    self.json(runner_setup.sync_inputs(state.APPLY, self.server.runner, user, owner, setup, content, expected))
                except runner_setup.SetupError as exc:
                    self.error(exc.status, str(exc))
                return True
            if self.connection_request(user, owner):
                return True
            if url.path == "/api/session":
                self.json({"mode": "accounts", "user": user, "legacy_access": owner})
                return True
            query = {key: values[-1] for key, values in parse_qs(url.query).items()}
            required = {"/api/library": "research", "/api/document": "research", "/api/research/learning": "learning", "/api/research/read": "learning"}.get(url.path)
            if required and user["role"] != "admin" and required not in user.get("modules", []):
                self.error(403, "Your plan does not include this module.")
                return True
            from tenant_api import TenantAPI
            if owner and url.path == "/api/research/read" and self.command == "POST":
                # Imported library IDs use account storage. Legacy daily research
                # keeps its existing local progress file for the explicit owner.
                # Parse once: dispatch must not consume the request body twice.
                data = self.body()
                if str(data.get("id", "")).startswith("artifact/"):
                    TenantAPI(bridge, self, user).handle("POST", url.path, query, data=data)
                else:
                    self.save_research_progress(data)
                return True
            core = {"/api/file", "/api/records", "/api/data", "/api/library", "/api/document", "/api/resume-file"}
            if owner and url.path == "/api/file" and query.get("name") == "env" and self.command in ("GET", "HEAD", "POST"):
                return False
            if owner and url.path == "/api/document" and not query.get("id", "").startswith("artifact/"):
                core.remove("/api/document")
            if not owner or url.path in core:
                method = "GET" if self.command == "HEAD" else self.command
                if TenantAPI(bridge, self, user).handle(method, url.path, query):
                    return True
                if url.path in core:
                    self.error(405, "Method not supported for this workspace endpoint.")
                    return True
            if not owner:
                self.error(403, "This workflow is not connected to your individual workspace yet.")
                return True
            return False
        except server.ApiError as exc:
            self.error(exc.status, str(exc))
            return True
        except Unavailable as exc:
            print(f"account service unreachable: {exc}", file=sys.stderr, flush=True)
            self.error(503, "The account service is unavailable. Try again shortly.")
            return True
        except BackendError as exc:
            self.error(exc.status, str(exc))
            return True
        except OSError as exc:
            import traceback
            traceback.print_exc()
            self.error(500, f"This computer could not finish the request: {exc}")
            return True

    def send(self, status, body, kind):
        compressed = len(body) > 1024 and 'gzip' in self.headers.get('Accept-Encoding', '') and (kind.startswith('text/') or 'javascript' in kind or 'json' in kind)
        if compressed:
            body = gzip.compress(body)
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store' if '/api/' in self.path else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('Vary', 'Accept-Encoding')
        if compressed:
            self.send_header('Content-Encoding', 'gzip')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_GET(self):
        if self.account_request():
            return
        if not self.host_ok():
            return self.error(HTTPStatus.FORBIDDEN, "Only this computer can use this dashboard.")
        url = urlsplit(self.path)
        try:
            query = {key: values[-1] for key, values in parse_qs(url.query).items()}
            if url.path == '/api/learning/collection':
                return self.json(learning_workspace.collection())
            if url.path == '/api/learning/discovery':
                return self.json(learning_workspace.discovery(query.get('date')))
            if url.path == '/api/learning/curriculum':
                return self.json(learning_workspace.curriculum(runner_setup.runtime_environment(state.APPLY, getattr(self.server, 'workspace_owner_email', ''))))
            if url.path == '/api/learning/overview':
                return self.json(learning_workspace.overview(runner_setup.runtime_environment(state.APPLY, getattr(self.server, 'workspace_owner_email', ''))))
            if url.path == '/api/learning/activity':
                return self.json(learning_activity.summary(learning_memory.transact(state.APPLY, studied=state.STUDIED)))
            if url.path == '/api/learning/code/capabilities':
                return self.json(local_code_runner.capabilities())
            if url.path == '/api/learning/code/problem':
                return self.json(coding_practice.descriptor(state.APPLY, query.get('key', ''), query.get('language', 'python')))
            if url.path == '/api/learning/code/progress':
                return self.json(learning_scores.summary(state.APPLY))
            if url.path == '/api/learning/dsa':
                return self.json(daily_dsa.daily(state.APPLY, state.COURSE, studied=state.STUDIED))
            if url.path == '/api/learning/dsa/sheet':
                return self.json(daily_dsa.sheet(state.APPLY, state.COURSE, query.get('q'), studied=state.STUDIED))
            if url.path == '/api/learning/dsa/problem':
                return self.json(daily_dsa.problem(state.APPLY, state.COURSE, query.get('id', ''), studied=state.STUDIED))
            if url.path == '/api/learning/practice':
                return self.json(self.practice_status())
            if url.path == '/api/learning/practice/paper':
                return self.json(learning_practice.paper(state.APPLY, query.get('id', '')))
            if url.path == '/api/learning/daily':
                return self.json(daily_learning.daily())
            if url.path == "/api/overview":
                data = server.overview_json(query.get('days', '14'))
                data['recent'] = dashboard_data.records({'days': data['days'], 'size': 6})['rows']
                data['source'] = {'database': state.database().name,
                                  'updated_at': dt.datetime.now().astimezone().isoformat(timespec='seconds'),
                                  'timezone': dt.datetime.now().astimezone().tzname()}
                try:
                    data['workspace'] = dashboard_data.workspace()
                except (ValueError, OSError) as exc:
                    data['workspace_error'] = str(exc)
                return self.json(data)
            if url.path == "/api/records":
                return self.json(dashboard_data.records(query))
            if url.path == "/api/library":
                return self.json(dashboard_data.artifacts(query if query else None))
            if url.path == "/api/research/learning":
                return self.json(research_learning.summary(query, environment=runner_setup.runtime_environment(state.APPLY, getattr(self.server, 'workspace_owner_email', ''))))
            if url.path == "/api/data":
                return self.json(dashboard_data.inventory(server.files(), query if query else None))
            if url.path == "/api/resume-file":
                path = dashboard_data.resume_file(query.get('file', ''))
                body = path.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header('Content-Type', 'application/pdf')
                disposition = 'inline' if query.get('preview') == '1' else 'attachment'
                self.send_header('Content-Disposition', disposition + '; filename="resume.pdf"; filename*=UTF-8\'\'' + quote(path.name))
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('X-Frame-Options', 'SAMEORIGIN')
                self.end_headers()
                self.wfile.write(body)
                return
            if url.path == "/api/document":
                return self.json(dashboard_data.artifact(query.get('id', '')))
            if url.path == "/api/pipeline":
                day = parse_qs(url.query, keep_blank_values=True).get('date', [None])[-1]
                return self.json(pipeline_status(day, self.server.runner))
            if url.path == "/api/bots":
                return self.json(bots_status(self.server.runner))
            if url.path == "/api/file":
                data = server.file_json(parse_qs(url.query).get("name", [""])[-1])
                data["revision"] = revision(data["text"])
                return self.json(data)
            if url.path.startswith(("/api/", "/course", "/reports/")):
                return super().do_GET()
            assets = ROOT / 'dist' if (ROOT / 'dist' / 'index.html').is_file() else ROOT / 'app'
            return self.file(server.inside(assets, url.path.lstrip("/")))
        except (BrokenPipeError, ConnectionResetError):
            # Navigation can cancel an in-flight learning summary response.
            return
        except ValueError as exc:
            self.error(HTTPStatus.BAD_REQUEST, str(exc))
        except OSError:
            self.error(HTTPStatus.INTERNAL_SERVER_ERROR, "The requested file could not be read.")
        except sqlite3.Error:
            self.error(HTTPStatus.SERVICE_UNAVAILABLE, "The application database could not be read. Try again shortly.")

    def save_research_progress(self, data=None):
        if not self.host_ok() or not self.change_ok():
            return self.error(HTTPStatus.FORBIDDEN, "Only this site can change progress.")
        try:
            if data is None:
                data = self.body()
            return self.json(research_learning.mark(str(data.get('id', '')), data.get('read', True)))
        except server.ApiError as exc:
            return self.error(exc.status, str(exc))
        except ValueError as exc:
            return self.error(HTTPStatus.BAD_REQUEST, str(exc))
        except OSError:
            return self.error(HTTPStatus.INTERNAL_SERVER_ERROR, "Progress could not be saved. Please retry.")

    def do_POST(self):
        if self.account_request():
            return
        path = urlsplit(self.path).path
        if path == '/api/learning/collection':
            if not self.host_ok() or not self.change_ok() or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                return self.error(403, 'Only this dashboard can update your learning workspace.')
            try:
                return self.json(learning_workspace.update(self.body()))
            except (ValueError, server.ApiError) as exc:
                return self.error(400, str(exc))
            except OSError:
                return self.error(503, 'Your learning workspace could not be saved. Please retry.')
        if path.startswith('/api/learning/code/'):
            return self.coding_request(path)
        if path.startswith('/api/learning/practice/'):
            return self.practice_request(path)
        if path == '/api/learning/dsa/problem':
            if not self.host_ok() or not self.change_ok() or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                return self.error(403, 'Only this dashboard can update practice progress.')
            try:
                return self.json(daily_dsa.update_problem(state.APPLY, state.COURSE, self.body(), studied=state.STUDIED))
            except (ValueError, server.ApiError) as exc:
                return self.error(400, str(exc))
            except OSError:
                return self.error(503, 'Practice progress could not be saved. Please retry.')
        if urlsplit(self.path).path == '/api/learning/dsa':
            if not self.change_ok() or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                return self.error(403, 'Only this dashboard can update your learning progress.')
            try:
                return self.json(daily_dsa.update(state.APPLY, state.COURSE, self.body(), studied=state.STUDIED))
            except daily_dsa.Conflict as exc:
                return self.error(409, str(exc))
            except (ValueError, server.ApiError) as exc:
                return self.error(400, str(exc))
            except OSError:
                return self.error(503, 'Your learning progress could not be saved. Please retry.')
        if urlsplit(self.path).path == "/api/research/read":
            return self.save_research_progress()
        if urlsplit(self.path).path != "/api/file":
            return super().do_POST()
        if not self.host_ok() or not self.change_ok():
            return self.error(HTTPStatus.FORBIDDEN, "Only this site can change files.")
        try:
            data = self.body()
            path = server.files().get(data.get("name", ""))
            if path is None or not isinstance(data.get("text"), str):
                raise ValueError("Choose an editable file and send its text.")
            with self.server.file_lock:
                original = path.read_text() if path.exists() else ""
                if data.get("revision") != revision(original):
                    return self.error(HTTPStatus.CONFLICT, "This file changed since you opened it. Reload before saving; your draft is still available.")
                backup = state.APPLY / paths.user_dir() / "inputs" / "backups"
                backup.mkdir(parents=True, exist_ok=True)
                if path.exists():
                    target = backup / f"dashboard-{data['name']}-{dt.datetime.now():%Y%m%d-%H%M%S-%f}.bak"
                    user_repo.write_private(target, original.encode("utf-8"))
                path.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False, encoding="utf-8") as temp:
                    temp.write(data["text"])
                os.replace(temp.name, path)
            self.json({"ok": True, "revision": revision(data["text"])})
        except (ValueError, server.ApiError) as exc:
            self.error(HTTPStatus.BAD_REQUEST, str(exc))
        except OSError:
            self.error(HTTPStatus.INTERNAL_SERVER_ERROR, "The file could not be saved. Your draft has been kept.")


    def do_PUT(self):
        if not self.account_request():
            self.error(404, "Endpoint not found")

    do_PATCH = do_PUT
    do_DELETE = do_PUT


class DashboardServer(server.ControlServer):
    def __init__(self, port, account_url=None):
        import threading
        super().__init__(port)
        self.RequestHandlerClass = DashboardHandler
        self.file_lock = threading.Lock()
        self.practice_lock = threading.Lock()
        self.code_slots = threading.BoundedSemaphore(2)
        self.practice_root, self.practice_course = state.APPLY, state.COURSE
        self.practice_stop = threading.Event()
        paths.browser_home(state.APPLY)
        self.connections = ConnectionService(state.APPLY, self.runner)
        self.local_setup = LocalSetup(state.APPLY, self.runner)
        self.runner.start_guard = self.connections.blocks_command
        self.account_bridge = None
        self.workspace_owner_email = os.getenv("MORROW_WORKSPACE_OWNER_EMAIL", "") if account_url else ""
        self.runner.environment_provider = lambda command, action: (runner_setup.runtime_environment(state.APPLY, self.workspace_owner_email)
                                                                   if account_url else self.local_setup.runtime_environment())
        if account_url:
            from auth_bridge import AccountBridge
            self.account_bridge = AccountBridge(account_url)
        self.practice_thread = threading.Thread(target=self._prepare_daily_practice, name='daily-practice', daemon=True)
        self.practice_thread.start()

    def practice_status(self):
        snapshot = self.runner.snapshot()
        learning_practice.reconcile_jobs(self.practice_root, snapshot)
        result = learning_practice.status(self.practice_root, self.practice_course)
        runs = snapshot.get('runs', [])
        for mode in ('daily', 'weekly'):
            active = next((run for run in runs if run.get('action') == 'learning-practice' and run.get('running')
                           and f'--generate {mode}' in run.get('shown', '')), None)
            if active:
                result[mode]['job'] = {**(result[mode].get('job') or {}), 'status': 'running', 'run_id': active.get('id')}
        return result

    def start_practice(self, mode, automatic=False):
        if mode not in ('daily', 'weekly'):
            raise ValueError('Choose daily practice or the weekly exam.')
        with self.practice_lock:
            current = self.practice_status()
            target, job = current[mode], current[mode].get('job') or {}
            skipped = {'started': False, 'run_id': job.get('run_id'), 'status': current}
            if self.practice_stop.is_set() or job.get('status') in ('running', 'queued'):
                return skipped
            if automatic and (not current['settings']['automatic'] or not target['automatic_ready']):
                return skipped
            if not current.get('configured'):
                if automatic:
                    return skipped
                raise LookupError('Connect Claude CLI or Kiro CLI on this computer, then retry AI practice.')
            if not target['needs_generation']:
                return skipped
            command = state.py('AI daily practice' if mode == 'daily' else 'AI weekly exam',
                               str(ROOT / 'learning_practice.py'), '--generate', mode, '--date', current['date'])
            run_id = self.runner.start(command, action='learning-practice', day=current['date'])
            return {'started': True, 'run_id': run_id, 'status': self.practice_status()}

    def _prepare_daily_practice(self):
        # Opt-in persists locally. No timers or agents run after this server closes.
        while not self.practice_stop.is_set():
            try:
                if learning_practice.automatic_enabled(self.practice_root):
                    self.start_practice('daily', automatic=True)
            except (ValueError, OSError, RuntimeError):
                # Invalid storage is exposed by the normal API. Busy runners retry
                # on the next tick; failed AI jobs require an explicit user retry.
                pass
            self.practice_stop.wait(60)

    def server_close(self):
        if getattr(self, 'local_setup', None) is not None:
            self.local_setup.close()
        if getattr(self, 'practice_stop', None) is not None:
            self.practice_stop.set()
            self.practice_thread.join(timeout=2)
        if getattr(self, 'connections', None) is not None:
            self.connections.shutdown()
        super().server_close()


def register_actions():
    server.ACTIONS.update(boards=board_command, pipeline=pipeline_command)
    server.ACTIONS.update(naukri=commands.naukri_command, profile=commands.profile_command,
                         linkedin_profile=commands.linkedin_profile_command,
                         cold_email=commands.cold_email_command)
    for key in ("profile", "linkedin"):
        server.ACTIONS[key + "_install"] = lambda o, save, key=key: schedule_command(key, "enable")
        server.ACTIONS[key + "_disable"] = lambda o, save, key=key: schedule_command(key, "disable")


def launch_options(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8100)
    parser.add_argument("--mode", choices=("beta", "accounts"), default=os.getenv("MORROW_MODE", "beta"),
                        help="beta opens all local tools without sign-in (default); accounts enables the account service")
    args = parser.parse_args(argv)
    if args.mode not in ("beta", "accounts"):
        parser.error("MORROW_MODE must be beta or accounts")
    args.account_url = None
    if args.mode == "accounts":
        args.account_url = os.getenv("MORROW_API_URL", "http://127.0.0.1:8200").strip()
        if not args.account_url:
            parser.error("MORROW_API_URL is required in accounts mode")
    return args


def main():
    import signal

    args = launch_options()
    register_actions()
    try:
        app = DashboardServer(args.port, args.account_url)
    except (OSError, ValueError) as exc:
        raise SystemExit(f"Cannot start dashboard on port {args.port}: {exc}") from exc
    print(f"Morrow ({'free beta' if args.mode == 'beta' else 'accounts'}): http://127.0.0.1:{args.port}", flush=True)
    stopping = False
    previous_handlers = {}

    def stop(signum, frame):
        nonlocal stopping
        if not stopping:
            stopping = True
            raise KeyboardInterrupt

    try:
        # A process-group signal and the Node launcher's forwarded signal can
        # both arrive. The first starts cleanup; repeats must not interrupt it.
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous_handlers[signum] = signal.signal(signum, stop)
        app.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stopping = True
        try:
            app.runner.shutdown()
        finally:
            try:
                app.server_close()
            finally:
                for signum, handler in previous_handlers.items():
                    signal.signal(signum, handler)


if __name__ == "__main__":
    main()
