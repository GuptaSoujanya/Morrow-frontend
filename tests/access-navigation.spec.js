import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

// Use scripts/preview.py's synthetic accounts only. The host guard deliberately
// rejects the production dashboard and temporary Firebase activation workspace.
const PASSWORD = 'Preview-only-passphrase-2026!';
const USER = 'preview.user@example.com';
const ADMIN = 'preview.admin@example.com';
const FREE_ROUTES = ['overview', 'records', 'data', 'files', 'plans', 'account'];
const RESTRICTED_ROUTES = ['bots', 'pipeline', 'todo', 'research', 'analytics', 'reports', 'study', 'setup', 'admin',
  'naukri', 'boards', 'sites', 'profile', 'linkedin', 'linkedin-profile', 'outreach', 'resume'];
const ADMIN_ROUTES = ['overview', 'bots', 'pipeline', 'todo', 'records', 'research', 'data', 'analytics', 'reports', 'study', 'files', 'plans', 'account', 'admin'];
let userState, adminState;

async function signIn(playwright, baseURL, email) {
  const api = await playwright.request.newContext({ baseURL });
  try {
    const response = await api.post('/api/v1/auth/login', { data: { email, password: PASSWORD } });
    expect(response.ok(), `${email}: ${response.status()}`).toBeTruthy();
    return await api.storageState();
  } finally { await api.dispose(); }
}

async function open(page, route, state = userState) {
  await page.context().addCookies(state.cookies);
  await page.goto('/#/' + route);
  await expect(page.locator('main h1')).toBeVisible();
}

const sidebarLinks = page => page.locator('#nav .sidebar-scroll a.nav-item');
const hrefs = locator => locator.evaluateAll(links => links.map(link => link.getAttribute('href')));

async function expectFreeNavigation(page) {
  await expect(sidebarLinks(page)).toHaveCount(FREE_ROUTES.length);
  expect(await hrefs(sidebarLinks(page))).toEqual(FREE_ROUTES.map(route => '#/' + route));
  await expect(page.locator('#console-dock')).toBeHidden();
}

async function observeNavigation(page, phase = 'free') {
  await page.addInitScript(({ restrictedRoutes, initialPhase }) => {
    window.__navigationAudit = { phase: initialPhase, violations: [] };
    const restricted = new Set(restrictedRoutes.map(route => '#/' + route));
    const inspect = root => {
      if (!(root instanceof Element)) return;
      const links = [...(root.matches('a[href]') ? [root] : []), ...root.querySelectorAll('a[href]')];
      for (const link of links) {
        if (!link.closest('#nav, #mobile-nav')) continue;
        const href = link.getAttribute('href');
        if (window.__navigationAudit.phase === 'pending' ||
            (window.__navigationAudit.phase === 'free' && restricted.has(href))) {
          window.__navigationAudit.violations.push({ phase: window.__navigationAudit.phase, href });
        }
      }
    };
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) inspect(node);
    }).observe(document, { childList: true, subtree: true });
  }, { restrictedRoutes: RESTRICTED_ROUTES, initialPhase: phase });
}

async function expectNoNavigationLeak(page) {
  expect(await page.evaluate(() => window.__navigationAudit.violations)).toEqual([]);
}

async function readyForScreenshot(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function expectAccessible(page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.filter(item => ['critical', 'serious'].includes(item.impact))
    .map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const target = new URL(baseURL);
  expect(['localhost', '127.0.0.1']).toContain(target.hostname);
  expect(target.port, 'Access regressions must use the isolated synthetic dashboard on 8102.').toBe('8102');
  await mkdir('artifacts/accounts', { recursive: true });
  userState = await signIn(playwright, baseURL, USER);
  adminState = await signIn(playwright, baseURL, ADMIN);
});

