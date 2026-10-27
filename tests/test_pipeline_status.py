"""Flow recovery uses temporary checkpoints and synthetic process snapshots."""
import datetime as dt
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
sys.path.insert(0, str(Path(__file__).parents[2]))
import commands
import pipeline_status as flow
from test_server import app, request

NOW = dt.datetime(2026, 10, 24, 12, 0, tzinfo=dt.timezone.utc)
DAY = "2026-10-23"


def checkpoint(tmp_path, entry, **days):
    path = tmp_path / "user/memory" / "progress.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"days": {DAY: entry, **days}}))
    return path


def read(tmp_path, snapshot=None, **kwargs):
    return flow.read_status(tmp_path, DAY, snapshot, now=NOW, pid_alive=lambda pid: pid == 42, **kwargs)


def running(name="learn", day=DAY, **extra):
    return {"id": "run-1", "action": "pipeline", "running": True,
            "shown": f"python -m pipeline continue --date {day} --only {name}",
            "resources": ["pipeline:writer", f"stage:{name}"], **extra}


def test_selected_date_is_ordered_read_only_and_resume_skips_completed(tmp_path):
    (tmp_path / "complete.md").write_text("A complete result")
    original = checkpoint(tmp_path, {
        "plan": ["learn", "brief:papers", "apply:naukri"],
        "run_options": {"cli": "kiro", "agents": 2, "bots": 1, "containers": False},
        "stages": {"apply:naukri": {"status": "pending"},
                   "learn": {"status": "done", "outputs": ["complete.md"]},
                   "brief:papers": {"status": "failed", "detail": "CLI request timed out", "attempts": 1}}},
        **{"2026-10-22": {"stages": {"learn": {"status": "done"}}}})
    before = original.read_bytes(), original.stat().st_mtime_ns
    data = read(tmp_path)
    assert data["date"] == DAY
    assert [stage["name"] for stage in data["stages"]] == ["learn", "brief:papers", "apply:naukri"]
    assert data["available_dates"] == ["2026-10-24", DAY, "2026-10-22"]
    assert data["summary"] == {"total": 3, "completed": 1, "running": 0, "pending": 1,
                               "remaining": 2, "attention": 1, "no_recent_update": 0, "active": False}
    options = data["resume"]["options"]
    assert options == {"command": "continue", "date": DAY, "groups": ["brief:papers", "apply:naukri"],
                       "dry_run": False, "cli": "kiro", "agents": 2, "bots": 1, "containers": False}
    command = commands.pipeline_command(options)
    assert command.argv.count("--only") == 2 and "learn" not in command.argv
    assert "--fresh" not in command.argv and "--redo" not in command.argv
    assert original.read_bytes() == before[0] and original.stat().st_mtime_ns == before[1]


@pytest.mark.parametrize("day", ["20261023", "2026-10-3", "2026-02-30", "../progress", "", "2026-W42-4", " 2026-10-23"])
def test_date_is_strict_and_calendar_valid(tmp_path, day):
    with pytest.raises(ValueError, match="date"):
        flow.read_status(tmp_path, day)
    if day and day == day.strip():
        with pytest.raises(ValueError, match="date"):
            commands.pipeline_command({"date": day})


def test_missing_checkpoint_has_no_invented_steps_and_never_creates_file(tmp_path):
    data = read(tmp_path)
    assert data["status"] == "not started" and data["stages"] == []
    assert data["latest_error"] is None and data["resume"]["available"] is False
    assert data["watch"] and not (tmp_path / "user/memory").exists()


def test_http_date_query_selects_the_checkpoint_and_rejects_empty_or_invalid_dates(app):
    checkpoint(app[1].parent, {"stages": {"learn": {"status": "failed", "detail": "Synthetic failure"}}})
    status, data = request(app, "GET", f"/api/pipeline?date={DAY}")
    assert status == 200 and data["date"] == DAY and data["stages"][0]["state"] == "failed"
    assert request(app, "GET", "/api/pipeline?date=")[0] == 400
    assert request(app, "GET", "/api/pipeline?date=2026-02-30")[0] == 400
    assert request(app, "GET", "/api/pipeline?date=20261023")[0] == 400


