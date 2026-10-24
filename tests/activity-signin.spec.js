import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const at = '2026-10-24T12:00:00Z';
const idle = { epoch: 'activity-signin-fixture', revision: 1, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const user = { id: '00000000-0000-4000-8000-000000000001', tenant_id: '00000000-0000-4000-8000-000000000002',
  name: 'Alice Example', email: 'alice@example.test', role: 'user', email_verified: true,
  modules: ['profile', 'files', 'applications'], effective_plan: 'free', plan_slug: 'free', plan_name: 'Free' };
const providers = [['naukri', 'Naukri'], ['linkedin', 'LinkedIn'], ['hirist', 'Hirist'], ['instahyre', 'Instahyre'],
  ['cutshort', 'Cutshort'], ['wellfound', 'Wellfound'], ['google', 'Google / Gmail']];
const scopes = [{ id: 'main', label: 'Main browser' }, { id: 'lane:hirist', label: 'Parallel lane · Hirist' }];
const groupId = (scope, provider) => scope !== 'main' ? scope : provider === 'linkedin' ? 'linkedin' : 'main';

function connections(scope = 'main') {
  return { scope, scopes: structuredClone(scopes), browser_available: true, automation_available: false,
    runtime: { available: true, chrome_available: true, pdftotext_available: true, active_browsers: 0, max_browsers: 3, location: 'This computer' },
    connections: providers.filter(([id]) => scope === 'main' || ['google', scope.split(':')[1]].includes(id)).map(([id, label]) => ({
      id, label, state: 'not_connected', expected_account: `${id}@saved.example.test`, account_configured: true,
      message: 'Complete sign-in in the automation browser.', fix: 'Check sign-in and close this browser before starting a workflow.',
      browser_open: false, pending: false, profile_busy: false, can_open: true, can_check: true, can_close: false,
      session_scope: id === 'linkedin' ? 'LinkedIn browser' : scope === 'main' ? 'Main browser · Google, Naukri and boards' : 'Parallel lane · hirist',
    })) };
}

// All browser connections, authentication and runner data are synthetic. No
// request can reach a provider, launch a profile or execute a real workflow.
const test = base.extend({
  fixture: async ({ page }, use) => {
    const state = { authenticated: true, owner: false, user: structuredClone(user), snapshot: structuredClone(idle),
      connections: { main: connections(), 'lane:hirist': connections('lane:hirist') },
      reads: [], actions: [], unexpected: [], errors: [], ownerReads: [], heldRead: null, holdRead: false,
      heldAction: null, holdAction: false, readFailure: false, actionFailure: false, asyncCheck: false, expectedPopupCount: 0 };
    state.group = (group, values) => {
      for (const [scope, result] of Object.entries(state.connections)) for (const row of result.connections) {
        if (groupId(scope, row.id) === group) Object.assign(row, values);
      }
    };
    state.openGroup = group => state.group(group, { browser_open: true, can_close: true, state: 'needs_sign_in' });
    state.releaseRead = async () => { const held = state.heldRead; state.heldRead = null; await held.route.fulfill({ json: held.data }).catch(() => {}); };
    state.releaseAction = async response => { const held = state.heldAction; state.heldAction = null; await held.route.fulfill(response || { json: held.data }).catch(() => {}); };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.addInitScript(snapshot => {
      window.__signinSources = []; window.__signinRequests = []; window.__signinOpens = [];
      class FixtureEventSource extends EventTarget {
        constructor(url) { super(); this.url = url; this.closed = false; window.__signinSources.push(this); queueMicrotask(() => this.send(snapshot)); }
        send(value) { if (!this.closed) this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(value) })); }
        close() { this.closed = true; }
      }
      window.EventSource = FixtureEventSource;
      const fetch = window.fetch.bind(window);
      window.fetch = (input, options) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
        if (!url.pathname.startsWith('/api/connections')) return fetch(input, options);
        const entry = { path: url.pathname, scope: url.searchParams.get('scope'), method: options?.method || 'GET', aborted: false, pending: true };
        window.__signinRequests.push(entry);
        options?.signal?.addEventListener('abort', () => { entry.aborted = true; }, { once: true });
        return fetch(input, options).finally(() => { entry.pending = false; });
      };
      window.open = (...args) => { window.__signinOpens.push(args); return null; };
    }, idle);
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
      if (method === 'GET' && path === '/api/session') return route.fulfill(state.authenticated
        ? { json: { mode: 'accounts', legacy_access: state.owner, user: state.user } }
        : { status: 401, json: { error: 'Sign in first.' } });
      if (method === 'GET' && path === '/api/connections') {
        const scope = url.searchParams.get('scope') || 'main'; state.reads.push(scope);
        if (!Object.hasOwn(state.connections, scope)) { state.unexpected.push(`GET unsupported scope ${scope}`); return route.fulfill({ status: 400, json: { error: 'Unsupported fixture browser group.' } }); }
        if (state.holdRead && scope === 'main') { state.holdRead = false; state.heldRead = { route, data: structuredClone(state.connections[scope]) }; return; }
        if (state.readFailure) return route.fulfill({ status: 503, json: { error: 'The synthetic connection service is temporarily unavailable.' } });
        return route.fulfill({ json: state.connections[scope] });
      }
      if (method === 'POST' && /^\/api\/connections\/(naukri|linkedin|hirist|instahyre|cutshort|wellfound|google)\/(check|close|open)$/.test(path)) {
        const [, , , provider, operation] = path.split('/'), body = request.postDataJSON();
        state.actions.push({ provider, operation, body });
        const result = state.connections[body.scope || 'main'], row = result?.connections.find(item => item.id === provider);
        if (!row) { state.unexpected.push(`POST unknown browser ${provider}`); return route.fulfill({ status: 400, json: { error: 'Unknown synthetic browser.' } }); }
        if (state.actionFailure) return route.fulfill({ status: 503, json: { error: 'This sign-in browser could not be checked. Try again.' } });
        if (Object.hasOwn(body, 'expected_account')) row.expected_account = body.expected_account;
        if (operation === 'open') state.openGroup(groupId(body.scope || 'main', provider));
        if (operation === 'check') {
          if (state.asyncCheck) {
            state.group(groupId(body.scope || 'main', provider), { pending: true, can_check: false, can_close: false });
            Object.assign(row, { state: 'checking', message: 'Checking the signed-in account…' });
          } else Object.assign(row, { state: 'connected', message: 'Signed-in account checked.', last_verified_at: at, verified_account: row.expected_account });
        }
        if (operation === 'close') state.group(groupId(body.scope || 'main', provider), { browser_open: false, can_close: false, pending: false });
        if (state.holdAction) { state.holdAction = false; state.heldAction = { route, data: structuredClone(result) }; return; }
        return route.fulfill({ json: result });
      }
      if (method === 'GET' && path.startsWith('/api/run') && state.owner) {
        state.ownerReads.push(path);
        if (path === '/api/run') return route.fulfill({ json: state.snapshot });
        const run = state.snapshot.runs[0];
        if (path === '/api/run/browsers') return route.fulfill({ json: { runs: run ? [{ ...run, open_browser_count: 1, count_status: 'ready' }] : [] } });
      }
      const profile = { full_name: state.user.name, email: state.user.email, phone: '+91 9999900000', current_location: 'Bengaluru', titles: ['Engineer'] };
      const replies = {
        '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
        '/api/status': { name: state.user.name, greeting: 'Hello', date: '2026-10-24', date_long: '24 October 2026', run: state.snapshot,
          questions: [], facts: [], sites: [], study: { today: 1, read: 0, total: 0 }, report: { ready: false, days: [] } },
        '/api/course': { today: 1, read: 0, total: 0, lessons: [], modules: [] },
        '/api/v1/onboarding': { version: 1, platforms: ['naukri', 'google'], account_hints: {}, resume_artifact_id: null, resume: null,
          profile: { version: 1, data: profile, updated_at: at }, completed_at: null,
          readiness: { profile_complete: true, resume_ready: false, missing_profile_fields: [] } },
        '/api/v1/artifacts': { items: [], limit: 100, offset: 0 },
        '/api/v1/auth/options': { provider: 'local', google: false, email: true },
      };
      if (method === 'GET' && Object.hasOwn(replies, path)) return route.fulfill({ json: replies[path] });
      state.unexpected.push(`${method} ${path}`);
      return route.fulfill({ status: 409, json: { error: 'Synthetic fixture guard: this action is not allowed.' } });
    });
    state.open = async () => {
      await page.clock.install({ time: new Date(at) });
      await page.goto('/#/onboarding');
      await expect(page.locator('.onboarding-page')).toBeVisible();
      await expect(activity(page)).toBeVisible();
    };
    await use(state);
    expect(state.unexpected, 'No requests escape the synthetic fixture.').toEqual([]);
    expect(state.errors, 'The UI must not throw.').toEqual([]);
    expect(await page.evaluate(() => window.__signinOpens), 'Only explicitly requested browser windows may open.').toHaveLength(state.expectedPopupCount);
    if (!state.owner) expect(await page.evaluate(() => window.__signinSources.map(source => source.url)), 'Free accounts must not subscribe to owner activity.').toEqual([]);
  },
});