test('identity loading never inserts unrestricted navigation before the Free workspace opens', async ({ page }) => {
  await page.context().addCookies(userState.cookies);
  await observeNavigation(page, 'pending');
  let pendingSession;
  await page.route('**/api/session', route => { pendingSession = route; });
  await page.goto('/#/overview');
  await expect.poll(() => Boolean(pendingSession)).toBe(true);
  await expect(page.locator('#nav a')).toHaveCount(0);
  await expectNoNavigationLeak(page);
  await page.evaluate(() => { window.__navigationAudit.phase = 'free'; });
  await pendingSession.continue();
  await page.unroute('**/api/session');
  await expect(page.locator('.tenant-overview')).toBeVisible();
  await expectFreeNavigation(page);
  await expectNoNavigationLeak(page);
});

test('Free navigation stays identical across shortcuts, plans, account, history, and reload', async ({ page }) => {
  await observeNavigation(page);
  await open(page, 'overview');
  await expectFreeNavigation(page);
  await page.keyboard.press('2');
  await expect(page.getByRole('heading', { level: 1, name: 'Applications' })).toBeVisible();
  await page.keyboard.press('9');
  await expect(page).toHaveURL(/#\/records(?:\?|$)/);
  await expectFreeNavigation(page);
  await sidebarLinks(page).filter({ hasText: 'Plans & billing' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Plans & billing' })).toBeVisible();
  await expectFreeNavigation(page);
  await page.locator('#nav .sidebar-scroll a[href="#/account"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Account settings' })).toBeVisible();
  await expectFreeNavigation(page);
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Plans & billing' })).toBeVisible();
  await expectFreeNavigation(page);
  await expectNoNavigationLeak(page);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Plans & billing' })).toBeVisible();
  await expectFreeNavigation(page);
  await expectNoNavigationLeak(page);
});

test('mobile Free navigation contains the same permitted sections before and after visiting plans', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await observeNavigation(page);
  await open(page, 'overview');
  expect(await hrefs(page.locator('#nav .mobile-primary a.nav-item')))
    .toEqual(['#/overview', '#/records', '#/data', '#/files']);
  await page.getByRole('button', { name: 'More sections' }).click();
  const menu = page.getByRole('dialog', { name: 'All sections' });
  await expect(menu).toBeVisible();
  expect(await hrefs(menu.locator('a.nav-item'))).toEqual(FREE_ROUTES.map(route => '#/' + route));
  await menu.getByRole('link', { name: 'Plans & billing', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Plans & billing' })).toBeVisible();
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'More sections' }).click();
  expect(await hrefs(menu.locator('a.nav-item'))).toEqual(FREE_ROUTES.map(route => '#/' + route));
  await menu.getByRole('button', { name: 'Close navigation' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
  await expectNoNavigationLeak(page);
});

test('paid and administrator deep links explain access without loading protected tools', async ({ page }) => {
  const protectedRequests = [];
  page.on('request', request => {
    if (/\/api\/(?:bots|run|pipeline|v1\/admin)(?:[/?]|$)/.test(new URL(request.url()).pathname)) protectedRequests.push(request.url());
  });
  await observeNavigation(page);
  await open(page, 'bots');
  await expect(page.getByRole('heading', { level: 1, name: 'Bot Crew' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Compare plans', exact: true })).toBeVisible();
  await expectFreeNavigation(page);
  await expectAccessible(page);
  await page.screenshot({ path: 'artifacts/accounts/access-upgrade-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('button', { name: 'More sections', exact: true })).toBeVisible();
  await expect(page.locator('#nav .mobile-primary a.nav-item')).toHaveCount(4);
  for (const link of await page.locator('#nav .mobile-primary a.nav-item').all()) await expect(link).toBeVisible();
  await readyForScreenshot(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
  await page.screenshot({ path: 'artifacts/accounts/access-upgrade-mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'Compare plans', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Plans & billing' })).toBeVisible();
  await expect(page).toHaveURL(/#\/plans\?module=automations$/);
  await expect(page.locator('details.account-comparison')).toHaveJSProperty('open', true);
  await expect(page.locator('.account-comparison').getByRole('rowheader', { name: 'Automations', exact: true })).toBeVisible();
  await expectFreeNavigation(page);
  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A space for administrators.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open administration', exact: true })).toHaveCount(0);
  await expectFreeNavigation(page);
  await expectAccessible(page);
  expect(protectedRequests).toEqual([]);
  await expectNoNavigationLeak(page);
});

test('administrators keep every module across plans while tenant runtime availability remains explicit', async ({ page }) => {
  await open(page, 'plans', adminState);
  await expect(sidebarLinks(page)).toHaveCount(ADMIN_ROUTES.length);
  expect(await hrefs(sidebarLinks(page))).toEqual(ADMIN_ROUTES.map(route => '#/' + route));
  await page.locator('#nav .sidebar-scroll a[href="#/bots"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bot Crew' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bot Crew needs a connection.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Compare plans', exact: true })).toHaveCount(0);
  expect(await hrefs(sidebarLinks(page))).toEqual(ADMIN_ROUTES.map(route => '#/' + route));
  await page.locator('#nav .sidebar-scroll a[href="#/admin"]').click();
  await expect(page.getByRole('button', { name: 'Open administration', exact: true })).toBeDisabled();
  expect(await hrefs(sidebarLinks(page))).toEqual(ADMIN_ROUTES.map(route => '#/' + route));
});

test('a failed workspace request cannot replace plans after the user navigates back', async ({ page }) => {
  await observeNavigation(page);
  await open(page, 'plans');
  // Status is a direct read, so its rejection reaches bootstrap immediately;
  // /api/meta has retry semantics that would otherwise leave this assertion early.
  let pendingStatus;
  await page.route('**/api/status', route => { pendingStatus = route; });
  await page.locator('#nav .sidebar-scroll a[href="#/records"]').click();
  await expect.poll(() => Boolean(pendingStatus)).toBe(true);
  await expectFreeNavigation(page);
  await page.locator('#nav .sidebar-scroll a[href="#/plans"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Plans & billing' })).toBeVisible();
  const failedRequest = page.waitForResponse(response => new URL(response.url()).pathname === '/api/status' && response.status() === 503);
  await pendingStatus.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic delayed workspace failure' }) });
  await (await failedRequest).finished();
  await readyForScreenshot(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Plans & billing' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Your workspace is unavailable.');
  await expectFreeNavigation(page);
  await expectNoNavigationLeak(page);
});

test('a changed session supersedes an older administrator workspace request', async ({ page }) => {
  await observeNavigation(page, 'admin');
  await open(page, 'plans', adminState);
  const oldIdentity = await (await page.request.get('/api/session')).json();
  expect(oldIdentity.user.role).toBe('admin');
  let pendingSession;
  await page.route('**/api/session', route => {
    if (!pendingSession) pendingSession = route;
    else return route.continue();
  });
  await page.locator('#nav .sidebar-scroll a[href="#/records"]').click();
  await expect.poll(() => Boolean(pendingSession)).toBe(true);
  await page.context().addCookies(userState.cookies);
  await page.evaluate(() => {
    window.__navigationAudit.phase = 'free';
    window.__navigationAudit.violations = [];
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // Visibility refreshes queue behind bootstrap. Once its older response lands,
  // the queued identity check must run before that response can restore admin UI.
  await pendingSession.fulfill({ contentType: 'application/json', body: JSON.stringify(oldIdentity) });
  await expect(page.getByRole('heading', { level: 1, name: 'Applications' })).toBeVisible();
  await expectFreeNavigation(page);
  await readyForScreenshot(page);
  await expectFreeNavigation(page);
  await expectNoNavigationLeak(page);
});

test('signing out an administrator and signing in as Free clears privileged navigation', async ({ page }) => {
  await observeNavigation(page, 'admin');
  await open(page, 'account', adminState);
  await expect(page.locator('#nav a[href="#/admin"]')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await expect(page.locator('#nav a')).toHaveCount(0);
  await expect(page.locator('#mobile-nav a')).toHaveCount(0);
  await page.evaluate(() => { window.__navigationAudit.phase = 'free'; window.__navigationAudit.violations = []; });
  await page.getByLabel('Email address', { exact: true }).fill(USER);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in to Morrow', exact: true }).click();
  await expect(page.locator('.tenant-overview')).toBeVisible();
  await expectFreeNavigation(page);
  await expectNoNavigationLeak(page);
});