@pytest.mark.parametrize("payload", [[], {"days": []}, {"days": {DAY: []}},
                                    {"days": {DAY: {"stages": {"learn": []}}}}])
def test_invalid_checkpoint_is_reported_without_replacing_it(tmp_path, payload):
    path = checkpoint(tmp_path, {})
    path.write_text(json.dumps(payload))
    before = path.read_bytes()
    with pytest.raises(ValueError, match="checkpoint could not be read"):
        read(tmp_path)
    assert path.read_bytes() == before


def test_stale_running_without_owner_is_interrupted_not_live(tmp_path):
    checkpoint(tmp_path, {"stages": {"learn": {"status": "running", "at": NOW.isoformat()}}})
    data = read(tmp_path)
    step = data["stages"][0]
    assert step["status"] == "running" and step["state"] == "interrupted"
    assert not step["running"] and step["retry"]["available"] and data["resume"]["available"]
    assert "no active process could be confirmed" in step["attention"]["explanation"]


def test_live_external_owner_can_be_quiet_but_never_retriable(tmp_path):
    checkpoint(tmp_path, {"stages": {"learn": {"status": "running", "owner_pid": 42,
                                               "at": "2026-10-23T11:00:00Z"}}})
    data = read(tmp_path)
    step = data["stages"][0]
    assert step["state"] == "running" and step["running"]
    assert step["attention"]["title"] == "No recent update"
    assert "does not mean it is stuck" in step["attention"]["explanation"]
    assert not step["retry"]["available"] and not data["resume"]["available"]
    assert data["summary"]["no_recent_update"] == 1 and data["summary"]["attention"] == 0


def test_runner_resources_confirm_only_the_right_stage_and_day(tmp_path):
    checkpoint(tmp_path, {"stages": {"learn": {"status": "running"}, "brief:papers": {"status": "running"}}})
    data = read(tmp_path, {"runs": [running(), running("brief:papers", day="2026-10-24")]})
    assert [step["state"] for step in data["stages"]] == ["running", "interrupted"]
    assert data["stages"][0]["run_ids"] == ["run-1"]
    assert not data["resume"]["available"]


def test_queued_checkpoint_is_not_presented_as_executing(tmp_path):
    checkpoint(tmp_path, {"stages": {"learn": {"status": "pending"}}})
    data = read(tmp_path, {"runs": [running()]})
    assert data["summary"]["active"] and data["summary"]["running"] == 0
    assert data["stages"][0]["queued"] and not data["stages"][0]["running"]
    assert not data["stages"][0]["retry"]["available"]


def test_practice_run_does_not_make_a_stale_checkpoint_live(tmp_path):
    checkpoint(tmp_path, {"stages": {"learn": {"status": "running"}}})
    run = running()
    run["shown"] += " --dry-run"
    data = read(tmp_path, {"runs": [run]})
    assert data["stages"][0]["state"] == "interrupted"
    assert not data["stages"][0]["retry"]["available"] and data["summary"]["active"]


def test_new_reservation_does_not_revive_a_dead_stage_owner(tmp_path):
    checkpoint(tmp_path, {"stages": {"learn": {"status": "running", "owner_pid": 19,
                                               "at": "2026-10-23T08:00:00Z"}}})
    data = read(tmp_path, {"runs": [running(started_at="2026-10-23T10:00:00Z")]})
    stage = data["stages"][0]
    assert stage["state"] == "interrupted" and not stage["running"] and stage["queued"]
    assert data["summary"]["running"] == 0 and data["summary"]["active"]
    assert not stage["retry"]["available"] and not data["resume"]["available"]


@pytest.mark.parametrize("checkpoint_at,expected", [
    ("2026-10-23T08:00:00Z", "interrupted"),
    ("2026-10-23T10:00:00Z", "running"),
])
def test_legacy_ownerless_checkpoint_must_belong_to_current_reserved_run(tmp_path, checkpoint_at, expected):
    checkpoint(tmp_path, {"stages": {"learn": {"status": "running", "at": checkpoint_at}}})
    data = read(tmp_path, {"runs": [running(started_at="2026-10-23T10:00:00.500Z")]})
    stage = data["stages"][0]
    assert stage["state"] == expected and stage["running"] == (expected == "running")
    assert stage["queued"] == (expected == "interrupted")


