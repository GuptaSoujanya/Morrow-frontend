import hashlib
import json
from pathlib import Path
import sys

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parents[1]))
import learning_profile as learning
from common.profile import ProfileError
from web import state


@pytest.fixture(autouse=True)
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(state, 'APPLY', tmp_path)
    for key in ('RESUME_PATH', 'PROFILE_PATH', 'MORROW_USER_DIR'):
        monkeypatch.delenv(key, raising=False)
    return tmp_path


def write(root, name, value):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(value) if isinstance(value, dict) else value)
    return path


def test_missing_resume_never_reads_the_process_working_directory(workspace, monkeypatch):
    elsewhere = workspace / 'elsewhere'
    write(elsewhere, 'user/resume/base.tex', 'Python, React')
    write(elsewhere, 'user/inputs/profile.yaml', {'skills': ['Wrong workspace']})
    monkeypatch.chdir(elsewhere)
    result = learning.profile()
    assert not result['resume_available']
    assert result['status'] == 'missing_resume'
    assert not result['skills'] and not result['focus']
    assert 'Setup' in result['guidance']
    assert not (workspace / 'user').exists()


def test_structured_preferences_are_attributed_without_contact_details(workspace):
    write(workspace, 'user/resume/base.tex', 'Python and JavaScript. Software Engineer.')
    write(workspace, 'user/inputs/profile.yaml', {
        'skills': ['Rust', 'rust', 'PostgreSQL', 'secret@example.com', '+1 212 555 0199'],
        'titles': ['Backend Engineer'], 'email': 'secret@example.com',
        'phone': '+1 212 555 0199', 'full_name': 'Private Name',
        'total_experience_years': 18,
    })
    write(workspace, 'user/inputs/persona.yaml', {
        'focus': 'Reliable distributed systems', 'goal': 'Build reliable services',
        'study_areas': [{'slug': 'databases', 'title': 'Database design'}],
        'topics': ['A lower priority topic'], 'facts': ['Private work history'],
    })
    result = learning.profile()
    assert result['resume_available'] and result['status'] == 'ready'
    assert result['skills'] == ['Rust', 'PostgreSQL']
    assert result['topics'] == ['Database design']
    assert result['focus'] == 'Reliable distributed systems'
    assert result['target_roles'] == ['Backend Engineer']
    assert result['provenance']['skills'] == 'saved_profile'
    assert result['provenance']['topics'] == 'saved_preferences'
    public = json.dumps(result)
    assert all(secret not in public for secret in ('secret@example.com', '+1 212', 'Private Name', 'Private work history', str(workspace)))


def test_selected_resume_is_used_and_fingerprint_changes_with_content(workspace, monkeypatch):
    write(workspace, 'user/resume/base.tex', 'Java React')
    chosen = write(workspace, 'selected/resume.txt', 'Python. FastAPI and PostgreSQL. Software Engineer.')
    monkeypatch.setenv('RESUME_PATH', 'selected/resume.txt')
    result = learning.profile()
    assert result['skills'] == ['Python', 'FastAPI', 'PostgreSQL']
    assert result['provenance']['skills'] == 'resume_keywords'
    assert result['target_roles'] == []  # Past employment is not a desired role.
    assert result['resume_fingerprint'] == hashlib.sha256(chosen.read_bytes()).hexdigest()
    assert result['resume_updated_at'].endswith('+00:00')
    chosen.write_text('Rust')
    changed = learning.profile()
    assert changed['skills'] == ['Rust']
    assert changed['resume_fingerprint'] != result['resume_fingerprint']


def test_missing_selected_resume_does_not_fall_back_to_old_resume(workspace, monkeypatch):
    write(workspace, 'user/resume/base.tex', 'Python React')
    monkeypatch.setenv('RESUME_PATH', 'missing-selected.txt')
    result = learning.profile()
    assert not result['resume_available'] and not result['skills']


