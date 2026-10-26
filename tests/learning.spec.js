import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const idle = { epoch: 'learning-fixture', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const readingLabel = 'I read the topic and understand the worked example';
const realReads = new Set(['/api/research/learning', '/api/library', '/api/document', '/api/course']);
const realWrites = new Set(['/api/research/read', '/api/course/read']);
test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ page }) => {
  // Audit settled colors and geometry, rather than sampling the route fade-in.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(run => {
    window.EventSource = class extends EventTarget {
      constructor() { super(); this.timer = setTimeout(() => this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(run) })), 0); }
      close() { clearTimeout(this.timer); }
    };
  }, idle);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/learning/') || realReads.has(path) || realWrites.has(path)) return route.continue();
    if (route.request().method() !== 'GET') return route.fulfill({ status: 403, json: { error: 'Fixture prohibits non-learning changes.' } });
    const data = {
      '/api/session': { mode: 'local', legacy_access: true, user: null },
      '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
      '/api/status': { name: 'Learner', greeting: 'Hello', date: '2026-10-26', date_long: '26 October 2026', run: idle,
        questions: [], facts: [], sites: [], study: { today: null, read: 0, total: 0 }, report: { ready: false, days: [] } },
      '/api/run': idle, '/api/bots': { bots: [], run: idle },
      '/api/overview': { days: 14, first: null, start: '2026-10-13', end: '2026-10-26', recent: [], boards: [],
        workspace: { research_count: 0, learning_done: 0 } },
    };
    return route.fulfill({ json: data[path] || {} });
  });
});

async function ready(page, route = 'learning') {
  await page.goto('/#/' + route);
  const [path, query = ''] = route.split('?');
  const part = path.split('/')[1] || 'today';
  const section = path === 'dsa' ? 'dsa' : path === 'study' ? 'courses'
    : path.startsWith('research/') ? 'read' : path === 'research' ? new URLSearchParams(query).get('view') || 'today' : part;
  const titles = { today: 'Today’s learning', dsa: 'DSA practice', practice: 'Practice & exams', plan: 'Daily learning', read: 'Reading',
    resume: 'Resume topics', courses: 'Courses', library: 'Saved library', progress: 'Your progress' };
  const title = path.startsWith('learning/dsa/problem/') ? 'DSA problem'
    : path === 'learning/dsa/sheet' ? 'DSA practice sheet' : titles[section];
  await expect(page.getByRole('heading', { name: route === 'overview' ? 'Launchpad' : title, level: 1, exact: true })).toBeVisible();
  if (route === 'learning') {
    await expect(page.locator('.daily-agenda')).toBeVisible();
    return;
  }
  const heading = route === 'overview' || route === 'learning/progress' ? 'Your learning momentum'
    : route.endsWith('/dsa') || route === 'dsa' ? 'Hash sets & frequency maps'
      : route.endsWith('/plan') ? 'How the web works' : null;
  if (!heading) return;
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
}
async function openRoute(page, path) {
  await page.evaluate(hash => { location.hash = hash; }, '#/' + path);
}
async function choose(page, label, option) {
  const control = page.getByRole('combobox', { name: label, exact: true });
  if (await control.evaluate(element => element.tagName === 'SELECT')) return control.selectOption({ label: option });
  await control.click();
  await page.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: option, exact: true }).click();
}
function task(page, key) { return page.locator(`[data-learning-task="${key}"]`); }
async function fit(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function capture(page, name) {
  await mkdir('artifacts/learning', { recursive: true });
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: `artifacts/learning/${name}.png`, fullPage: true, animations: 'disabled' });
}
async function example(page) {
  await page.getByRole('tab', { name: '02 Worked example', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: readingLabel, exact: true })).toBeVisible();
}
async function assertCheckedSave(page, label) {
  const checkbox = page.getByRole('checkbox', { name: label, exact: true });
  await checkbox.check();
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).toBeChecked();
}

