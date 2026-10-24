import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const USER = {
  id: 'feedback-fixture-user', name: 'Sam Example', email: 'feedback@example.com',
  role: 'user', plan_name: 'Free', plan_id: 'free', modules: ['profile', 'applications', 'files'],
  email_verified: true, ai_provider: 'none',
};
const OVERVIEW = {
  days: 14, start: '2026-10-11', end: '2026-10-24', first: null,
  attempts: 0, sent: { total: 0 }, found: { total: 0 }, recent: [],
  workspace: { research_count: 0 },
  source: { database: 'Private account', updated_at: '2026-10-24T08:00:00Z' },
};
const EMPTY_FILES = { page: 1, pages: 1, size: 12, total: 0, sources: [], files: [] };
const IDLE_RUN = { running: false, stopping: false, last: null, next: 0, lines: [] };
const privatePaths = new Set(['/api/meta', '/api/status', '/api/course', '/api/overview', '/api/data', '/api/run']);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// Every API request is fulfilled in the browser. These tests never sign in to,
// inspect, mutate, or send actions to a real workspace or the preview database.
const test = base.extend({
  fixture: async ({ page }, use) => {
    const state = { signedIn: true, requests: [], unexpected: [], identityGate: null, filesGate: null, filesFail: false, filesRequests: 0, plansGate: null, plansFail: false, plansRequests: 0 };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      state.requests.push(pathname);
      if (request.method() !== 'GET') {
        state.unexpected.push(`${request.method()} ${pathname}`);
        return route.fulfill({ status: 409, json: { error: 'Fixture guard: writes are disabled.' } });
      }
      if (pathname === '/api/session') {
        await state.identityGate?.promise;
        return route.fulfill({ json: { mode: 'accounts', user: state.signedIn ? USER : null, legacy_access: false } });
      }
      if (pathname === '/api/v1/auth/options') return route.fulfill({ json: { provider: 'local', google: false, email: true } });
      if (pathname === '/api/v1/plans') {
        state.plansRequests += 1;
        await state.plansGate?.promise;
        return state.plansFail
          ? route.fulfill({ status: 503, json: { detail: 'Plans are temporarily unavailable.' } })
          : route.fulfill({ json: { items: [], billing_available: false } });
      }
      if (pathname === '/api/meta') return route.fulfill({ json: { actions: {}, boards: [] } });
      if (pathname === '/api/status') return route.fulfill({ json: { name: USER.name, questions: [], facts: [], run: IDLE_RUN } });
      if (pathname === '/api/course') return route.fulfill({ json: { today: null, read: 0, total: 0, days: [] } });
      if (pathname === '/api/overview') return route.fulfill({ json: OVERVIEW });
      if (pathname === '/api/data') {
        state.filesRequests += 1;
        await state.filesGate?.promise;
        return state.filesFail
          ? route.fulfill({ status: 503, json: { error: 'Saved files are temporarily unavailable.' } })
          : route.fulfill({ json: EMPTY_FILES });
      }
      state.unexpected.push(`${request.method()} ${pathname}`);
      return route.fulfill({ status: 409, json: { error: 'Unconfigured synthetic fixture.' } });
    });
    await use(state);
    expect(state.unexpected, 'No test may reach an unmocked API or execute a write.').toEqual([]);
    expect(errors, 'Page scripts should not throw.').toEqual([]);
  },
});