const activity = page => page.getByRole('region', { name: 'Activity', exact: true });
const signin = root => root.locator('.signin-browsers');
const card = (root, group = 'main') => signin(root).locator(`.signin-browser-card[data-browser-group="${group}"]`);
async function expand(page) {
  if (await activity(page).getAttribute('data-size') === 'collapsed') await activity(page).locator('.activity-launch').click();
  const browsers = activity(page).getByRole('tab', { name: /^Browsers/ });
  if (await browsers.isVisible()) await browsers.click();
  await expect(signin(activity(page))).toBeVisible();
}
async function visibility(page, hidden) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: value ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test.beforeAll(async ({ baseURL }) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname);
  await mkdir('artifacts/activity-signin', { recursive: true });
});

test('a Free account sees honest sign-in Activity without owner runner requests', async ({ page, fixture }) => {
  await fixture.open(); await expand(page);
  await expect(activity(page).getByRole('tablist')).not.toBeVisible();
  await expect(signin(activity(page))).toContainText('No sign-in browsers are open.');
  await expect(card(activity(page))).toHaveCount(0);
  expect(fixture.actions).toEqual([]);
  expect(fixture.ownerReads).toEqual([]);
});

test('a browser opened from setup appears in Activity with no extra open action', async ({ page, fixture }) => {
  await fixture.open();
  await page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button', { name: /Connect accounts/ }).click();
  const setupCard = page.locator('.connection-card[data-provider="naukri"]');
  await setupCard.getByRole('button', { name: 'Open sign-in: Naukri', exact: true }).click();
  await expect(setupCard.getByRole('button', { name: 'Check sign-in: Naukri', exact: true })).toBeEnabled();
  await expand(page);
  await expect(card(activity(page))).toHaveCount(1);
  await expect(card(activity(page))).toContainText('Main browser');
  expect(fixture.actions.map(item => item.operation)).toEqual(['open']);
});

