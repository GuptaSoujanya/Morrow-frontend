import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

// This suite targets scripts/preview.py's isolated synthetic database only.
// It never starts a bot, uses provider credentials, or accesses the owner workspace.
const PASSWORD = 'Preview-only-passphrase-2026!';
const USER = 'preview.user@example.com';
const ADMIN = 'preview.admin@example.com';
const artifacts = 'artifacts/accounts';
const fileName = `account-integration-${Date.now()}.txt`;
let userState, adminState, userApi, originalProfile, uploadedFile, uploadedUiFile;
const token = state => state.cookies.find(cookie => cookie.name === 'morrow_csrf')?.value || '';

async function session(playwright, baseURL, email) {
  const api = await playwright.request.newContext({ baseURL });
  const response = await api.post('/api/v1/auth/login', { data: { email, password: PASSWORD } });
  expect(response.ok(), `${email}: ${response.status()}`).toBeTruthy();
  return { api, state: await api.storageState() };
}
async function open(page, route, state = userState) {
  await page.context().addCookies(state.cookies);
  await page.goto('/#/' + route);
  await expect(page.locator('main h1')).toBeVisible();
}
async function screenshot(page, name) {
  await page.evaluate(async () => { window.scrollTo(0, 0); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await page.locator('main').evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
  await page.screenshot({ path: `${artifacts}/${name}.png`, animations: 'disabled', fullPage: true });
}
async function accessible(page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.filter(item => ['critical', 'serious'].includes(item.impact)).map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
}
async function fit(page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth,
    overflowing: [...document.querySelectorAll('main *')].filter(element => !element.closest('.account-table-scroll') && element.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(element).position !== 'fixed').slice(0, 20).map(element => ({ tag: element.tagName, classes: element.className, width: Math.round(element.getBoundingClientRect().width) })) }));
  expect(dimensions.width, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
}
async function openAdmin(page) {
  await open(page, 'admin', adminState);
  await page.getByLabel('Reason for access', { exact: true }).fill('Synthetic integration check of account permissions');
  await page.getByRole('button', { name: 'Open administration', exact: true }).click();
  await expect(page.getByRole('table').first()).toBeVisible();
}

test.beforeAll(async ({ playwright, baseURL }) => {
  await mkdir(artifacts, { recursive: true });
  const user = await session(playwright, baseURL, USER); userApi = user.api; userState = user.state;
  const admin = await session(playwright, baseURL, ADMIN); adminState = admin.state; await admin.api.dispose();
  originalProfile = await (await userApi.get('/api/v1/profile')).json();
  const profile = { ...originalProfile.data, full_name: 'Jamie Chen', email: USER };
  const saved = await userApi.put('/api/v1/profile', { headers: { 'X-CSRF-Token': token(userState) }, data: { data: profile, expected_version: originalProfile.version } });
  expect(saved.ok()).toBeTruthy();
  const uploaded = await userApi.post('/api/v1/artifacts?filename=' + fileName, {
    headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': token(userState) }, data: Buffer.from('Synthetic private artifact for dashboard integration testing.'),
  });
  expect(uploaded.ok()).toBeTruthy(); uploadedFile = await uploaded.json();
});
test.afterAll(async () => {
  if (!userApi) return;
  if (originalProfile) {
    const current = await (await userApi.get('/api/v1/profile')).json();
    await userApi.put('/api/v1/profile', { headers: { 'X-CSRF-Token': token(userState) }, data: { data: originalProfile.data, expected_version: current.version } });
  }
  if (uploadedFile) await userApi.delete(`/api/v1/artifacts/${uploadedFile.id}`, { headers: { 'X-CSRF-Token': token(userState) } });
  if (uploadedUiFile) await userApi.delete(`/api/v1/artifacts/${uploadedUiFile.id}`, { headers: { 'X-CSRF-Token': token(userState) } });
  await userApi.dispose();
});

test('sign-in keeps the established Morrow theme and accessible controls', async ({ page }) => {
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await expect(page.locator('#nav')).toBeHidden();
  await expect(page.locator('#console-dock')).toBeHidden();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveAttribute('type', 'email');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  const theme = await page.evaluate(() => ({ canvas: getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim(), font: getComputedStyle(document.querySelector('h1')).fontFamily }));
  expect(theme.canvas).toBe('#121318'); expect(theme.font).toContain('Space Grotesk');
  await expect(page.locator('.account-scene-hero .crew-avatar.morrow-world')).toHaveCount(1);
  await expect(page.locator('.account-scene-tab-art .crew-avatar.morrow-world')).toHaveCount(3);
  await accessible(page); await screenshot(page, 'login-desktop');
  await page.setViewportSize({ width: 375, height: 812 }); await fit(page);
  const buttonLayout = await page.getByRole('button', { name: 'Sign in to Morrow' }).evaluate(button => {
    const range = document.createRange(); range.selectNodeContents([...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE));
    return { label: button.textContent, color: getComputedStyle(button).color, button: button.getBoundingClientRect().toJSON(), text: range.getBoundingClientRect().toJSON() };
  });
  expect(buttonLayout.text.left).toBeGreaterThanOrEqual(buttonLayout.button.left);
  expect(buttonLayout.text.right).toBeLessThanOrEqual(buttonLayout.button.right);
  await screenshot(page, 'login-mobile');
  await expect(page.locator('.account-form-character .crew-avatar.morrow-world')).toBeVisible();
});