async function capture(page, name, width) {
  await page.evaluate(async () => { await document.fonts.ready; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal page overflow`).toBe(true);
  await page.screenshot({ animations: 'disabled', path: `artifacts/feedback/${name}-${width}.png`, fullPage: true });
}

async function accessible(page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map(issue => ({ id: issue.id, targets: issue.nodes.map(node => node.target) }))).toEqual([]);
}

async function expectOpaqueAncestry(locator) {
  await expect.poll(() => locator.evaluate(element => {
    const dimmed = [];
    for (let node = element; node; node = node.parentElement) {
      if (Number(getComputedStyle(node).opacity) < 1) dimmed.push(node.className || node.tagName);
    }
    return dimmed;
  }), { message: 'Loading feedback should remain fully visible inside a busy result list.' }).toEqual([]);
}

async function expectCenteredProgress(loading) {
  const track = loading.locator('.loading-progress');
  await expect(track).toBeVisible();
  const [containerBox, trackBox] = await Promise.all([loading.boundingBox(), track.boundingBox()]);
  expect(Math.abs(trackBox.x + trackBox.width / 2 - containerBox.x - containerBox.width / 2)).toBeLessThan(2);
}

test.beforeAll(async ({ baseURL }) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname);
  await mkdir('artifacts/feedback', { recursive: true });
});

for (const width of [375, 768, 1440]) {
  for (const signedIn of [false, true]) {
    test(`404 recovery respects ${signedIn ? 'Free account' : 'signed-out'} identity at ${width}px`, async ({ page, fixture }) => {
      fixture.signedIn = signedIn;
      await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
      const missing = '/#/a-missing-page/deep-link?token=do-not-display';
      await page.goto(missing);
      const missingPage = page.locator('.not-found-page');
      await expect(missingPage).toBeVisible();
      await expect(missingPage.getByRole('heading', { level: 1 })).toHaveText('A little off course.');
      await expect(page).toHaveURL(new RegExp('#/a-missing-page/deep-link\\?token=do-not-display$'));
      await expect(missingPage).not.toContainText('do-not-display');
      expect(fixture.requests.filter(path => privatePaths.has(path)), 'A missing page must not fetch private workspace data.').toEqual([]);
      if (!signedIn) await expect(page.locator('#nav a')).toHaveCount(0);
      else {
        const links = await page.locator('#nav .sidebar-scroll a').evaluateAll(items => items.map(item => item.getAttribute('href')));
        expect(links).toEqual(['#/overview', '#/records', '#/data', '#/files', '#/plans', '#/account']);
      }
      const primary = missingPage.getByRole('link', { name: signedIn ? 'Back to workspace' : 'Sign in', exact: true });
      await expect(primary).toHaveAttribute('href', signedIn ? '#/overview' : '#/login');
      expect((await primary.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await capture(page, signedIn ? '404-account' : '404-public', width);
      if (width === 1440) await accessible(page);
      await primary.focus();
      await page.keyboard.press('Enter');
      if (signedIn) await expect(page.locator('.tenant-overview')).toBeVisible();
      else await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
      await expect(missingPage).toHaveCount(0);
    });
  }

  test(`files loading, recoverable failure, and empty state work at ${width}px`, async ({ page, fixture }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
    fixture.filesGate = deferred();
    fixture.filesFail = true;
    await page.goto('/#/data');
    const loading = page.locator('.data-file-list .state-loading');
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('role', 'status');
    await expectCenteredProgress(loading);
    await expect(page.locator('.data-file-list')).toHaveAttribute('aria-busy', 'true');
    await expectOpaqueAncestry(loading);
    await capture(page, 'files-loading', width);
    if (width === 1440) await accessible(page);
    fixture.filesGate.resolve();
    const error = page.locator('.data-page .state-error');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(error).toContainText('Saved files are temporarily unavailable.');
    await expect(loading).toHaveCount(0);
    await capture(page, 'files-error', width);
    if (width === 1440) await accessible(page);
    const failedRequests = fixture.filesRequests;
    fixture.filesFail = false;
    const retry = error.getByRole('button', { name: 'Try again', exact: true });
    expect((await retry.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await retry.focus();
    await page.keyboard.press('Enter');
    const empty = page.locator('.data-file-list .state-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No saved files match.');
    await expect(error).toHaveCount(0);
    expect(fixture.filesRequests).toBe(failedRequests + 1);
    await expect(page.locator('.data-file-list')).toHaveAttribute('aria-busy', 'false');
    await capture(page, 'files-empty', width);
    if (width === 1440) await accessible(page);
    await empty.getByRole('button', { name: 'Clear filters' }).focus();
    await page.keyboard.press('Enter');
    await expect(empty).toBeVisible();
  });
}

test('identity loading stays private and reduced-motion loading is still readable', async ({ page, fixture }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  fixture.identityGate = deferred();
  await page.goto('/#/data');
  const loading = page.locator('main .state-loading');
  await expect(loading).toBeVisible();
  await expect(loading).toContainText('Opening your workspace…');
  await expectCenteredProgress(loading);
  await expect(page.locator('#nav a')).toHaveCount(0);
  expect(fixture.requests.filter(path => privatePaths.has(path))).toEqual([]);
  const moving = await loading.evaluate(element => element.getAnimations({ subtree: true })
    .filter(animation => animation.playState === 'running' && animation.effect.getTiming().duration > 1).length);
  expect(moving, 'Reduced-motion keeps the loader legible without movement.').toBe(0);
  await capture(page, 'identity-loading-reduced-motion', 375);
  fixture.identityGate.resolve();
  await expect(page.locator('.data-page .state-empty')).toBeVisible();
  await expect(page.locator('#nav a[href="#/bots"]')).toHaveCount(0);
});

test('lazy route loading resolves into the requested page without a premature empty state', async ({ page, fixture }) => {
  await page.goto('/#/overview');
  await expect(page.locator('.tenant-overview')).toBeVisible();
  const moduleGate = deferred();
  await page.route('**/assets/chunks/data-*.js', async route => { await moduleGate.promise; await route.continue(); });
  await page.locator('#nav .sidebar-scroll a[href="#/data"]').click();
  const loading = page.locator('main .state-loading');
  await expect(loading).toBeVisible();
  await expectCenteredProgress(loading);
  await expect(page.locator('.data-page')).toHaveCount(0);
  await capture(page, 'route-loading', 1440);
  moduleGate.resolve();
  await expect(page.locator('.data-page .state-empty')).toBeVisible();
  await expect(loading).toHaveCount(0);
  await expect(page.locator('#nav .sidebar-scroll a[href="#/data"]')).toHaveAttribute('aria-current', 'page');
  expect(fixture.filesRequests).toBe(1);
});

test('account plans use the compact loader and recover from a failed request', async ({ page, fixture }) => {
  for (const width of [1440, 375]) {
    await page.goto('about:blank');
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
    fixture.plansGate = deferred();
    fixture.plansFail = true;
    await page.goto('/#/plans');
    const loading = page.locator('.account-loading .state-loading.is-compact');
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('role', 'status');
    await expect(loading).toContainText('Loading plans…');
    await expectCenteredProgress(loading);
    await expectOpaqueAncestry(loading);
    await capture(page, 'account-plans-loading', width);
    if (width === 1440) await accessible(page);
    fixture.plansGate.resolve();
    const error = page.getByRole('alert').filter({ hasText: 'Plans are temporarily unavailable.' });
    await expect(error).toBeVisible();
    await expect(loading).toHaveCount(0);
    fixture.plansFail = false;
    const failedRequests = fixture.plansRequests;
    await error.getByRole('button', { name: 'Try again', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(error).toHaveCount(0);
    await expect(loading).toHaveCount(0);
    await expect(page.locator('.account-checkout-note')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your current access' })).toContainText('You’re on Free');
    expect(fixture.plansRequests).toBe(failedRequests + 1);
  }
});

test('missing browser paths serve a static 404 and recover to the signed-out app', async ({ page, fixture }) => {
  fixture.signedIn = false;
  for (const width of [375, 1440]) {
    await page.goto('about:blank');
    fixture.requests.length = 0;
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
    const response = await page.goto('/a-missing-page/deep-link');
    expect(response.status()).toBe(404);
    const missing = page.locator('.not-found-page');
    await expect(missing).toBeVisible();
    await expect(missing.getByRole('heading', { level: 1 })).toHaveText('A little off course.');
    await expect(page.locator('script')).toHaveCount(0);
    expect(fixture.requests, 'The public error document must not fetch workspace identity or data.').toEqual([]);
    const home = missing.getByRole('link', { name: 'Back to Morrow', exact: true });
    await expect(home).toHaveAttribute('href', '/#/');
    await capture(page, '404-static', width);
    await accessible(page);
    await home.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/#\/login$/);
  }
});
