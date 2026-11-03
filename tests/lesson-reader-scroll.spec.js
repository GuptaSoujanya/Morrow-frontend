import { test, expect } from '@playwright/test';

const idle = { epoch: 'lesson-scroll', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const position = page => page.evaluate(() => scrollY);
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

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
    if (route.request().method() !== 'GET') return route.fulfill({ status: 403, json: { error: 'Scroll verification never changes progress or starts jobs.' } });
    if (path.startsWith('/api/learning/') || ['/api/research/learning', '/api/library', '/api/document', '/api/course'].includes(path)) return route.continue();
    const fixture = {
      '/api/session': { mode: 'local', legacy_access: true, user: null },
      '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
      '/api/status': { name: 'Learner', greeting: 'Hello', date: '2026-11-03', run: idle,
        questions: [], facts: [], sites: [], study: { today: null, read: 0, total: 0 }, report: { ready: false, days: [] } },
      '/api/run': idle, '/api/bots': { bots: [], run: idle },
      '/api/overview': { days: 14, recent: [], boards: [], workspace: { research_count: 0, learning_done: 0 } },
    };
    return route.fulfill({ json: fixture[path] || {} });
  });
});

async function ready(page) {
  await expect(page.locator('.lesson-chapter-prose')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.lesson-chapter-prose .learning-diagram[data-diagram-state="ready"]')).not.toHaveCount(0);
  await expect(page.locator('.lesson-chapter-prose .learning-diagram:is([data-diagram-state="loading"], [data-diagram-state="waiting"])')).toHaveCount(0);
  await settle(page);
}

test('saved course refresh keeps open answers and working completion controls', async ({ page, request }) => {
  const reply = await request.get('/api/document', { params: { id: 'interview/day-1' } });
  expect(reply.ok()).toBe(true);
  const document = await reply.json(), writes = [];
  document.read = false;
  await page.route('**/api/document?**', route => route.fulfill({ json: document }));
  await page.route('**/api/research/read', route => {
    const body = route.request().postDataJSON();
    writes.push(body); document.read = body.read;
    return route.fulfill({ json: { read: body.read } });
  });
  await page.goto('/#/learning/read/interview%2Fday-1?part=build&stage=example');
  await ready(page);
  const answer = page.locator('.lesson-task details').first();
  await answer.locator('summary').click();
  await page.locator('.lesson-task p').first().evaluate(element => window.scrollTo({ top: scrollY + element.getBoundingClientRect().top - 180, behavior: 'instant' }));
  await settle(page);
  const before = await position(page);
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/document');
  await page.evaluate(() => { document.activeElement?.blur(); window.dispatchEvent(new Event('learning-refresh')); });
  await response;
  await expect(page.locator('.learning-library-body')).toHaveAttribute('aria-busy', 'false');
  await ready(page);
  expect(Math.abs(await position(page) - before)).toBeLessThan(4);
  await expect(answer).toHaveAttribute('open', '');
  const menu = page.locator('.lesson-path-menu');
  if (!await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
  await page.locator('[data-lesson-part="review"]').click();
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen reading', exact: true })).toBeEnabled();
  expect(writes).toEqual([{ id: 'interview/day-1', read: true }]);
  await page.getByRole('button', { name: 'Reopen reading', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toBeEnabled();
  expect(writes).toEqual([{ id: 'interview/day-1', read: true }, { id: 'interview/day-1', read: false }]);
});

for (const width of [390, 1440]) {
  test(`chapter choice keeps its visible navigation steady at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/learning/plan?part=build');
    await ready(page);
    const menu = page.locator('.lesson-path-menu');
    if (await menu.count() && !await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
    const button = page.locator('[data-lesson-part="systems"]');
    await button.evaluate(element => window.scrollTo({ top: scrollY + element.getBoundingClientRect().top - 180, behavior: 'instant' }));
    await settle(page);
    const before = await position(page);
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'step');
    await ready(page);
    const after = await position(page);
    console.log(JSON.stringify({ width, action: 'chapter', before, after, delta: after - before }));
    expect(Math.abs(after - before), 'Choosing a visible chapter should not move its controls off screen').toBeLessThan(4);
    await expect(menu.locator(':scope > summary')).toBeFocused();
  });

  test(`background refresh keeps the current reading position at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/learning/plan?part=build&stage=example');
    await ready(page);
    const answer = page.locator('.lesson-task details').first();
    await answer.locator('summary').click();
    const paragraph = page.locator('.lesson-task p').first();
    await paragraph.evaluate(element => window.scrollTo({ top: scrollY + element.getBoundingClientRect().top - 180, behavior: 'instant' }));
    await settle(page);
    const before = await position(page);
    for (const event of ['learning-refresh', 'focus']) {
      const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/learning/daily');
      await page.evaluate(type => { document.activeElement?.blur(); window.dispatchEvent(new Event(type)); }, event);
      await response;
      await expect(page.locator('.daily-refresh')).toBeEnabled();
      await ready(page);
      const after = await position(page);
      console.log(JSON.stringify({ width, action: event, before, after, delta: after - before }));
      expect(Math.abs(after - before), 'An unchanged lesson refresh should not replay the URL section jump').toBeLessThan(4);
      await expect(page.locator('[data-lesson-part="build"]')).toHaveAttribute('aria-current', 'step');
      await expect(answer).toHaveAttribute('open', '');
    }
  });

  test(`an explicit section jump stays on its heading at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/learning/plan?part=build');
    await ready(page);
    await page.locator('[data-lesson-stage="example"]').click();
    const heading = page.locator('[data-lesson-section="example"] h3').first();
    await expect(heading).toBeFocused();
    const top = await heading.evaluate(element => element.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(200);
    const before = await position(page);
    await settle(page);
    await ready(page);
    expect(Math.abs(await position(page) - before)).toBeLessThan(4);
    await expect(page).toHaveURL(/part=build&stage=example/);
  });

  test(`a deep-linked section remains readable after delayed diagrams at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const diagram = deferred();
    await page.route('**/mermaid.core-*.js', async route => { await diagram.promise; await route.continue(); });
    await page.goto('/#/learning/plan?part=build&stage=example');
    await expect(page.locator('.lesson-chapter-prose')).toBeVisible();
    await expect(page.locator('.learning-diagram[data-diagram-state="loading"]')).not.toHaveCount(0);
    await settle(page);
    diagram.resolve();
    await ready(page);
    const heading = page.locator('[data-lesson-section="example"] h3').first();
    await expect.poll(() => heading.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
    await expect.poll(() => heading.evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(200);
    const before = await position(page);
    await settle(page);
    expect(Math.abs(await position(page) - before)).toBeLessThan(4);
  });

  test(`manual scrolling wins over a pending deep-link jump at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const diagram = deferred();
    await page.route('**/mermaid.core-*.js', async route => { await diagram.promise; await route.continue(); });
    await page.goto('/#/learning/plan?part=build&stage=example');
    await expect(page.locator('.lesson-chapter-prose')).toBeVisible();
    await expect(page.locator('.learning-diagram[data-diagram-state="loading"]')).not.toHaveCount(0);
    // The input event must be real: a delayed automatic jump must yield when
    // the reader chooses a different position while a diagram is still loading.
    await page.mouse.move(width - 20, 650);
    const starting = await position(page);
    await page.mouse.wheel(0, 400);
    await expect.poll(async () => await position(page) - starting).toBeGreaterThan(300);
    await settle(page);
    const before = await page.locator('.lesson-chapter-prose :is(h2, h3, p, pre, dt, dd)').evaluateAll(elements => {
      const element = elements.find(element => {
        const box = element.getBoundingClientRect();
        return box.top >= 50 && box.top < innerHeight - 100 && box.height > 10;
      });
      if (!element) throw new Error('Expected visible lesson text to track.');
      element.dataset.scrollAnchor = 'pending-diagram';
      return element.getBoundingClientRect().top;
    });
    diagram.resolve();
    await ready(page);
    // Diagrams above the viewport may grow, so track the visible content rather
    // than treating the browser's normal scroll anchoring as an unwanted jump.
    const after = await page.locator('[data-scroll-anchor="pending-diagram"]').evaluate(element => element.getBoundingClientRect().top);
    console.log(JSON.stringify({ width, action: 'manual-during-diagram', before, after, delta: after - before }));
    expect(Math.abs(after - before), 'Loading a diagram must not reapply an abandoned section jump').toBeLessThan(4);
  });
}
