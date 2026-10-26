import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const key = 'dsa/01-arrays-strings-hashing/problem-1';
const problemRoute = '/#/learning/dsa/problem/01-arrays-strings-hashing/problem-1';
const solutions = {
  python: 'def solve(input):\n    nums = input["nums"]\n    return len(nums) != len(set(nums))\n',
  javascript: 'function solve(input) {\n  return new Set(input.nums).size !== input.nums.length;\n}\n',
  cpp: '#include <iostream>\n#include <vector>\n#include <set>\n#include <nlohmann/json.hpp>\nusing json = nlohmann::json;\njson solve(const json& input) {\n    auto nums = input.at("nums").get<std::vector<long long>>();\n    return std::set<long long>(nums.begin(), nums.end()).size() != nums.size();\n}\nint main() {\n    json input; std::cin >> input;\n    std::cout << solve(input).dump() << std::endl;\n}\n',
};
const names = { python: 'Python', javascript: 'JavaScript', cpp: 'C++' };
const idle = { epoch: 'compiler-fixture', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(run => {
    window.EventSource = class extends EventTarget {
      constructor() { super(); this.timer = setTimeout(() => this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(run) })), 0); }
      close() { clearTimeout(this.timer); }
    };
  }, idle);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/learning/') || ['/api/research/learning', '/api/library', '/api/document', '/api/course', '/api/research/read', '/api/course/read'].includes(path)) return route.continue();
    if (route.request().method() !== 'GET') return route.fulfill({ status: 403, json: { error: 'Fixture prohibits non-learning changes.' } });
    const data = {
      '/api/session': { mode: 'local', legacy_access: true, user: null },
      '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
      '/api/status': { name: 'Learner', greeting: 'Hello', date: '2026-10-26', date_long: '26 October 2026', run: idle, questions: [], facts: [], sites: [], study: { today: null, read: 0, total: 0 }, report: { ready: false, days: [] } },
      '/api/run': idle, '/api/bots': { bots: [], run: idle },
      '/api/overview': { days: 14, first: null, start: '2026-10-13', end: '2026-10-26', recent: [], boards: [], workspace: { research_count: 0, learning_done: 0 } },
    };
    return route.fulfill({ json: data[path] || {} });
  });
});

