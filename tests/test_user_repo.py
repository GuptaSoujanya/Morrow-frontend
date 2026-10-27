"""Private user repo connection and account-to-repo input sync; no real git, gh or network."""
import copy
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parents[1]))
sys.path.insert(0, str(Path(__file__).parents[2]))
import user_repo
from test_server import app, request  # noqa: F401  (fixture)
from test_runner_setup import Bridge, EXPECTED, OWNER, PDF, USER, setup as account_setup


def make_repo(root):
    (root / "user" / ".git").mkdir(parents=True, exist_ok=True)
    return root / "user"


def test_status_describes_missing_and_connected_repo(tmp_path, monkeypatch):
    monkeypatch.setattr(user_repo, "_which", lambda name: "")
    before = user_repo.status(tmp_path)
    assert before == {"user_dir": "user", "exists": False, "is_repo": False, "remote": "", "database_ready": False,
                      "profile_exists": False, "answers_exist": False, "resume_sources": [], "gh_available": False,
                      "script": "scripts/setup_user.sh"}
    user = make_repo(tmp_path)
    (user / "inputs").mkdir()
    (user / "inputs/profile.yaml").write_text("full_name: Me\n")
    (user / "resume").mkdir()
    (user / "resume/base.tex").write_text("\\documentclass{article}")
    (tmp_path / "database/course").mkdir(parents=True)
    monkeypatch.setattr(user_repo, "_remote", lambda path: "https://github.com/me/Morrow-user-me.git")
    after = user_repo.status(tmp_path)
    assert after["is_repo"] and after["exists"] and after["database_ready"] and after["profile_exists"]
    assert after["remote"] == "https://github.com/me/Morrow-user-me.git" and after["resume_sources"] == ["base.tex"]


def test_remote_strips_embedded_credentials(tmp_path, monkeypatch):
    done = subprocess.CompletedProcess([], 0, stdout="https://me:ghp_secret@github.com/me/repo.git\n", stderr="")
    monkeypatch.setattr(user_repo.subprocess, "run", lambda *a, **k: done)
    assert user_repo._remote(tmp_path) == "https://github.com/me/repo.git"


def test_connect_runs_setup_script_from_the_checkout(tmp_path, monkeypatch):
    script = tmp_path / "scripts/setup_user.sh"
    script.parent.mkdir()
    script.write_text("#!/bin/zsh\n")
    monkeypatch.setattr(user_repo, "_which", lambda name: "/usr/local/bin/gh")
    calls = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        make_repo(tmp_path)
        return subprocess.CompletedProcess(command, 0, stdout="Your files live in user (me/Morrow-user-me). Fill in:\n", stderr="")

    result = user_repo.connect(tmp_path, "me/Morrow-user-me", run=fake_run)
    assert calls[0][0] == ["zsh", str(script.resolve()), "me/Morrow-user-me"]
    assert calls[0][1]["cwd"] == str(tmp_path.resolve()) and calls[0][1]["env"]["GIT_TERMINAL_PROMPT"] == "0"
    assert result["is_repo"] and "Your files live in user" in result["output"]
    assert user_repo.connect(tmp_path, None, run=fake_run)["is_repo"] and calls[1][0] == ["zsh", str(script.resolve())]


@pytest.mark.parametrize("repo", ["../escape", "me/with space", "", "a/b/c", 5])
def test_connect_rejects_invalid_repo_names(tmp_path, repo):
    with pytest.raises(user_repo.RepoError) as caught:
        user_repo.connect(tmp_path, repo, run=lambda *a, **k: pytest.fail("must not run"))
    assert caught.value.status == 400


def test_connect_reports_missing_gh_and_script_failure(tmp_path, monkeypatch):
    script = tmp_path / "scripts/setup_user.sh"
    script.parent.mkdir()
    script.write_text("#!/bin/zsh\n")
    monkeypatch.setattr(user_repo, "_which", lambda name: "")
    with pytest.raises(user_repo.RepoError, match="GitHub CLI") as caught:
        user_repo.connect(tmp_path, None)
    assert caught.value.status == 409
    monkeypatch.setattr(user_repo, "_which", lambda name: "/usr/local/bin/gh")
    failing = lambda command, **kwargs: subprocess.CompletedProcess(command, 1, stdout="", stderr="gh: not logged in\n")
    with pytest.raises(user_repo.RepoError, match="not logged in") as caught:
        user_repo.connect(tmp_path, None, run=failing)
    assert caught.value.status == 409
    (tmp_path / "scripts/setup_user.sh").unlink()
    with pytest.raises(user_repo.RepoError, match="missing"):
        user_repo.connect(tmp_path, None, run=failing)


