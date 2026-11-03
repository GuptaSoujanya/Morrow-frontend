import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const idle = { epoch: 'reader-polish', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };

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
    if (!['GET', 'HEAD'].includes(route.request().method())) return route.fulfill({ status: 403, json: { error: 'Reader UI audit never changes progress or starts jobs.' } });
    if (path.startsWith('/api/learning/') || ['/api/research/learning', '/api/library', '/api/document', '/api/course'].includes(path)) return route.continue();
    const data = {
      '/api/session': { mode: 'local', legacy_access: true, user: null },
      '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
      '/api/status': { name: 'Learner', greeting: 'Hello', date: '2026-11-03', run: idle,
        questions: [], facts: [], sites: [], study: { today: null, read: 0, total: 0 }, report: { ready: false, days: [] } },
      '/api/run': idle, '/api/bots': { bots: [], run: idle },
      '/api/overview': { days: 14, recent: [], boards: [], workspace: { research_count: 0, learning_done: 0 } },
    };
    return route.fulfill({ json: data[path] || {} });
  });
});

for (const width of [1440, 390]) {
  test(`course reader layout and code stay readable at ${width}px`, async ({ page }) => {
    const writes = [], errors = [];
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await mkdir('artifacts/reader-polish', { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#/learning/plan');
    await expect(page.locator('.lesson-chapter-prose')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    console.log(JSON.stringify({ width, titleTop: await page.locator('.lesson-chapter-prose > h2').first().evaluate(element => Math.round(element.getBoundingClientRect().top)),
      readingTop: await page.locator('.lesson-idea p').first().evaluate(element => Math.round(element.getBoundingClientRect().top)) }));
    await page.screenshot({ path: `artifacts/reader-polish/top-${width}.png` });
    const menu = page.locator('.lesson-path-menu');
    await expect(menu).not.toHaveAttribute('open', '');
    expect((await menu.locator(':scope > summary').boundingBox()).height).toBeGreaterThanOrEqual(44);
    if (await menu.count() && !await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
    const targets = await page.locator('[data-lesson-part], [data-lesson-stage], .lesson-mode').evaluateAll(buttons => buttons.filter(button => !button.hidden).map(button => ({ label: button.textContent.trim(), height: button.getBoundingClientRect().height })));
    for (const target of targets) expect(target.height, `${target.label} click target`).toBeGreaterThanOrEqual(44);
    expect((await new AxeBuilder({ page }).include('.lesson-menu-content').analyze()).violations).toEqual([]);
    await page.screenshot({ path: `artifacts/reader-polish/chapters-${width}.png` });
    await page.locator('[data-lesson-part="build"]').click();
    await expect(page.locator('[data-lesson-part="build"]')).toHaveAttribute('aria-current', 'step');
    await page.locator('[data-lesson-stage="example"]').click();
    const heading = page.locator('[data-lesson-section="example"] h3').first();
    await expect(heading).toBeFocused();
    await page.screenshot({ path: `artifacts/reader-polish/example-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const codeBlocks = await page.locator('.lesson-chapter-prose pre').evaluateAll(blocks => blocks.map(block => {
      const bounds = block.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, width: bounds.width, viewport: innerWidth,
        overflowing: block.scrollWidth > block.clientWidth + 1, overflowX: getComputedStyle(block).overflowX };
    }).filter(block => block.width));
    expect(codeBlocks.length).toBeGreaterThan(0);
    for (const block of codeBlocks) {
      expect(block.left).toBeGreaterThanOrEqual(0);
      expect(block.right).toBeLessThanOrEqual(block.viewport + 1);
      if (block.overflowing) expect(['auto', 'scroll']).toContain(block.overflowX);
    }
    const audit = await new AxeBuilder({ page }).include('.course-reading').analyze();
    expect(audit.violations).toEqual([]);
    await page.getByRole('button', { name: 'Read all parts', exact: true }).click();
    const single = page.getByRole('button', { name: 'Read one subject at a time', exact: true });
    await expect(single).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const bounds = await single.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: `artifacts/reader-polish/full-reading-${width}.png` });
    await single.click();
    await expect(page.locator('[data-lesson-part="build"]')).toHaveAttribute('aria-current', 'step');
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const width of [1440, 390]) test(`compact chapter choices keep their position and keyboard focus at ${width}px`, async ({ page }) => {
  const writes = [];
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/#/learning/plan?part=build');
  await expect(page.locator('.lesson-chapter-prose')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const menu = page.locator('.lesson-path-menu');
  await expect(menu).not.toHaveAttribute('open', '');
  await menu.locator(':scope > summary').click();
  const current = page.locator('[data-lesson-part="build"]');
  await expect(current).toBeInViewport();
  const before = await page.evaluate(() => scrollY);
  await current.click();
  expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(4);
  const summary = menu.locator(':scope > summary');
  await expect(menu).not.toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
  await summary.click();
  const systems = page.locator('[data-lesson-part="systems"]');
  await systems.focus();
  const buttonTop = await summary.evaluate(element => element.getBoundingClientRect().top);
  await page.keyboard.press('Enter');
  await expect(systems).toHaveAttribute('aria-current', 'step');
  await expect(summary).toBeFocused();
  await expect(menu).not.toHaveAttribute('open', '');
  expect(Math.abs(await summary.evaluate(element => element.getBoundingClientRect().top) - buttonTop)).toBeLessThan(4);
  await summary.click();
  await systems.focus();
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
  expect(writes).toEqual([]);
});

test('compact sticky chapter menu reveals a newly chosen chapter during deep reading', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/learning/plan?part=build&stage=example');
  await expect(page.locator('[data-lesson-section="example"] h3').first()).toBeFocused();
  const menu = page.locator('.lesson-path-menu'), summary = menu.locator(':scope > summary');
  await expect(summary).toBeInViewport();
  await summary.click();
  const before = await page.evaluate(() => scrollY);
  await page.locator('[data-lesson-part="build"]').click();
  expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(4);
  await summary.click();
  await page.locator('[data-lesson-part="systems"]').click();
  const title = page.locator('.lesson-chapter-prose > h2').first();
  await expect(title).toBeFocused();
  await expect(title).toBeInViewport();
  expect(await title.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(await page.locator('.lesson-chapter-tools').evaluate(element => element.getBoundingClientRect().bottom) - 1);
  await expect(menu).not.toHaveAttribute('open', '');
});

test('a lesson without optional metadata keeps its introduction collapsed on phones', async ({ page, request }) => {
  const response = await request.get('/api/learning/daily');
  expect(response.ok()).toBe(true);
  const data = await response.json();
  data.plan.lesson = null;
  await page.route('**/api/learning/daily', route => route.fulfill({ json: data }));
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/#/learning/plan');
  const help = page.locator('.lesson-study-guide');
  await expect(help).not.toHaveAttribute('open', '');
  await expect(page.locator('.lesson-chapter-prose > h2').first()).toBeInViewport();
  await page.screenshot({ path: 'artifacts/reader-polish/no-metadata-390.png' });
  const menu = page.locator('.lesson-path-menu');
  if (!await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
  await help.locator(':scope > summary').click();
  await expect(help).toHaveAttribute('open', '');
  await expect(help.locator('.daily-prose')).not.toBeEmpty();
  await help.locator(':scope > summary').click();
  await expect(help).not.toHaveAttribute('open', '');
});