test('main, LinkedIn and parallel lanes are grouped by actual browser rather than provider row', async ({ page, fixture }) => {
  fixture.openGroup('main'); fixture.openGroup('linkedin'); fixture.openGroup('lane:hirist');
  await fixture.open(); await expand(page);
  await expect(signin(activity(page)).locator('.signin-browser-card')).toHaveCount(3);
  await expect(card(activity(page), 'main')).toContainText('Main browser');
  await expect(card(activity(page), 'linkedin')).toContainText('LinkedIn browser');
  await expect(card(activity(page), 'lane:hirist')).toContainText('Parallel lane · Hirist');
  expect(new Set(fixture.reads)).toEqual(new Set(['main', 'lane:hirist']));
  expect(fixture.actions).toEqual([]);
});

test('Activity follows the targeted browser account until the user explicitly chooses another account', async ({ page, fixture }) => {
  fixture.openGroup('main');
  fixture.group('main', { browser_provider: 'hirist', browser_group: 'main' });
  for (const row of fixture.connections.main.connections) {
    row.browser_active = row.id === 'hirist';
    if (['naukri', 'google'].includes(row.id)) Object.assign(row, {
      state: 'connected', verified_account: row.expected_account, last_verified_at: at, message: 'This account was checked earlier.',
    });
  }
  await fixture.open(); await expand(page);
  await expect(card(activity(page)).getByRole('combobox', { name: 'Account to check in Main browser', exact: true })).toHaveValue('hirist');
  const main = card(activity(page));
  const account = main.getByRole('combobox', { name: 'Account to check in Main browser', exact: true });
  await expect(account).toHaveValue('hirist');
  await main.getByRole('button', { name: 'Check sign-in in Main browser', exact: true }).click();
  await expect(main).toContainText('Signed-in account checked.');
  expect(fixture.actions).toEqual([{ provider: 'hirist', operation: 'check', body: { scope: 'main' } }]);
  await account.selectOption('google');
  const reads = fixture.reads.length;
  await page.clock.fastForward(5100);
  await expect.poll(() => fixture.reads.length).toBeGreaterThan(reads);
  await expect(account).toHaveValue('google');
  await expect(card(activity(page)).getByRole('combobox', { name: 'Account to check in Main browser', exact: true })).toHaveValue('google');
  await card(activity(page)).getByRole('button', { name: 'Check sign-in in Main browser', exact: true }).click();
  await expect.poll(() => fixture.actions.length).toBe(2);
  expect(fixture.actions[1]).toEqual({ provider: 'google', operation: 'check', body: { scope: 'main' } });
  expect(fixture.actions.every(action => Object.keys(action.body).join() === 'scope')).toBe(true);
});