def test_missing_outputs_reopen_completed_step_without_mutation(tmp_path):
    path = checkpoint(tmp_path, {"status": "done", "stages": {"learn": {"status": "done", "outputs": ["gone.md"]}}})
    before = path.read_text()
    data = read(tmp_path)
    assert data["status"] == "in progress" and data["summary"]["completed"] == 0
    assert data["stages"][0]["state"] == "missing_output" and data["stages"][0]["missing_outputs"] == 1
    assert data["resume"]["options"]["groups"] == ["learn"]
    assert path.read_text() == before


def test_last_error_survives_active_retry_and_success_resolution(tmp_path):
    entry = {"stages": {"learn": {"status": "running", "owner_pid": 42, "detail": "",
                                    "last_error": {"message": "kiro authentication expired", "at": "2026-10-23T10:00:00Z", "exit_code": 2}},
                        "brief:papers": {"status": "done", "last_error": {"message": "old network failure", "at": "2026-10-22T10:00:00Z", "resolved_at": "2026-10-23T09:00:00Z"}}}}
    checkpoint(tmp_path, entry)
    data = read(tmp_path)
    assert data["latest_error"]["stage"] == "learn" and data["latest_error"]["attention"]["kind"] == "ai_auth"
    assert data["stages"][1]["last_error"]["resolved_at"] == "2026-10-23T09:00:00Z"
    entry["stages"]["learn"].update(status="done")
    entry["stages"]["learn"]["last_error"]["resolved_at"] = "2026-10-24T11:00:00Z"
    checkpoint(tmp_path, entry)
    resolved = read(tmp_path)
    assert resolved["latest_error"]["resolved_at"] == "2026-10-24T11:00:00Z"
    assert resolved["summary"]["attention"] == 0


@pytest.mark.parametrize("message,kind", [
    ("Site shows a captcha at sign-in", "human_check"), ("OTP required", "human_check"),
    ("Claude usage limit reached", "usage_limit"), ("kiro-cli authentication expired", "ai_auth"),
    ("Site is signed out", "sign_in"), ("No such file: resume.pdf", "file"),
    ("Could not load settings: malformed YAML", "configuration"),
    ("Connection timed out", "connection"), ("exit 1", "failed"),
])
def test_error_guidance_is_specific_and_uses_only_local_routes(message, kind):
    guidance = flow.attention_for(message)
    assert guidance["kind"] == kind and len(guidance["steps"]) >= 2
    if guidance.get("action"):
        assert guidance["action"]["href"] in ("#/setup", "#/files", "#/connections")


def test_legacy_errors_are_redacted_before_display(tmp_path, monkeypatch):
    secret = "synthetic-password-do-not-expose"
    monkeypatch.setenv("GOOGLE_PASSWORD", secret)
    checkpoint(tmp_path, {"stages": {"learn": {"status": "failed", "detail": f"password={secret} authentication failed"}}})
    data = read(tmp_path)
    assert secret not in json.dumps(data)
    assert data["latest_error"]["message"]


def test_stage_retry_uses_its_saved_settings_without_overwriting_day_options(tmp_path):
    checkpoint(tmp_path, {"run_options": {"cli": "claude", "agents": 3, "bots": 2, "containers": False},
                          "stages": {"learn": {"status": "failed", "run_options": {"cli": "kiro", "agents": 1, "bots": 2, "containers": True}}}})
    data = read(tmp_path)
    assert data["resume"]["options"]["cli"] == "claude"
    retry = data["stages"][0]["retry"]["options"]
    assert retry["cli"] == "kiro" and retry["containers"] and "bots" not in retry
    assert "--containers" in commands.pipeline_command(retry).argv


