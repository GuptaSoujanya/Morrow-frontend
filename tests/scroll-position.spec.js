import { test as base, expect } from '@playwright/test';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const idle = { epoch: 'scroll-fixture', revision: 0, next: 0, running: false, stopping: false, label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const row = id => ({ job_id: id, title: `Fixture engineering role ${id}`, company: `Example company ${id}`, board: 'hirist', kind: 'sent', label: 'Confirmed submission', score: 80, at: '2026-10-26T08:00:00Z' });
const tracks = ['Track A', 'Track B'].map((name, track) => ({ name, modules: Array.from({ length: 45 }, (_, i) => ({ title: `${name} lesson ${i + 1}`, path: `${track}/lesson-${i}.md`, route: `track-${track}/lesson-${i}`, today: false, read: false })) }));
const test = base.extend({
  fixture: async ({ page }, use) => {
    const state = { legacy: true, courseGate: null, recordsGate: null, sessionName: 'Scroll Tester', requests: [], unexpected: [], errors: [] };
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => { window.EventSource = class extends EventTarget { close() {} }; });
    page.on('pageerror', error => state.errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      state.requests.push(path);
      if (request.method() !== 'GET') { state.unexpected.push(`${request.method()} ${path}`); return route.fulfill({ status: 409, json: { error: 'Read-only fixture' } }); }
      if (path === '/api/session') return route.fulfill({ json: { mode: state.legacy ? 'local' : 'accounts', legacy_access: state.legacy, user: state.legacy ? null : { id: 'scroll-user', name: state.sessionName, role: 'user', plan_name: 'Free', modules: ['profile', 'applications', 'files'], ai_provider: 'none' } } });
      if (path === '/api/course') { await state.courseGate?.promise; return route.fulfill({ json: { today: null, read: 0, total: 90, days: [], tracks } }); }
      if (path === '/api/records') {
        await state.recordsGate?.promise;
        const size = Number(url.searchParams.get('size')) || 20, total = url.searchParams.get('q') === 'short' ? 2 : 240;
        const page = Math.min(Math.ceil(total / size), Number(url.searchParams.get('page')) || 1);
        return route.fulfill({ json: { page, pages: Math.ceil(total / size), size, total, rows: Array.from({ length: Math.min(size, total - (page - 1) * size) }, (_, i) => row((page - 1) * size + i + 1)), statuses: ['submitted'], updated_at: '2026-10-26T08:00:00Z' } });
      }
      const data = {
        '/api/meta': { actions: {}, boards: [], course: '/course/' },
        '/api/status': { name: 'Scroll Tester', questions: [], facts: [], sites: [], run: idle, study: { today: null, read: 0, total: 90 }, report: { ready: false, days: [] } },
        '/api/run': idle,
        '/api/overview': { days: 14, start: '2026-10-13', end: '2026-10-26', first: null, attempts: 70, sent: { total: 70 }, found: { total: 70 }, recent: Array.from({ length: 70 }, (_, i) => row(i + 1)), workspace: { research_count: 0 }, source: { database: 'Private account', updated_at: '2026-10-26T08:00:00Z' } },
      };
      if (Object.hasOwn(data, path)) return route.fulfill({ json: data[path] });
      state.unexpected.push(path); return route.fulfill({ status: 409, json: { error: 'Unconfigured synthetic response' } });
    });
    await use(state);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  },
});

const y = page => page.evaluate(() => scrollY);
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function scroll(page, target) { await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), target); await settle(page); return y(page); }
async function samePosition(page, previous) { await expect.poll(async () => Math.abs(await y(page) - previous), { message: `Viewport should remain near scrollY=${previous}` }).toBeLessThan(4); }
async function coursesReady(page, name = 'Track A') { await expect(page.locator('.learning-library-course-content h2')).toHaveText(name); await expect(page.locator('.learning-library-lesson')).toHaveCount(45); await page.evaluate(() => document.fonts.ready); await settle(page); }
async function recordsReady(page) { await expect(page.locator('.records-body')).toHaveAttribute('aria-busy', 'false'); await expect(page.locator('.records-body tbody tr')).not.toHaveCount(0); await page.evaluate(() => document.fonts.ready); await settle(page); }
async function openRecords(page, size = 20) { await page.goto('/#/records?size=' + size); await recordsReady(page); }