test('checking and closing target the chosen account and scope without overwriting saved hints', async ({ page, fixture }) => {
  fixture.openGroup('main'); fixture.openGroup('lane:hirist');
  await fixture.open(); await expand(page);
  const main = card(activity(page));
  await main.getByRole('combobox', { name: 'Account to check in Main browser', exact: true }).selectOption('google');
  await main.getByRole('button', { name: 'Check sign-in in Main browser', exact: true }).click();
  await expect.poll(() => fixture.actions.length).toBe(1);
  expect(fixture.actions[0]).toEqual({ provider: 'google', operation: 'check', body: { scope: 'main' } });
  await expect(main).toContainText(/checked|connected/i);
  await main.getByRole('button', { name: 'Close browser in Main browser', exact: true }).click();
  await expect(card(activity(page))).toHaveCount(0);
  const lane = card(activity(page), 'lane:hirist');
  await lane.getByRole('combobox', { name: 'Account to check in Parallel lane · Hirist', exact: true }).selectOption('hirist');
  await lane.getByRole('button', { name: 'Check sign-in in Parallel lane · Hirist', exact: true }).click();
  await expect.poll(() => fixture.actions.length).toBe(3);
  expect(fixture.actions[2]).toEqual({ provider: 'hirist', operation: 'check', body: { scope: 'lane:hirist' } });
  expect(fixture.connections.main.connections.find(row => row.id === 'google').expected_account).toBe('google@saved.example.test');
  expect(fixture.connections['lane:hirist'].connections.find(row => row.id === 'hirist').expected_account).toBe('hirist@saved.example.test');
  expect(fixture.actions.every(item => !Object.hasOwn(item.body, 'expected_account'))).toBe(true);
});

test('pending and occupied profiles cannot issue conflicting browser controls', async ({ page, fixture }) => {
  fixture.group('main', { pending: true, state: 'opening', can_check: false, can_close: false });
  fixture.openGroup('linkedin'); fixture.group('linkedin', { profile_busy: true, can_check: false, can_close: false });
  await fixture.open(); await expand(page);
  await expect(card(activity(page))).toBeVisible();
  await expect(card(activity(page)).getByRole('button', { name: 'Check sign-in in Main browser', exact: true })).toBeDisabled();
  await expect(card(activity(page)).getByRole('button', { name: 'Close browser in Main browser', exact: true })).toBeDisabled();
  await expect(card(activity(page), 'linkedin').getByRole('button', { name: 'Check sign-in in LinkedIn browser', exact: true })).toBeDisabled();
  expect(fixture.actions).toEqual([]);
});

