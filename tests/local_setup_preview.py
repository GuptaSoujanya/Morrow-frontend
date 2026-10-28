"""Real local onboarding API against temporary files; only the AI is a fixture."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT.parent), str(ROOT.parent / 'tests')]
from pdf_helpers import pdf_bytes
from common import local_setup

spec = importlib.util.spec_from_file_location('local_setup_preview_server', ROOT / 'server.py')
dashboard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dashboard)
real_which = local_setup.shutil.which
local_setup.shutil.which = lambda name: '/synthetic/assistant' if name in ('claude', 'kiro-cli') else real_which(name)
calls = {'extract': 0, 'answers': 0}


def fixture_ai(prompt, **kwargs):
    extraction = prompt.startswith('Extract a draft')
    kind = 'extract' if extraction else 'answers'
    calls[kind] += 1
    time.sleep(1)
    if calls[kind] == 1:
        raise RuntimeError('Synthetic expired login; no real provider was called.')
    if extraction:
        if 'Partial Candidate' in prompt:
            rows = [('email', 'partial@example.com', 'partial@example.com')]
        else:
            rows = [
                ('full_name', 'Example Candidate', 'Example Candidate'),
                ('email', 'candidate@example.com', 'candidate@example.com'),
                ('phone', '+91 5555555555', '+91 5555555555'),
                ('current_location', 'Pune', 'Pune'),
                ('skills', ['Python', 'SQL', 'React'], 'Python, SQL, React'),
                ('titles', ['Software Engineer', 'Backend Engineer'], 'Software Engineer'),
                ('preferred_locations', ['Pune'], 'Pune'),
                ('total_experience_years', 4, '4 years of experience'),
                ('highest_qualification', 'BSc Computer Science', 'BSc Computer Science'),
                ('current_company', 'Example Ltd', 'Example Ltd'),
                ('current_designation', 'Software Engineer', 'Software Engineer'),
                ('employment_history', 'Software Engineer at Example Ltd, Jan 2022 - Present', 'Software Engineer at Example Ltd, Jan 2022 - Present'),
                ('linkedin_url', 'linkedin.com/in/example-candidate', 'linkedin.com/in/example-candidate'),
            ]
        return json.dumps({'fields': [{'field': k, 'value': v, 'evidence': e} for k, v, e in rows]})
    return json.dumps({'questions': [{'field': 'full_name', 'question': 'What is your full name?'}]})


class Handler(dashboard.DashboardHandler):
    def do_POST(self):
        if not urlsplit(self.path).path.startswith('/api/local-setup'):
            return self.error(403, 'Only temporary onboarding writes are permitted in this test server.')
        return super().do_POST()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--port', type=int, default=8129)
    args = parser.parse_args()
    (ROOT / 'artifacts').mkdir(exist_ok=True)
    (ROOT / 'artifacts/local-setup-resume.pdf').write_bytes(pdf_bytes('Example Candidate\ncandidate@example.com | +91 5555555555 | Pune\nSoftware Engineer at Example Ltd, Jan 2022 - Present\n4 years of experience\nPython, SQL, React\nBSc Computer Science\nlinkedin.com/in/example-candidate'))
    (ROOT / 'artifacts/local-setup-partial.pdf').write_bytes(pdf_bytes('Partial Candidate\npartial@example.com'))
    with tempfile.TemporaryDirectory(prefix='morrow-onboarding-') as temporary:
        root = Path(temporary)
        dashboard.state.APPLY = root
        for name, relative in [('PROFILE', 'user/inputs/profile.yaml'), ('ANSWERS', 'user/inputs/answers.txt'),
                               ('RESUMES', 'user/resume'), ('REPORTS', 'user/reports'), ('LOGS', 'user/logs'),
                               ('STUDIED', 'user/reports/studied.json'), ('COMPANY_SITES', 'user/inputs/company_sites.md')]:
            setattr(dashboard.state, name, root / relative)
        server = dashboard.DashboardServer(args.port)
        server.local_setup.ask = fixture_ai
        server.RequestHandlerClass = Handler
        try:
            server.serve_forever()
        finally:
            server.server_close()