@pytest.mark.parametrize("options", [
    {"groups": []}, {"groups": "learn"}, {"groups": ["apply"]}, {"groups": ["learn", "learn"]},
    {"groups": ["learn", "--shell"]}, {"groups": ["learn"], "group": "brief"},
    {"groups": ["learn"], "fresh": True}, {"groups": ["learn"], "redo": True},
    {"groups": ["learn"], "command": "run"}, {"groups": [1]},
])
def test_exact_resume_stage_selection_is_bounded(options):
    with pytest.raises(ValueError):
        commands.pipeline_command(options)


def test_unknown_saved_stage_cannot_silently_expand_to_the_full_workflow(tmp_path):
    checkpoint(tmp_path, {"stages": {"retired:stage": {"status": "failed"}}})
    data = read(tmp_path)
    assert not data["resume"]["available"] and data["resume"]["options"] is None
    assert not data["stages"][0]["retry"]["available"]


def test_startup_failure_before_checkpoint_is_visible_without_invented_stage(tmp_path):
    failed = running(status="failed", exit=2, finished="2026-10-23T11:00:00Z")
    failed["running"] = False
    data = read(tmp_path, {"runs": [failed]})
    assert data["stages"] == [] and data["latest_error"]["stage"] == "workflow"
    assert "code 2" in data["latest_error"]["message"] and data["latest_error"]["run_id"] == "run-1"


def test_new_startup_error_is_not_hidden_by_old_stage_error(tmp_path):
    checkpoint(tmp_path, {"stages": {"learn": {"status": "failed", "detail": "older failure", "at": "2026-10-23T08:00:00Z"}}})
    failed = running(status="failed", exit=1, started_at="2026-10-23T10:00:00Z", finished="2026-10-23T11:00:00Z")
    failed["running"] = False
    data = read(tmp_path, {"runs": [failed], "lines": [[1, "ERROR Could not load settings: malformed YAML", "run-1"],
                                                       [2, "ERROR irrelevant other run", "other-run"]]})
    assert data["latest_error"]["stage"] == "workflow"
    assert "malformed YAML" in data["latest_error"]["message"]
    assert data["latest_error"]["attention"]["kind"] == "configuration"
    assert "irrelevant" not in data["latest_error"]["message"]


def test_later_successful_relevant_run_resolves_startup_failure(tmp_path):
    failed = running(status="failed", exit=1, started_at="2026-10-23T09:00:00Z", finished="2026-10-23T10:00:00Z")
    failed["running"] = False
    success = running(status="completed", exit=0, started_at="2026-10-23T11:00:00Z", finished="2026-10-23T12:00:00Z", id="recovered")
    success["running"] = False
    data = read(tmp_path, {"runs": [failed, success]})
    assert data["latest_error"]["run_id"] == "run-1"
    assert data["latest_error"]["resolved_at"] == "2026-10-23T12:00:00Z"


@pytest.mark.parametrize("variation", ["unrelated_stage", "wrong_day", "practice", "status", "check", "earlier", "stopped", "partial"])
def test_unrelated_or_incomplete_success_does_not_resolve_startup_failure(tmp_path, variation):
    failed = running(status="failed", exit=1, started_at="2026-10-23T09:00:00Z", finished="2026-10-23T10:00:00Z")
    failed["running"] = False
    success = running(status="completed", exit=0, started_at="2026-10-23T11:00:00Z", finished="2026-10-23T12:00:00Z", id="other")
    success["running"] = False
    if variation == "unrelated_stage":
        success.update(resources=["stage:brief:papers"], shown=f"python -m pipeline continue --date {DAY} --only brief:papers")
    elif variation == "wrong_day":
        success["shown"] = "python -m pipeline continue --date 2026-10-24 --only learn"
    elif variation == "practice":
        success["shown"] += " --dry-run"
    elif variation in ("status", "check"):
        success["shown"] = f"python -m pipeline {variation} --date {DAY}"
    elif variation == "earlier":
        success.update(started_at="2026-10-23T07:00:00Z", finished="2026-10-23T08:00:00Z")
    elif variation == "stopped":
        success["stopped"] = True
    elif variation == "partial":
        failed["resources"].append("stage:brief:papers")
    data = read(tmp_path, {"runs": [failed, success]})
    assert "resolved_at" not in data["latest_error"]
