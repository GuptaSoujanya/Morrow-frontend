import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const idle = { epoch: 'learning-layout', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const failures = new WeakMap();
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const top = locator => locator.evaluate(element => element.getBoundingClientRect().top);

async function home(page) {
  await page.goto('/#/learning');
  await expect(page.locator('.learning-home-layout')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
}

async function recordMotion(page) {
  await page.addInitScript(() => {
    window.learningReveals = [];
    window.learningScrolls = [];
    const animate = Element.prototype.animate, scroll = Element.prototype.scrollIntoView;
    Element.prototype.animate = function (...args) {
      const key = this.getAttribute('data-learning-reveal');
      if (key) window.learningReveals.push(key);
      return animate.apply(this, args);
    };
    Element.prototype.scrollIntoView = function (options) {
      window.learningScrolls.push({ behavior: options?.behavior, text: this.textContent.slice(0, 100) });
      return scroll.call(this, options);
    };
  });
}

test.beforeEach(async ({ page }) => {
  const errors = [], writes = [];
  failures.set(page, { errors, writes });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/')) writes.push(request.url()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(run => {
    window.EventSource = class extends EventTarget {
      constructor() { super(); this.timer = setTimeout(() => this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(run) })), 0); }
      close() { clearTimeout(this.timer); }
    };
  }, idle);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (!['GET', 'HEAD'].includes(route.request().method())) return route.fulfill({ status: 403, json: { error: 'Layout review never changes progress or starts jobs.' } });
    if (path.startsWith('/api/learning/') || ['/api/research/learning', '/api/library', '/api/document', '/api/course'].includes(path)) return route.continue();
    const data = {
      '/api/session': { mode: 'local', legacy_access: true, user: null },
      '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
      '/api/status': { name: 'Learner', greeting: 'Hello', date: '2026-11-03', date_long: '3 November 2026', run: idle,
        questions: [], facts: [], sites: [], study: { today: null, read: 0, total: 0 }, report: { ready: false, days: [] } },
      '/api/run': idle, '/api/bots': { bots: [], run: idle },
      '/api/overview': { days: 14, recent: [], boards: [], workspace: { research_count: 0, learning_done: 0 } },
    };
    return route.fulfill({ json: data[path] || {} });
  });
});

test.afterEach(async ({ page }) => {
  expect(failures.get(page)).toEqual({ errors: [], writes: [] });
});