test('the daily plan and DSA save together, persist on reload and award 60 XP once', async ({ page, request }) => {
  const before = await (await request.get('/api/learning/activity')).json();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await expect(page.getByRole('heading', { name: 'How the web works', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hash sets & frequency maps', exact: true })).toBeVisible();
  await expect(page.locator('.daily-session-count')).toHaveText('0 / 7 complete');
  await capture(page, 'learning-home-desktop');
  await page.getByRole('link', { name: 'Open learning day', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Today’s learning material' })).toContainText('request to a server');
  await capture(page, 'learning-plan-desktop');
  await page.getByRole('button', { name: 'Complete learning day', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Learning day completed', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Learning day completed', exact: true })).toBeDisabled();
  await expect(page.locator('.daily-workspace-head .eyebrow')).toContainText('DAY 1 OF 90');
  await expect(page.getByRole('heading', { name: 'How the web works', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Continue with DSA practice →', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Complete DSA topic', exact: true })).toBeDisabled();
  await example(page);
  await assertCheckedSave(page, readingLabel);
  await page.getByRole('tab', { name: '03 Practice', exact: true }).click();
  await page.getByText('Reveal approach & Python solution', { exact: true }).click();
  await expect(page.locator('.daily-solution[open] pre')).toBeVisible();
  await capture(page, 'learning-dsa-desktop');
  await assertCheckedSave(page, 'I practiced Valid Anagram');
  await page.getByRole('button', { name: 'Question 2', exact: true }).click();
  await assertCheckedSave(page, 'I practiced Two Sum');
  await page.getByRole('button', { name: 'Complete DSA topic', exact: true }).click();
  await expect(page.getByRole('button', { name: 'DSA completed today', exact: true })).toBeDisabled();
  await expect(page.locator('.daily-save-status')).toContainText('50 XP');
  await page.reload();
  await expect(page.getByRole('button', { name: 'DSA completed today', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: '03 Practice', exact: true }).click();
  await page.getByRole('button', { name: 'Question 2', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'I practiced Two Sum', exact: true })).toBeChecked();
  const saved = await (await request.get('/api/learning/activity')).json();
  expect(saved.xp).toBe(before.xp + 60); expect(saved.today_count).toBe(before.today_count + 2);
  await ready(page);
  await expect(page.locator('.daily-session-count')).toHaveText('2 / 7 complete');
  await expect(page.locator('.daily-win')).toHaveCount(0);
  await ready(page, 'overview');
  await expect(page.locator('.learning-momentum').getByRole('link', { name: 'Open Learning', exact: true })).toHaveAttribute('href', '#/learning');
  await expect(page.locator('.learning-xp')).toContainText(`${saved.xp} XP earned`);
  await expect(page.locator('.learning-day-detail')).toContainText('Hash sets & frequency maps');
  await expect(page.locator('.learning-day-detail')).toContainText('How the web works');
  await expect(page.locator('.learning-rewards')).not.toHaveAttribute('open');
  await fit(page); await capture(page, 'dashboard-learning-desktop');
  await ready(page, 'dsa');
  await expect(page.getByRole('navigation', { name: 'Learning workspace' }).getByRole('link', { name: 'DSA practice', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'DSA completed today', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('failed DSA saves restore the checkbox, allow retry and do not award XP', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/learning/dsa')).json();
  snapshot.progress = { ...snapshot.progress, read: false, practiced: [], completed_at: null };
  let fail = true, saves = 0;
  await page.route('**/api/learning/dsa', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: snapshot });
    saves++;
    if (fail) return route.fulfill({ status: 503, json: { error: 'Temporary storage unavailable.' } });
    return route.fulfill({ json: { ...snapshot, progress: { ...snapshot.progress, read: true } } });
  });
  await ready(page, 'learning/dsa'); await example(page);
  await page.getByRole('checkbox', { name: readingLabel, exact: true }).check();
  await expect(page.getByRole('alert')).toContainText('Temporary storage unavailable');
  await expect(page.getByRole('checkbox', { name: readingLabel, exact: true })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Complete DSA topic', exact: true })).toBeDisabled();
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: readingLabel, exact: true })).toBeChecked();
  expect(saves).toBe(2);
  expect((await (await request.get('/api/learning/activity')).json()).xp).toBe(snapshot.activity.xp);
});

test('failed plan saves preserve the reading and recover with an explicit retry', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/learning/daily')).json();
  snapshot.plan = { ...snapshot.plan, read: false, completed: 0 };
  const before = await (await request.get('/api/learning/activity')).json();
  let fail = true, saves = 0;
  await page.route('**/api/learning/daily', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/research/read', route => {
    saves++;
    expect(route.request().postDataJSON()).toEqual({ id: 'plan/day-1', read: true });
    if (fail) return route.fulfill({ status: 503, json: { error: 'Reading storage unavailable.' } });
    snapshot.plan.read = true; snapshot.plan.completed = 1;
    return route.fulfill({ json: { ok: true, read: true } });
  });
  await ready(page, 'learning/plan');
  await page.getByRole('button', { name: 'Complete learning day', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Reading storage unavailable');
  await expect(page.getByRole('button', { name: 'Complete learning day', exact: true })).toBeEnabled();
  await expect(page.getByRole('article', { name: 'Today’s learning material' })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Learning day completed', exact: true })).toBeDisabled();
  expect(saves).toBe(2);
  expect((await (await request.get('/api/learning/activity')).json()).xp).toBe(before.xp);
});

test('learning views support keyboard steps, calendar dates, accessibility and responsive layouts', async ({ page }) => {
  test.setTimeout(65_000);
  await ready(page, 'learning/dsa');
  const learn = page.getByRole('tab', { name: '01 Learn', exact: true });
  await learn.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '02 Worked example', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'step-example');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: '03 Practice', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home'); await expect(learn).toBeFocused();
  await ready(page, 'learning/progress');
  const selected = page.locator('.learning-cell[aria-pressed="true"]');
  const lastLabel = await selected.getAttribute('aria-label');
  await selected.focus(); await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.learning-cell[aria-pressed="true"]')).not.toHaveAttribute('aria-label', lastLabel);
  await page.keyboard.press('End');
  await expect(page.locator('.learning-cell[aria-pressed="true"]')).toHaveAttribute('aria-label', lastLabel);
  const inspectDate = page.getByRole('textbox', { name: 'Inspect a learning date', exact: true });
  const firstDate = await inspectDate.getAttribute('min'), lastDate = await inspectDate.getAttribute('max');
  await expect(inspectDate).toHaveValue(lastDate);
  await inspectDate.fill('2099-12-31'); await inspectDate.press('Tab');
  await expect(inspectDate).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.learning-cell[aria-pressed="true"]')).toHaveAttribute('aria-label', lastLabel);
  await inspectDate.fill(lastDate);
  const openCalendar = page.getByRole('button', { name: 'Choose learning date', exact: true });
  await openCalendar.click();
  const calendar = page.getByRole('dialog', { name: 'Inspect a learning date calendar', exact: true });
  await expect(calendar.getByRole('button', { name: 'Next month', exact: true })).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(calendar.locator(`[data-date="${lastDate}"]`)).toBeFocused();
  await page.keyboard.press('Escape');
  await inspectDate.fill(firstDate); await openCalendar.click();
  await expect(calendar.getByRole('button', { name: 'Previous month', exact: true })).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await expect(calendar.locator(`[data-date="${firstDate}"]`)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(inspectDate).toHaveValue(firstDate);
  await inspectDate.fill(lastDate); await inspectDate.press('Tab');
  await expect(page.locator('.learning-rewards')).toHaveAttribute('open');
  const routes = [['learning', 'learning-home'], ['learning/plan', 'learning-plan'],
    ['learning/dsa', 'learning-dsa'], ['learning/progress', 'learning-progress'], ['overview', 'dashboard-learning']];
  for (const [route, name] of routes) {
    await ready(page, route);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect.soft(audit.violations.map(item => ({ route, id: item.id, targets: item.nodes.map(node => node.target), reasons: item.nodes.map(node => node.failureSummary) }))).toEqual([]);
    await fit(page); await capture(page, name + '-desktop');
  }
  for (const width of [375, 768, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [route, name] of routes) {
      await ready(page, route); await fit(page);
      if (width === 375) await capture(page, name + '-mobile');
    }
  }
});

test('unavailable DSA leaves the saved learning plan usable and supports retry', async ({ page }) => {
  await page.route('**/api/learning/dsa', route => route.fulfill({ status: 503, json: { error: 'Lesson storage unavailable.' } }));
  await ready(page);
  await expect(page.getByRole('heading', { name: 'How the web works', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Lesson storage unavailable');
  await openRoute(page, 'learning/dsa');
  await expect(page.getByRole('alert')).toContainText('Lesson storage unavailable');
  await page.unroute('**/api/learning/dsa');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hash sets & frequency maps', exact: true })).toBeVisible();
});

test('unavailable learning summaries leave DSA independently usable', async ({ page }) => {
  await page.route('**/api/learning/daily', route => route.fulfill({ status: 503, json: { error: 'Learning plan storage unavailable.' } }));
  await ready(page);
  await expect(page.getByRole('alert')).toContainText('Learning plan storage unavailable');
  await expect(page.getByRole('heading', { name: 'Hash sets & frequency maps', exact: true })).toBeVisible();
  await openRoute(page, 'learning/dsa');
  await expect(page.getByRole('tab', { name: '01 Learn', exact: true })).toBeVisible();
  await openRoute(page, 'learning/plan');
  await expect(page.getByRole('alert')).toContainText('Learning plan storage unavailable');
  await page.unroute('**/api/learning/daily');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How the web works', exact: true })).toBeVisible();
});

test('missing plan material has a clear next step without hiding DSA', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/learning/daily')).json();
  snapshot.plan = { ...snapshot.plan, available: false, read: false, completed: 0, content_html: '',
    reason: 'Day 1 has no saved reading material yet. Generate the learning plan from Research agents.' };
  await page.route('**/api/learning/daily', route => route.fulfill({ json: snapshot }));
  await ready(page);
  await expect(page.locator('.daily-session-count')).toHaveText(/[01] \/ 6 complete/);
  await expect(page.locator('.daily-material-note')).toContainText('1 task needs material');
  await openRoute(page, 'learning/plan');
  await expect(page.getByRole('heading', { name: 'Your learning material is not ready yet', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open saved plans', exact: true })).toHaveAttribute('href', '#/learning/library?category=Learning');
  await expect(page.getByRole('button', { name: 'Complete learning day', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Practice DSA today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hash sets & frequency maps', exact: true })).toBeVisible();
  snapshot.plan = { ...snapshot.plan, completed: 90, id: null, day: null, reason: 'You have completed all 90 days.' };
  await ready(page);
  await expect(task(page, 'plan')).toContainText('Your 90-day plan is complete');
  await expect(task(page, 'plan').getByRole('link', { name: 'Revisit learning plan', exact: true })).toHaveAttribute('href', '#/learning/library?category=Learning');
  await expect(task(page, 'plan').getByRole('button', { name: 'Prepare learning day', exact: true })).toHaveCount(0);
  await expect(page.locator('.daily-material-note')).toHaveCount(0);
  await expect(page.locator('.daily-session-count')).toHaveText(/[01] \/ 6 complete/);
  await openRoute(page, 'learning/plan');
  await expect(page.getByRole('heading', { name: 'You’ve finished your learning plan', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare learning day', exact: true })).toHaveCount(0);
});

test('returning from another tab refreshes rewards and stale reads cannot overwrite a save', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/learning/dsa')).json();
  snapshot.progress = { ...snapshot.progress, read: false, practiced: [], completed_at: null };
  let current = structuredClone(snapshot), pendingRead;
  let deferRead = false;
  await page.route('**/api/learning/activity', route => route.fulfill({ json: current.activity }));
  await page.route('**/api/learning/dsa', async route => {
    if (route.request().method() === 'POST') {
      current.progress.read = true;
      return route.fulfill({ json: current });
    }
    if (deferRead) { pendingRead = route; return; }
    return route.fulfill({ json: current });
  });
  await ready(page);
  await expect(page.locator('.daily-progress-metrics')).toContainText(`${current.activity.xp} XP`);
  current.activity.xp += 20;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.daily-progress-metrics')).toContainText(`${current.activity.xp} XP`);
  await openRoute(page, 'learning/dsa');
  await example(page);
  deferRead = true;
  await page.getByRole('button', { name: 'Refresh learning', exact: true }).click();
  await expect.poll(() => Boolean(pendingRead)).toBe(true);
  await assertCheckedSave(page, readingLabel);
  await pendingRead.fulfill({ json: snapshot }).catch(() => {});
  await expect(page.getByRole('checkbox', { name: readingLabel, exact: true })).toBeChecked();
  await expect(page.locator('.daily-workspace-footer')).toContainText('1 of 3 checkpoints complete');
  deferRead = false;
  await page.getByRole('navigation', { name: 'Learning workspace' }).getByRole('link', { name: 'Progress', exact: true }).click();
  await expect(page.locator('.learning-xp')).toContainText(`${current.activity.xp} XP earned`);
});

test('an open daily workspace advances both sources at midnight and stops refreshing after leaving', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/learning/dsa')).json();
  const hub = await (await request.get('/api/learning/daily')).json();
  await page.clock.install({ time: new Date('2026-10-26T23:59:30') });
  snapshot.date = hub.date = '2026-10-26';
  let dsaReads = 0, dailyReads = 0, nextDay = false;
  await page.route('**/api/learning/dsa', route => {
    dsaReads++;
    return route.fulfill({ json: nextDay ? { ...snapshot, date: '2026-10-27',
      lesson: { ...snapshot.lesson, title: 'Next day’s topic' } } : snapshot });
  });
  await page.route('**/api/learning/daily', route => {
    dailyReads++;
    return route.fulfill({ json: nextDay ? { ...hub, date: '2026-10-27',
      plan: { ...hub.plan, day: 2, title: 'Caching and freshness', read: false } } : hub });
  });
  await ready(page);
  await expect(page.getByRole('heading', { name: 'How the web works', exact: true })).toBeVisible();
  nextDay = true;
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('heading', { name: 'Next day’s topic', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Caching and freshness', exact: true })).toBeVisible();
  await ready(page, 'overview');
  const afterLeaving = [dsaReads, dailyReads];
  await page.clock.fastForward(120_000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect([dsaReads, dailyReads]).toEqual(afterLeaving);
});

for (const unavailable of ['plan', 'dsa']) {
  test(`a partial midnight refresh hides yesterday's ${unavailable} task until it recovers`, async ({ page, request }) => {
    const snapshot = await (await request.get('/api/learning/dsa')).json();
    const hub = await (await request.get('/api/learning/daily')).json();
    await page.clock.install({ time: new Date('2026-10-26T23:59:30') });
    snapshot.date = hub.date = '2026-10-26';
    let nextDay = false, fail = true;
    await page.route('**/api/learning/dsa', route => {
      if (nextDay && fail && unavailable === 'dsa') return route.fulfill({ status: 503, json: { error: 'Temporary DSA failure.' } });
      return route.fulfill({ json: nextDay ? { ...snapshot, date: '2026-10-27',
        lesson: { ...snapshot.lesson, title: 'Next day’s topic' } } : snapshot });
    });
    await page.route('**/api/learning/daily', route => {
      if (nextDay && fail && unavailable === 'plan') return route.fulfill({ status: 503, json: { error: 'Temporary plan failure.' } });
      return route.fulfill({ json: nextDay ? { ...hub, date: '2026-10-27',
        plan: { ...hub.plan, day: 2, title: 'Caching and freshness', read: false } } : hub });
    });
    await ready(page);
    await expect(page.getByRole('heading', { name: 'How the web works', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hash sets & frequency maps', exact: true })).toBeVisible();
    nextDay = true;
    await page.clock.fastForward(61_000);
    await expect(page.getByRole('alert')).toContainText('A new day has started');
    await expect(page.getByRole('heading', { name: unavailable === 'plan' ? 'How the web works' : 'Hash sets & frequency maps', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: unavailable === 'plan' ? 'Next day’s topic' : 'Caching and freshness', exact: true })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Refresh learning', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Next day’s topic', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Caching and freshness', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('Today orders all seven priorities and opens the saved papers, news and companies directly', async ({ page, request }) => {
  const daily = await (await request.get('/api/learning/daily')).json();
  await ready(page);
  await expect(page.locator('.daily-agenda [data-learning-task]')).toHaveCount(7);
  expect(await page.locator('.daily-agenda [data-learning-task]').evaluateAll(rows => rows.map(row => row.dataset.learningTask)))
    .toEqual(['dsa', 'plan', 'papers', 'goal', 'design', 'tech', 'companies']);
  await expect(page.locator('#nav .sidebar-scroll').getByRole('link', { name: 'Learning', exact: true })).toHaveCount(1);
  await expect(page.locator('#nav').getByRole('link', { name: 'Research Studio', exact: true })).toHaveCount(0);
  await expect(page.locator('#nav').getByRole('link', { name: 'Learning path', exact: true })).toHaveCount(0);
  for (const [key, title] of [['papers', 'Research worth reading today'], ['tech', 'Today’s technology notes'], ['companies', 'Companies to explore today']]) {
    const source = daily.readings.find(item => item.key === key);
    await expect(task(page, key).getByRole('link').first()).toHaveAttribute('href', source.route);
    await task(page, key).getByRole('link').first().click();
    await expect(page.locator('.learning-library-reading').getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Continue today’s priorities →', exact: true }).click();
    await expect(page.locator('.daily-agenda')).toBeVisible();
  }
});

test('section navigation keeps the current page clear and today’s first task visible on desktop, tablet and phone', async ({ page }) => {
  test.setTimeout(75_000);
  const sections = [
    ['Today', '#/learning', 'Today’s learning'],
    ['DSA practice', '#/learning/dsa?step=practice', 'DSA practice'],
    ['Practice & exams', '#/learning/practice', 'Practice & exams'],
    ['Resume topics', '#/learning/resume', 'Resume topics'],
    ['Courses', '#/learning/courses', 'Courses'],
    ['Saved library', '#/learning/library', 'Saved library'],
    ['Progress', '#/learning/progress', 'Your progress'],
  ];
  await ready(page);
  const navigation = page.getByRole('navigation', { name: 'Learning workspace', exact: true });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('link')).toHaveCount(sections.length);
  await expect(page.locator('#nav .sidebar-scroll').getByRole('link', { name: 'Learning', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('combobox', { name: 'Learning section', exact: true })).not.toBeVisible();
  for (const [label, href, title] of sections) {
    await navigation.getByRole('link', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
    await expect(navigation.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(navigation.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
    if (label === 'DSA practice') {
      await expect(page.getByRole('tab', { name: '03 Practice', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.cm-content[aria-label="Python code editor"]')).toBeVisible();
    }
  }
  for (const width of [375, 768, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    const selector = page.getByRole('combobox', { name: 'Learning section', exact: true });
    await expect(selector).toBeVisible();
    await expect(selector).toHaveAttribute('data-value', '#/learning');
    await expect(selector).toBeInViewport({ ratio: 1 });
    await expect(task(page, 'dsa').getByRole('link').first()).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.daily-tabs')).toHaveCount(0);
    await fit(page);
    for (const [label, href, title] of sections.slice(1)) {
      await selector.click();
      await page.getByRole('option', { name: label, exact: true }).click();
      await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
      await expect(selector).toHaveAttribute('data-value', href);
      await fit(page);
    }
    await selector.click();
    await page.getByRole('option', { name: 'Today', exact: true }).click();
    await expect(page.locator('.daily-agenda')).toBeVisible();
    await task(page, 'dsa').getByRole('link').first().click();
    await expect(page.getByRole('heading', { name: 'DSA practice', level: 1, exact: true })).toBeVisible();
    await expect(selector).toHaveAttribute('data-value', '#/learning/dsa?step=practice');
    await expect(page.getByRole('tab', { name: '03 Practice', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-content[aria-label="Python code editor"]')).toBeVisible();
  }
});

test('a research completion updates Today and shared progress without duplicate XP on reload or repeat completion', async ({ page, request }) => {
  const before = await (await request.get('/api/learning/activity')).json();
  const daily = await (await request.get('/api/learning/daily')).json();
  const paper = daily.readings.find(item => item.key === 'papers');
  await ready(page);
  await task(page, 'papers').getByRole('link').first().click();
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen reading', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reopen reading', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: 'Continue today’s priorities →', exact: true }).click();
  await expect(task(page, 'papers')).toContainText('Complete');
  await expect(page.locator('.daily-session-count')).toHaveText('3 / 7 complete');
  const saved = await (await request.get('/api/learning/activity')).json();
  expect(saved.xp).toBe(before.xp + 10);
  expect(saved.today_count).toBe(before.today_count + 1);
  expect(saved.current_streak).toBe(before.current_streak);
  expect((await request.post('/api/research/read', { data: { id: paper.id, read: true } })).ok()).toBe(true);
  const repeated = await (await request.get('/api/learning/activity')).json();
  expect(repeated.xp).toBe(saved.xp);
  expect(repeated.today_count).toBe(saved.today_count);
  await ready(page, 'learning/read/' + encodeURIComponent(paper.id) + '?from=today');
  await page.getByRole('button', { name: 'Reopen reading', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen reading', exact: true })).toBeEnabled();
  expect((await (await request.get('/api/learning/activity')).json()).xp).toBe(saved.xp);
  await ready(page, 'learning/progress');
  await expect(page.locator('.learning-day-detail')).toContainText('Research worth reading today');
  const history = page.locator('.learning-library-history');
  await expect(history).toContainText('Research worth reading today');
  await expect(history).toContainText('Reopened');
  await expect(history).toContainText('Completed');
  await history.getByRole('link', { name: 'Research worth reading today', exact: true }).first().click();
  await page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: 'Progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Learning history', exact: true })).toBeVisible();
});

test('resume learning continues at the next unfinished topic after a saved completion', async ({ page, request }) => {
  const before = await (await request.get('/api/learning/activity')).json();
  await ready(page, 'learning/resume');
  await expect(page.getByRole('heading', { name: 'Resume topics', exact: true })).toBeVisible();
  await expect(page.locator('.learning-library-continue')).toContainText('Explain your evaluation work');
  await expect(page.getByRole('progressbar', { name: 'Resume topics completed', exact: true })).toHaveAttribute('value', '0');
  await page.getByRole('link', { name: 'Continue resume learning', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Explain your evaluation work', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen reading', exact: true })).toBeEnabled();
  await page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: 'Resume topics', exact: true }).click();
  await expect(page.locator('.learning-library-continue')).toContainText('Explain your serving decisions');
  await expect(page.getByRole('progressbar', { name: 'Resume topics completed', exact: true })).toHaveAttribute('value', '1');
  await page.reload();
  await expect(page.locator('.learning-library-continue')).toContainText('Explain your serving decisions');
  expect((await (await request.get('/api/learning/activity')).json()).xp).toBe(before.xp + 10);
});

test('course progress persists and shares XP while old track links remain usable', async ({ page, request }) => {
  const before = await (await request.get('/api/learning/activity')).json();
  const course = await (await request.get('/api/course')).json();
  const track = course.tracks[0], module = track.modules.find(item => !item.read);
  expect(module).toBeTruthy();
  await ready(page, 'study?track=' + encodeURIComponent(track.name));
  await expect(page.getByRole('heading', { name: 'Courses', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Course tracks' }).getByRole('link', { name: new RegExp(track.name) })).toHaveAttribute('aria-current', 'page');
  expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('track')).toBe(track.name);
  const checkbox = page.getByRole('checkbox', { name: `Mark ${module.title} complete`, exact: true });
  await checkbox.check(); await expect(checkbox).toBeEnabled(); await expect(checkbox).toBeChecked();
  await page.reload(); await expect(checkbox).toBeChecked();
  const saved = await (await request.get('/api/learning/activity')).json();
  expect(saved.xp).toBe(before.xp + 20);
  await page.setViewportSize({ width: 375, height: 900 });
  const tracks = page.getByRole('combobox', { name: 'Course track', exact: true });
  await expect(tracks).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Course tracks', exact: true })).not.toBeVisible();
  await tracks.click();
  await page.getByRole('option', { name: course.tracks[1].name, exact: true }).click();
  await expect(page.getByRole('heading', { name: course.tracks[1].name, exact: true, level: 2 })).toBeVisible();
  expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('track')).toBe(course.tracks[1].name);
  await tracks.click();
  await page.getByRole('option', { name: track.name, exact: true }).click();
  await expect(checkbox).toBeChecked();
  await fit(page);
  await ready(page, 'learning/progress');
  await expect(page.locator('.learning-day-detail')).toContainText(module.title);
});

test('library aliases, date filters, search and reader back navigation preserve the selected collection', async ({ page, request }) => {
  const daily = await (await request.get('/api/learning/daily')).json();
  const query = new URLSearchParams({ view: 'library', category: 'Briefing', date: daily.date, q: 'Research', size: '24' });
  await ready(page, 'research?' + query);
  await expect(page.getByRole('heading', { name: 'Saved library', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search saved library', exact: true })).toHaveValue('Research');
  await expect(page.getByRole('button', { name: 'Briefing', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const link = page.getByRole('link', { name: /Research worth reading today/ });
  await expect(link).toBeVisible();
  await expect(page.getByRole('link', { name: /Yesterday’s research notes/ })).toHaveCount(0);
  await link.click();
  await expect(page.getByRole('heading', { name: 'Research worth reading today', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: 'Saved library', exact: true }).click();
  await expect(link).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search saved library', exact: true })).toHaveValue('Research');
  let savedQuery = new URLSearchParams(new URL(page.url()).hash.split('?')[1]);
  for (const [key, value] of [['category', 'Briefing'], ['date', daily.date], ['q', 'Research'], ['size', '24']]) expect(savedQuery.get(key)).toBe(value);
  await page.getByRole('button', { name: 'Show all dates', exact: true }).click();
  await expect(page.getByRole('link', { name: /Yesterday’s research notes/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search saved library', exact: true }).fill('Yesterday');
  await expect(page.getByRole('link', { name: /Research worth reading today/ })).toHaveCount(0);
  await page.getByRole('link', { name: /Yesterday’s research notes/ }).click();
  await expect(page.getByRole('heading', { name: 'Yesterday’s research notes', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('searchbox', { name: 'Search saved library', exact: true })).toHaveValue('Yesterday');
  await expect(page.getByRole('link', { name: /Yesterday’s research notes/ })).toBeVisible();
  const oldDoc = daily.readings.find(item => item.key === 'papers');
  await ready(page, 'research/' + encodeURIComponent(oldDoc.id) + '?view=library&category=Briefing&q=Research&date=' + daily.date);
  await expect(page.getByRole('heading', { name: 'Research worth reading today', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: 'Saved library', exact: true })).toHaveAttribute('href', /learning\/library\?/);
});

test('preparing new research requires the preview confirmation and cancel starts no run', async ({ page }) => {
  let previews = 0, runs = 0;
  await page.route('**/api/preview', route => {
    previews++; expect(route.request().postDataJSON().action).toBe('pipeline');
    return route.fulfill({ json: { shown: 'morrow research resume --date 2026-10-26', needed: null } });
  });
  await page.route('**/api/run', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: idle });
    runs++; return route.fulfill({ status: 403, json: { error: 'No bot run permitted in this test.' } });
  });
  await ready(page, 'learning/resume');
  await expect(page.getByRole('button', { name: 'Update resume library', exact: true })).toBeVisible();
  expect(previews).toBe(0); expect(runs).toBe(0);
  await page.getByRole('button', { name: 'Update resume library', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('morrow research resume');
  expect(previews).toBe(1); expect(runs).toBe(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(runs).toBe(0);
});

test('the consolidated workspace and saved reader remain accessible on desktop and mobile', async ({ page, request }) => {
  test.setTimeout(150_000);
  const daily = await (await request.get('/api/learning/daily')).json();
  const paper = daily.readings.find(item => item.key === 'papers');
  const routes = [
    ['learning', 'learning-today', null],
    ['learning/resume', 'learning-resume', 'Resume topics'],
    ['learning/courses', 'learning-courses', 'Courses'],
    ['learning/library', 'learning-library', 'Saved library'],
    ['learning/read/' + encodeURIComponent(paper.id) + '?from=today', 'learning-reader', 'Research worth reading today'],
    ['learning/progress', 'learning-progress', 'Your learning momentum'],
  ];
  for (const width of [1440, 375, 768, 1100]) {
    await page.setViewportSize({ width, height: width === 375 ? 900 : 1000 });
    for (const [route, name, title] of routes) {
      await ready(page, route);
      if (title) await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      if (width <= 1100) {
        const section = route.startsWith('learning/read/') ? 'learning' : route;
        await expect(page.getByRole('combobox', { name: 'Learning section', exact: true })).toHaveAttribute('data-value', '#/' + section);
      }
      await fit(page);
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect.soft(audit.violations.map(item => ({ route, width, id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
      await capture(page, `${name}-${width === 375 ? 'mobile' : width === 1440 ? 'desktop' : width}`);
    }
  }
});

for (const kind of ['reader', 'course']) {
  test(`${kind} saves survive background refreshes and older reads cannot revert them`, async ({ page, request }) => {
    const daily = await (await request.get('/api/learning/daily')).json();
    const paper = daily.readings.find(item => item.key === 'papers');
    const course = await (await request.get('/api/course')).json();
    const track = course.tracks[0], lesson = track.modules[0];
    const document = await (await request.get('/api/document?id=' + encodeURIComponent(paper.id))).json();
    const state = structuredClone(kind === 'reader' ? document : course);
    const setRead = read => { if (kind === 'reader') state.read = read; else state.tracks[0].modules[0].read = read; };
    setRead(false);
    let reads = 0, holdSave = true, pendingSave, holdRead = false, pendingRead, staleRead;
    const readPath = kind === 'reader' ? '**/api/document?*' : '**/api/course';
    const writePath = kind === 'reader' ? '**/api/research/read' : '**/api/course/read';
    await page.route(readPath, route => {
      reads++;
      if (holdRead) { holdRead = false; pendingRead = route; staleRead = structuredClone(state); return; }
      return route.fulfill({ json: state });
    });
    await page.route(writePath, route => {
      if (holdSave) { pendingSave = route; return; }
      setRead(true); return route.fulfill({ json: { ok: true, read: true } });
    });
    await ready(page, kind === 'reader' ? 'learning/read/' + encodeURIComponent(paper.id) + '?from=today'
      : 'learning/courses?track=' + encodeURIComponent(track.name));
    const checkbox = page.getByRole('checkbox', { name: `Mark ${lesson.title} complete`, exact: true });
    const mark = page.getByRole('button', { name: 'Mark complete', exact: true });
    const saving = kind === 'reader' ? page.getByRole('button', { name: 'Saving…', exact: true }) : checkbox;
    const completed = async () => {
      if (kind === 'reader') await expect(page.getByRole('button', { name: 'Reopen reading', exact: true })).toBeEnabled();
      else { await expect(checkbox).toBeChecked(); await expect(checkbox).toBeEnabled(); }
    };
    if (kind === 'reader') await mark.click(); else await checkbox.check();
    await expect.poll(() => Boolean(pendingSave)).toBe(true);
    await expect(saving).toBeDisabled();
    const readsDuringSave = reads;
    await page.evaluate(() => {
      window.dispatchEvent(new Event('learning-refresh')); window.dispatchEvent(new Event('focus'));
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(saving).toBeDisabled();
    expect(reads).toBe(readsDuringSave);
    setRead(true); holdSave = false;
    await pendingSave.fulfill({ json: { ok: true, read: true } });
    await completed();
    await expect.poll(() => reads).toBeGreaterThan(readsDuringSave);

    // Start an older, unread GET before the next save and release it afterwards.
    setRead(false);
    await page.evaluate(() => window.dispatchEvent(new Event('learning-refresh')));
    if (kind === 'reader') await expect(mark).toBeEnabled(); else await expect(checkbox).not.toBeChecked();
    holdRead = true;
    await page.getByRole('button', { name: 'Refresh learning', exact: true }).click();
    await expect.poll(() => Boolean(pendingRead)).toBe(true);
    if (kind === 'reader') await mark.click(); else await checkbox.check();
    await completed();
    await pendingRead.fulfill({ json: staleRead }).catch(() => {});
    await completed();
    await page.reload();
    await completed();
  });
}

const practiceCard = (page, mode, kind) => page.locator(`[data-practice-mode="${mode}"][data-practice-kind="${kind}"]`);
async function practiceState(request) { return (await request.get('/api/learning/practice')).json(); }
function emptyPractice(snapshot, reason = '') {
  const value = structuredClone(snapshot);
  value.settings.automatic = false;
  value.archive = []; value.next_day.carry = [];
  for (const mode of ['daily', 'weekly']) Object.assign(value[mode], {
    status: reason ? 'blocked' : 'pending', job: null, needs_generation: !reason, automatic_ready: !reason,
    papers: ['dsa', 'learning', 'research'].map(kind => ({ kind, status: reason ? 'blocked' : 'pending', reason, paper: null })),
  });
  return value;
}
async function answerPaper(page, count) {
  for (let number = 1; number <= count; number++) {
    await page.getByRole('navigation', { name: 'Practice questions' }).getByRole('button', { name: new RegExp(`^Question ${number}(, answered)?$`) }).click();
    await page.getByRole('textbox', { name: 'Your answer', exact: true }).fill(`Answer ${number}: explain the source idea, an edge case, and a test of the result.`);
    await page.getByRole('button', { name: 'Save answer', exact: true }).click();
    await expect(page.locator('.practice-save-state')).toHaveText('Answer saved');
  }
}

test('the DSA practice sheet filters real problems and preserves status and notes after reload', async ({ page, request }) => {
  const before = await (await request.get('/api/learning/activity')).json();
  await ready(page, 'learning/dsa/sheet');
  await expect(page.getByRole('progressbar', { name: 'Practice sheet completion' })).toHaveAttribute('max', '72');
  await expect(page.locator('.dsa-topic')).toHaveCount(11);
  await page.getByRole('searchbox', { name: 'Search DSA problems' }).fill('Contains Duplicate');
  await expect(page.locator('.dsa-problem-list li')).toHaveCount(1);
  await page.getByRole('link', { name: 'Open Contains Duplicate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contains Duplicate', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Your approach and notes' }).fill('Use a set. Return early when an element is already present. O(n) time and space.');
  await choose(page, 'Your problem status', 'Solved');
  await page.getByRole('button', { name: 'Save progress', exact: true }).click();
  await expect(page.locator('.dsa-sheet-feedback')).toContainText('Your practice progress is saved.');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Your approach and notes' })).toHaveValue(/Use a set/);
  await expect(page.locator('.dsa-problem-workspace .dsa-problem-status')).toHaveText('Solved');
  await page.getByRole('link', { name: '← Back to practice sheet', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search DSA problems' })).toHaveValue('Contains Duplicate');
  await choose(page, 'Problem status', 'Solved');
  await expect(page.locator('.dsa-problem-list li')).toHaveCount(1);
  await expect(page.locator('.dsa-problem-list')).toContainText('Contains Duplicate');
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search DSA problems' })).toHaveValue('Contains Duplicate');
  const filters = new URLSearchParams(new URL(page.url()).hash.split('?')[1]);
  expect(filters.get('q')).toBe('Contains Duplicate'); expect(filters.get('status')).toBe('solved');
  await expect(page.locator('.dsa-problem-list li')).toHaveCount(1);
  expect((await (await request.get('/api/learning/activity')).json()).xp).toBe(before.xp);
});

test('DSA problem drafts survive refresh and a failed save can be retried without losing notes', async ({ page, request }) => {
  const identifier = '01-arrays-strings-hashing/problem-4';
  const original = await (await request.get('/api/learning/dsa/problem?id=' + encodeURIComponent(identifier))).json();
  let fail = true, saves = 0;
  await page.route('**/api/learning/dsa/problem', route => {
    saves++;
    if (fail) return route.fulfill({ status: 503, json: { error: 'Practice storage temporarily unavailable.' } });
    return route.continue();
  });
  await ready(page, 'learning/dsa/problem/' + encodeURIComponent(identifier));
  const notes = page.getByRole('textbox', { name: 'Your approach and notes' });
  await expect(notes).toBeVisible();
  let pendingRead, hold = true;
  await page.route('**/api/learning/dsa/problem?*', route => {
    if (hold) { hold = false; pendingRead = route; return; }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Refresh learning', exact: true }).click();
  await expect.poll(() => Boolean(pendingRead)).toBe(true);
  await notes.fill('Group strings by a canonical character count.');
  await choose(page, 'Your problem status', 'Attempted');
  await pendingRead.fulfill({ json: original }).catch(() => {});
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('learning-refresh')); });
  await expect(notes).toHaveValue('Group strings by a canonical character count.');
  await openRoute(page, 'learning');
  await expect(page.locator('.daily-agenda')).toBeVisible();
  await openRoute(page, 'learning/dsa/problem/' + encodeURIComponent(identifier));
  await expect(notes).toHaveValue('Group strings by a canonical character count.');
  await page.getByRole('button', { name: 'Save progress', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Practice storage temporarily unavailable');
  await expect(notes).toHaveValue('Group strings by a canonical character count.');
  fail = false;
  await page.getByRole('button', { name: 'Save progress', exact: true }).click();
  await expect(page.locator('.dsa-sheet-feedback')).toContainText('Your practice progress is saved.');
  expect(saves).toBe(2);
  const saved = await (await request.get('/api/learning/dsa/problem?id=' + encodeURIComponent(identifier))).json();
  expect(saved.status).toBe('attempted'); expect(saved.notes).toBe('Group strings by a canonical character count.');
});

test('AI daily practice prepares three grounded papers and saves, retries, reloads and submits answers', async ({ page, request }) => {
  await ready(page, 'learning/practice');
  await page.getByRole('button', { name: 'Start AI practice', exact: true }).click();
  for (const kind of ['dsa', 'learning', 'research']) await expect(practiceCard(page, 'daily', kind).getByRole('link', { name: /^Open paper:/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Prepare daily practice automatically', exact: true })).toBeChecked();
  const initial = await practiceState(request);
  expect(initial.daily.papers.map(slot => slot.paper.kind)).toEqual(['dsa', 'learning', 'research']);
  expect(initial.daily.papers.every(slot => slot.paper.questions.length === 3 && slot.paper.sources.length > 0)).toBe(true);
  const repeated = await (await request.post('/api/learning/practice/generate', { data: { mode: 'daily' } })).json();
  expect(repeated.status.daily.papers.map(slot => slot.paper.id)).toEqual(initial.daily.papers.map(slot => slot.paper.id));
  await page.getByRole('checkbox', { name: 'Prepare daily practice automatically', exact: true }).uncheck();
  await expect.poll(async () => (await practiceState(request)).settings.automatic).toBe(false);
  await practiceCard(page, 'daily', 'dsa').getByRole('link', { name: 'Open paper: DSA practice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Submit paper', exact: true })).toBeDisabled();
  const dsaPaper = initial.daily.papers.find(slot => slot.kind === 'dsa').paper;
  const codeKey = `practice/${dsaPaper.id}/${dsaPaper.questions[0].id}`;
  const exercise = await (await request.get('/api/learning/code/problem', { params: { key: codeKey, language: 'python' } })).json();
  expect(exercise.problem_key).toMatch(/^dsa\/.+\/problem-\d+$/);
  const editor = page.locator('.cm-content[aria-label="Python code editor"]');
  await expect(editor).toBeVisible();
  const sharedCode = 'def solve(input):\n    return None\n# Shared AI and sheet draft.\n';
  await editor.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(sharedCode);
  await page.getByRole('button', { name: 'Save code', exact: true }).click();
  await expect(page.locator('.code-save-status')).toHaveText('Code saved on this computer');
  const sheetExercise = await (await request.get('/api/learning/code/problem', { params: { key: exercise.problem_key, language: 'python' } })).json();
  expect(sheetExercise.draft.code).toBe(sharedCode);
  await page.reload(); await expect(page.locator('.cm-content')).toContainText('Shared AI and sheet draft.');
  let fail = true;
  await page.route('**/api/learning/practice/answer', route => fail
    ? route.fulfill({ status: 503, json: { error: 'Answer storage temporarily unavailable.' } }) : route.continue());
  const answer = page.getByRole('textbox', { name: 'Your answer', exact: true });
  await answer.fill('Draft: use a frequency map and compare counts.');
  await page.getByRole('button', { name: 'Save answer', exact: true }).click();
  await expect(page.locator('.practice-save-state')).toContainText('Could not save');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(answer).toHaveValue('Draft: use a frequency map and compare counts.');
  fail = false;
  await page.getByRole('button', { name: 'Save answer', exact: true }).click();
  await expect(page.locator('.practice-save-state')).toHaveText('Answer saved');
  await page.reload();
  await expect(answer).toHaveValue('Draft: use a frequency map and compare counts.');
  await answerPaper(page, 3);
  const before = await (await request.get('/api/learning/activity')).json();
  await page.getByRole('button', { name: 'Submit paper', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paper submitted', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Your submitted answer', exact: true })).toHaveAttribute('readonly');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Paper submitted', exact: true })).toBeDisabled();
  expect((await (await request.get('/api/learning/activity')).json()).xp).toBe(before.xp + 10);
  await request.post('/api/learning/practice/answer', { data: { paper_id: initial.daily.papers[0].paper.id, completed: true } });
  expect((await (await request.get('/api/learning/activity')).json()).xp).toBe(before.xp + 10);
});

test('weekly exams contain three papers and reveal reference answers only after all questions are submitted', async ({ page, request }) => {
  await ready(page, 'learning/practice');
  await page.getByRole('button', { name: 'Prepare weekly exam', exact: true }).click();
  for (const kind of ['dsa', 'learning', 'research']) await expect(practiceCard(page, 'weekly', kind).getByRole('link')).toBeVisible();
  const state = await practiceState(request), paper = state.weekly.papers.find(slot => slot.kind === 'dsa').paper;
  expect(state.weekly.papers.every(slot => slot.paper.questions.length === 5)).toBe(true);
  expect(paper.questions.every(question => !('reference_answer' in question))).toBe(true);
  await practiceCard(page, 'weekly', 'dsa').getByRole('link').click();
  await expect(page.locator('.practice-reference')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Submit paper', exact: true })).toBeDisabled();
  await answerPaper(page, 5);
  let pending;
  await page.route('**/api/learning/practice/answer', route => {
    if (route.request().postDataJSON().completed) { pending = route; return; }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Submit paper', exact: true }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Your answer', exact: true })).toHaveAttribute('readonly');
  await expect(page.locator('.practice-reference')).toHaveCount(0);
  await pending.continue();
  await expect(page.getByRole('button', { name: 'Paper submitted', exact: true })).toBeDisabled();
  await expect(page.locator('.practice-reference')).toHaveAttribute('open');
  await expect(page.locator('.practice-reference-answer')).toContainText('Reference dsa reasoning');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Your submitted answer', exact: true })).toHaveValue(/Answer/);
  const saved = await (await request.get('/api/learning/practice/paper?id=' + paper.id)).json();
  expect(saved.completed_at).toBeTruthy();
  expect(saved.questions.every(question => question.reference_answer && question.answer)).toBe(true);
});

test('practice without an AI connection offers setup and never tries generation', async ({ page, request }) => {
  const state = emptyPractice(await practiceState(request)); state.configured = false; state.provider = null;
  let generated = 0;
  await page.route('**/api/learning/practice', route => route.fulfill({ json: state }));
  await page.route('**/api/learning/practice/generate', route => { generated++; return route.fulfill({ status: 503, json: { error: 'No AI connection.' } }); });
  await ready(page, 'learning/practice');
  await expect(page.getByRole('link', { name: 'Set up AI connection', exact: true })).toHaveAttribute('href', '#/connections');
  await expect(page.getByRole('button', { name: 'Start AI practice', exact: true })).toHaveCount(0);
  expect(generated).toBe(0);
});

test('practice without saved sources explains the missing material and keeps generation unavailable', async ({ page, request }) => {
  const state = emptyPractice(await practiceState(request), 'No saved source is available. Complete or prepare learning material first.');
  let generated = 0;
  await page.route('**/api/learning/practice', route => route.fulfill({ json: state }));
  await page.route('**/api/learning/practice/generate', route => { generated++; return route.fulfill({ status: 400, json: { error: 'No saved source.' } }); });
  await ready(page, 'learning/practice');
  await expect(practiceCard(page, 'daily', 'dsa')).toContainText('No saved source is available');
  await expect(page.getByRole('link', { name: 'Open today’s learning', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start AI practice|Prepare weekly exam/ })).toHaveCount(0);
  expect(generated).toBe(0);
});

test('failed AI preparation shows the error and a retry reuses existing saved papers', async ({ page, request }) => {
  const existing = await practiceState(request), state = emptyPractice(existing);
  let recover = false, attempts = 0;
  await page.route('**/api/learning/practice', route => recover ? route.continue() : route.fulfill({ json: state }));
  await page.route('**/api/learning/practice/settings', route => route.fulfill({ json: { automatic: true } }));
  await page.route('**/api/learning/practice/generate', route => {
    attempts++;
    if (!recover) return route.fulfill({ status: 503, json: { error: 'AI connection is temporarily unavailable. Retry preparation.' } });
    return route.continue();
  });
  await ready(page, 'learning/practice');
  await page.getByRole('button', { name: 'Start AI practice', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('AI connection is temporarily unavailable');
  recover = true;
  await page.getByRole('button', { name: 'Start AI practice', exact: true }).click();
  await expect(practiceCard(page, 'daily', 'learning').getByRole('link')).toBeVisible();
  expect(attempts).toBe(2);
  expect((await practiceState(request)).daily.papers.map(slot => slot.paper.id)).toEqual(existing.daily.papers.map(slot => slot.paper.id));
});

test('practice sheet, problem workspace, AI papers and exams are accessible on desktop and phone', async ({ page, request }) => {
  test.setTimeout(100_000);
  const state = await practiceState(request);
  const daily = state.daily.papers.find(slot => slot.kind === 'learning').paper;
  const weekly = state.weekly.papers.find(slot => slot.kind === 'learning').paper;
  const routes = [['learning/dsa/sheet', 'dsa-sheet', '.dsa-topic'],
    ['learning/dsa/problem/' + encodeURIComponent('01-arrays-strings-hashing/problem-1'), 'dsa-problem', '.dsa-problem-workspace'],
    ['learning/practice', 'ai-practice', '.practice-paper-grid'],
    ['learning/practice/paper/' + daily.id, 'ai-daily-paper', '.practice-question'],
    ['learning/practice/paper/' + weekly.id, 'ai-weekly-paper', '.practice-question']];
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 900 : 1000 });
    for (const [route, name, selector] of routes) {
      await ready(page, route); await expect(page.locator(selector).first()).toBeVisible(); await fit(page);
      if (route.startsWith('learning/practice')) {
        expect(await page.locator('.practice-workspace').evaluate(root => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), invalid = [];
          while (walker.nextNode()) if (/^(null|undefined)$/.test(walker.currentNode.textContent.trim())) invalid.push(walker.currentNode.textContent);
          return invalid;
        })).toEqual([]);
      }
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect.soft(audit.violations.map(item => ({ route, width, id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
      await capture(page, `${name}-${width}`);
    }
  }
});
