import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const idle = { epoch: 'course-timer', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const timer = page => page.locator('.study-timer');
const value = page => timer(page).locator('.study-timer-value');
const toggle = page => timer(page).locator('.study-timer-toggle');
const reset = page => timer(page).locator('.study-timer-reset');
const seconds = async page => (await value(page).textContent()).trim().split(':').reduce((total, part) => total * 60 + Number(part), 0);

const test = base.extend({
  course: [async ({ page, request }, use) => {
    await mkdir('artifacts/course-timer', { recursive: true });
    const [dailyReply, dsaReply] = await Promise.all([request.get('/api/learning/daily'), request.get('/api/learning/dsa')]);
    expect(dailyReply.ok()).toBe(true); expect(dsaReply.ok()).toBe(true);
    const daily = await dailyReply.json(), dsa = await dsaReply.json();
    daily.plan.read = false; daily.plan.completed = 0;
    dsa.progress.read = false; dsa.progress.practiced = []; dsa.progress.completed_at = null;
    const state = { daily, dsa, errors: [], writes: [] };
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
        return route.fulfill({ status: 403, json: { error: 'Course timer review never changes saved learning or starts jobs.' } });
      }
      if (path === '/api/learning/daily') return route.fulfill({ json: state.daily });
      if (path === '/api/learning/dsa') return route.fulfill({ json: state.dsa });
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

async function openCourse(page) {
  await page.goto('/#/learning/plan');
  await expect(page.locator('.course-reading')).toBeVisible();
  await expect(timer(page)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
}

test('course opens independently of DSA and activity requests', async ({ page }) => {
  const unrelated = [];
  for (const path of ['/api/learning/dsa', '/api/learning/activity']) {
    await page.route('**' + path, route => {
      unrelated.push(path);
      return route.abort('timedout');
    });
  }
  await openCourse(page);
  await expect(page.locator('.daily-content .state-error')).toHaveCount(0);
  expect(unrelated).toEqual([]);
});

test('course recovers from one timed out read automatically', async ({ page }) => {
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.courseReadAttempts = 0;
    window.fetch = (input, options) => {
      if (new URL(typeof input === 'string' ? input : input.url, location.href).pathname === '/api/learning/daily'
        && ++window.courseReadAttempts === 1) {
        return Promise.reject(new DOMException('Request timed out', 'TimeoutError'));
      }
      return fetch(input, options);
    };
  });
  await openCourse(page);
  expect(await page.evaluate(() => window.courseReadAttempts)).toBe(2);
  await expect(page.locator('.daily-content .state-error')).toHaveCount(0);
});

test('learning shows one timeout warning and retries successfully', async ({ page }) => {
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.learningUnavailable = true;
    window.learningReadAttempts = {};
    window.fetch = (input, options) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      if (['/api/learning/daily', '/api/learning/dsa'].includes(path)) {
        window.learningReadAttempts[path] = (window.learningReadAttempts[path] || 0) + 1;
        if (window.learningUnavailable) return Promise.reject(new DOMException('Request timed out', 'TimeoutError'));
      }
      return fetch(input, options);
    };
  });
  await page.goto('/#/learning');
  const warnings = page.locator('.daily-content .state-error');
  await expect(warnings).toHaveCount(1);
  await expect(warnings).toContainText('The server is taking too long. Try again.');
  expect(await page.evaluate(() => window.learningReadAttempts)).toEqual({ '/api/learning/daily': 2, '/api/learning/dsa': 2 });
  await page.evaluate(() => { window.learningUnavailable = false; });
  await warnings.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(warnings).toHaveCount(0);
  await expect(page.locator('.daily-focus-title')).toHaveText('What is machine learning?');
});

