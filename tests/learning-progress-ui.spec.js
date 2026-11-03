import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const idle = { epoch: 'learning-progress', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

const test = base.extend({
  learning: [async ({ page, request }, use) => {
    await mkdir('artifacts/learning-progress', { recursive: true });
    const [dailyResponse, dsaResponse] = await Promise.all([
      request.get('/api/learning/daily'), request.get('/api/learning/dsa'),
    ]);
    expect(dailyResponse.ok()).toBe(true);
    expect(dsaResponse.ok()).toBe(true);
    const daily = await dailyResponse.json(), dsa = await dsaResponse.json();
    daily.plan.read = false; daily.plan.completed = 0;
    dsa.progress.read = false; dsa.progress.practiced = []; dsa.progress.completed_at = null;
    const state = { daily, dsa, failDaily: false, failDsa: false, errors: [], writes: [] };
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(run => {
      window.EventSource = class extends EventTarget {
        constructor() { super(); this.timer = setTimeout(() => this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(run) })), 0); }
        close() { clearTimeout(this.timer); }
      };
    }, idle);
    page.on('pageerror', error => state.errors.push(error.message));
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (!['GET', 'HEAD'].includes(route.request().method())) {
        state.writes.push(path);
        return route.fulfill({ status: 403, json: { error: 'Progress review never changes saved learning or starts jobs.' } });
      }
      if (path === '/api/learning/daily') return route.fulfill(state.failDaily
        ? { status: 503, json: { error: 'Course progress temporarily unavailable.' } } : { json: state.daily });
      if (path === '/api/learning/dsa') return route.fulfill(state.failDsa
        ? { status: 503, json: { error: 'Coding progress temporarily unavailable.' } } : { json: state.dsa });
      if (path.startsWith('/api/learning/') || ['/api/research/learning', '/api/library', '/api/document', '/api/course'].includes(path)) return route.continue();
      const data = {
        '/api/session': { mode: 'local', legacy_access: true, user: null },
        '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
        '/api/status': { name: 'Learner', greeting: 'Hello', date: daily.date, date_long: daily.date, run: idle,
          questions: [], facts: [], sites: [], study: { today: null, read: 0, total: 0 }, report: { ready: false, days: [] } },
        '/api/run': idle, '/api/bots': { bots: [], run: idle },
        '/api/overview': { days: 14, recent: [], boards: [], workspace: { research_count: 0, learning_done: 0 } },
      };
      return route.fulfill({ json: data[path] || {} });
    });
    await use(state);
    expect(state.errors).toEqual([]);
    expect(state.writes).toEqual([]);
  }, { auto: true }],
});