for (const width of [390, 768, 1440]) {
  test(`learning home layout is readable at ${width}px`, async ({ page }) => {
    await mkdir('artifacts/learning-layout', { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    await home(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('.learning-topic-card')).toHaveCount(4);
    await expect(page.locator('.learning-course-compact')).toContainText('0 of 90 days complete');
    await expect(page.getByRole('progressbar', { name: 'Course days complete', exact: true, includeHidden: true })).toHaveAttribute('value', '0');
    await expect(page.getByRole('link', { name: 'Quick note', exact: true })).toHaveAttribute('href', '#/learning/notes?new=1');
    const name = process.env.LEARNING_LAYOUT_PHASE || 'final';
    await page.screenshot({ path: `artifacts/learning-layout/${name}-${width}.png`, fullPage: true });
    await page.screenshot({ path: `artifacts/learning-layout/${name}-${width}-viewport.png` });
    if (name !== 'baseline') {
      const audit = await new AxeBuilder({ page }).include('.daily-page').analyze();
      expect(audit.violations).toEqual([]);
    }
  });
}

for (const width of [390, 1440]) {
  test(`daily task selection stays in place and opens the selected work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await home(page);
    const course = page.locator('[data-learning-task="plan"] button');
    const coding = page.locator('[data-learning-task="dsa"] button');
    const before = await top(coding);
    await coding.click();
    await expect(coding).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('link', { name: 'Start DSA lesson', exact: true })).toHaveAttribute('href', '#/learning/dsa');
    expect(Math.abs(await top(coding) - before)).toBeLessThan(2);
    await coding.press('ArrowLeft');
    await expect(course).toHaveAttribute('aria-pressed', 'true');
    await expect(course).toBeFocused();
    expect(Math.abs(await top(coding) - before)).toBeLessThan(2);
    await expect(page.locator('.learning-topic-card')).toHaveCount(4);
    await page.locator('[data-disclosure="today-outline"] > summary').click();
    const fullStack = page.locator('.learning-topic-card[href$="part=build"]');
    await fullStack.click();
    await expect(page).toHaveURL(/learning\/plan\?part=build$/);
    await expect(page.locator('[data-lesson-part="build"]')).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('.lesson-focus')).toContainText('What you’ll learn');
  });
}

test('scroll reveals run once per visible card without replaying after a refresh', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await recordMotion(page);
  await home(page);
  await page.locator('[data-disclosure="extras"] > summary').click();
  const card = page.locator('[data-learning-reveal="discovery-papers"]');
  await card.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => window.learningReveals.filter(key => key === 'discovery-papers').length)).toBe(1);
  await expect.poll(() => card.evaluate(element => element.getAnimations().length)).toBe(0);
  const before = await top(card);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await card.scrollIntoViewIfNeeded();
  await settle(page);
  expect(await page.evaluate(() => window.learningReveals.filter(key => key === 'discovery-papers').length)).toBe(1);
  expect(Math.abs(await top(card) - before)).toBeLessThan(2);
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/learning/daily');
  await page.evaluate(() => window.dispatchEvent(new Event('learning-refresh')));
  await response;
  await expect(page.locator('.learning-home-layout')).toBeVisible();
  await settle(page);
  expect(await page.evaluate(() => window.learningReveals.filter(key => key === 'discovery-papers').length)).toBe(1);
});

test('reduced motion keeps every card visible and uses an instant section jump', async ({ page }) => {
  await recordMotion(page);
  await home(page);
  await page.locator('[data-disclosure="extras"] > summary').click();
  const card = page.locator('[data-learning-reveal="discovery-tech"]');
  await card.scrollIntoViewIfNeeded();
  await settle(page);
  expect(await page.evaluate(() => window.learningReveals)).toEqual([]);
  expect(await card.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await page.goto('/#/learning/plan?part=build');
  await expect(page.locator('.lesson-example')).toBeVisible();
  await page.locator('[data-lesson-stage="example"]').click();
  await expect(page.locator('.lesson-example h3')).toBeFocused();
  expect(await page.evaluate(() => window.learningScrolls.at(-1)?.behavior)).toBe('instant');
});

test('normal motion animates intentional section jumps but opens deep links instantly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await recordMotion(page);
  await page.goto('/#/learning/plan?part=build&stage=example');
  await expect(page.locator('.lesson-example h3')).toBeFocused();
  expect(await page.evaluate(() => window.learningScrolls.at(-1)?.behavior)).toBe('instant');
  await page.locator('[data-lesson-stage="interview"]').click();
  const target = page.locator('.lesson-interview h3');
  await expect(target).toBeFocused();
  expect(await page.evaluate(() => window.learningScrolls.at(-1)?.behavior)).toBe('smooth');
  const positions = await page.evaluate(() => new Promise(resolve => {
    const values = [], start = performance.now();
    function sample() { values.push(Math.round(scrollY)); if (performance.now() - start > 250) resolve(values); else requestAnimationFrame(sample); }
    requestAnimationFrame(sample);
  }));
  expect(new Set(positions).size).toBeGreaterThan(3);
  await expect.poll(async () => Math.abs(await top(target) - 100)).toBeLessThan(4);
});

test('manual scrolling interrupts an animated section jump', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await recordMotion(page);
  await page.goto('/#/learning/plan?part=build');
  await expect(page.locator('.lesson-example')).toBeVisible();
  await page.locator('[data-lesson-stage="interview"]').click();
  await expect.poll(() => page.evaluate(() => window.learningScrolls.at(-1)?.behavior)).toBe('smooth');
  await page.mouse.move(700, 350);
  await page.mouse.wheel(0, -150);
  const samples = await page.evaluate(() => new Promise(resolve => {
    const values = [], start = performance.now();
    function sample() { values.push(scrollY); if (performance.now() - start > 1100) resolve(values); else requestAnimationFrame(sample); }
    requestAnimationFrame(sample);
  }));
  const tail = samples.slice(-15);
  expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(3);
  expect(await top(page.locator('.lesson-interview h3'))).toBeGreaterThan(250);
});