for (const width of [1440, 390]) test(`course timer stays compact and accessible at ${width}px`, async ({ page }) => {
  const midday = new Date(); midday.setHours(12, 0, 0, 0);
  await page.clock.install({ time: midday });
  await page.setViewportSize({ width, height: 1000 });
  await openCourse(page);
  await expect(value(page)).toHaveText('00:00');
  await expect(timer(page)).toBeInViewport();
  const face = timer(page).locator('.study-timer-compact-readout');
  const circle = await face.evaluate(element => {
    const bounds = element.getBoundingClientRect(), radius = getComputedStyle(element).borderTopLeftRadius;
    return { width: bounds.width, height: bounds.height, radius: parseFloat(radius), percent: radius.endsWith('%') };
  });
  expect(Math.abs(circle.width - circle.height)).toBeLessThan(1);
  expect(circle.radius).toBeGreaterThanOrEqual(circle.percent ? 50 : circle.width / 2);
  if (width >= 1120) {
    const [lesson, clock, notes] = await Promise.all([
      page.locator('.course-reading').boundingBox(), timer(page).boundingBox(), page.locator('.study-notes').boundingBox(),
    ]);
    expect(clock.x).toBeGreaterThanOrEqual(lesson.x + lesson.width);
    expect(clock.y + clock.height).toBeLessThanOrEqual(notes.y + 1);
  }
  await mkdir('artifacts/course-timer', { recursive: true });
  await page.screenshot({ path: `artifacts/course-timer/ready-${width}.png` });
  await toggle(page).click();
  await page.clock.fastForward(12000);
  await expect(value(page)).toHaveText('00:12');
  await expect(timer(page)).toHaveAttribute('data-timer-running', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect((await new AxeBuilder({ page }).include('.daily-page').analyze()).violations).toEqual([]);
  await page.screenshot({ path: `artifacts/course-timer/running-${width}.png` });
  await page.clock.fastForward(3600000);
  await expect(value(page)).toHaveText(/^01:00:\d{2}$/);
  console.log(JSON.stringify({ width, longTimeFont: await value(page).evaluate(element => getComputedStyle(element).fontSize),
    toggleWidth: (await toggle(page).boundingBox()).width }));
  const [dialBounds, timeBounds] = await Promise.all([face.boundingBox(), value(page).boundingBox()]);
  expect(timeBounds.x).toBeGreaterThanOrEqual(dialBounds.x);
  expect(timeBounds.x + timeBounds.width).toBeLessThanOrEqual(dialBounds.x + dialBounds.width);
  expect(timeBounds.y).toBeGreaterThanOrEqual(dialBounds.y);
  expect(timeBounds.y + timeBounds.height).toBeLessThanOrEqual(dialBounds.y + dialBounds.height);
  await page.screenshot({ path: `artifacts/course-timer/long-time-${width}.png` });
});

test('course timer counts only running time and reset never completes the lesson', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await openCourse(page);
  await expect(reset(page)).toBeDisabled();
  await toggle(page).click();
  await page.clock.fastForward(5000);
  await expect(value(page)).toHaveText('00:05');
  await expect(reset(page)).toBeDisabled();
  await toggle(page).click();
  await expect(timer(page)).toHaveAttribute('data-timer-running', 'false');
  await page.clock.fastForward(10000);
  await expect(value(page)).toHaveText('00:05');
  await reset(page).click();
  await expect(value(page)).toHaveText('00:00');
  await expect(page.locator('.course-completion')).not.toBeVisible();
});

test('chapter changes and unchanged refresh keep the course timer and its focused control', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await openCourse(page);
  await toggle(page).click();
  await page.clock.fastForward(3000);
  await page.locator('.lesson-path-menu > summary').click();
  await page.locator('[data-lesson-part="systems"]').click();
  await expect(value(page)).toHaveText('00:03');
  await expect(timer(page)).toHaveAttribute('data-timer-running', 'true');
  await toggle(page).focus();
  const original = await toggle(page).elementHandle();
  for (const event of ['focus', 'learning-refresh']) {
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/learning/daily');
    await page.evaluate(type => window.dispatchEvent(new Event(type)), event);
    await refreshed; await settle(page);
    await expect(toggle(page)).toBeFocused();
    expect(await original.evaluate(element => element === document.querySelector('.study-timer-toggle'))).toBe(true);
    await expect(page.locator('[data-lesson-part="systems"]')).toHaveAttribute('aria-current', 'step');
  }
  await page.clock.fastForward(2000);
  await expect(value(page)).toHaveText('00:05');
});

test('Today and the course share one running timer', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await openCourse(page);
  await toggle(page).click();
  await page.clock.fastForward(3000);
  await page.evaluate(() => { location.hash = '#/learning'; });
  await expect(page.locator('.learning-home-layout')).toBeVisible();
  await expect(value(page)).toHaveText('00:03');
  await page.clock.fastForward(2000);
  await expect(value(page)).toHaveText('00:05');
  await page.locator('.daily-preview-action a').click();
  await expect(page.locator('.course-reading')).toBeVisible();
  await expect(value(page)).toHaveText('00:05');
  await expect(timer(page)).toHaveAttribute('data-timer-running', 'true');
  await toggle(page).click();
  await page.clock.fastForward(10000);
  await expect(value(page)).toHaveText('00:05');
});