test('invalid credentials show inline feedback without opening protected views', async ({ page }) => {
  await page.goto('/#/login');
  await page.getByLabel('Email address', { exact: true }).fill(`absent-${Date.now()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('Incorrect-only-password');
  await page.getByRole('button', { name: 'Sign in to Morrow' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#nav')).toBeHidden();
  await expect(page).toHaveURL(/#\/login/);
});

test('auth validation identifies the field and keeps incomplete data off the network', async ({ page }) => {
  const logins = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/v1/auth/login')) logins.push(request.url()); });
  await page.goto('/#/login');
  await page.getByRole('button', { name: 'Sign in to Morrow' }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Email address', { exact: true })).toBeFocused();
  await expect(page.getByText('Enter your email address.', { exact: true })).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill('not-an-email');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in to Morrow' }).click();
  await expect(page.getByText('Enter a valid email, like you@example.com.', { exact: true })).toBeVisible();
  expect(logins).toEqual([]);
  await accessible(page); await screenshot(page, 'login-validation');
});

test('recovery waits for sign-in configuration and can retry a failed load', async ({ page }) => {
  let pendingOptions;
  const submissions = [];
  await page.route('**/api/v1/auth/options', route => { pendingOptions = route; });
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/v1/auth/')) submissions.push(request.url()); });
  await page.goto('/#/forgot');
  await expect(page.getByText('Preparing secure sign-in…', { exact: true })).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill('synthetic@example.com');
  await expect(page.getByRole('button', { name: 'Send reset link', exact: true })).toBeDisabled();
  await pendingOptions.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Preview service unavailable' }) });
  await expect(page.getByRole('alert')).toContainText('Sign-in options could not load.');
  await expect(page.getByRole('button', { name: 'Send reset link', exact: true })).toBeDisabled();
  await page.unroute('**/api/v1/auth/options');
  await page.route('**/api/v1/auth/options', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'local', google: false }) }));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send reset link', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('synthetic@example.com');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(submissions).toEqual([]);
});

test('workspace preview and password guide explain the next step without fake activity', async ({ page }) => {
  await page.goto('/#/signup');
  await page.getByRole('button', { name: 'Your search', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Your search', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Keep your next move in view.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Your growth', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room to get ready.', exact: true })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('short');
  await expect(page.locator('.account-password-guide')).toContainText('Use at least 12 characters.');
  await page.getByLabel('Password', { exact: true }).fill('exactly12abc');
  await expect(page.locator('.account-password-guide')).toContainText('12 characters');
  await expect(page.locator('.account-password-guide')).toContainText('Minimum length met.');
  await page.getByLabel('Password', { exact: true }).fill('a much longer unique passphrase');
  await expect(page.locator('.account-password-guide')).toContainText('A longer password — good choice.');
  await accessible(page); await screenshot(page, 'signup-desktop');
});

test('signup and password recovery use the same responsive account flow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#/signup');
  await expect(page.getByRole('heading', { name: 'Create your account.' })).toBeVisible();
  await page.getByLabel('Your name', { exact: true }).fill('Synthetic Account');
  await page.getByLabel('Email address', { exact: true }).fill(`signup-${Date.now()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await screenshot(page, 'signup-mobile');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Check your email' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Check your inbox.', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Check your inbox.', exact: true })).toBeFocused();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await fit(page); await screenshot(page, 'verification-mobile');
  await page.goto('/#/forgot');
  await page.getByLabel('Email address', { exact: true }).fill(`unknown-${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'If an eligible account exists' })).toBeVisible();
  await fit(page);
});

test('the real login form opens the existing dashboard and account navigation', async ({ page }) => {
  await page.goto('/#/login');
  await page.getByLabel('Email address', { exact: true }).fill(USER);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in to Morrow' }).click();
  await expect(page).toHaveURL(/#\/overview/);
  await expect(page.locator('.tenant-overview')).toBeVisible();
  await expect(page.locator('#nav')).toBeVisible();
  await expect(page.locator('#nav a[href="#/plans"]')).toBeVisible();
  await expect(page.locator('#nav a[href="#/admin"]')).toHaveCount(0);
  await expect(page.locator('#console-dock')).toBeHidden();
  await screenshot(page, 'workspace-desktop');
});

test('the original profile editor saves to the authenticated private profile', async ({ page }) => {
  await open(page, 'files/profile');
  const fullName = page.getByRole('textbox', { name: 'Full name', exact: true });
  await expect(fullName).toHaveValue('Jamie Chen');
  await fullName.fill('Jamie Integration Check');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Full name', exact: true })).toHaveValue('Jamie Integration Check');
  const saved = await (await userApi.get('/api/v1/profile')).json();
  expect(saved.data.full_name).toBe('Jamie Integration Check');
  await screenshot(page, 'profile-desktop');
});

test('applications and data hub retain existing views and private artifact downloads', async ({ page }) => {
  await open(page, 'records');
  await expect(page.getByRole('heading', { level: 1, name: 'Applications' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search records' })).toBeVisible();
  await expect(page.locator('.records-body')).toHaveAttribute('aria-busy', 'false');
  await page.goto('/#/data');
  await expect(page.getByRole('heading', { level: 1, name: 'Data hub' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search workspace data' }).fill(fileName);
  await expect(page.getByText(fileName, { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: `Open ${fileName}`, exact: true }).click();
  expect((await downloading).suggestedFilename()).toBe(fileName);
  const uiName = fileName.replace('integration', 'ui-upload');
  const uploadResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/artifacts');
  await page.getByLabel('Choose a private file', { exact: true }).setInputFiles({ name: uiName, mimeType: 'text/plain', buffer: Buffer.from('Uploaded through the original Morrow Data hub.') });
  uploadedUiFile = await (await uploadResponse).json();
  expect(uploadedUiFile.id).toBeTruthy();
  await page.getByRole('searchbox', { name: 'Search workspace data' }).fill(uiName);
  await expect(page.getByText(uiName, { exact: true })).toBeVisible();
  await screenshot(page, 'data-desktop');
});

test('plans show clear prices, BYO AI access, and preserve the dashboard shell', async ({ page }) => {
  await open(page, 'plans');
  await expect(page.locator('.account-plan')).toHaveCount(3);
  await expect(page.locator('.account-plan').filter({ has: page.getByRole('heading', { name: 'Plus', exact: true }) })).toContainText('₹499');
  await expect(page.locator('.account-plan').filter({ has: page.getByRole('heading', { name: 'Pro', exact: true }) })).toContainText('₹999');
  await expect(page.getByText('Your AI subscription stays yours.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Your current plan' })).toBeDisabled();
  await expect(page.locator('#nav .sidebar-brand')).toBeVisible();
  await accessible(page); await screenshot(page, 'plans-desktop');
  await page.setViewportSize({ width: 375, height: 812 }); await fit(page); await screenshot(page, 'plans-mobile');
});

test('provider preference saves and survives a reload', async ({ page }) => {
  await open(page, 'account');
  await page.getByRole('radio', { name: 'Kiro Your own subscription', exact: true }).check();
  await page.getByRole('button', { name: 'Save preference' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'AI preference saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Kiro Your own subscription', exact: true })).toBeChecked();
  await screenshot(page, 'account-desktop');
});

test('mobile account navigation fits and can open plans in the same shell', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, 'account');
  await fit(page);
  await page.getByRole('button', { name: 'More sections' }).click();
  await page.getByRole('dialog', { name: 'All sections' }).getByRole('link', { name: 'Plans & billing', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Plans & billing' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'All sections' })).not.toBeVisible();
  await fit(page);
});

test('administrator data stays gated until a reason is entered', async ({ page }) => {
  const adminReads = [];
  page.on('request', req => { if (req.url().includes('/api/v1/admin/')) adminReads.push(req.url()); });
  await open(page, 'admin', adminState);
  await expect(page.getByRole('button', { name: 'Open administration', exact: true })).toBeDisabled();
  expect(adminReads).toEqual([]);
  await page.getByLabel('Reason for access', { exact: true }).fill('Synthetic integration review of access controls');
  await page.getByRole('button', { name: 'Open administration', exact: true }).click();
  await expect(page.getByRole('table').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Audit trail', exact: true })).toBeVisible();
  await expect(page.locator('#nav a[href="#/admin"]')).toBeVisible();
  await accessible(page); await screenshot(page, 'admin-desktop');
});

test('admin plan save preserves Stripe price IDs and exposes recorded user data', async ({ page }) => {
  await openAdmin(page);
  const form = page.locator('.account-admin-plans form').first();
  const price = await form.getByLabel('Stripe monthly price ID', { exact: true }).inputValue();
  const update = page.waitForRequest(req => req.method() === 'PUT' && req.url().includes('/api/v1/admin/plans/'));
  await form.getByRole('button', { name: 'Save Free', exact: true }).click();
  expect((await update).postDataJSON().stripe_price_id).toBe(price || null);
  await expect(page.getByRole('status').filter({ hasText: 'Plan updated.' })).toBeVisible();
  await page.getByRole('button', { name: `View data for ${USER}`, exact: true }).click();
  await expect(page.locator('.account-inspection')).toBeVisible();
  await expect(page.locator('.account-inspection')).toContainText(fileName);
  await page.setViewportSize({ width: 375, height: 812 }); await fit(page); await screenshot(page, 'admin-mobile');
});

test('sign out clears protected content and expired sessions cannot reopen it', async ({ page, playwright, baseURL }) => {
  const fresh = await session(playwright, baseURL, USER);
  await open(page, 'account', fresh.state);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await expect(page.locator('#nav')).toBeHidden();
  await expect(page.locator('.account-person')).toHaveCount(0);
  await page.goto('/#/files/profile');
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await expect(page.locator('.file-editor')).toHaveCount(0);
  await fresh.api.dispose();
});
