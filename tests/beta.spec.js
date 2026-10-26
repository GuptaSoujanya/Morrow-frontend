import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Exercise the real beta session and routing; never edit personal files or run bots.
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/file' && request.method() === 'GET') {
      return route.fulfill({ json: { name: 'profile', exists: true, path: 'profile.yaml',
        text: 'first_name: Beta\nlocation: Bengaluru\n', revision: 'beta-fixture' } });
    }
    if (!['GET', 'HEAD'].includes(request.method()) && path !== '/api/preview') {
      return route.fulfill({ status: 409, json: { error: 'Test guard: action was not executed.' } });
    }
    return route.continue();
  });
});

test('beta opens directly with all workspace navigation and no account links', async ({ page, request }) => {
  expect(await (await request.get('/api/session')).json()).toEqual({ mode: 'local', user: null, legacy_access: true });
  await page.goto('/');
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.getByText('Free beta · all tools', { exact: true })).toBeVisible();
  const nav = page.locator('#nav .sidebar-scroll');
  for (const route of ['bots', 'pipeline', 'todo', 'research', 'analytics', 'reports', 'study', 'files', 'records', 'data', 'connections', 'setup']) {
    await expect(nav.locator(`a[href="#/${route}"]`)).toHaveCount(1);
  }
  await expect(nav.getByText(/Plans & billing|My account|Administration|Setup checklist/)).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/auth-screen/);
  await expect(page.locator('#console-dock')).toBeVisible();
});

test('old account links open useful beta pages without requesting authentication or billing', async ({ page }) => {
  test.setTimeout(90000);
  const accountRequests = [], errors = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/v1/')) accountRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  for (const route of ['login', 'signup', 'forgot', 'reset', 'verify', 'resend', 'plans', 'admin', 'account', 'onboarding']) {
    await page.goto(`/#/${route}?token=old-link`);
    await expect(page).toHaveURL(new RegExp(['account', 'onboarding'].includes(route) ? '#/files/profile$' : '#/overview$'));
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/auth-screen/);
  }
  expect(accountRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('beta route changes wait for the session before loading sign-in screens', async ({ page }) => {
  const accountRequests = [];
  let session;
  page.on('request', request => { if (request.url().includes('/api/v1/')) accountRequests.push(request.url()); });
  await page.route('**/api/session', route => { session = route; });
  await page.goto('/#/login');
  await expect.poll(() => Boolean(session)).toBe(true);
  await page.evaluate(() => { window.location.hash = '#/signup'; });
  await expect(page.getByText('Opening your workspace…', { exact: true })).toBeVisible();
  await session.continue();
  await expect(page).toHaveURL(/#\/overview$/);
  await expect(page.locator('main h1')).toBeVisible();
  expect(accountRequests).toEqual([]);
});

test('mobile beta navigation omits subscriptions and access administration', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#/bots');
  await expect(page.locator('main h1')).toBeVisible();
  await page.locator('#nav .mobile-primary button').click();
  const menu = page.locator('#mobile-nav');
  await expect(menu).toBeVisible();
  for (const route of ['naukri', 'boards', 'resume', 'linkedin', 'outreach', 'research', 'study']) {
    await expect(menu.locator(`a[href="#/${route}"]`)).toHaveCount(1);
  }
  await expect(menu.locator('a[href="#/plans"], a[href="#/account"], a[href="#/admin"], a[href="#/login"]')).toHaveCount(0);
});
