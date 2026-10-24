"""Read-only Flow checkpoint projection and bounded recovery suggestions.

Checkpoint state is history, not evidence that a process still runs. Recovery
options are commands for the existing preview/confirmation flow; this module
never starts work or repairs a checkpoint while it is being viewed.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import re
import shlex

import commands
from common.pipeline_diagnostics import sanitize_detail

QUIET_AFTER_SECONDS = 15 * 60
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}\Z")


def valid_day(value):
    if not isinstance(value, str) or not _DATE.fullmatch(value):
        raise ValueError("Use a date in YYYY-MM-DD format.")
    try:
        return dt.date.fromisoformat(value).isoformat()
    except ValueError:
        raise ValueError("Use a valid date in YYYY-MM-DD format.") from None


def _time(value):
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.astimezone() if parsed.tzinfo is None else parsed
    except (TypeError, ValueError, OverflowError):
        return None


def _pid_alive(value):
    # Reject bools and non-positive PIDs: os.kill(0, 0) means a process group.
    if type(value) is not int or value <= 0:
        return False
    try:
        os.kill(value, 0)
        return True
    except PermissionError:
        return True
    except (ProcessLookupError, OSError, OverflowError):
        return False


def attention_for(message, *, kind="failed"):
    """Explain only what the saved diagnostic supports; never invent a fix."""
    text = str(message or "").lower()
    title = "This step needs a closer look"
    explanation = "The step did not finish. The recorded error does not identify a specific fix."
    steps = ["Read the last error and this run's output in Activity.",
             "Fix the reported issue, then retry this step. Completed steps stay saved."]
    action = None
    if kind == "interrupted":
        title = "This step did not finish"
        explanation = "The checkpoint still says running, but no active process could be confirmed. The run may have been stopped or the app restarted."
        steps = ["Check Activity and the bot's browser for any unfinished work.",
                 "Confirm no separate copy is still running, then resume this step."]
    elif kind == "missing_output":
        title = "A saved result is missing"
        explanation = "The step finished earlier, but at least one of its output files is no longer present."
        steps = ["Restore the missing result if you have a copy, or retry this step to recreate it.",
                 "Other completed steps will be skipped when you resume."]
        action = {"label": "Open files", "href": "#/files"}
    elif kind == "no_recent_update":
        title = "No recent update"
        explanation = "The process is still active, but this step has not saved a recent checkpoint. This alone does not mean it is stuck."
        steps = ["Check the current output in Activity and any open bot browser.",
                 "If it is waiting for you, complete that action. Retry only after the current run has stopped."]
    elif re.search(r"captcha|\botp\b|verification code|verify.{0,20}human|human check", text):
        kind, title = "human_check", "Complete the browser check"
        explanation = "The recorded error mentions a CAPTCHA, verification code, or another check that needs you."
        steps = ["Open the bot's browser and complete the site's verification yourself.",
                 "If the run has stopped, use Connections to reopen its browser group. Check the sign-in, close that browser, then retry this step."]
        action = {"label": "Open Connections", "href": "#/connections"}
    elif re.search(r"quota|rate.?limit|usage.?limit|too many requests|\b429\b|credits? exhausted", text):
        kind, title = "usage_limit", "Check the provider limit"
        explanation = "The provider reported a usage or request limit. Retrying immediately may fail again."
        steps = ["Check the provider's stated reset time or available usage.",
                 "Wait until access is available, then retry. Your Morrow plan does not add Claude or Kiro usage."]
    elif re.search(r"claude|kiro|anthropic|ai cli", text) and re.search(r"auth|log.?in|sign.?in|expired|credential|token|not installed|not found", text):
        kind, title = "ai_auth", "Reconnect your AI tool"
        explanation = "The error points to the configured AI tool's installation or authentication."
        steps = ["Check that your selected Claude or Kiro CLI is installed on the computer running the workflow.",
                 "Sign in through that tool using your own account, then retry this step."]
        action = {"label": "Open preferences", "href": "#/setup"}
    elif re.search(r"sign.?in|signed out|log.?in|session expired|authentication|unauthorized|\b401\b|password", text):
        kind, title = "sign_in", "Restore the site's sign-in"
        explanation = "The recorded error points to an expired or missing session for the site used by this step."
        steps = ["After the current run stops, open Connections and choose the browser group used by this step.",
                 "Open sign-in for the affected site, complete verification, check the sign-in, then close the browser and retry this step."]
        action = {"label": "Open Connections", "href": "#/connections"}
    elif re.search(r"no such file|file.?not.?found|missing.{0,30}(file|resume)|wrote no|permission denied|permissionerror", text):
        kind, title = "file", "Check the required files"
        explanation = "The error mentions a missing file or a file the workflow could not access."
        steps = ["Check the named file or resume in My profile & files and restore or update it.",
                 "Check access permissions on the computer running the workflow, then retry."]
        action = {"label": "Open files", "href": "#/files"}
    elif re.search(r"configuration|could not load settings|validationerror|invalid.{0,20}(config|setting)|yaml|\.env", text):
        kind, title = "configuration", "Review the workflow settings"
        explanation = "The workflow reported a configuration problem."
        steps = ["Use the recorded message to find the missing or invalid setting.",
                 "Correct that setting in Preferences or the workspace configuration, then retry."]
        action = {"label": "Open preferences", "href": "#/setup"}
    elif re.search(r"timed? ?out|timeout|connection|network|dns|name resolution|\b50[234]\b|unreachable", text):
        kind, title = "connection", "Check the connection"
        explanation = "The recorded error mentions a timeout or a network connection problem."
        steps = ["Check internet access and whether the affected site or provider is responding.",
                 "When it is available again, retry this step. If it repeats, inspect Activity for the exact request."]
    result = {"kind": kind, "title": title, "explanation": explanation, "steps": steps}
    if action:
        result["action"] = action
    return result


def _runs(snapshot, day, today):
    runs = snapshot.get("runs") if isinstance(snapshot.get("runs"), list) else [snapshot]
    result = []
    for run in runs:
        if not isinstance(run, dict) or run.get("action") != "pipeline":
            continue
        try:
            tokens = shlex.split(run.get("shown") or "")
        except ValueError:
            tokens = []
        value = lambda flag: tokens[tokens.index(flag) + 1] if flag in tokens[:-1] else ""
        subcommand = tokens[tokens.index("pipeline") + 1] if "pipeline" in tokens[:-1] else "continue"
        if subcommand in ("status", "check") or "--done" in tokens:
            continue
        started = _time(run.get("started_at"))
        run_day = value("--date") or run.get("day") or (started.astimezone().date().isoformat() if started else today)
        if run_day != day:
            continue
        resources = run.get("resources")
        if isinstance(resources, list):
            names = {item[6:] for item in resources if isinstance(item, str) and item.startswith("stage:")}
        else:
            only = [tokens[i + 1] for i, token in enumerate(tokens[:-1]) if token == "--only"]
            skip = [tokens[i + 1] for i, token in enumerate(tokens[:-1]) if token == "--skip"]
            if subcommand == "learn":
                only = ["learn"]
            hit = lambda name, groups: any(name == group or name.startswith(group + ":") for group in groups)
            names = {name for name in commands.STAGES if (not only or hit(name, only)) and not hit(name, skip)}
        result.append(({**run, "_practice": "--dry-run" in tokens}, names))
    return result


def _options(day, names, saved):
    options = {"command": "continue", "date": day, "groups": names, "dry_run": False}
    if saved is not None:
        if not isinstance(saved, dict):
            raise ValueError("Saved settings could not be read.")
        for key in ("cli", "agents", "bots", "containers"):
            if key in saved:
                options[key] = saved[key]
        if options.get("containers") is True:
            options.pop("bots", None)
        elif "containers" in options and type(options["containers"]) is not bool:
            raise ValueError("Saved container settings could not be read.")
    commands.pipeline_command(options)
    return options


def _recovery(day, names, saved, *, active=False, empty_reason="All recorded steps are complete."):
    result = {"available": False, "reason": "", "options": None,
              "settings_source": "saved" if saved is not None else "defaults"}
    if not names:
        result["reason"] = empty_reason
    elif active:
        result["reason"] = "Wait for the active run to finish or stop it in Activity before resuming."
    else:
        try:
            result["options"] = _options(day, names, saved)
            result["available"] = True
        except (ValueError, TypeError):
            result["reason"] = "The saved stage selection or settings are no longer supported. Review the run settings before starting."
    return result


def read_status(root, selected_day=None, snapshot=None, *, now=None, pid_alive=None):
    root = Path(root)
    now = now or dt.datetime.now().astimezone()
    if now.tzinfo is None:
        now = now.astimezone()
    today = now.date().isoformat()
    day = valid_day(selected_day) if selected_day is not None else today
    path = root / ".memory" / "progress.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        if not isinstance(data, dict) or not isinstance(data.get("days", {}), dict):
            raise ValueError()
        days = data.get("days", {})
        entry = days.get(day, {})
        if not isinstance(entry, dict) or not isinstance(entry.get("stages", {}), dict):
            raise ValueError()
        recorded = entry.get("stages", {})
        plan = entry.get("plan", list(recorded))
        if not isinstance(plan, list) or any(not isinstance(name, str) for name in plan):
            raise ValueError()
        if any(not isinstance(value, dict) for value in recorded.values()):
            raise ValueError()
        if any(not isinstance(value.get("outputs") or [], list)
               or any(not isinstance(output, str) for output in value.get("outputs") or [])
               for value in recorded.values()):
            raise ValueError()
    except (ValueError, OSError):
        raise ValueError("The pipeline checkpoint could not be read. Check .memory/progress.json.") from None
    names = list(dict.fromkeys([*plan, *recorded]))
    snapshot = snapshot or {}
    runs = _runs(snapshot, day, today)
    active_names = set().union(*(stages for run, stages in runs if run.get("running")))
    live_runs = [(run, stages) for run, stages in runs if run.get("running") and not run["_practice"]]
    pid_alive = pid_alive or _pid_alive
    stages, errors = [], []
    for name in names:
        source = recorded.get(name, {})
        raw_status = source.get("status", "pending")
        state = raw_status
        owner_live = raw_status == "running" and pid_alive(source.get("owner_pid"))
        active = name in active_names or owner_live
        updated = _time(source.get("at"))
        # Resources reserve the whole selection, including stages the worker
        # has not reached. A dead recorded owner cannot become live merely
        # because another process has queued the same step for a retry.
        legacy_live = "owner_pid" not in source and any(
            name in resources and (not updated or not _time(run.get("started_at"))
                                   or updated >= _time(run["started_at"]) - dt.timedelta(seconds=1))
            for run, resources in live_runs)
        missing = []
        for output in source.get("outputs") or []:
            if isinstance(output, str):
                target = Path(output)
                try:
                    exists = (target if target.is_absolute() else root / target).exists()
                except OSError:
                    exists = False
                if not exists:
                    missing.append(output)
        if raw_status == "done" and missing:
            state = "missing_output"
        elif raw_status == "running" and not (legacy_live or owner_live):
            state = "interrupted"
        elif raw_status not in ("done", "running", "failed", "pending"):
            state = "interrupted"
        detail = sanitize_detail(source.get("detail", ""))
        error = source.get("last_error")
        if isinstance(error, dict) and error.get("message"):
            error = {key: error[key] for key in ("at", "exit_code", "resolved_at") if key in error}
            error["message"] = sanitize_detail(source["last_error"]["message"])
        elif raw_status == "failed":
            error = {"message": detail or "The step failed without recording an error message.", "at": source.get("at", "")}
        else:
            error = None
        if error:
            errors.append({**error, "stage": name, "attention": attention_for(error["message"])})
        quiet = state == "running" and updated is not None and (now - updated).total_seconds() >= QUIET_AFTER_SECONDS
        attention = attention_for(detail, kind=state) if state in ("failed", "interrupted", "missing_output") else None
        if state == "failed" and error:
            attention = attention_for(error["message"])
        if quiet:
            attention = attention_for("", kind="no_recent_update")
        stage = {"name": name, "status": raw_status, "attempts": source.get("attempts", 0),
                 "at": source.get("at", ""), "detail": detail, "outputs": source.get("outputs", []),
                 "state": state, "running": state == "running", "queued": active and state != "running",
                 "attention": attention, "last_error": error, "missing_outputs": len(missing),
                 "run_ids": [run["id"] for run, resources in runs if run.get("running") and name in resources and run.get("id")],
                 "retry": _recovery(day, [name] if state != "done" else [], source.get("run_options", entry.get("run_options")), active=active)}
        for key in ("started_at", "finished_at"):
            if key in source:
                stage[key] = source[key]
        stages.append(stage)
    # Startup/configuration failures may happen before a stage can checkpoint.
    for run, resources in runs:
        if not run.get("running") and (run.get("status") in ("failed", "stopped") or run.get("exit", 0)):
            if run["_practice"]:
                continue
            message = "The workflow was stopped." if run.get("stopped") else f"The workflow exited with code {run.get('exit', 'unknown')}."
            diagnostic = [line[1] for line in snapshot.get("lines", []) if isinstance(line, (list, tuple)) and len(line) >= 3
                          and line[2] == run.get("id") and isinstance(line[1], str) and not line[1].startswith(("×", "○", "✓"))
                          and re.search(r"\berror\b|exception|could not|cannot|not found|permission denied", line[1], re.I)]
            message = sanitize_detail("\n".join(diagnostic[-2:])) or message + " Check this run's output in Activity for the cause."
            error = {"stage": "workflow", "message": message,
                     "at": run.get("finished", run.get("started_at", "")), "attention": attention_for(message),
                     "run_id": run.get("id", "")}
            failed_at = _time(run.get("finished"))
            resolved = []
            for later, selected in runs:
                started_later, finished_later = _time(later.get("started_at")), _time(later.get("finished"))
                if (resources and resources <= selected and failed_at and started_later and finished_later
                        and started_later >= failed_at and finished_later > failed_at
                        and not later.get("running") and not later.get("stopped") and not later["_practice"]
                        and later.get("status") == "completed" and later.get("exit") == 0):
                    resolved.append((finished_later, later["finished"]))
            if resolved:
                error["resolved_at"] = min(resolved)[1]
            started = _time(run.get("started_at"))
            stage_recorded_error = any(item["name"] in resources and item.get("last_error")
                                       and (not started or ((_time(item["last_error"].get("at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc))
                                                            >= started - dt.timedelta(seconds=1))) for item in stages)
            if not stage_recorded_error:
                errors.append(error)
    counts = {key: sum(stage["state"] == state for stage in stages) for key, state in
              (("completed", "done"), ("running", "running"), ("pending", "pending"))}
    active = bool(any(run.get("running") for run, _ in runs) or counts["running"])
    summary = {"total": len(stages), **counts, "remaining": len(stages) - counts["completed"],
               "attention": sum(stage["state"] in ("failed", "interrupted", "missing_output") for stage in stages),
               "no_recent_update": sum(bool(stage["attention"] and stage["attention"]["kind"] == "no_recent_update") for stage in stages),
               "active": active}
    status = "done" if stages and counts["completed"] == len(stages) else "in progress" if active or any(stage["state"] != "pending" for stage in stages) else "not started"
    available = {today, day}
    for key in days:
        try:
            available.add(valid_day(key))
        except ValueError:
            pass
    from pipeline import lanes
    return {"date": day, "status": status, "available_dates": sorted(available, reverse=True),
            "watch": [{"site": site, "url": lanes.watch_url(site)} for site in lanes.WATCH_PORTS],
            "stages": stages, "summary": summary,
            "latest_error": max(errors, key=lambda error: (_time(error.get("at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc))) if errors else None,
            "resume": _recovery(day, [stage["name"] for stage in stages if stage["state"] != "done"],
                                entry.get("run_options"), active=active,
                                empty_reason="No workflow is recorded for this day." if not stages else "All recorded steps are complete.")}
