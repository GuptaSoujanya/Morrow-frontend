"""Private setup snapshots and runner handoff; all inputs/processes synthetic."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import shutil
import threading
from types import SimpleNamespace

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parents[1]))
sys.path.insert(0, str(Path(__file__).parents[2]))
sys.path.insert(0, str(Path(__file__).parents[2] / "tests"))
from pdf_helpers import pdf_bytes
import runner_setup as runner_inputs
from web.runner import BatchCommand, Runner
from web.state import Command
from test_server import app, request

OWNER = {"tenant_id": "20000000-0000-0000-0000-000000000001", "id": "10000000-0000-0000-0000-000000000001", "email": "owner@example.com", "role": "admin"}
USER = {"tenant_id": "20000000-0000-0000-0000-000000000002", "id": "10000000-0000-0000-0000-000000000002", "email": "user@example.com", "role": "user"}
PDF = pdf_bytes()
EXPECTED = {"version": 2, "profile_version": 3}


@pytest.fixture(autouse=True)
def synthetic_pdf_reader(monkeypatch):
    # Snapshot/auth tests focus on boundaries. The integration case below
    # restores Poppler and verifies a real synthetic PDF end to end.
    monkeypatch.setattr(runner_inputs, "extract_pdf_text", lambda content: "Synthetic Person - Python engineer")


def setup():
    return {"version": 2, "profile": {"version": 3, "data": {"full_name": "Synthetic Person", "email": OWNER["email"], "_internal": "omit"}},
            "resume": {"id": "30000000-0000-0000-0000-000000000001", "filename": "my-resume.pdf", "sha256": hashlib.sha256(PDF).hexdigest()},
            "readiness": {"profile_complete": True, "resume_ready": True}}


def sync(tmp_path, runner=None, user=OWNER, owner=True, data=None, content=PDF, expected=None):
    return runner_inputs.sync_inputs(tmp_path, runner or Runner(), user, owner, data or setup(), content, EXPECTED if expected is None else expected)


def test_owner_snapshot_is_private_immutable_and_selected_for_runtime(tmp_path):
    original = tmp_path / "data/inputs/profile.yaml"
    original.parent.mkdir(parents=True)
    original.write_text("full_name: Original untouched\n")
    result = sync(tmp_path)
    env = runner_inputs.runtime_environment(tmp_path, OWNER["email"])
    profile, resume = Path(env["PROFILE_PATH"]), Path(env["RESUME_PATH"])
    assert result["saved"] and result["automation_available"]
    assert profile.parent == resume.parent
    assert profile.parent.name != "current"
    assert yaml.safe_load(profile.read_text()) == {"full_name": "Synthetic Person", "email": OWNER["email"]}
    assert resume.read_bytes() == PDF
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in (profile, resume))
    assert profile.parent.stat().st_mode & 0o777 == 0o700
    assert original.read_text() == "full_name: Original untouched\n"
    changed = setup()
    changed["profile"]["data"]["full_name"] = "Updated Person"
    sync(tmp_path, data=changed)
    assert runner_inputs.runtime_environment(tmp_path, OWNER["email"])["PROFILE_PATH"] != str(profile)
    assert yaml.safe_load(profile.read_text())["full_name"] == "Synthetic Person"


def test_other_user_cannot_select_shared_runner_inputs(tmp_path):
    sync(tmp_path)
    owner_env = runner_inputs.runtime_environment(tmp_path, OWNER["email"])
    result = sync(tmp_path, user=USER, owner=False)
    assert result["saved"] and not result["automation_available"]
    assert runner_inputs.runtime_environment(tmp_path, OWNER["email"]) == owner_env
    assert runner_inputs.runtime_environment(tmp_path, USER["email"]) == {}
    assert (tmp_path / "data/private/runner" / USER["tenant_id"] / "current.json").is_file()


def test_active_owner_job_blocks_switch_but_nonowner_can_save_private_snapshot(tmp_path):
    runner = Runner()
    runner.runs["synthetic"] = SimpleNamespace(result=None)
    with pytest.raises(runner_inputs.SetupError, match="workflow is running"):
        sync(tmp_path, runner=runner)
    assert list(tmp_path.iterdir()) == []
    assert sync(tmp_path, runner=runner, user=USER, owner=False)["saved"]
    assert not (tmp_path / "data/private/runner/active-owner.json").exists()


@pytest.mark.parametrize("expected,status", [({}, 400), ({"version": 1, "profile_version": 3}, 409),
    ({"version": 2, "profile_version": 1}, 409), ({"version": 2, "profile_version": 3, "tenant": OWNER["tenant_id"]}, 400),
    ({"version": True, "profile_version": 3}, 400), ({"version": "2", "profile_version": 3}, 400)])
def test_version_and_payload_rejections_do_not_write_files(tmp_path, expected, status):
    with pytest.raises(runner_inputs.SetupError) as caught:
        sync(tmp_path, expected=expected)
    assert caught.value.status == status
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("content", [b"not-pdf", PDF + b"changed", b"%PDF-" + b"X" * (10 * 1024 * 1024)], ids=["not-pdf", "changed-hash", "oversized"])
def test_hash_type_and_size_validation_prevent_wrong_resume(tmp_path, content):
    with pytest.raises(runner_inputs.SetupError, match="resume could not be verified"):
        sync(tmp_path, content=content)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("missing", ["profile_complete", "resume_ready"])
def test_incomplete_setup_cannot_activate_runner(tmp_path, missing):
    data = setup()
    data["readiness"][missing] = False
    with pytest.raises(runner_inputs.SetupError, match="Complete your profile"):
        sync(tmp_path, data=data)


@pytest.mark.parametrize("bad", ["../other", "/tmp/other", "not-a-uuid"])
def test_client_identity_never_becomes_a_path(tmp_path, bad):
    with pytest.raises(runner_inputs.SetupError) as caught:
        sync(tmp_path, user={**OWNER, "tenant_id": bad})
    assert caught.value.status == 403
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("part", ["data", "data/private", "data/private/runner", "data/private/runner/" + OWNER["tenant_id"]])
def test_input_symlinks_cannot_escape_private_workspace(tmp_path, part):
    outside = tmp_path / "other-location"
    outside.mkdir()
    alias = tmp_path / part
    alias.parent.mkdir(parents=True, exist_ok=True)
    alias.symlink_to(outside, target_is_directory=True)
    with pytest.raises(runner_inputs.SetupError, match="symbolic"):
        sync(tmp_path)
    assert list(outside.iterdir()) == []


@pytest.mark.parametrize("part", ["manifest", "tenant", "snapshot", "profile", "resume"])
def test_runtime_rejects_symlink_replacement_after_setup(tmp_path, part):
    sync(tmp_path)
    env = runner_inputs.runtime_environment(tmp_path, OWNER["email"])
    profile = Path(env["PROFILE_PATH"])
    paths = {"manifest": tmp_path / "data/private/runner/active-owner.json", "tenant": profile.parent.parent,
             "snapshot": profile.parent, "profile": profile, "resume": Path(env["RESUME_PATH"])}
    selected = paths[part]
    replacement = selected.with_name(selected.name + "-saved")
    selected.rename(replacement)
    selected.symlink_to(replacement, target_is_directory=replacement.is_dir())
    with pytest.raises(RuntimeError, match="inputs are unavailable"):
        runner_inputs.runtime_environment(tmp_path, OWNER["email"])


@pytest.mark.parametrize("field", ["tenant", "snapshot"])
def test_runtime_manifest_traversal_cannot_select_another_path(tmp_path, field):
    sync(tmp_path)
    manifest = tmp_path / "data/private/runner/active-owner.json"
    value = json.loads(manifest.read_text())
    value[field] = "../../other-user"
    manifest.write_text(json.dumps(value))
    with pytest.raises(RuntimeError, match="inputs are unavailable"):
        runner_inputs.runtime_environment(tmp_path, OWNER["email"])


@pytest.fixture
def mocked_runner(monkeypatch):
    from web import runner as module
    calls = []
    runner = Runner()
    monkeypatch.setattr(module.subprocess, "Popen", lambda *args, **kwargs: calls.append((args, kwargs)) or SimpleNamespace(pid=99999999))
    monkeypatch.setattr(runner, "_follow", lambda run: None)
    return runner, calls


def test_runner_guard_and_environment_are_evaluated_inside_same_lock(mocked_runner):
    runner, calls = mocked_runner
    observed = []
    def guard(command, action):
        observed.append(("guard", action, runner.lock._is_owned()))
        return ""
    def environment(command, action):
        observed.append(("environment", action, runner.lock._is_owned()))
        return {"PROFILE_PATH": "/synthetic/private/profile.yaml", "RESUME_PATH": "/synthetic/private/resume.pdf"}
    runner.start_guard = guard
    runner.environment_provider = environment
    command = Command("Synthetic", ("never-executed",), (("HEADLESS", "true"),))
    runner.start(command, "naukri")
    assert observed == [("guard", "naukri", True), ("environment", "naukri", True)]
    assert calls[0][1]["env"]["PROFILE_PATH"] == "/synthetic/private/profile.yaml"
    assert calls[0][1]["env"]["HEADLESS"] == "true"
    assert len(calls) == 1


def test_guard_blocks_single_and_batch_before_process_creation(mocked_runner):
    runner, calls = mocked_runner
    runner.start_guard = lambda command, action: "Close the sign-in browser"
    command = Command("Synthetic", ("never-executed",))
    with pytest.raises(RuntimeError, match="Close the sign-in"):
        runner.start(command, "naukri")
    plan = runner.batch_plan([BatchCommand("one", "naukri", command)])
    assert not plan["ready"] and "Close the sign-in" in plan["conflicts"][0]["message"]
    result = runner.start_batch([BatchCommand("one", "naukri", command)])
    assert not result["ok"] and calls == []


def test_environment_failure_launches_nothing_and_does_not_create_run(mocked_runner):
    runner, calls = mocked_runner
    def unavailable(*_):
        raise RuntimeError("Review setup before running")
    runner.environment_provider = unavailable
    command = Command("Synthetic", ("never-executed",))
    with pytest.raises(RuntimeError, match="Review setup"):
        runner.start(command, "naukri")
    result = runner.start_batch([BatchCommand("one", "naukri", command)])
    assert not result["ok"] and not result["results"][0]["ok"]
    assert calls == [] and runner.runs == {}


class Bridge:
    def __init__(self, user=OWNER, owner=True):
        self.user, self.owner = user, owner
        self.calls = []
        self.setup = setup()
        self.artifact_status = 200
    def identity(self, handler):
        return self.user
    def is_owner(self, handler, user):
        return self.owner
    def json_request(self, handler, path):
        self.calls.append(path)
        assert path == "/api/v1/onboarding"
        return copy.deepcopy(self.setup)
    def request(self, handler, path):
        self.calls.append(path)
        assert path == "/api/v1/artifacts/" + self.setup["resume"]["id"] + "/content"
        return self.artifact_status, [], PDF


def test_runner_setup_http_downloads_only_current_accounts_selected_artifact(app):
    bridge = Bridge()
    app[0].account_bridge = bridge
    status, result = request(app, "POST", "/api/runner/setup", EXPECTED)
    assert status == 200 and result["automation_available"]
    assert bridge.calls == ["/api/v1/onboarding", "/api/v1/artifacts/30000000-0000-0000-0000-000000000001/content"]
    assert runner_inputs.runtime_environment(app[1].parent, OWNER["email"])


def test_runner_setup_http_ordinary_account_cannot_activate_legacy_worker(app):
    app[0].account_bridge = Bridge(USER, False)
    status, result = request(app, "POST", "/api/runner/setup", EXPECTED)
    assert status == 200 and not result["automation_available"]
    assert not (app[1].parent / "data/private/runner/active-owner.json").exists()
    assert request(app, "POST", "/api/run", {"action": "naukri", "options": {}})[0] == 403


def test_runner_setup_http_rejects_signedout_cross_origin_and_deleted_artifacts(app):
    bridge = Bridge(None, False)
    app[0].account_bridge = bridge
    assert request(app, "POST", "/api/runner/setup", EXPECTED)[0] == 401
    bridge.user, bridge.owner = OWNER, True
    assert request(app, "POST", "/api/runner/setup", EXPECTED, {"Origin": "https://other.example"})[0] == 403
    assert request(app, "POST", "/api/runner/setup", EXPECTED, {"Sec-Fetch-Site": "cross-site"})[0] == 403
    assert request(app, "GET", "/api/runner/setup")[0] == 405
    assert bridge.calls == []
    bridge.artifact_status = 404
    assert request(app, "POST", "/api/runner/setup", EXPECTED)[0] == 409
    assert not (app[1].parent / "data/private/runner").exists()


def test_real_pdf_setup_handoff_and_scanned_replacement_leave_active_snapshot_intact(tmp_path, monkeypatch):
    if not shutil.which("pdftotext"):
        pytest.skip("Poppler is required for PDF integration tests")
    from common import profile, resume
    from common.models import Settings
    monkeypatch.setattr(runner_inputs, "extract_pdf_text", profile.extract_pdf_text)
    sync(tmp_path)
    active = runner_inputs.runtime_environment(tmp_path, OWNER["email"])
    settings = Settings(profile_path=active["PROFILE_PATH"], resume_path=active["RESUME_PATH"])
    assert "Python" in profile.load_profile(settings).resume_text
    assert resume.build_base_pdf(settings).read_bytes() == PDF
    scanned = pdf_bytes("")
    changed = setup()
    changed["resume"]["sha256"] = hashlib.sha256(scanned).hexdigest()
    with pytest.raises(runner_inputs.SetupError, match="selectable text"):
        sync(tmp_path, data=changed, content=scanned)
    assert runner_inputs.runtime_environment(tmp_path, OWNER["email"]) == active