async function home(page) {
  await page.goto('/#/learning');
  await expect(page.locator('.learning-home-layout')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
}

const task = (page, key) => page.locator(`[data-learning-task="${key}"]`);
const dailyProgress = page => page.getByRole('progressbar', { name: 'Today’s completed priorities', exact: true });

for (const width of [390, 768, 1440]) {
  test(`daily progress is clear and accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await home(page);
    await expect(dailyProgress(page)).toHaveAttribute('aria-valuenow', '0');
    await expect(dailyProgress(page)).toHaveAttribute('aria-valuemax', '2');
    await expect(task(page, 'plan')).toContainText('Next');
    await expect(task(page, 'dsa')).toContainText('Still to do');
    await expect(page.locator('[data-time-left]')).toContainText('About 4h left');
    await expect(page.locator('[data-disclosure="today-outline"]')).not.toHaveAttribute('open', '');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const audit = await new AxeBuilder({ page }).include('.daily-page').analyze();
    expect(audit.violations).toEqual([]);
    await mkdir('artifacts/learning-progress', { recursive: true });
    await page.screenshot({ path: `artifacts/learning-progress/empty-${width}.png`, fullPage: true });
    await page.screenshot({ path: `artifacts/learning-progress/empty-${width}-viewport.png` });
  });
}

for (const [done, expectedNext] of [[1, 'dsa'], [2, null]]) {
  test(`${done} completed tasks have correct ring, labels and next action`, async ({ page, learning }) => {
    learning.daily.plan.read = true; learning.daily.plan.completed = 1;
    if (done === 2) learning.dsa.progress.completed_at = learning.daily.date + 'T10:00:00';
    await home(page);
    await expect(dailyProgress(page)).toHaveAttribute('aria-valuenow', String(done));
    await expect(dailyProgress(page)).toHaveAttribute('aria-valuemax', '2');
    await expect(task(page, 'plan')).toContainText('Done');
    await expect(task(page, 'dsa')).toContainText(expectedNext ? 'Next' : 'Done');
    expect(await page.locator('.learning-ring-fill').evaluate(element => parseFloat(getComputedStyle(element).strokeDashoffset))).toBe(100 - done * 50);
    await expect(page.locator('[data-time-left]')).toContainText(expectedNext ? 'About 1h left' : 'All planned work complete');
    if (expectedNext) await expect(page.locator('.daily-preview-action a')).toHaveAttribute('href', '#/learning/dsa');
    await page.screenshot({ path: `artifacts/learning-progress/done-${done}.png`, fullPage: true });
  });
}

test('lesson outline and optional resources open with accessible controls', async ({ page }) => {
  await home(page);
  const outline = page.locator('[data-disclosure="today-outline"]');
  const extras = page.locator('[data-disclosure="extras"]');
  await expect(extras).not.toHaveAttribute('open', '');
  await outline.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(outline).toHaveAttribute('open', '');
  await expect(outline.locator('.learning-topic-card')).toHaveCount(4);
  await extras.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(extras).toHaveAttribute('open', '');
  await expect(page.getByRole('progressbar', { name: 'Course days complete', exact: true })).toBeVisible();
  const audit = await new AxeBuilder({ page }).include('.daily-page').analyze();
  expect(audit.violations).toEqual([]);
  await expect(dailyProgress(page)).toHaveAttribute('aria-valuenow', '0');
});

test('finished course leaves only the unfinished coding task in today’s progress', async ({ page, learning }) => {
  Object.assign(learning.daily.plan, { available: false, day: null, read: false, completed: 90, lesson: null,
    title: '90-day course complete', reason: 'You have completed all 90 days.' });
  await home(page);
  await expect(dailyProgress(page)).toHaveAttribute('aria-valuenow', '0');
  await expect(dailyProgress(page)).toHaveAttribute('aria-valuemax', '1');
  await expect(task(page, 'plan')).toContainText('Done');
  await expect(task(page, 'dsa')).toContainText('Next');
  await expect(page.locator('.daily-preview-action a')).toHaveAttribute('href', '#/learning/dsa');
});

test('unavailable course progress stays unknown instead of looking complete', async ({ page, learning }) => {
  learning.failDaily = true;
  learning.dsa.progress.completed_at = learning.daily.date + 'T10:00:00';
  await home(page);
  await expect(task(page, 'plan')).toContainText(/Needs attention|Could not load|Unavailable/);
  await expect(dailyProgress(page)).not.toHaveAttribute('aria-valuenow');
  await expect(page.locator('.learning-home-layout')).not.toContainText('100%');
  await expect(page.getByRole('heading', { name: 'Today’s work is done.', exact: true })).not.toBeVisible();
});

test('saved completion animates the progress circle once and reduced motion disables that movement', async ({ page, learning }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await home(page);
  learning.daily.plan.read = true; learning.daily.plan.completed = 1;
  await page.evaluate(() => window.dispatchEvent(new Event('learning-refresh')));
  await expect(dailyProgress(page)).toHaveAttribute('aria-valuenow', '1');
  const fill = page.locator('.learning-ring-fill');
  const offsets = await fill.evaluate(element => new Promise(resolve => {
    const samples = [], started = performance.now();
    function sample() {
      samples.push(parseFloat(getComputedStyle(element).strokeDashoffset));
      if (performance.now() - started > 1000) resolve(samples); else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }));
  expect(new Set(offsets.map(value => Math.round(value))).size).toBeGreaterThan(2);
  await expect.poll(() => fill.evaluate(element => parseFloat(getComputedStyle(element).strokeDashoffset))).toBeCloseTo(50, 0);
  const unchangedFill = await fill.elementHandle();
  const refresh = page.waitForResponse(response => new URL(response.url()).pathname === '/api/learning/daily');
  await page.evaluate(() => window.dispatchEvent(new Event('learning-refresh')));
  await refresh; await settle(page);
  expect(await unchangedFill.evaluate(element => element === document.querySelector('.learning-ring-fill'))).toBe(true);
  expect(await fill.evaluate(element => element.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  learning.dsa.progress.completed_at = learning.daily.date + 'T10:00:00';
  await page.evaluate(() => window.dispatchEvent(new Event('learning-refresh')));
  await expect(dailyProgress(page)).toHaveAttribute('aria-valuenow', '2');
  expect(await fill.evaluate(element => element.getAnimations().length)).toBe(0);
  expect(await fill.evaluate(element => parseFloat(getComputedStyle(element).strokeDashoffset))).toBe(0);
});

test('study timer measures only running time and never completes a task', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await home(page);
  const timer = page.locator('.study-timer'), value = timer.locator('.study-timer-value');
  await expect(value).toHaveText('00:00');
  await timer.getByRole('button', { name: 'Start timer', exact: true }).click();
  await page.clock.fastForward(5000);
  await expect(value).toHaveText('00:05');
  await expect(timer.getByRole('button', { name: 'Reset timer', exact: true })).toBeDisabled();
  await timer.getByRole('button', { name: 'Pause timer', exact: true }).click();
  await page.clock.fastForward(10000);
  await expect(value).toHaveText('00:05');
  await expect(dailyProgress(page)).toHaveAttribute('aria-valuenow', '0');
  await timer.getByRole('button', { name: 'Reset timer', exact: true }).click();
  await expect(value).toHaveText('00:00');
});

test('study timer survives Learning navigation and reload but pauses outside Learning', async ({ page }) => {
  // Use the real browser clock here: Playwright's fake performance removes the
  // navigation entry the timer correctly uses to distinguish an actual reload.
  const storedTimer = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('morrow.study-timer.v1:local')));
  await home(page);
  const timer = page.locator('.study-timer'), value = timer.locator('.study-timer-value');
  await timer.getByRole('button', { name: 'Start timer', exact: true }).click();
  await expect.poll(async () => (await storedTimer()).elapsedMs).toBeGreaterThanOrEqual(1000);
  await page.locator('.daily-preview-action a').click();
  await expect(page.locator('.lesson-reader')).toBeVisible();
  await expect.poll(async () => (await storedTimer()).elapsedMs).toBeGreaterThanOrEqual(2000);
  const beforeReload = (await storedTimer()).elapsedMs;
  await page.reload();
  await expect(page.locator('.lesson-reader')).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type)).toBe('reload');
  await expect.poll(async () => (await storedTimer()).running).toBe(true);
  await expect.poll(async () => (await storedTimer()).elapsedMs).toBeGreaterThanOrEqual(beforeReload + 1000);
  await page.evaluate(() => { location.hash = '#/learning'; });
  await expect(timer.getByRole('button', { name: 'Pause timer', exact: true })).toBeVisible();
  const homeElapsed = (await storedTimer()).elapsedMs;
  await page.reload();
  await expect(timer.getByRole('button', { name: 'Pause timer', exact: true })).toBeVisible();
  await expect.poll(async () => (await storedTimer()).elapsedMs).toBeGreaterThanOrEqual(homeElapsed + 1000);
  await page.evaluate(() => { location.hash = '#/overview'; });
  await expect(page.getByRole('heading', { name: 'Launchpad', exact: true })).toBeVisible();
  const paused = await storedTimer();
  expect(paused.running).toBe(false);
  await page.waitForTimeout(1100);
  await page.evaluate(() => { location.hash = '#/learning'; });
  await expect(timer.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
  expect((await storedTimer()).elapsedMs).toBe(paused.elapsedMs);
  await expect(value).toHaveText(`00:${String(Math.floor(paused.elapsedMs / 1000)).padStart(2, '0')}`);
  await expect(dailyProgress(page)).toHaveAttribute('aria-valuenow', '0');
});

test('unchanged progress refresh keeps timer focus, elapsed time and open details', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await home(page);
  const outline = page.locator('[data-disclosure="today-outline"]');
  await outline.locator(':scope > summary').click();
  const timer = page.locator('.study-timer'), toggle = timer.locator('.study-timer-toggle');
  await toggle.click();
  await page.clock.fastForward(3000);
  const originalToggle = await toggle.elementHandle();
  for (const event of ['focus', 'learning-refresh']) {
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/learning/daily');
    await page.evaluate(type => window.dispatchEvent(new Event(type)), event);
    await response; await settle(page);
    await expect(toggle).toBeFocused();
    await expect(outline).toHaveAttribute('open', '');
    expect(await originalToggle.evaluate(element => element === document.querySelector('.study-timer-toggle'))).toBe(true);
  }
  await page.clock.fastForward(2000);
  await expect(timer.locator('.study-timer-value')).toHaveText('00:05');
  await expect(dailyProgress(page)).toHaveAttribute('aria-valuenow', '0');
});

test('hiding the tab pauses the study timer until the learner restarts it', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await home(page);
  const timer = page.locator('.study-timer'), value = timer.locator('.study-timer-value');
  await timer.getByRole('button', { name: 'Start timer', exact: true }).click();
  await page.clock.fastForward(4000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(15000);
  await page.evaluate(() => {
    delete document.hidden; delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(timer.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
  await expect(value).toHaveText('00:04');
  await expect(dailyProgress(page)).toHaveAttribute('aria-valuenow', '0');
});
