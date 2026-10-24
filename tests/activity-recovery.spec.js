import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

// All API requests and browser-opening calls are synthetic. Navigation to the
// Connections page must never launch Chrome, retry a run, or apply to a job.
const at = '2026-10-24T12:00:00+05:30';
const missing = 'Naukri is not connected in this automation browser. Open Connections → Naukri → Sign in, complete sign-in, check it, and close the browser before trying again.';
const reconnect = 'Naukri needs you to sign in again. Reconnect Naukri in Connections, check sign-in, and close the browser before trying again.';
const security = 'Naukri needs a security check. Open Connections → Naukri → Sign in, complete the verification, check sign-in, and close the browser before trying again.';
const naukri = { id: 'naukri-auth-failed', label: 'Naukri', action: 'naukri', running: false, stopping: false, status: 'failed', exit: 1, seconds: 9, started_at: at, finished: at };
const research = { id: 'research-working', label: 'Resume researcher', action: 'pipeline', running: true, stopping: false, status: 'running', seconds: 14, started_at: at };
const idle = { epoch: 'recovery-fixture', revision: 0, next: 0, running: false, stopping: false, active_count: 0, label: '', runs: [], lines: [], last: null };

function connectionSnapshot() {
  return {
    scope: 'main', scopes: [{ id: 'main', label: 'Main browser' }], browser_available: true, automation_available: true,
    runtime: { chrome_available: true, pdftotext_available: true, claude_installed: true, active_browsers: 0 },
    // Deliberately return Google first: the recovery route must focus Naukri.
    connections: [
      { id: 'google', label: 'Google / Gmail', state: 'connected', account_configured: true, expected_account: 'example@example.test', verified_account: 'example@example.test', message: 'Google sign-in checked.', last_verified_at: at },
      { id: 'naukri', label: 'Naukri', state: 'not_connected', account_configured: false, expected_account: '', message: 'No Naukri sign-in has been connected to this automation browser.' },
      { id: 'hirist', label: 'Hirist', state: 'not_connected', account_configured: false, expected_account: '', message: 'Sign in to Hirist when needed.' },
    ].map(row => ({ ...row, browser_open: false, can_open: true, can_check: true, can_close: false, session_scope: 'Main browser' })),
  };
}

