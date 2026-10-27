"""Copy an authenticated account's selected inputs into its private local runner store.

Only the explicitly configured workspace owner can select inputs for the shared
legacy runner. Other accounts can prepare private inputs, never change its paths.
"""
import hashlib
import json
import os
from pathlib import Path
import tempfile
from uuid import UUID, uuid4

import yaml

from common import paths
from common.profile import ProfileError, extract_pdf_text


class SetupError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def private_root(root):
    root = Path(root).resolve()
    # Snapshots live inside the person's private user repo (user/ by default,
    # MORROW_USER_DIR otherwise); private/runner/ is gitignored there.
    user = Path(paths.user_dir())
    current, parts = (Path(user.anchor), user.parts[1:]) if user.is_absolute() else (root, user.parts)
    for part in (*parts, 'private', 'runner'):
        current /= part
        if current.is_symlink():
            raise SetupError(409, 'The private runner folder cannot be a symbolic link.')
    return current


def atomic_write(path, content):
    if path.is_symlink():
        raise SetupError(409, 'The runner setup file cannot be a symbolic link.')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    descriptor, temporary = tempfile.mkstemp(prefix='.setup-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def sync_inputs(root, runner, user, owner, setup, content, expected):
    if (not isinstance(expected, dict) or set(expected) != {'version', 'profile_version'}
            or any(type(value) is not int or value < 0 for value in expected.values())):
        raise SetupError(400, 'Send the saved setup and profile versions.')
    if setup['version'] != expected['version'] or setup['profile']['version'] != expected['profile_version']:
        raise SetupError(409, 'Your saved setup changed. Reload it before preparing the local runner.')
    ready = setup.get('readiness', {})
    resume = setup.get('resume')
    if not ready.get('profile_complete') or not ready.get('resume_ready') or not resume:
        raise SetupError(409, 'Complete your profile and choose a resume before preparing this computer.')
    if not content.startswith(b'%PDF-') or len(content) > 10 * 1024 * 1024 or hashlib.sha256(content).hexdigest() != resume.get('sha256'):
        raise SetupError(409, 'The selected resume could not be verified. Upload it again before preparing this computer.')
    try:
        extract_pdf_text(content)
    except ProfileError as exc:
        raise SetupError(409, str(exc)) from None
    try:
        tenant = str(UUID(str(user['tenant_id'])))
    except (ValueError, KeyError):
        raise SetupError(403, 'A verified account workspace is required.') from None
    base = private_root(root)
    snapshot = str(uuid4())
    target = base / tenant / snapshot
    if (base / tenant).is_symlink():
        raise SetupError(409, 'Use a private runner directory without symbolic links.')
    profile = {key: value for key, value in setup['profile']['data'].items() if not key.startswith('_')}
    profile_bytes = yaml.safe_dump(profile, allow_unicode=True, sort_keys=False).encode()
    # Saving files and switching the active snapshot are one reservation with
    # starting a workflow. Existing jobs keep their input paths unchanged.
    with runner.lock:
        if owner and runner.running:
            raise SetupError(409, 'Your account setup is saved. A workflow is running; finish setup again after it stops to update this computer’s inputs.')
        base.mkdir(parents=True, exist_ok=True, mode=0o700)
        base.chmod(0o700)
        atomic_write(target / 'profile.yaml', profile_bytes)
        atomic_write(target / 'resume.pdf', content)
        manifest = {'tenant': tenant, 'snapshot': snapshot, 'email': user['email'],
                    'profile_version': setup['profile']['version'], 'resume_artifact_id': resume['id']}
        atomic_write(base / tenant / 'current.json', json.dumps(manifest).encode())
        if owner:
            atomic_write(base / 'active-owner.json', json.dumps(manifest).encode())
    return {'saved': True, 'automation_available': bool(owner), 'profile_version': setup['profile']['version'], 'resume_filename': resume['filename']}


def runtime_environment(root, owner_email):
    if not owner_email:
        return {}
    base = private_root(root)
    path = base / 'active-owner.json'
    if not path.exists():
        return {}
    try:
        if path.is_symlink() or path.stat().st_size > 4096:
            raise ValueError()
        manifest = json.loads(path.read_text())
        if manifest.get('email', '').lower() != owner_email.lower():
            return {}
        target = base / str(UUID(manifest['tenant'])) / str(UUID(manifest['snapshot']))
        files = [target / 'profile.yaml', target / 'resume.pdf']
        if any(item.is_symlink() for item in [target.parent, target, *files]) or any(not item.is_file() for item in files):
            raise ValueError()
        return {'PROFILE_PATH': str(files[0]), 'RESUME_PATH': str(files[1])}
    except (OSError, ValueError, KeyError, TypeError):
        raise RuntimeError('The saved local runner inputs are unavailable. Review setup and finish it again before running.') from None
