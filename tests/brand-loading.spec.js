import { test as base, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const USER = { id: 'brand-loading-fixture', name: 'Sam Example', role: 'user', plan_name: 'Free', plan_id: 'free', modules: ['profile', 'applications', 'files'], email_verified: true, ai_provider: 'none' };
const test = base.extend({
  fixture: async ({ page }, use) => {
    const state = { signedIn: true, identityGate: null, plansGate: null, requests: [], unexpected: [] };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      state.requests.push(path);
      if (request.method() !== 'GET') { state.unexpected.push(request.method() + ' ' + path); return route.fulfill({ status: 409, json: { error: 'Read-only synthetic fixture' } }); }
      if (path === '/api/session') { await state.identityGate?.promise; return route.fulfill({ json: { mode: 'accounts', user: state.signedIn ? USER : null, legacy_access: false } }); }
      if (path === '/api/v1/plans') { await state.plansGate?.promise; return route.fulfill({ json: { items: [], billing_available: false } }); }
      const data = {
        '/api/v1/auth/options': { provider: 'local', google: false, email: true },
        '/api/v1/billing/status': { provider: 'stripe', configured: false, subscription: null },
        '/api/meta': { actions: {}, boards: [] },
        '/api/status': { name: USER.name, questions: [], facts: [], run: { running: false, stopping: false, last: null, next: 0, lines: [] } },
        '/api/course': { today: null, read: 0, total: 0, days: [] },
        '/api/overview': { days: 14, start: '2026-10-11', end: '2026-10-24', first: null, attempts: 0, sent: { total: 0 }, found: { total: 0 }, recent: [], workspace: { research_count: 0 }, source: { database: 'Fixture', updated_at: '2026-10-24T08:00:00Z' } },
        '/api/data': { page: 1, pages: 1, size: 12, total: 0, sources: [], files: [] },
      };
      if (Object.hasOwn(data, path)) return route.fulfill({ json: data[path] });
      state.unexpected.push(path);
      return route.fulfill({ status: 409, json: { error: 'Unconfigured synthetic fixture' } });
    });
    await use(state);
    expect(state.unexpected, 'All API calls stay inside the read-only fixture.').toEqual([]);
    expect(errors).toEqual([]);
  },
});

async function checkLoader(page, loader, label) {
  await expect(loader).toBeVisible();
  await expect(loader).toHaveAttribute('role', 'status');
  await expect(loader).toHaveAttribute('aria-live', 'polite');
  await expect(loader).toContainText(label);
  await expect(loader.locator('.loading-visual')).toHaveAttribute('aria-hidden', 'true');
  await expect(loader.locator('.loading-mark')).toHaveAttribute('alt', '');
  await expect.poll(() => loader.locator('.loading-mark').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const [box, mark, beads] = await Promise.all([loader.boundingBox(), loader.locator('.loading-mark').boundingBox(), loader.locator('.loading-progress').boundingBox()]);
  expect(Math.abs(mark.x + mark.width / 2 - box.x - box.width / 2)).toBeLessThan(2);
  expect(Math.abs(beads.x + beads.width / 2 - box.x - box.width / 2)).toBeLessThan(2);
  await expect(loader.getByRole('progressbar')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function capture(page, name, width) {
  await mkdir('artifacts/brand-loading', { recursive: true });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: `artifacts/brand-loading/${name}-${width}.png`, animations: name === 'auth' ? 'disabled' : 'allow' });
}

for (const width of [375, 1280]) {
  test(`static startup loader becomes the branded sign-in page at ${width}px`, async ({ page, fixture }) => {
    await page.setViewportSize({ width, height: 900 });
    fixture.signedIn = false;
    const coreGate = deferred();
    // The production entry is inline; its shared module imports gate execution.
    await page.route('**/assets/chunks/*.js', async route => { await coreGate.promise; await route.continue(); });
    await page.goto('/#/login', { waitUntil: 'commit' });
    const loading = page.locator('.boot-loading');
    await checkLoader(page, loading, 'Opening your workspace…');
    await expect.poll(() => loading.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect.getTiming().duration > 1).length)).toBeGreaterThan(0);
    expect(fixture.requests).toEqual([]);
    await capture(page, 'startup', width);
    coreGate.resolve();
    await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
    await expect(loading).toHaveCount(0);
    await expect(page.locator('.account-auth-brand a')).toContainText('morrow');
    await expect.poll(() => page.locator('.account-auth-brand img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(page).toHaveTitle('Sign in · Morrow');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await capture(page, 'auth', width);
  });

  test(`route loading stays centered and clears when Data is ready at ${width}px`, async ({ page, fixture }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/overview');
    await expect(page.locator('.tenant-overview')).toBeVisible();
    const moduleGate = deferred();
    await page.route('**/assets/chunks/data-*.js', async route => { await moduleGate.promise; await route.continue(); });
    await page.evaluate(() => { location.hash = '#/data'; });
    const loading = page.locator('main .state-loading');
    await checkLoader(page, loading, 'Opening your workspace…');
    await expect(page.locator('.data-page')).toHaveCount(0);
    await capture(page, 'route', width);
    moduleGate.resolve();
    await expect(page.locator('.data-file-list .state-empty')).toBeVisible();
    await expect(loading).toHaveCount(0);
    await expect(page).toHaveTitle('Data hub · Morrow');
  });

  test(`compact account loader remains readable and clears at ${width}px`, async ({ page, fixture }) => {
    await page.setViewportSize({ width, height: 900 });
    fixture.plansGate = deferred();
    await page.goto('/#/plans');
    const loading = page.locator('.account-loading .state-loading.is-compact');
    await checkLoader(page, loading, 'Loading plans…');
    await capture(page, 'compact', width);
    fixture.plansGate.resolve();
    await expect(page.locator('.account-checkout-note')).toBeVisible();
    await expect(loading).toHaveCount(0);
  });
}

test('reduced-motion identity loader stays static and never exposes workspace navigation', async ({ page, fixture }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  fixture.identityGate = deferred();
  await page.goto('/#/data');
  const loading = page.locator('main .state-loading');
  await checkLoader(page, loading, 'Opening your workspace…');
  await expect(page.locator('#nav a')).toHaveCount(0);
  expect(fixture.requests.filter(path => path !== '/api/session')).toEqual([]);
  const moving = await loading.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect.getTiming().duration > 1).length);
  expect(moving).toBe(0);
  await capture(page, 'reduced-motion', 375);
  fixture.identityGate.resolve();
  await expect(page.locator('.data-file-list .state-empty')).toBeVisible();
  await expect(loading).toHaveCount(0);
});
