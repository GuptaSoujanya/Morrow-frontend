"""Read the selected learning inputs without exposing personal resume content.

Paths are resolved against the running workspace, never the process's current
directory. Only explicit learning preferences and recognized skill names leave
this module; names, contact details and employment histories do not.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import os
from pathlib import Path
import re

import yaml

from common import paths
from common.profile import PDF_MAX_BYTES, ProfileError, _SKILL_KEYWORDS, extract_resume_text
from web import state


_CONTACT = re.compile(
    r'@|https?://|www\.|mailto:|tel:|(?:linkedin\.com|github\.com)/|'
    r'(?<!\w)(?:\+?\d[\s().-]*){7,}(?!\w)', re.I,
)
_PLACEHOLDER = re.compile(r'^(?:FILL\b|TODO\b|N/?A$|NONE$)', re.I)
_YAML_MAX_BYTES = 256 * 1024


def _text(value, limit=160):
    if not isinstance(value, str):
        return ''
    value = ' '.join(value.split())
    if not value or len(value) > limit or _CONTACT.search(value) or _PLACEHOLDER.search(value):
        return ''
    return value


def _strings(value, limit=16):
    if isinstance(value, str):
        value = value.split(',')
    if not isinstance(value, list):
        return []
    result, seen = [], set()
    for item in value:
        text = _text(item)
        if text and text.casefold() not in seen:
            result.append(text)
            seen.add(text.casefold())
        if len(result) >= limit:
            break
    return result


def _mapping(path):
    try:
        if not path.is_file() or path.stat().st_size > _YAML_MAX_BYTES:
            return {}
        content = yaml.safe_load(path.read_text(encoding='utf-8'))
        return content if isinstance(content, dict) else {}
    except (OSError, UnicodeError, yaml.YAMLError):
        return {}


def _path(value, default):
    # paths.resolve follows MORROW_USER_DIR for user/... settings, while root is
    # explicit so tests and alternate workspaces cannot fall back to this repo.
    return paths.resolve(value or default, Path(state.APPLY))


def _skill_names(resume):
    # Return only vocabulary entries, never excerpts. Exclude common verbs such
    # as "go" unless the resume uses the technology's conventional spelling.
    resume = re.sub(r'(?:https?://|www\.|(?:github|linkedin)\.com/)\S+|'
                    r'[^\s@]+@[^\s@]+\.[^\s@]+', ' ', resume, flags=re.I)
    names = []
    for skill in _SKILL_KEYWORDS:
        flags = 0 if skill in ('Go', 'RAG', 'LLM', 'NLP', 'AWS', 'GCP', 'Git') else re.I
        if re.search(r'(?<!\w)' + re.escape(skill) + r'(?!\w)', resume, flags):
            names.append(skill)
    return names[:24]


def profile(environment=None):
    """Return safe, attributed focus information for this workspace.

    ``environment`` may contain the runner's selected PROFILE_PATH/RESUME_PATH
    (for an authenticated owner's uploaded snapshot). They override process
    settings, exactly as the workflow runner does. This function does not write
    files or invoke AI. A missing selected file never falls back to another
    resume, and custom profiles use only their own sibling persona preferences.
    """
    settings = dict(os.environ)
    if environment is not None:
        settings.update(environment)
    resume_path = _path(settings.get('RESUME_PATH', '').strip(), 'user/resume/base.tex')
    profile_path = _path(settings.get('PROFILE_PATH', '').strip(), 'user/inputs/profile.yaml')
    facts = _mapping(profile_path)
    preferences = _mapping(profile_path.with_name('persona.yaml'))

    skills = _strings(facts.get('skills'), 24)
    roles = _strings(facts.get('titles'), 6)
    areas = preferences.get('study_areas')
    topics = _strings([item.get('title') if isinstance(item, dict) else item
                       for item in areas], 12) if isinstance(areas, list) else []
    topics = topics or _strings(preferences.get('topics'), 12)
    focus = _text(preferences.get('focus'), 240)
    goal = _text(preferences.get('goal'), 300)
    provenance = {
        'skills': 'saved_profile' if skills else '',
        'topics': 'saved_preferences' if topics else '',
        'target_roles': 'saved_profile' if roles else '',
        'focus': 'saved_preferences' if focus else '',
        'goal': 'saved_preferences' if goal else '',
    }

    available, fingerprint, updated_at, status = False, '', '', 'missing_resume'
    try:
        if resume_path.is_file():
            stamp = resume_path.stat()
            if stamp.st_size > PDF_MAX_BYTES:
                raise ProfileError('Resume too large')
            content = resume_path.read_bytes()
            text = extract_resume_text(str(resume_path))
            after = resume_path.stat()
            if (stamp.st_mtime_ns, stamp.st_size, stamp.st_ino) != (after.st_mtime_ns, after.st_size, after.st_ino):
                raise ProfileError('Selected resume changed while being read')
            if not text.strip():
                status = 'empty_resume'
            else:
                available, status = True, 'ready'
                fingerprint = hashlib.sha256(content).hexdigest()
                updated_at = dt.datetime.fromtimestamp(
                    stamp.st_mtime, dt.timezone.utc).isoformat()
                if not skills:
                    skills = _skill_names(text)
                    provenance['skills'] = 'resume_keywords' if skills else ''
    except (OSError, UnicodeError, ProfileError):
        status = 'unreadable_resume'

    if not topics and skills:
        topics = skills[:6]
        provenance['topics'] = provenance['skills']
    if not focus:
        focus = ' · '.join(topics[:3])
        provenance['focus'] = provenance['topics'] if focus else ''
    has_preferences = any(value.startswith('saved_') for value in provenance.values())
    if available:
        source = 'Saved preferences and selected resume' if has_preferences else 'Selected resume'
        guidance = ('Your saved preferences guide your focus; the selected resume guides new learning material.'
                    if has_preferences else 'Your focus is based on skills found in your selected resume.')
        if not skills and not topics:
            guidance = 'Resume ready. Add skills or learning goals in your profile to make your focus more specific.'
    elif has_preferences:
        source = 'Saved learning preferences'
        guidance = 'Your saved preferences are shown. Choose a readable resume in Setup to generate learning material from it.'
    else:
        source = 'No readable resume selected'
        guidance = 'Choose your resume in Setup to build a learning plan around your skills and target roles.'
    if status == 'unreadable_resume':
        guidance = 'Your selected resume could not be read. Choose a PDF with selectable text, a .tex file or a .txt file in Setup.'
    elif status == 'empty_resume':
        guidance = 'Your selected resume has no readable text. Choose a resume with selectable text in Setup.'

    return {
        'resume_available': available,
        'status': status,
        'source_label': source,
        'skills': skills,
        'topics': topics,
        'target_roles': roles,
        'focus': focus,
        'goal': goal,
        'provenance': provenance,
        'resume_fingerprint': fingerprint,
        'resume_updated_at': updated_at,
        'guidance': guidance,
    }