test('a native course reload resumes the running timer without losing tracked time', async ({ page }) => {
  // Playwright's fake clock removes navigation timing metadata; this case needs
  // the browser's actual reload event and real monotonic clock.
  await openCourse(page);
  await toggle(page).click();
  await expect.poll(() => seconds(page)).toBeGreaterThanOrEqual(1);
  const before = await seconds(page);
  await page.reload();
  await expect(timer(page)).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type)).toBe('reload');
  await expect(timer(page)).toHaveAttribute('data-timer-running', 'true');
  await expect.poll(() => seconds(page)).toBeGreaterThanOrEqual(before + 1);
  await toggle(page).click();
  const paused = await seconds(page);
  await page.reload();
  await expect(timer(page)).toHaveAttribute('data-timer-running', 'false');
  expect(await seconds(page)).toBe(paused);
});

test('saved course progress follows server data and never the elapsed timer', async ({ page, course }) => {
  await page.clock.install({ time: new Date() });
  await openCourse(page);
  const progress = page.getByRole('progressbar', { name: 'Course days completed', exact: true });
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.course-save-state')).toHaveText('Not completed');
  await toggle(page).click();
  await page.clock.fastForward(5000);
  await expect(value(page)).toHaveText('00:05');
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.course-save-state')).toHaveText('Not completed');
  course.daily.plan.completed = 1; course.daily.plan.read = true;
  let refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/learning/daily');
  await page.evaluate(() => window.dispatchEvent(new Event('learning-refresh')));
  await refreshed;
  await expect(progress).toHaveAttribute('aria-valuenow', '1');
  await expect(progress).toHaveAttribute('aria-valuemax', '90');
  await expect(page.locator('.course-save-state')).toHaveText('Day saved');
  await expect(value(page)).toHaveText('00:05');
  await expect(timer(page)).toHaveAttribute('data-timer-running', 'true');
  await page.screenshot({ path: 'artifacts/course-timer/saved-1440.png' });
  course.daily.plan.completed = null;
  refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/learning/daily');
  await page.evaluate(() => window.dispatchEvent(new Event('learning-refresh')));
  await refreshed;
  await expect(progress).not.toHaveAttribute('aria-valuenow');
  await expect(page.locator('.course-saved-count')).toHaveText('Course progress unavailable');
});

for (const [width, motion] of [[1440, 'reduce'], [390, 'reduce'], [1440, 'no-preference']]) {
  test(`reading section follows manual scrolling at ${width}px with ${motion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#/learning/plan?part=build&stage=example');
    const example = page.locator('[data-lesson-section="example"] h3').first();
    await expect(example).toBeFocused();
    await expect(page.locator('[data-lesson-stage="example"]')).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('.lesson-chapter-prose .learning-diagram:is([data-diagram-state="loading"], [data-diagram-state="waiting"])')).toHaveCount(0);
    const originalUrl = page.url();
    await toggle(page).focus();
    for (const key of ['understand', 'example', 'try', 'interview', 'try', 'example', 'understand']) {
      const section = page.locator(`[data-lesson-section="${key}"]`);
      await section.evaluate(element => window.scrollTo({ top: scrollY + element.getBoundingClientRect().top - 32, behavior: 'instant' }));
      const position = await page.evaluate(() => scrollY);
      await expect(page.locator(`[data-lesson-stage="${key}"]`)).toHaveAttribute('aria-current', 'location');
      await expect(toggle(page)).toBeFocused();
      expect(page.url()).toBe(originalUrl);
      expect(Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThan(4);
    }
    await page.locator('.lesson-path-menu > summary').click();
    await page.locator('[data-lesson-part="systems"]').click();
    await expect(page.locator('[data-lesson-part="systems"]')).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('.lesson-chapter-prose .learning-diagram:is([data-diagram-state="loading"], [data-diagram-state="waiting"])')).toHaveCount(0);
    await settle(page);
    const chapterUrl = page.url();
    await toggle(page).focus();
    await page.locator('[data-lesson-section="example"]').evaluate(element => window.scrollTo({ top: scrollY + element.getBoundingClientRect().top - 32, behavior: 'instant' }));
    await expect(page.locator('[data-lesson-stage="example"]')).toHaveAttribute('aria-current', 'location');
    await expect(toggle(page)).toBeFocused();
    expect(page.url()).toBe(chapterUrl);
    await expect(page.getByRole('progressbar', { name: 'Course days completed', exact: true })).toHaveAttribute('aria-valuenow', '0');
  });
}