def test_sync_merges_account_profile_and_saves_resume_with_backups(tmp_path):
    user = make_repo(tmp_path)
    (user / "inputs").mkdir()
    (user / "inputs/profile.yaml").write_text("full_name: Old Name\ncustom_fact: keep me\n")
    setup = account_setup()
    result = user_repo.sync_account_inputs(tmp_path, setup, PDF)
    saved = yaml.safe_load((user / "inputs/profile.yaml").read_text())
    assert saved == {"full_name": "Synthetic Person", "custom_fact": "keep me", "email": OWNER["email"]}
    assert result["updated_fields"] == ["full_name", "email"]
    assert result["profile_path"] == "user/inputs/profile.yaml" and result["resume_path"] == "user/resume/my-resume.pdf"
    assert (user / "resume/my-resume.pdf").read_bytes() == PDF
    backups = list((user / "inputs/backups").iterdir())
    assert len(backups) == 1 and backups[0].read_text() == "full_name: Old Name\ncustom_fact: keep me\n"
    again = user_repo.sync_account_inputs(tmp_path, setup, PDF)
    assert again["updated_fields"] == [] and len(list((user / "inputs/backups").iterdir())) == 1
    assert not (user / "resume/backups").exists()


def test_sync_requires_repo_profile_and_pdf(tmp_path):
    with pytest.raises(user_repo.RepoError, match="Connect your private user repo") as caught:
        user_repo.sync_account_inputs(tmp_path, account_setup(), PDF)
    assert caught.value.status == 409
    make_repo(tmp_path)
    with pytest.raises(user_repo.RepoError, match="Save your profile"):
        user_repo.sync_account_inputs(tmp_path, {"profile": {}}, PDF)
    with pytest.raises(user_repo.RepoError, match="not a PDF"):
        user_repo.sync_account_inputs(tmp_path, account_setup(), b"not a pdf")
    (tmp_path / "user/inputs").mkdir(exist_ok=True)
    (tmp_path / "user/inputs/profile.yaml").write_text("- just a list\n")
    with pytest.raises(user_repo.RepoError, match="YAML mapping"):
        user_repo.sync_account_inputs(tmp_path, account_setup(), PDF)


def test_http_beta_owner_can_read_and_connect_but_has_no_account_to_sync(app, monkeypatch):
    status, body = request(app, "GET", "/api/runner/repo")
    assert status == 200 and body["is_repo"] is False and body["user_dir"] == "user"
    monkeypatch.setattr(user_repo, "connect", lambda root, repo: {"is_repo": True, "repo": repo})
    assert request(app, "POST", "/api/runner/repo", {"repo": "me/Morrow-user-me"}) == (200, {"is_repo": True, "repo": "me/Morrow-user-me"})
    assert request(app, "POST", "/api/runner/repo", {}, {"Sec-Fetch-Site": "cross-site"})[0] == 403
    assert request(app, "DELETE", "/api/runner/repo")[0] == 405
    assert request(app, "POST", "/api/runner/repo/sync", EXPECTED)[0] == 404


def test_http_accounts_mode_sync_copies_owner_inputs_only(app):
    root = app[1].parent
    bridge = Bridge()
    app[0].account_bridge = bridge
    status, body = request(app, "POST", "/api/runner/repo/sync", EXPECTED)
    assert status == 409 and "Connect your private user repo" in body["error"]
    make_repo(root)
    status, body = request(app, "POST", "/api/runner/repo/sync", EXPECTED)
    assert status == 200 and body["updated_fields"] == ["full_name", "email"]
    assert yaml.safe_load((root / "user/inputs/profile.yaml").read_text())["full_name"] == "Synthetic Person"
    assert (root / "user/resume/my-resume.pdf").read_bytes() == PDF
    assert bridge.calls == ["/api/v1/onboarding", "/api/v1/artifacts/30000000-0000-0000-0000-000000000001/content"]
    stale = copy.deepcopy(EXPECTED)
    stale["version"] += 1
    assert request(app, "POST", "/api/runner/repo/sync", stale)[0] == 409
    app[0].account_bridge = Bridge(USER, False)
    assert request(app, "GET", "/api/runner/repo")[0] == 403
    assert request(app, "POST", "/api/runner/repo/sync", EXPECTED)[0] == 403
    app[0].account_bridge = Bridge(None, False)
    assert request(app, "GET", "/api/runner/repo")[0] == 401