async function ready(page) {
  await page.goto(problemRoute);
  await expect(page.getByRole('heading', { name: 'DSA problem', level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Code language', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run examples', exact: true })).toBeEnabled();
}
async function setCode(page, language, code) {
  const select = page.getByRole('combobox', { name: 'Code language', exact: true });
  if (await select.inputValue() !== language) await select.selectOption(language);
  const editor = page.locator(`.cm-content[aria-label="${names[language]} code editor"]`);
  await expect(editor).toBeVisible();
  await expect(select).toBeEnabled();
  await editor.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(code);
  await page.getByRole('button', { name: 'Save code', exact: true }).click();
  await expect(page.locator('.code-save-status')).toHaveText('Code saved on this computer');
  return editor;
}
async function execute(page, label) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/learning/code/execute' && response.request().method() === 'POST');
  await page.getByRole('button', { name: label, exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  const body = await result.json();
  expect(body.status, body.stderr || body.reason).not.toBe('unavailable');
  await expect(page.getByRole('button', { name: 'Run examples', exact: true })).toBeEnabled();
  return body;
}
async function captureAndAudit(page, name, widths = [375, 1440]) {
  await mkdir('artifacts/compiler', { recursive: true });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const chart = page.locator('.code-score-chart-scroll');
    if (await chart.count()) await expect.poll(() => chart.evaluate(element => {
      const selected = element.querySelector('[aria-pressed="true"]').getBoundingClientRect();
      const container = element.getBoundingClientRect();
      return selected.left >= container.left - 1 && selected.right <= container.right + 1;
    })).toBe(true);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    await writeFile(`artifacts/compiler/${name}-${width}-axe.json`, JSON.stringify(audit.violations, null, 2));
    expect(audit.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
    await page.screenshot({ path: `artifacts/compiler/${name}-${width}.png`, fullPage: true, animations: 'disabled' });
    const workspace = page.locator('.code-workspace');
    if (await workspace.count()) await workspace.screenshot({ path: `artifacts/compiler/${name}-workspace-${width}.png`, animations: 'disabled' });
  }
}
async function progress(request) { return (await request.get('/api/learning/code/progress')).json(); }

test('real local runtimes are available and empty coding progress is accessible', async ({ page, request }) => {
  const capability = await (await request.get('/api/learning/code/capabilities')).json();
  expect(capability.available, capability.reason).toBe(true);
  for (const language of ['python', 'javascript', 'cpp']) {
    const runtime = capability.languages.find(item => item.id === language);
    expect(runtime?.available, `${language}: ${runtime?.reason}`).toBe(true);
  }
  expect((await progress(request)).totals.attempts).toBe(0);
  await page.goto('/#/learning/progress');
  await expect(page.getByRole('heading', { name: 'Your coding progress', exact: true })).toBeVisible();
  await expect(page.getByText('Submit a solution to start your score, trend and verified-solve milestones.', { exact: true })).toBeVisible();
  expect(await page.locator('.code-score-ring').evaluate(element => getComputedStyle(element).backgroundImage)).toContain('conic-gradient');
  const search = page.getByRole('button', { name: /^Search .*: your workspace$/ });
  await search.click();
  await expect(page.getByRole('dialog', { name: 'Find your next step' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(search).toBeFocused();
  await captureAndAudit(page, 'progress-empty');
});

test('Python and JavaScript drafts survive language switches and reload', async ({ page, request }) => {
  await ready(page);
  await setCode(page, 'python', solutions.python);
  await setCode(page, 'javascript', solutions.javascript);
  await page.getByRole('combobox', { name: 'Code language', exact: true }).selectOption('python');
  await expect(page.locator('.cm-content')).toHaveText(solutions.python.replaceAll('\n', ''), { useInnerText: false });
  await page.reload();
  await expect(page.locator('.cm-content[aria-label="Python code editor"]')).toContainText('len(set(nums))');
  const js = await (await request.get('/api/learning/code/problem', { params: { key, language: 'javascript' } })).json();
  expect(js.draft.code).toBe(solutions.javascript);
  expect((await progress(request)).totals.attempts).toBe(0);
  await captureAndAudit(page, 'editor');
});

test('a failed code save retains the draft for an explicit retry', async ({ page, request }) => {
  await ready(page);
  let fail = true;
  await page.route('**/api/learning/code/draft', route => fail
    ? route.fulfill({ status: 503, json: { error: 'Temporary draft storage failure.' } }) : route.continue());
  const code = solutions.python + '# Retry keeps this note.\n';
  const editor = page.locator('.cm-content[aria-label="Python code editor"]');
  await editor.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(code);
  await page.getByRole('button', { name: 'Save code', exact: true }).click();
  await expect(page.locator('.code-save-status')).toContainText('Could not save. Temporary draft storage failure.');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(editor).toContainText('Retry keeps this note.');
  fail = false;
  await page.getByRole('button', { name: 'Save code', exact: true }).click();
  await expect(page.locator('.code-save-status')).toHaveText('Code saved on this computer');
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Retry keeps this note.');
  expect((await progress(request)).totals.attempts).toBe(0);
});

test('the daily worked example opens the same saved coding exercise', async ({ page, request }) => {
  await page.goto('/#/learning/dsa');
  await page.getByRole('tab', { name: '02 Worked example', exact: true }).click();
  const disclosure = page.getByText('Try this example in the code editor', { exact: true });
  await expect(disclosure).toBeVisible(); await disclosure.click();
  await expect(page.locator('.cm-content[aria-label="Python code editor"]')).toContainText('Retry keeps this note.');
  await expect(page.getByRole('button', { name: 'Run examples', exact: true })).toBeEnabled();
  expect((await progress(request)).totals.attempts).toBe(0);
});

test('an unavailable language explains setup, allows saving, and leaves other runtimes usable', async ({ page, request }) => {
  const capabilities = await (await request.get('/api/learning/code/capabilities')).json();
  const python = capabilities.languages.find(item => item.id === 'python');
  python.available = false; python.reason = 'Python is not installed. Install Python to run this language.';
  await page.route('**/api/learning/code/capabilities', route => route.fulfill({ json: capabilities }));
  await page.goto(problemRoute);
  await expect(page.getByRole('combobox', { name: 'Code language', exact: true })).toBeVisible();
  await expect(page.getByText(python.reason, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run examples', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Submit solution', exact: true })).toBeDisabled();
  await setCode(page, 'python', solutions.python + '# Available for editing without a runtime.\n');
  const saved = await (await request.get('/api/learning/code/problem', { params: { key, language: 'python' } })).json();
  expect(saved.draft.code).toContain('Available for editing without a runtime.');
  await page.getByRole('combobox', { name: 'Code language', exact: true }).selectOption('javascript');
  await expect(page.locator('.cm-content[aria-label="JavaScript code editor"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run examples', exact: true })).toBeEnabled();
  await expect(page.getByText(python.reason, { exact: true })).not.toBeVisible();
  expect((await progress(request)).totals.attempts).toBe(0);
});

test('Launchpad, Today and the practice sheet open coding directly on phone and desktop', async ({ page, request }) => {
  test.setTimeout(90000);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#/overview');
    await page.getByRole('link', { name: 'Practice DSA', exact: true }).click();
    await expect(page).toHaveURL(/#\/learning\/dsa\?step=practice$/);
    await expect(page.getByRole('tab', { name: '03 Practice', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-content[aria-label="Python code editor"]')).toBeVisible();
    await page.goBack(); await expect(page.getByRole('heading', { name: 'Launchpad', level: 1, exact: true })).toBeVisible();
    await page.goto('/#/learning');
    await page.locator('[data-learning-task="dsa"]').getByRole('link', { name: 'Practice now', exact: true }).click();
    await expect(page.getByRole('tab', { name: '03 Practice', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-content[aria-label="Python code editor"]')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tab', { name: '03 Practice', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-content[aria-label="Python code editor"]')).toBeVisible();
    await captureAndAudit(page, 'direct-practice', [width]);
    await page.goto('/#/learning/dsa/sheet');
    await expect(page.getByRole('link', { name: /^(Start|Continue) coding$/ })).toBeVisible();
    await captureAndAudit(page, 'sheet-start', [width]);
    await page.getByRole('link', { name: /^(Start|Continue) coding$/ }).click();
    await expect(page.getByRole('heading', { name: 'DSA problem', exact: true, level: 1 })).toBeVisible();
    await expect(page.locator('.cm-content[aria-label="Python code editor"]')).toBeVisible();
    await page.getByRole('link', { name: '← Back to practice sheet', exact: true }).click();
    await expect(page.getByRole('link', { name: /^(Start|Continue) coding$/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect((await progress(request)).totals.attempts).toBe(0);
});

for (const language of ['python', 'javascript', 'cpp']) {
  test(`real ${names[language]} examples and custom input run without scoring`, async ({ page, request }) => {
    test.setTimeout(60000);
    await ready(page); await setCode(page, language, solutions[language]);
    const examples = await execute(page, 'Run examples');
    expect(examples.status).toBe('accepted');
    expect(examples.passed).toBe(examples.total);
    expect(examples.scored).toBe(false);
    await expect(page.locator('.code-result-head')).toContainText('All tests passed');
    await page.getByText('Try your own input', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Custom JSON input', exact: true }).fill('{"nums":[-7,0,3,-7]}');
    const custom = await execute(page, 'Run input');
    expect(custom.status).toBe('ok'); expect(custom.stdout.trim()).toBe('true');
    expect(custom.scored).toBe(false); expect((await progress(request)).totals.attempts).toBe(0);
  });
}

test('runtime errors and timeouts show diagnostics without scoring a practice run', async ({ page, request }) => {
  test.setTimeout(60000);
  await ready(page); await setCode(page, 'python', 'def solve(input):\n    raise RuntimeError("controlled failure")\n');
  const failure = await execute(page, 'Run examples');
  expect(failure.tests[0].status).toBe('runtime_error');
  await expect(page.locator('.code-test')).toContainText('controlled failure');
  await setCode(page, 'python', 'def solve(input):\n    while True:\n        pass\n');
  const timeout = await execute(page, 'Run examples');
  expect(timeout.tests[0].status).toBe('timeout');
  await expect(page.locator('.code-test summary')).toContainText('timeout');
  await setCode(page, 'cpp', 'int main( {\n');
  const compileError = await execute(page, 'Run examples');
  expect(compileError.status).toBe('compile_error');
  await expect(page.locator('.code-result-head')).toContainText('compile error');
  expect((await progress(request)).totals.attempts).toBe(0);
  await captureAndAudit(page, 'execution-failure');
});

test('submissions score verified tests once, preserve best points and unlock the first milestone', async ({ page, request }) => {
  test.setTimeout(60000);
  const xpBefore = (await (await request.get('/api/learning/activity')).json()).xp;
  await ready(page); await setCode(page, 'python', 'def solve(input):\n    return None\n');
  const wrong = await execute(page, 'Submit solution');
  expect(wrong.scored).toBe(true); expect(wrong.submission.score).toBe(0);
  expect((await progress(request)).totals.verified_solves).toBe(0);
  await setCode(page, 'python', solutions.python);
  const correct = await execute(page, 'Submit solution');
  expect(correct.submission.score).toBe(100); expect(correct.submission.improvement).toBe(100);
  await expect(page.locator('.code-score-note')).toContainText('100 / 100 for this problem · +100 daily points');
  await captureAndAudit(page, 'verified-results');
  const repeated = await execute(page, 'Submit solution');
  expect(repeated.submission.improvement).toBe(0);
  const data = await progress(request);
  expect(data.today.score).toBe(100); expect(data.today.max_score).toBe(100);
  expect(data.totals.attempts).toBe(3); expect(data.totals.verified_solves).toBe(1);
  expect(data.badges[0].earned_at).toBeTruthy();
  expect((await (await request.get('/api/learning/activity')).json()).xp).toBe(xpBefore + 10);
  await page.goto('/#/learning/progress');
  await expect(page.getByRole('heading', { name: 'Your coding progress', exact: true })).toBeVisible();
  expect(await page.locator('.code-score-ring').evaluate(element => getComputedStyle(element).backgroundImage)).toContain('conic-gradient');
  expect(await page.locator('.code-score-ring').evaluate(element => getComputedStyle(element).getPropertyValue('--score-ratio').trim())).toBe('100%');
  await expect(page.locator('.code-score-badge.is-earned')).toHaveCount(1);
  await expect(page.locator('.code-score-day')).toContainText('100 points');
  const chart = page.getByRole('group', { name: /Choose a scoring day/ });
  await chart.locator('[aria-pressed="true"]').focus(); await page.keyboard.press('Home');
  await expect(chart.getByRole('button').first()).toBeFocused();
  await expect(page.locator('.code-score-day')).toContainText('No code submissions recorded');
  await page.keyboard.press('End'); await expect(chart.getByRole('button').last()).toBeFocused();
  await page.getByText('View daily scoring data', { exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(15);
  await page.getByText('Recent submissions', { exact: true }).click();
  await expect(page.locator('.code-score-history-list li')).toHaveCount(3);
  await captureAndAudit(page, 'progress-populated');
});