test('an in-flight sign-in check disables duplicate actions until its result arrives', async ({ page, fixture }) => {
  fixture.openGroup('main'); fixture.holdAction = true;
  await fixture.open(); await expand(page);
  const main = card(activity(page));
  await main.getByRole('button', { name: 'Check sign-in in Main browser', exact: true }).click();
  await expect.poll(() => Boolean(fixture.heldAction)).toBe(true);
  await expect(main.getByRole('button', { name: 'Check sign-in in Main browser', exact: true })).toBeDisabled();
  await expect(main.getByRole('button', { name: 'Close browser in Main browser', exact: true })).toBeDisabled();
  await expect(main.getByRole('combobox')).toBeDisabled();
  expect(fixture.actions).toHaveLength(1);
  await fixture.releaseAction();
  await expect(main.getByRole('button', { name: 'Check sign-in in Main browser', exact: true })).toBeEnabled();
});

test('collapsing and reopening Activity preserves a pending action and reports its eventual failure', async ({ page, fixture }) => {
  fixture.openGroup('main'); fixture.holdAction = true;
  await fixture.open(); await expand(page);
  const section = signin(activity(page));
  await expect(section.getByRole('button', { name: 'Refresh sign-in browsers', exact: true })).toBeEnabled();
  await card(activity(page)).getByRole('button', { name: 'Check sign-in in Main browser', exact: true }).click();
  await expect.poll(() => Boolean(fixture.heldAction)).toBe(true);
  const reads = fixture.reads.length;
  await activity(page).getByRole('button', { name: 'Close activity', exact: true }).click();
  await expect(activity(page)).toHaveAttribute('data-size', 'collapsed');
  await expand(page);
  await expect(section).toContainText('Finishing the requested browser action…');
  await expect(section.getByRole('button', { name: 'Refresh sign-in browsers', exact: true })).toBeDisabled();
  await expect(card(activity(page))).toHaveCount(0);
  await page.clock.fastForward(5100);
  expect(fixture.reads).toHaveLength(reads);
  expect(fixture.actions).toHaveLength(1);
  await fixture.releaseAction({ status: 503, json: { error: 'The delayed sign-in check failed. Try again.' } });
  await expect(section.getByRole('button', { name: 'Refresh sign-in browsers', exact: true })).toBeEnabled();
  await page.clock.fastForward(1100);
  await expect(card(activity(page))).toContainText('The delayed sign-in check failed. Try again.');
  expect(fixture.actions).toHaveLength(1);
  await card(activity(page)).getByRole('button', { name: 'Check sign-in in Main browser', exact: true }).click();
  await expect(card(activity(page))).not.toContainText('The delayed sign-in check failed. Try again.');
  expect(fixture.actions.map(item => item.operation)).toEqual(['check', 'check']);
});

test('account expiry aborts a pending action and its late result cannot restore private browser controls', async ({ page, fixture }) => {
  fixture.openGroup('main'); fixture.holdAction = true;
  await fixture.open(); await expand(page);
  await card(activity(page)).getByRole('button', { name: 'Check sign-in in Main browser', exact: true }).click();
  await expect.poll(() => Boolean(fixture.heldAction)).toBe(true);
  fixture.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event('account-expired')));
  await expect(page).toHaveURL(/#\/login$/);
  await expect(activity(page)).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__signinRequests.some(item => item.method === 'POST' && item.aborted))).toBe(true);
  const reads = fixture.reads.length;
  await fixture.releaseAction(); await page.clock.fastForward(6000);
  expect(fixture.reads).toHaveLength(reads);
  expect(fixture.actions).toHaveLength(1);
  await expect(page.locator('.signin-browser-card')).toHaveCount(0);
  await expect(page.locator('.signin-browsers')).not.toContainText('naukri@saved.example.test');
});

