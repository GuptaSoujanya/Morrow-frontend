"""Connect this computer to the person's private user repo and copy account inputs into it.

The user repo (user/ by default, MORROW_USER_DIR otherwise) is the private GitHub
repo that holds one person's inputs, resume, ledger, reports, memory and research.
scripts/setup_user.sh creates or clones it; this module runs that script for the
dashboard and copies the profile and resume saved in an account into the repo so
the CLI bots and the dashboard read the same files.
"""
import datetime as dt
import os
from pathlib import Path
import re
import subprocess
import tempfile

import yaml

from common import paths

# Neither part may start with "-" (it would read as an option of setup_user.sh) or ".".
REPO_NAME = re.compile(r"(?![.-])[A-Za-z0-9_.-]{1,100}/(?![.-])[A-Za-z0-9_.-]{1,100}")
SCRIPT = Path("scripts/setup_user.sh")


class RepoError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def user_root(root):
    root = Path(root).resolve()
    user = Path(paths.user_dir())
    return user if user.is_absolute() else root / user


def _remote(user):
    try:
        done = subprocess.run(["git", "-C", str(user), "remote", "get-url", "origin"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    url = done.stdout.strip() if done.returncode == 0 else ""
    # Never echo embedded tokens (https://user:token@host/...) back to the browser.
    return re.sub(r"://[^/@]+@", "://", url)


def status(root):
    root = Path(root).resolve()
    user = user_root(root)
    database = Path(paths.database_dir())
    database = database if database.is_absolute() else root / database
    is_repo = (user / ".git").exists()
    resume_sources = sorted(p.name for p in (user / "resume").glob("*.tex")) if (user / "resume").is_dir() else []
    return {
        "user_dir": str(paths.user_dir()),
        "exists": user.is_dir(),
        "is_repo": is_repo,
        "remote": _remote(user) if is_repo else "",
        "database_ready": (database / "course").is_dir(),
        "profile_exists": (user / "inputs" / "profile.yaml").is_file(),
        "answers_exist": (user / "inputs" / "answers.txt").is_file(),
        "resume_sources": resume_sources,
        "gh_available": bool(_which("gh")),
        "script": SCRIPT.as_posix(),
    }


def _which(name):
    for folder in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(folder) / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return ""


def connect(root, repo=None, run=subprocess.run):
    """Create or clone the private user repo through scripts/setup_user.sh."""
    root = Path(root).resolve()
    if repo is not None and (not isinstance(repo, str) or not REPO_NAME.fullmatch(repo)):
        raise RepoError(400, "Give the repo as owner/name, letters, digits, dots, dashes and underscores only.")
    script = root / SCRIPT
    if not script.is_file():
        raise RepoError(409, f"{SCRIPT.as_posix()} is missing from this Morrow checkout.")
    if not _which("gh"):
        raise RepoError(409, "Install the GitHub CLI (brew install gh) and run gh auth login on this computer first.")
    command = ["zsh", str(script)] + ([repo] if repo else [])
    try:
        done = run(command, cwd=str(root), capture_output=True, text=True, timeout=600, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    except subprocess.TimeoutExpired:
        raise RepoError(504, "Creating the repo took too long. Check your network and gh auth status, then try again.") from None
    except OSError as exc:
        raise RepoError(500, f"Could not run {SCRIPT.as_posix()}: {exc}") from None
    output = ((done.stdout or "") + "\n" + (done.stderr or "")).strip()
    tail = "\n".join(output.splitlines()[-12:])
    if done.returncode != 0:
        raise RepoError(409, tail or f"{SCRIPT.as_posix()} failed with exit code {done.returncode}.")
    return {**status(root), "output": tail}


def _atomic_write(path, content):
    if path.is_symlink():
        raise RepoError(409, f"{path.name} is a symbolic link; replace it with a regular file first.")
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".sync-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _backup(path):
    if not path.is_file():
        return None
    backups = path.parent / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    target = backups / f"dashboard-{path.stem}-{dt.datetime.now():%Y%m%d-%H%M%S-%f}.bak"
    write_private(target, path.read_bytes())
    return target


def write_private(path, content):
    """Create a new file that only this user can read, private from its first byte."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(content)


def sync_account_inputs(root, setup, resume_content):
    """Merge the account profile into inputs/profile.yaml and save the chosen resume PDF.

    Facts already in the file that the account does not know about are kept; the
    account's values win for the fields it has. The previous file is backed up
    under inputs/backups/ the same way the dashboard file editor does.
    """
    user = user_root(root)
    if not (user / ".git").exists():
        raise RepoError(409, "Connect your private user repo before copying your saved details into it.")
    profile = setup.get("profile", {}).get("data") if isinstance(setup, dict) else None
    if not isinstance(profile, dict):
        raise RepoError(409, "Save your profile in setup before copying it into your repo.")
    incoming = {key: value for key, value in profile.items() if isinstance(key, str) and not key.startswith("_")}
    resume = setup.get("resume")
    if resume and resume_content and not resume_content.startswith(b"%PDF-"):
        raise RepoError(409, "The selected resume is not a PDF.")
    profile_path = user / "inputs" / "profile.yaml"
    existing = {}
    if profile_path.is_file():
        try:
            loaded = yaml.safe_load(profile_path.read_text())
        except yaml.YAMLError:
            raise RepoError(409, "inputs/profile.yaml is not valid YAML. Fix it in the file editor before syncing.") from None
        if loaded is not None and not isinstance(loaded, dict):
            raise RepoError(409, "inputs/profile.yaml must contain a YAML mapping.")
        existing = loaded or {}
    merged = {**existing, **incoming}
    changed = [key for key in incoming if existing.get(key) != incoming[key]]
    result = {"profile_path": str(profile_path.relative_to(root.resolve())) if profile_path.is_relative_to(root.resolve()) else str(profile_path),
              "updated_fields": changed, "resume_path": None}
    if merged != existing or not profile_path.exists():
        _backup(profile_path)
        _atomic_write(profile_path, yaml.safe_dump(merged, allow_unicode=True, sort_keys=False).encode())
    if resume and resume_content:
        name = Path(str(resume.get("filename") or "resume.pdf")).name
        if not name.lower().endswith(".pdf") or name.startswith("."):
            name = "resume.pdf"
        resume_path = user / "resume" / name
        if not resume_path.exists() or resume_path.read_bytes() != resume_content:
            _backup(resume_path)
            _atomic_write(resume_path, resume_content)
        result["resume_path"] = str(resume_path.relative_to(root.resolve())) if resume_path.is_relative_to(root.resolve()) else str(resume_path)
    return result