def test_runtime_snapshot_uses_its_own_profile_and_preferences(workspace, monkeypatch):
    write(workspace, 'user/inputs/profile.yaml', {'skills': ['Old technology']})
    write(workspace, 'user/inputs/persona.yaml', {'focus': 'Old user focus'})
    write(workspace, 'user/resume/base.tex', 'Java')
    selected = write(workspace, 'private/snapshot/resume.txt', 'Rust and Kubernetes')
    facts = write(workspace, 'private/snapshot/profile.yaml', {'skills': ['Rust'], 'titles': ['Platform Engineer']})
    monkeypatch.setenv('RESUME_PATH', 'user/resume/base.tex')
    result = learning.profile({'RESUME_PATH': str(selected), 'PROFILE_PATH': str(facts)})
    assert result['skills'] == ['Rust'] and result['target_roles'] == ['Platform Engineer']
    assert result['focus'] == 'Rust'
    assert 'Old' not in json.dumps(result)


def test_configured_private_user_directory_is_respected(workspace, monkeypatch):
    monkeypatch.setenv('MORROW_USER_DIR', 'private-person')
    write(workspace, 'private-person/resume/base.tex', 'Docker')
    write(workspace, 'private-person/inputs/profile.yaml', {'skills': ['Linux']})
    assert learning.profile()['skills'] == ['Linux']


def test_saved_preferences_without_resume_are_not_claimed_as_resume_matches(workspace):
    write(workspace, 'user/inputs/profile.yaml', {'skills': ['Python'], 'titles': ['AI Engineer']})
    result = learning.profile()
    assert not result['resume_available']
    assert result['source_label'] == 'Saved learning preferences'
    assert result['skills'] == ['Python']
    assert result['resume_fingerprint'] == ''
    assert 'Choose a readable resume' in result['guidance']


@pytest.mark.parametrize('contents,status', [('', 'empty_resume'), ('not binary', 'unreadable_resume')])
def test_unreadable_and_empty_resume_have_actionable_guidance(workspace, monkeypatch, contents, status):
    path = write(workspace, 'resume.txt', contents)
    monkeypatch.setenv('RESUME_PATH', str(path))
    if status == 'unreadable_resume':
        monkeypatch.setattr(learning, 'extract_resume_text', lambda path: (_ for _ in ()).throw(ProfileError('private path should not leak')))
    result = learning.profile()
    assert result['status'] == status and not result['resume_available']
    assert 'Setup' in result['guidance'] and not result['resume_fingerprint']
    assert 'private path' not in json.dumps(result)


def test_malformed_preferences_and_placeholder_fields_do_not_break_focus(workspace):
    write(workspace, 'user/inputs/profile.yaml', {'skills': ['FILL skills', 'TODO skills', 'N/A', {'bad': 'shape'}], 'titles': 42})
    write(workspace, 'user/inputs/persona.yaml', 'study_areas: [\n')
    write(workspace, 'user/resume/base.tex', 'Python Flask')
    result = learning.profile()
    assert result['skills'] == ['Python', 'Flask'] and result['target_roles'] == []


def test_pdf_uses_existing_bounded_extractor_without_exposing_text(workspace, monkeypatch):
    path = workspace / 'resume.pdf'
    path.write_bytes(b'%PDF-1.7 fake test file')
    monkeypatch.setenv('RESUME_PATH', 'resume.pdf')
    calls = []
    def extract(selected):
        calls.append(selected)
        return 'Private Person secret@example.com Python FastAPI'
    monkeypatch.setattr(learning, 'extract_resume_text', extract)
    result = learning.profile()
    assert calls == [str(path)]
    assert result['skills'] == ['Python', 'FastAPI']
    assert 'Private Person' not in json.dumps(result)


def test_contact_addresses_and_links_are_not_skill_evidence(workspace):
    write(workspace, 'user/resume/base.tex', 'python@example.com https://github.com/Rust\nJavaScript')
    assert learning.profile()['skills'] == ['JavaScript']