async function workspace(page, { line = missing, action = 'naukri', account = false } = {}) {
  const run = { ...naukri, action };
  const state = {
    snapshot: { ...idle, revision: 1, next: 2, running: true, active_count: 1, label: research.label, runs: [run, research], lines: [[0, `2026-10-24 12:00:00,001 ERROR ${line}`, run.id, at], [1, 'Gathering research material.', research.id, at]] },
    mutations: [], unknown: [], connectionReads: [], errors: [],
  };
  let session = account
    ? { mode: 'accounts', legacy_access: true, user: { id: 'recovery-owner', name: 'Recovery owner', email: 'owner@example.test', role: 'admin', plan_name: 'Pro', modules: [] } }
    : { mode: 'local', legacy_access: true, user: null };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(snapshot => {
    window.__recoverySources = [];
    window.__recoveryWindows = [];
    window.open = (...args) => { window.__recoveryWindows.push(args); return null; };
    class FixtureEventSource extends EventTarget {
      constructor() {
        super(); this.closed = false; window.__recoverySources.push(this);
        queueMicrotask(() => { if (!this.closed) this.send(snapshot); });
      }
      send(value) { this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(value) })); }
      close() { this.closed = true; }
    }
    window.EventSource = FixtureEventSource;
  }, state.snapshot);
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() !== 'GET') {
      state.mutations.push({ method: request.method(), path, body: request.postData() });
      return route.fulfill({ status: 409, json: { error: 'Synthetic guard: no real action is allowed.' } });
    }
    if (path === '/api/connections') {
      state.connectionReads.push(url.searchParams.get('scope'));
      return route.fulfill({ json: connectionSnapshot() });
    }
    const replies = {
      '/api/session': session,
      '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
      '/api/status': { name: 'Synthetic recovery workspace', greeting: 'Hello', date: '2026-10-24', date_long: '24 October 2026', run: { ...state.snapshot, lines: [] }, questions: [], facts: [], sites: [], study: { today: 0, read: 0, total: 0 }, report: { ready: false, days: [] } },
      '/api/course': { today: 0, read: 0, total: 0, modules: [], lessons: [] },
      '/api/bots': { bots: [{ id: 'naukri', status: 'failed', running: false }, { id: 'research', running: true }], run: state.snapshot },
      '/api/run': state.snapshot,
      '/api/run/browsers': { runs: state.snapshot.runs.filter(item => item.running).map(item => ({ ...item, browser_state: 'waiting', message: 'Waiting for a browser', browsers: [] })) },
      '/api/v1/onboarding': { account_hints: {} },
      '/api/v1/auth/options': { provider: 'local', google: false, email: true },
    };
    if (Object.hasOwn(replies, path)) return route.fulfill({ json: replies[path] });
    state.unknown.push(path);
    return route.fulfill({ status: 404, json: { error: `No synthetic fixture for ${path}` } });
  });
  state.push = async snapshot => {
    state.snapshot = snapshot;
    await page.evaluate(value => window.__recoverySources.at(-1).send(value), snapshot);
  };
  state.signOut = () => {
    session = { mode: 'accounts', legacy_access: false, user: null };
    state.snapshot = structuredClone(idle);
  };
  await page.goto('/#/bots');
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  if (await page.locator('.activity-console').getAttribute('data-size') === 'collapsed') await page.locator('.activity-launch').click();
  await expect(page.getByRole('tab', { name: /^Progress/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox', { name: 'Agent run', exact: true })).toBeVisible();
  return state;
}

const activity = page => page.getByRole('region', { name: 'Activity', exact: true });
const recovery = page => activity(page).getByRole('link', { name: 'Connect Naukri', exact: true });
const picker = page => page.getByRole('combobox', { name: 'Agent run', exact: true });
const naukriCard = page => page.locator('.connection-card[data-provider="naukri"]');
async function safe(page, state) {
  expect(state.mutations).toEqual([]);
  expect(state.unknown).toEqual([]);
  expect(state.errors).toEqual([]);
  expect(await page.evaluate(() => window.__recoveryWindows)).toEqual([]);
}

test('Naukri recovery survives later errors and remains isolated to its selected run', async ({ page }) => {
  const state = await workspace(page);
  await expect(recovery(page)).not.toBeVisible();
  await picker(page).selectOption(naukri.id);
  await expect(recovery(page)).toBeVisible();
  await expect(recovery(page)).toHaveAttribute('href', '#/connections/naukri');
  await expect(page.locator('.activity-summary')).not.toContainText('expired');
  await recovery(page).focus();
  await state.push({
    ...state.snapshot, revision: 2, next: 48,
    lines: [
      ...Array.from({ length: 45 }, (_, index) => [index + 2, index % 2 ? 'ERROR The run could not finish.' : 'Saving results to the local report.', naukri.id, at]),
      [47, '× Naukri — failed (9s)', naukri.id, at],
    ],
  });
  await expect(recovery(page)).toBeVisible();
  await expect(recovery(page)).toBeFocused();
  await activity(page).getByRole('tab', { name: /^Browsers/ }).click();
  await expect(recovery(page)).not.toBeVisible();
  await activity(page).getByRole('tab', { name: /^Progress/ }).click();
  await expect(recovery(page)).toBeVisible();
  await expect(picker(page)).toHaveValue(naukri.id);
  await picker(page).selectOption(research.id);
  await expect(recovery(page)).not.toBeVisible();
  await picker(page).selectOption(naukri.id);
  await expect(recovery(page)).toBeVisible();
  await recovery(page).click();
  await expect(page).toHaveURL(/#\/connections\/naukri$/);
  await safe(page, state);
});

test('the recovery link focuses Naukri Connections without opening Chrome or retrying work', async ({ page }) => {
  const state = await workspace(page);
  await picker(page).selectOption(naukri.id);
  await recovery(page).click();
  await expect(page).toHaveURL(/#\/connections\/naukri$/);
  await expect(page.getByRole('heading', { name: 'Connections', exact: true, level: 1 })).toBeVisible();
  await expect(activity(page)).toHaveAttribute('data-size', 'collapsed');
  await expect(page.locator('.connection-card').first()).toHaveAttribute('data-provider', 'naukri');
  await expect(naukriCard(page)).toContainText('Google and Naukri use separate sign-ins.');
  await expect(naukriCard(page).getByRole('button', { name: 'Open sign-in: Naukri', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.connection-card')?.dataset.provider)).toBe('naukri');
  expect(state.connectionReads.length).toBeGreaterThan(0);
  expect(state.connectionReads.every(scope => scope === 'main')).toBe(true);
  await safe(page, state);
});

for (const [name, line] of [
  ['a previously verified session needs sign-in again', reconnect],
  ['the platform requires a security check', security],
  ['retained logs contain the old expired-sign-in message', 'Saved Naukri sign-in expired. Reconnect Naukri before trying again.'],
]) {
  test(`Naukri recovery is available when ${name}`, async ({ page }) => {
    const state = await workspace(page, { line });
    await picker(page).selectOption(naukri.id);
    await expect(recovery(page)).toBeVisible();
    await expect(recovery(page)).toHaveAttribute('href', '#/connections/naukri');
    await safe(page, state);
  });
}

test('generic sign-in and service errors do not send unrelated agents to Naukri', async ({ page }) => {
  const state = await workspace(page, { line: 'Connection refused while loading the page.' });
  await picker(page).selectOption(naukri.id);
  await expect(recovery(page)).not.toBeVisible();
  await state.push({ ...state.snapshot, revision: 2, next: 4, lines: [
    [2, 'Sign-in required. Review your platform session.', research.id, at],
    [3, 'Google session expired. Please sign in.', research.id, at],
  ] });
  await picker(page).selectOption(research.id);
  await expect(activity(page).getByRole('log', { name: 'Run progress', exact: true })).toContainText('Sign-in required');
  await expect(recovery(page)).not.toBeVisible();
  await safe(page, state);
});

test('a completed run does not retain an obsolete sign-in recovery action', async ({ page }) => {
  const state = await workspace(page);
  await picker(page).selectOption(naukri.id);
  await expect(recovery(page)).toBeVisible();
  await state.push({ ...state.snapshot, revision: 2, next: 3, runs: [{ ...naukri, status: 'completed', exit: 0 }, research], lines: [[2, '✓ Naukri — done (9s)', naukri.id, at]] });
  await expect(page.locator('.activity-state')).toHaveText('Completed');
  await expect(recovery(page)).not.toBeVisible();
  await safe(page, state);
});

test('account expiration removes recovery and late events cannot restore another account’s failure', async ({ page }) => {
  const state = await workspace(page, { account: true });
  await picker(page).selectOption(naukri.id);
  await expect(recovery(page)).toBeVisible();
  const previous = structuredClone(state.snapshot);
  state.signOut();
  await page.evaluate(() => window.dispatchEvent(new Event('account-expired')));
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.locator('.activity-recovery')).not.toBeVisible();
  await page.evaluate(snapshot => window.__recoverySources[0].send(snapshot), previous);
  await expect(page.locator('.activity-recovery')).not.toBeVisible();
  await expect(page.locator('.activity-summary')).not.toContainText('Naukri');
  await expect(page.locator('.console-lines')).not.toContainText(missing);
  expect(await page.evaluate(() => window.__recoverySources.every(source => source.closed))).toBe(true);
  await safe(page, state);
});

test('Naukri recovery remains readable and keyboard accessible on desktop and a short phone', async ({ page }) => {
  const state = await workspace(page);
  await picker(page).selectOption(naukri.id);
  await mkdir('artifacts/activity-recovery', { recursive: true });
  for (const [width, height] of [[1280, 812], [375, 667]]) {
    await page.setViewportSize({ width, height });
    await picker(page).focus();
    await page.keyboard.press('Tab');
    await expect(recovery(page)).toBeFocused();
    await expect(recovery(page)).toBeInViewport({ ratio: 1 });
    const bounds = await activity(page).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    await activity(page).screenshot({ path: `artifacts/activity-recovery/naukri-${width}.png`, animations: 'disabled' });
    const result = await new AxeBuilder({ page }).include('.activity-console').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target).join(', ')}`)).toEqual([]);
    const timeline = await activity(page).locator('.activity-log-wrap').boundingBox();
    expect(timeline.height, 'Recovery must leave a usable progress timeline.').toBeGreaterThanOrEqual(100);
    const details = activity(page).locator('.activity-details');
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
    await expect(activity(page).getByRole('log', { name: 'Run output', exact: true })).toContainText(missing);
    await details.locator('summary').click();
    await expect(details).not.toHaveAttribute('open', '');
    await recovery(page).focus();
    await expect(recovery(page)).toBeInViewport({ ratio: 1 });
  }
  await safe(page, state);
});