for (const width of [375, 768, 1440]) {
  test(`course query-only selection preserves reading position at ${width}px`, async ({ page, fixture }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto('/#/learning/courses'); await coursesReady(page);
    const picker = page.getByRole('combobox', { name: 'Course track', exact: true });
    const link = page.locator('.learning-library-tracks').getByRole('link', { name: /Track B/ });
    const control = await picker.isVisible() ? picker : link;
    const top = await control.evaluate(element => element.getBoundingClientRect().top + scrollY - 140);
    const before = await scroll(page, top); expect(before).toBeGreaterThan(80);
    if (control === picker) { await picker.click(); await page.getByRole('listbox', { name: 'Course track', exact: true }).getByRole('option', { name: 'Track B', exact: true }).click(); }
    else await link.click();
    await coursesReady(page, 'Track B'); await samePosition(page, before);
  });

  test(`full overview background rerender preserves position at ${width}px`, async ({ page, fixture }) => {
    fixture.legacy = false;
    await page.setViewportSize({ width, height: 820 });
    await page.goto('/#/overview'); await expect(page.locator('.recent-panel tbody tr')).toHaveCount(70);
    const before = await scroll(page, 1400); expect(before).toBeGreaterThan(1000);
    fixture.sessionName = 'Updated Tester';
    await page.evaluate(() => { document.activeElement?.blur(); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(page.locator('main h1')).toContainText('Updated');
    await samePosition(page, before);
  });

  test(`keyboard course selection restores focus after async content at ${width}px`, async ({ page, fixture }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto('/#/learning/courses'); await coursesReady(page);
    const picker = page.getByRole('combobox', { name: 'Course track', exact: true });
    const link = page.locator('.learning-library-tracks').getByRole('link', { name: /Track B/ });
    const usingPicker = await picker.isVisible(), control = usingPicker ? picker : link;
    const before = await scroll(page, await control.evaluate(element => element.getBoundingClientRect().top + scrollY - 140));
    await control.evaluate(element => element.focus({ preventScroll: true }));
    fixture.courseGate = deferred();
    if (usingPicker) await picker.press('End');
    await control.press('Enter');
    await expect(page.locator('.learning-library-body')).toHaveAttribute('aria-busy', 'true');
    fixture.courseGate.resolve(); await coursesReady(page, 'Track B');
    await expect(usingPicker ? picker : link).toBeFocused();
    await samePosition(page, before);
  });

  test(`pagination next and page size preserve viewport at ${width}px`, async ({ page, fixture }) => {
    await page.setViewportSize({ width, height: 820 }); await openRecords(page);
    const next = page.getByRole('navigation', { name: 'Applications pagination' }).getByRole('button', { name: 'Next', exact: true });
    await next.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' })); await settle(page);
    const before = await y(page); expect(before).toBeGreaterThan(500);
    await next.click(); await expect(page.locator('.pagination-position')).toHaveText('Page 2 of 12');
    await samePosition(page, before);
    const picker = page.getByRole('combobox', { name: 'Rows per page', exact: true });
    await picker.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' })); await settle(page);
    const beforeSize = await y(page);
    await picker.click(); await page.getByRole('listbox', { name: 'Rows per page', exact: true }).getByRole('option', { name: '50 per page', exact: true }).click();
    await expect(page.locator('.records-body tbody tr')).toHaveCount(50);
    await samePosition(page, beforeSize);
  });

  test(`visiting another page and Back restores the prior page at ${width}px`, async ({ page, fixture }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto('/#/learning/courses'); await coursesReady(page);
    const before = await scroll(page, 1350);
    await page.evaluate(() => { location.hash = '#/records'; }); await recordsReady(page);
    await expect.poll(() => y(page)).toBeLessThan(4);
    await scroll(page, 700); await page.goBack(); await coursesReady(page);
    await samePosition(page, before);
  });

  test(`user scrolling during pending replacement wins over saved position at ${width}px`, async ({ page, fixture }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto('/#/learning/courses'); await coursesReady(page);
    const before = await scroll(page, 1350);
    fixture.courseGate = deferred();
    await page.evaluate(() => { location.hash = '#/learning/courses?track=Track+B'; });
    await expect(page.locator('.learning-library-body')).toHaveAttribute('aria-busy', 'true');
    await samePosition(page, before);
    await page.mouse.move(width - 30, 400); await page.mouse.wheel(0, -450);
    await expect.poll(async () => Math.abs(await y(page) - (before - 450))).toBeLessThan(8);
    await settle(page); const userPosition = await y(page);
    fixture.courseGate.resolve(); await coursesReady(page, 'Track B');
    await samePosition(page, userPosition);
  });

  test(`shorter results clamp naturally without a lasting blank spacer at ${width}px`, async ({ page, fixture }) => {
    await page.setViewportSize({ width, height: 820 }); await openRecords(page, 50);
    const before = await scroll(page, 3000); expect(before).toBeGreaterThan(1500);
    await page.evaluate(() => { location.hash = '#/records?size=50&q=short'; });
    await expect(page.locator('.records-body tbody tr')).toHaveCount(2); await recordsReady(page);
    await expect.poll(() => page.evaluate(() => Math.abs(scrollY - Math.max(0, document.documentElement.scrollHeight - innerHeight)))).toBeLessThan(4);
    expect(await y(page)).toBeLessThan(before - 500);
  });
}