test('browser action errors stay visible and a retry can recover without opening another browser', async ({ page, fixture }) => {
  fixture.openGroup('main'); fixture.actionFailure = true;
  await fixture.open(); await expand(page);
  const main = card(activity(page));
  await main.getByRole('button', { name: 'Check sign-in in Main browser', exact: true }).click();
  await expect(main).toContainText('This sign-in browser could not be checked. Try again.');
  await page.clock.fastForward(5100);
  await expect(main).toContainText('This sign-in browser could not be checked. Try again.');
  fixture.actionFailure = false;
  await main.getByRole('button', { name: 'Check sign-in in Main browser', exact: true }).click();
  await expect(main).not.toContainText('This sign-in browser could not be checked. Try again.');
  expect(fixture.actions.map(item => item.operation)).toEqual(['check', 'check']);
});

test('a background sign-in check failure remains visible after its browser window disappears', async ({ page, fixture }) => {
  fixture.openGroup('main'); fixture.asyncCheck = true;
  await fixture.open(); await expand(page);
  const section = signin(activity(page)), main = card(activity(page));
  await main.getByRole('combobox', { name: 'Account to check in Main browser', exact: true }).selectOption('google');
  await main.getByRole('button', { name: 'Check sign-in in Main browser', exact: true }).click();
  await expect(section.locator('.signin-browsers-status')).toContainText('Sign-in check requested for Google / Gmail');
  await expect(main.getByRole('button', { name: 'Check sign-in in Main browser', exact: true })).toBeDisabled();
  fixture.group('main', { browser_open: false, pending: false, can_check: true, can_close: false });
  Object.assign(fixture.connections.main.connections.find(row => row.id === 'google'), {
    state: 'needs_attention', message: 'Google sign-in could not be verified. Reopen this account in Connections and try again.',
  });
  await page.clock.fastForward(1100);
  await expect(main).toHaveCount(0);
  await expect(section.locator('.signin-browsers-status')).toHaveAttribute('data-state', 'error');
  await expect(section.locator('.signin-browsers-status')).toContainText('Google sign-in could not be verified. Reopen this account in Connections and try again.');
  await expect(section.locator('.signin-browsers-status')).not.toContainText('Sign-in check requested');
  expect(fixture.actions).toEqual([{ provider: 'google', operation: 'check', body: { scope: 'main' } }]);
});

test('a failed browser refresh reports an error instead of inventing an empty list and later recovers', async ({ page, fixture }) => {
  fixture.openGroup('main');
  await fixture.open(); fixture.readFailure = true; await expand(page);
  await expect(signin(activity(page))).toContainText(/unavailable|could not|couldn’t|delayed|retry/i);
  await expect(signin(activity(page)).locator('.signin-browsers-empty')).toBeHidden();
  fixture.readFailure = false;
  await page.clock.fastForward(21000);
  await expect(card(activity(page))).toBeVisible();
});

test('polling pauses when Activity is collapsed or the page is hidden and resumes on visibility', async ({ page, fixture }) => {
  fixture.openGroup('main');
  await fixture.open(); await expand(page); await expect(card(activity(page))).toBeVisible();
  await expect.poll(() => fixture.reads.includes('lane:hirist')).toBe(true);
  await activity(page).getByRole('button', { name: 'Close activity', exact: true }).click();
  await expect(activity(page)).toHaveAttribute('data-size', 'collapsed');
  const collapsed = fixture.reads.length; await page.clock.fastForward(16000); expect(fixture.reads).toHaveLength(collapsed);
  await expand(page); await expect(card(activity(page))).toBeVisible();
  await visibility(page, true);
  const hidden = fixture.reads.length; await page.clock.fastForward(16000); expect(fixture.reads).toHaveLength(hidden);
  await visibility(page, false);
  await expect.poll(() => fixture.reads.length).toBeGreaterThan(hidden);
  expect(fixture.actions).toEqual([]);
});

test('collapsing Activity aborts a held read and its late result cannot restore browser cards', async ({ page, fixture }) => {
  fixture.openGroup('main');
  await fixture.open(); await expand(page); await expect(card(activity(page))).toBeVisible();
  const refresh = activity(page).getByRole('button', { name: 'Refresh sign-in browsers', exact: true });
  await expect(refresh).toBeEnabled(); fixture.holdRead = true; await refresh.click();
  await expect.poll(() => Boolean(fixture.heldRead)).toBe(true);
  await activity(page).getByRole('button', { name: 'Close activity', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__signinRequests.some(item => item.aborted))).toBe(true);
  const count = fixture.reads.length; await fixture.releaseRead(); await page.clock.fastForward(16000);
  expect(fixture.reads).toHaveLength(count);
  await expect(activity(page)).toHaveAttribute('data-size', 'collapsed');
  await expect(page.locator('.signin-browser-card')).toHaveCount(0);
});

