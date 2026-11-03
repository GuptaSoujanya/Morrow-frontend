import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

const idle = { epoch: 'course-review', revision: 0, next: 0, running: false, stopping: false,
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
    if (route.request().method() !== 'GET') return route.fulfill({ status: 403, json: { error: 'Visual review never changes progress or starts jobs.' } });
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

for (const width of [390, 768, 1440]) {
  test(`course syllabus and continuous lesson fit at ${width}px`, async ({ page }) => {
    await mkdir('artifacts/course-rebuild', { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#/learning/weekly');
    await expect(page.locator('.course-today-outline li')).toHaveCount(4);
    await expect(page.locator('.course-day-subjects').first().locator('dd')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const roadmapAudit = await new AxeBuilder({ page }).include('.course-hub').analyze();
    expect(roadmapAudit.violations).toEqual([]);
    await page.screenshot({ path: `artifacts/course-rebuild/course-${width}.png` });
    await page.getByRole('link', { name: 'Start Day 1 →', exact: true }).click();
    const menu = page.locator('.lesson-path-menu');
    if (await menu.count() && !await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
    await expect(page.getByRole('navigation', { name: 'Lesson contents' })).toBeVisible();
    await expect(page.locator('.lesson-panel .lesson-idea')).toBeVisible();
    await expect(page.locator('.lesson-panel .lesson-example')).toBeVisible();
    await expect(page.locator('.lesson-panel .lesson-task')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const lessonAudit = await new AxeBuilder({ page }).include('.course-reading').analyze();
    expect(lessonAudit.violations).toEqual([]);
    await page.screenshot({ path: `artifacts/course-rebuild/lesson-${width}.png` });
    await page.locator('[data-lesson-stage="example"]').click();
    await page.screenshot({ path: `artifacts/course-rebuild/example-${width}.png` });
  });
}
