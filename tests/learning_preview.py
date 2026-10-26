"""Isolated UI-test server: temporary learning history, bundled lessons, no bot actions."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT.parent))
spec = importlib.util.spec_from_file_location('learning_preview_dashboard', ROOT / 'server.py')
dashboard = importlib.util.module_from_spec(spec); spec.loader.exec_module(dashboard)
from common import learning_memory as memory
import learning_practice

# Generate deterministic papers through the production validator and persistence
# code. This fixture never invokes an installed AI CLI or a bot process.
learning_practice.ai_cli.chosen_cli = lambda: 'claude'
def forbidden_cli(*args, **kwargs):
    raise AssertionError('Browser fixtures must never invoke a real AI CLI.')
learning_practice.ai_cli.ask = forbidden_cli


def fixture_paper(prompt):
    context = json.loads(prompt.split('SAVED_CONTEXT_JSON:\n', 1)[1])
    source = context['sources'][0]
    return json.dumps({'title': f'{context["kind"].title()} {context["mode"]} practice',
        'goal': f'Explain and apply the ideas from {source["title"]}.',
        'reason': 'This practice uses your saved reading and progress.',
        'questions': [{'prompt': f'Question {number}: Using {source["title"]}, explain one decision and an edge case.',
            'hint': 'Start with the saved example, then test its assumptions.', 'difficulty': 'easy' if number == 1 else 'medium',
            'minutes': 8, 'source_ids': [source['id']],
            'reference_answer': f'Reference {context["kind"]} reasoning {number}: name the decision, evidence, and limitation.',
            'rubric': ['Explain the main idea.', 'Consider an edge case.']}
            for number in range(1, context['question_count'] + 1)]})


class Handler(dashboard.DashboardHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith('/api/') and path not in ('/api/learning/dsa', '/api/learning/activity', '/api/learning/daily',
                '/api/learning/dsa/sheet', '/api/learning/dsa/problem', '/api/learning/practice', '/api/learning/practice/paper',
                '/api/learning/code/capabilities', '/api/learning/code/problem', '/api/learning/code/progress',
                '/api/research/learning', '/api/document', '/api/library', '/api/course'):
            return self.error(404, 'UI fixture must supply this response.')
        return super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == '/api/learning/practice/generate':
            if not self.host_ok() or not self.change_ok() or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                return self.error(403, 'Only this fixture can prepare papers.')
            try:
                body = self.body()
                if not isinstance(body, dict) or body.get('mode') not in ('daily', 'weekly'):
                    raise ValueError('Choose daily or weekly practice.')
                result = learning_practice.generate(dashboard.state.APPLY, dashboard.state.COURSE, body['mode'], ask=fixture_paper)
                return self.json({'started': True, 'status': result})
            except ValueError as exc:
                return self.error(400, str(exc))
        if path not in ('/api/learning/dsa', '/api/learning/dsa/problem', '/api/learning/practice/settings',
                         '/api/learning/practice/answer', '/api/research/read', '/api/course/read',
                         '/api/learning/code/draft', '/api/learning/code/execute'):
            return self.error(403, 'Only temporary learning progress can change in this preview.')
        return super().do_POST()

    def do_PUT(self):
        self.error(403, 'Not available in the learning preview.')
    do_PATCH = do_PUT
    do_DELETE = do_PUT


class FixtureServer(dashboard.DashboardServer):
    def _prepare_daily_practice(self):
        # Frontend automatic-generation requests use the deterministic handler;
        # the real process scheduler must never run in a browser fixture.
        return


with TemporaryDirectory(prefix='morrow-learning-ui-') as folder:
    dashboard.state.APPLY = Path(folder)
    dashboard.state.STUDIED = Path(folder) / 'old-studied.json'
    dashboard.state.REPORTS = Path(folder) / 'data/reports'
    dashboard.state.COURSE = ROOT.parent / 'course'
    weeks = Path(folder) / '.research/learning/weeks'
    weeks.mkdir(parents=True)
    (weeks / 'week-01.md').write_text('''# Week 1: Building a learning habit

## Day 1: How the web works

### Understand the request and response

A browser sends a request to a server. The server returns a response containing a
status code, headers, and the requested content. Follow one request from the address
bar through DNS, a connection, and the response.

### Try it yourself

Open your browser's Network panel and reload a page. Find the document request and
identify its method, status code, and content type. Explain the journey in your own words.

## Day 2: Caching and freshness

A cache reuses saved responses. Compare a fresh response with a validated cached response
and describe when reusing a result is safe.

## Day 3: Reliable background work

Describe how a retry can repeat a job. Explain how an idempotency key prevents
duplicate effects, and compare a retryable failure with an invalid request.
''', encoding='utf-8')
    daily = Path(folder) / '.research/daily' / dt.date.today().isoformat()
    daily.mkdir(parents=True)
    for filename, title, body in [
        ('README.md', 'Your daily briefing', 'A saved reading list for today.\n\n## Read, reflect, and apply\nWork through the five daily sections.'),
        ('01-goal.md', 'Build a clear mental model', 'Explain today’s concepts in your own words.\n\n## Connect the ideas\nDraw a request through a small system.'),
        ('02-system-design.md', 'Design a reliable job queue', 'Compare retries and duplicate work.\n\n## Delivery guarantees\nConsider what happens when a worker stops.'),
        ('03-papers.md', 'Research worth reading today', 'Read the saved abstracts and methods.\n\n## Evaluating retrieval systems\nCompare the experiment with its baseline.\n\n## Measuring agent reliability\nIdentify the evaluation limits.'),
        ('04-tech-news.md', 'Today’s technology notes', 'A saved technology briefing.\n\n## Engineering\n**A practical release checklist**\nRead the saved notes and consider one idea to try.'),
        ('05-companies.md', 'Companies to explore today', 'Research fit before choosing where to apply.\n\n## Example AI team\nReview the role and prepare a relevant question. Reading this note does not submit an application.'),
    ]:
        (daily / filename).write_text(f'# {title}\n\n{body}\n', encoding='utf-8')
    archive = daily.parent / (dt.date.today() - dt.timedelta(days=1)).isoformat()
    archive.mkdir()
    (archive / '03-papers.md').write_text('# Yesterday’s research notes\n\nAn older saved paper summary.\n\n## Revisit the baseline\nCompare the earlier result with today’s reading.\n', encoding='utf-8')
    older = daily.parent / (dt.date.today() - dt.timedelta(days=2)).isoformat()
    older.mkdir()
    (older / '03-papers.md').write_text('# Earlier evaluation methods\n\n## Comparing experiments\nDescribe the metric, baseline, and limits of an evaluation.\n', encoding='utf-8')
    resume = Path(folder) / '.research/resume-learning'
    resume.mkdir(parents=True)
    (resume / 'README.md').write_text('# Resume learning\n\n[Evaluation](01-evaluation.md)\n\n[Serving](02-serving.md)\n', encoding='utf-8')
    (resume / '01-evaluation.md').write_text('# Explain your evaluation work\n\n## Evidence and trade-offs\nDescribe the metric, baseline, and decision from a project.\n', encoding='utf-8')
    (resume / '02-serving.md').write_text('# Explain your serving decisions\n\n## Latency and reliability\nConnect a serving choice to a measured outcome.\n', encoding='utf-8')
    def seed(data):
        today = dt.date.today()
        for offset in range(180, 0, -1):
            if offset > 7 and offset % 5 in (0, 3):
                continue
            date = today - dt.timedelta(days=offset)
            for index in range(1 + offset % 4):
                memory.record(data, 'course' if index % 2 else 'research', f'fixture-{offset}-{index}',
                              ['A new idea', 'Practice and reflection', 'Course reading', 'Research notes'][index], True,
                              at=f'{date}T12:00:00+05:30')
        yesterday = today - dt.timedelta(days=1)
        at = f'{yesterday}T12:30:00+05:30'
        data['dsa'] = {'days': {yesterday.isoformat(): {'topic': 'tries', 'read': True,
            'practiced': ['5'], 'completed_at': at}}}
        data['history'].append({'at': at, 'kind': 'dsa', 'id': 'tries', 'title': 'Tries & prefix search', 'action': 'completed'})
        memory.record(data, 'research', 'plan/day-2', 'Caching and freshness', True, at=at, day=2)
        memory.record(data, 'research', f'research/daily/{yesterday}/03-papers.md', 'Yesterday’s research notes', True, at=at)
    memory.transact(folder, seed)
    app = FixtureServer(8117)
    app.runner.start = forbidden_cli
    app.RequestHandlerClass = Handler
    print('Isolated learning UI fixture: http://127.0.0.1:8117', flush=True)
    try:
        app.serve_forever()
    finally:
        app.runner.shutdown(); app.server_close()