test('switching accounts aborts old reads and prevents old sign-in accounts returning', async ({ page, fixture }) => {
  fixture.openGroup('main');
  await fixture.open(); await expand(page);
  const refresh = activity(page).getByRole('button', { name: 'Refresh sign-in browsers', exact: true });
  await expect(refresh).toBeEnabled(); fixture.holdRead = true; await refresh.click();
  await expect.poll(() => Boolean(fixture.heldRead)).toBe(true);
  fixture.user = { ...user, id: '00000000-0000-4000-8000-000000000004', tenant_id: '00000000-0000-4000-8000-000000000005', name: 'Bob Example', email: 'bob@example.test' };
  fixture.connections = { main: connections(), 'lane:hirist': connections('lane:hirist') };
  await page.clock.fastForward(31000);
  await expect(page.getByRole('textbox', { name: 'Full name *', exact: true })).toHaveValue('Bob Example');
  await expect(activity(page)).toHaveAttribute('data-size', 'collapsed');
  await expect.poll(() => page.evaluate(() => window.__signinRequests.some(item => item.aborted))).toBe(true);
  await fixture.releaseRead(); await page.clock.fastForward(6000);
  await expand(page);
  await expect(signin(activity(page))).toContainText('No sign-in browsers are open.');
  await expect(page.locator('.signin-browser-card')).toHaveCount(0);
  expect(fixture.actions).toEqual([]);
});

test('agent counts and sign-in browser controls coexist without opening a viewer', async ({ page, fixture }) => {
  fixture.owner = true; fixture.user = { ...user, role: 'admin' }; fixture.openGroup('main');
  const run = { id: 'synthetic-owner-run', action: 'naukri', label: 'Owner run', running: true, status: 'running', seconds: 10, started_at: at };
  fixture.snapshot = { ...idle, running: true, active_count: 1, runs: [run], label: run.label };
  await fixture.open();
  await page.evaluate(snapshot => window.__signinSources.at(-1)?.send(snapshot), fixture.snapshot);
  await expand(page);
  await expect(activity(page).locator('.activity-browser-overview-count')).toHaveText('1 agent browser open');
  await expect(card(activity(page))).toBeVisible();
  const before = fixture.reads.length;
  await page.clock.fastForward(6000);
  await expect.poll(() => fixture.reads.length).toBeGreaterThan(before);
  await expect(activity(page).getByRole('button', { name: 'All browsers', exact: true })).toHaveCount(0);
  await expect(activity(page).getByRole('button', { name: /Open browser/ })).toHaveCount(0);
  expect(fixture.ownerReads.every(path => ['/api/run', '/api/run/browsers'].includes(path))).toBe(true);
});

test('sign-in browser controls fit desktop and mobile with accessible names and no WCAG violations', async ({ page, fixture }) => {
  fixture.openGroup('main'); fixture.openGroup('linkedin'); fixture.openGroup('lane:hirist');
  await fixture.open(); await expand(page);
  for (const [width, height] of [[1280, 900], [375, 812]]) {
    await page.setViewportSize({ width, height });
    const section = signin(activity(page));
    await expect(section.locator('.signin-browser-card')).toHaveCount(3);
    const mainCheck = card(activity(page)).getByRole('button', { name: 'Check sign-in in Main browser', exact: true });
    await mainCheck.scrollIntoViewIfNeeded(); await mainCheck.click({ trial: true });
    const bounds = await activity(page).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    await activity(page).screenshot({ path: `artifacts/activity-signin/activity-${width}.png`, animations: 'disabled' });
    const activityAudit = await new AxeBuilder({ page }).include('.activity-console').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(activityAudit.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target).join(', ')}`)).toEqual([]);
  }
  expect(fixture.actions).toEqual([]);
});
