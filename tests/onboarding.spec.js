import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const idle = { epoch: 'onboarding-fixture', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const profile = { full_name: 'Alice Example', email: 'alice@example.com', phone: '+91 99999 00000',
  current_location: 'Bengaluru', titles: ['Software engineer'], skills: ['Python'],
  extra_facts: { qualification: 'Synthetic qualification' }, custom_preserved: 'Keep this fact' };
const user = { id: '00000000-0000-4000-8000-000000000001', tenant_id: '00000000-0000-4000-8000-000000000002',
  name: 'Alice Example', email: 'alice@example.com', role: 'user', email_verified: true,
  modules: ['profile', 'files', 'applications'], effective_plan: 'free', plan_slug: 'free', plan_name: 'Free' };
const providers = [['naukri', 'Naukri'], ['linkedin', 'LinkedIn'], ['hirist', 'Hirist'], ['instahyre', 'Instahyre'],
  ['cutshort', 'Cutshort'], ['wellfound', 'Wellfound'], ['google', 'Google / Gmail']];
const savedResume = { id: '00000000-0000-4000-8000-000000000003', filename: 'previous-resume.pdf',
  category: 'resumes', media_type: 'application/octet-stream', size_bytes: 256, created_at: '2026-10-24T09:00:00Z' };

function defaultConnections(scope = 'main') {
  return { scope, scopes: [{ id: 'main', label: 'Main browser' }, { id: 'lane:hirist', label: 'Parallel lane · Hirist' }],
    browser_available: true, automation_available: false,
    runtime: { available: true, chrome_available: true, pdftotext_available: true, automation_available: false, active_browsers: 0, max_browsers: 3, location: 'This computer' },
    connections: providers.map(([id, label]) => ({ id, label, state: 'not_connected', expected_account: '', account_configured: false,
      message: scope === 'main' ? 'Sign in to this account in your automation browser.' : 'This is a separate parallel lane session.',
      fix: 'Complete sign-in, check it, and close the browser before a run.', browser_open: false,
      can_open: true, can_check: true, can_close: false, session_scope: scope === 'main' ? 'Main browser' : 'Parallel lane · Hirist' })) };
}

// Every API endpoint is intercepted with synthetic fixtures. These tests cannot
// launch Chrome profiles, contact an account provider, or execute a real workflow.
const test = base.extend({
  fixture: async ({ page }, use) => {
    const state = { authenticated: true, user: structuredClone(user), legacy: false,
      setup: { version: 0, platforms: [], account_hints: {}, resume_artifact_id: null, resume: null,
        profile: { version: 1, data: structuredClone(profile), updated_at: '2026-10-24T09:00:00Z' }, completed_at: null },
      artifacts: [structuredClone(savedResume)], profiles: [], saves: [], uploads: [], actions: [], reads: [], syncs: [],
      connections: { main: defaultConnections(), 'lane:hirist': defaultConnections('lane:hirist') },
      unexpected: [], errors: [], profileConflict: false, setupConflict: false, connectionFailure: false, syncFailure: false,
      holdConnections: false, heldConnection: null, holdAction: false, heldAction: null };
    state.snapshot = () => {
      const data = structuredClone(state.setup), facts = data.profile.data;
      const missing = ['full_name', 'email', 'phone', 'current_location', 'titles'].filter(key => !facts[key] || (Array.isArray(facts[key]) && !facts[key].length));
      data.resume = state.artifacts.find(item => item.id === data.resume_artifact_id) || null;
      data.readiness = { profile_complete: missing.length === 0, resume_ready: Boolean(data.resume), missing_profile_fields: missing };
      return data;
    };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.addInitScript(snapshot => {
      class FixtureEventSource extends EventTarget {
        constructor() { super(); this.first = setTimeout(() => this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(snapshot) })), 0); }
        close() { clearTimeout(this.first); }
      }
      window.EventSource = FixtureEventSource;
    }, idle);
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
      if (path === '/api/session') return route.fulfill(state.authenticated
        ? { json: { mode: 'accounts', legacy_access: state.legacy, user: state.user } }
        : { status: 401, json: { error: 'Sign in first.' } });
      if (path === '/api/v1/onboarding') {
        if (method === 'GET') return route.fulfill({ json: state.snapshot() });
        if (method === 'PUT') {
          const body = request.postDataJSON(); state.saves.push(body);
          if (state.setupConflict || body.expected_version !== state.setup.version) return route.fulfill({ status: 409, json: { detail: 'Setup changed. Reload its current version before saving.' } });
          Object.assign(state.setup, { version: state.setup.version + 1, platforms: body.platforms, account_hints: body.account_hints,
            resume_artifact_id: body.resume_artifact_id, completed_at: body.completed ? '2026-10-24T10:00:00Z' : null });
          return route.fulfill({ json: state.snapshot() });
        }
      }
      if (path === '/api/v1/profile' && method === 'PUT') {
        const body = request.postDataJSON(); state.profiles.push(body);
        if (state.profileConflict || body.expected_version !== state.setup.profile.version) return route.fulfill({ status: 409, json: { detail: 'Profile changed. Reload its current version before saving.' } });
        state.setup.profile = { version: state.setup.profile.version + 1, data: body.data, updated_at: '2026-10-24T10:00:00Z' };
        return route.fulfill({ json: state.setup.profile });
      }
      if (path === '/api/v1/artifacts') {
        if (method === 'GET') return route.fulfill({ json: { items: state.artifacts, limit: 100, offset: 0 } });
        if (method === 'POST') {
          state.uploads.push({ filename: url.searchParams.get('filename'), category: url.searchParams.get('category'), body: request.postDataBuffer().toString() });
          const artifact = { ...savedResume, id: '00000000-0000-4000-8000-000000000004', filename: url.searchParams.get('filename') };
          state.artifacts.unshift(artifact); return route.fulfill({ status: 201, json: artifact });
        }
      }
      if (path === '/api/connections' && method === 'GET') {
        const scope = url.searchParams.get('scope') || 'main'; state.reads.push(scope);
        if (state.holdConnections) { state.holdConnections = false; state.heldConnection = { route, data: structuredClone(state.connections[scope]) }; return; }
        if (state.connectionFailure) return route.fulfill({ status: 503, json: { error: 'Synthetic connection service is unavailable.' } });
        return route.fulfill({ json: state.connections[scope] });
      }
      if (path.startsWith('/api/connections/') && method === 'POST') {
        const [, , , id, operation] = path.split('/'), body = request.postDataJSON(); state.actions.push({ id, operation, body });
        const response = state.connections[body.scope || 'main'], row = response.connections.find(row => row.id === id);
        if (state.holdAction) { state.holdAction = false; state.heldAction = { route, data: structuredClone(response) }; return; }
        row.expected_account = body.expected_account; row.account_configured = true;
        if (operation === 'open' || operation === 'switch') Object.assign(row, { browser_open: true, can_close: true, state: 'needs_sign_in', message: 'Complete the sign-in in the automation browser.' });
        if (operation === 'check') Object.assign(row, { state: 'connected', message: 'Signed-in account checked.', verified_account: body.expected_account, last_verified_at: '2026-10-24T10:00:00Z' });
        if (operation === 'close') Object.assign(row, { browser_open: false, can_close: false, message: 'Browser closed. Saved sign-in can be reused.' });
        if (operation === 'disconnect') Object.assign(row, { state: 'not_connected', browser_open: false, can_close: false, last_verified_at: null, verified_account: '' });
        return route.fulfill({ json: response });
      }
      if (path === '/api/runner/setup' && method === 'POST') {
        state.syncs.push(request.postDataJSON());
        if (state.syncFailure) return route.fulfill({ status: 409, json: { error: 'Wait for the current workflow before preparing the local runner.' } });
        return route.fulfill({ json: { saved: true, automation_available: state.legacy } });
      }
      const replies = {
        '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
        '/api/status': { name: 'Alice Example', greeting: 'Hello', date: '2026-10-24', date_long: '24 October 2026', run: idle,
          questions: [], facts: [], sites: [], study: { today: 1, read: 0, total: 0 }, report: { ready: false, days: [] } },
        '/api/course': { today: 1, read: 0, total: 0, lessons: [], modules: [] }, '/api/run': idle,
        '/api/v1/auth/options': { provider: 'local', google: false, email: true },
      };
      if (method === 'GET' && Object.hasOwn(replies, path)) return route.fulfill({ json: replies[path] });
      state.unexpected.push(`${method} ${path}`);
      return route.fulfill({ status: 409, json: { error: 'Fixture guard: no real action is allowed.' } });
    });
    state.open = async (route = 'onboarding') => { await page.goto('/#/' + route); await expect(page.locator('.' + (route === 'connections' ? 'connections-page' : 'onboarding-page'))).toBeVisible(); };
    state.releaseConnection = async () => { const held = state.heldConnection; state.heldConnection = null; await held.route.fulfill({ json: held.data }).catch(() => {}); };
    state.releaseAction = async () => { const held = state.heldAction; state.heldAction = null; await held.route.fulfill({ json: held.data }).catch(() => {}); };
    await use(state);
    expect(state.unexpected, 'All API calls remain inside synthetic fixtures.').toEqual([]);
    expect(state.errors, 'The page must not throw.').toEqual([]);
  },
});

test.beforeAll(async ({ baseURL }) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname);
  await mkdir('artifacts/onboarding', { recursive: true });
});

const card = (page, id = 'naukri') => page.locator(`.connection-card[data-provider="${id}"]`);
const step = (page, title) => page.getByRole('navigation', { name: 'Setup steps' }).getByRole('button', { name: new RegExp(title) });

test('a signed-in first-time account arriving at login opens its saved setup', async ({ page, fixture }) => {
  await page.goto('/#/login');
  await expect(page).toHaveURL(/#\/onboarding$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Make your crew ready.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Contact email *', exact: true })).toHaveValue('alice@example.com');
  expect(fixture.actions).toEqual([]);
});

test('profile saves preserve unedited facts and reloading resumes the saved draft', async ({ page, fixture }) => {
  await fixture.open();
  await page.getByRole('textbox', { name: 'Full name *', exact: true }).fill('Alice Updated');
  await page.getByRole('textbox', { name: 'Target roles *', exact: true }).fill('Platform engineer, Backend engineer');
  await page.getByRole('button', { name: 'Save profile & continue' }).click();
  await expect(page.getByRole('heading', { name: '02 · Add your resume' })).toBeVisible();
  expect(fixture.profiles[0].data).toMatchObject({ full_name: 'Alice Updated', titles: ['Platform engineer', 'Backend engineer'],
    extra_facts: profile.extra_facts, custom_preserved: profile.custom_preserved });
  expect(fixture.profiles[0].expected_version).toBe(1);
  expect(fixture.saves.at(-1).completed).toBe(false);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Full name *', exact: true })).toHaveValue('Alice Updated');
});

test('a profile version conflict retains edits and does not advance or overwrite setup', async ({ page, fixture }) => {
  fixture.profileConflict = true;
  await fixture.open();
  const input = page.getByRole('textbox', { name: 'Full name *', exact: true });
  await input.fill('Unsaved local name');
  await page.getByRole('button', { name: 'Save profile & continue' }).click();
  await expect(page.locator('.onboarding-feedback')).toContainText('Your edits remain here.');
  await expect(input).toHaveValue('Unsaved local name');
  await expect(input).toBeEnabled();
  expect(fixture.saves).toEqual([]);
  expect(fixture.setup.profile.data.full_name).toBe(profile.full_name);
});

test('resume upload validates the PDF, keeps existing files and saves the selected private artifact', async ({ page, fixture }) => {
  await fixture.open();
  await step(page, 'Your resume').click();
  const upload = page.getByLabel('Upload or replace resume');
  await upload.setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid') });
  await expect(page.locator('.onboarding-feedback')).toContainText('This file is not a PDF.');
  expect(fixture.uploads).toEqual([]);
  await upload.setInputFiles({ name: 'alice-new.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nsynthetic fixture') });
  await expect(page.getByRole('heading', { name: 'alice-new.pdf' })).toBeVisible();
  expect(fixture.uploads).toEqual([{ filename: 'alice-new.pdf', category: 'resumes', body: '%PDF-1.7\nsynthetic fixture' }]);
  await expect(page.getByRole('combobox', { name: 'Use a saved resume' }).locator('option')).toHaveCount(3);
  expect(fixture.setup.resume_artifact_id).toBe('00000000-0000-4000-8000-000000000004');
  await page.getByRole('combobox', { name: 'Use a saved resume' }).selectOption(savedResume.id);
  await page.getByRole('button', { name: 'Save resume & continue' }).click();
  await expect(page.getByRole('heading', { name: '03 · Connect the accounts you use' })).toBeVisible();
  expect(fixture.setup.resume_artifact_id).toBe(savedResume.id);
});

test('selected providers and account hints save while finishing setup never fabricates a verified browser', async ({ page, fixture }) => {
  fixture.setup.resume_artifact_id = savedResume.id;
  await fixture.open();
  await step(page, 'Connect accounts').click();
  await page.getByRole('checkbox', { name: 'Naukri', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Google / Gmail', exact: true }).check();
  await card(page).getByRole('textbox', { name: 'Naukri account email' }).fill('jobs@example.com');
  await card(page, 'google').getByRole('textbox', { name: 'Google / Gmail account email' }).fill('mail@example.com');
  await page.getByRole('button', { name: 'Save connections & review' }).click();
  await expect(page.locator('.onboarding-runtime-review')).toContainText('0 of 2 sign-ins checked');
  await expect(page.locator('.onboarding-runtime-review')).toContainText('Workflow execution for this account is not connected');
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your setup is saved.', exact: true })).toBeVisible();
  expect(fixture.saves.at(-1)).toMatchObject({ platforms: ['naukri', 'google'],
    account_hints: { naukri: 'jobs@example.com', google: 'mail@example.com' }, completed: true });
  expect(fixture.actions).toEqual([]);
  await expect(page.getByRole('link', { name: 'Open workspace', exact: true })).toHaveAttribute('href', '#/overview');
  await expect(page.getByRole('link', { name: 'Open Flows', exact: true })).toHaveCount(0);
});

test('Connections opens, checks and closes the selected automation-browser account', async ({ page, fixture }) => {
  await fixture.open('connections');
  await card(page).getByRole('textbox', { name: 'Naukri account email' }).fill('jobs@example.com');
  await card(page).getByRole('button', { name: 'Open sign-in: Naukri', exact: true }).click();
  await expect(card(page).getByRole('button', { name: 'Check sign-in: Naukri', exact: true })).toBeEnabled();
  await card(page).getByRole('button', { name: 'Check sign-in: Naukri', exact: true }).click();
  await expect(card(page).locator('.connection-state')).toHaveText('Sign-in checked');
  await card(page).getByRole('button', { name: 'Close browser: Naukri', exact: true }).click();
  await expect(card(page).getByRole('button', { name: 'Open sign-in: Naukri', exact: true })).toBeEnabled();
  expect(fixture.actions).toEqual(['open', 'check', 'close'].map(operation => ({ id: 'naukri', operation,
    body: { scope: 'main', expected_account: 'jobs@example.com' } })));
});

test('a failed local setup transfer keeps onboarding unfinished and preserves saved preferences', async ({ page, fixture }) => {
  fixture.setup.resume_artifact_id = savedResume.id;
  fixture.setup.platforms = ['naukri'];
  fixture.syncFailure = true;
  await fixture.open();
  await step(page, 'Review setup').click();
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
  await expect(page.locator('.onboarding-feedback')).toContainText('Wait for the current workflow');
  expect(fixture.syncs).toHaveLength(1);
  expect(fixture.setup.completed_at).toBeNull();
  expect(fixture.saves.every(save => save.completed === false)).toBe(true);
  expect(fixture.setup.resume_artifact_id).toBe(savedResume.id);
  expect(fixture.setup.platforms).toEqual(['naukri']);
  await expect(page.getByRole('heading', { name: '04 · Review your setup' })).toBeVisible();
});

test('changing an account requires confirmation and cancel sends no destructive request', async ({ page, fixture }) => {
  fixture.setup.account_hints = { naukri: 'previous@example.com' };
  await fixture.open('connections');
  await card(page).getByRole('button', { name: 'Change account: Naukri', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Change Naukri account?', exact: true });
  await expect(dialog).toContainText('This clears Naukri sign-in data');
  expect(fixture.actions).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(fixture.actions).toEqual([]);
  await card(page).getByRole('textbox', { name: 'Naukri account email' }).fill('replacement@example.com');
  await card(page).getByRole('button', { name: 'Change account: Naukri', exact: true }).click();
  await dialog.getByRole('button', { name: 'Change account', exact: true }).click();
  await expect.poll(() => fixture.actions.length).toBe(1);
  expect(fixture.actions[0]).toEqual({ id: 'naukri', operation: 'switch', body: { scope: 'main', expected_account: 'replacement@example.com' } });
  await expect(card(page).getByRole('button', { name: 'Check sign-in: Naukri', exact: true })).toBeEnabled();
  await page.reload();
  await expect(card(page).getByRole('textbox', { name: 'Naukri account email' })).toHaveValue('replacement@example.com');
  await card(page).getByRole('textbox', { name: 'Naukri account email' }).fill('');
  await card(page).getByRole('button', { name: 'Check sign-in: Naukri', exact: true }).click();
  await expect(card(page).locator('.connection-state')).toHaveText('Sign-in checked');
  await page.reload();
  await expect(card(page).getByRole('textbox', { name: 'Naukri account email' })).toHaveValue('');
  expect(fixture.connections.main.connections[0].account_configured).toBe(true);
});

test('polling updates connection status without replacing a focused account email draft', async ({ page, fixture }) => {
  await fixture.open('connections');
  const input = card(page).getByRole('textbox', { name: 'Naukri account email' });
  await input.fill('unfinished@example.com');
  await input.evaluate(element => { window.__onboardingInput = element; });
  const reads = fixture.reads.length;
  fixture.connections.main.connections[0].message = 'Updated connection status from the fixture.';
  await expect.poll(() => fixture.reads.length, { timeout: 9000 }).toBeGreaterThan(reads);
  await expect(card(page)).toContainText('Updated connection status from the fixture.');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('unfinished@example.com');
  expect(await input.evaluate(element => element === window.__onboardingInput)).toBe(true);
});

test('connection refresh failures retain cards and clear after a successful retry', async ({ page, fixture }) => {
  await fixture.open('connections');
  await expect(card(page)).toBeVisible();
  fixture.connectionFailure = true;
  await page.getByRole('button', { name: 'Check connection status', exact: true }).click();
  await expect(page.locator('.connection-feedback')).toContainText('Synthetic connection service is unavailable.');
  await expect(card(page)).toBeVisible();
  await expect(page.locator('.connection-freshness')).toContainText('The last connection status is still shown.');
  fixture.connectionFailure = false;
  await page.locator('.connection-feedback').getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.connection-feedback')).toHaveText('');
  await expect(page.locator('.connection-freshness')).toContainText('Status updates every 5 seconds.');
});

test('late old-scope status cannot replace a newly selected browser group', async ({ page, fixture }) => {
  await fixture.open('connections');
  await expect(card(page)).toBeVisible();
  fixture.holdConnections = true;
  await page.getByRole('button', { name: 'Check connection status', exact: true }).click();
  await expect.poll(() => Boolean(fixture.heldConnection)).toBe(true);
  await page.getByRole('combobox', { name: 'Automation browser group' }).selectOption('lane:hirist');
  await fixture.releaseConnection();
  await expect(card(page)).toContainText('This is a separate parallel lane session.');
  await expect(page.getByRole('combobox', { name: 'Automation browser group' })).toHaveValue('lane:hirist');
});

test('leaving Connections dismisses confirmation and ignores a late browser-action response', async ({ page, fixture }) => {
  await fixture.open('connections');
  await card(page).getByRole('button', { name: 'Change account: Naukri', exact: true }).click();
  await page.evaluate(() => { location.hash = '#/onboarding'; });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(fixture.actions).toEqual([]);
  await page.evaluate(() => { location.hash = '#/connections'; });
  await expect(card(page)).toBeVisible();
  fixture.holdAction = true;
  await card(page).getByRole('button', { name: 'Open sign-in: Naukri', exact: true }).click();
  await expect.poll(() => Boolean(fixture.heldAction)).toBe(true);
  await page.evaluate(() => { location.hash = '#/onboarding'; });
  await expect(page.locator('.onboarding-page')).toBeVisible();
  await fixture.releaseAction();
  await expect(page.locator('.connections-page')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Full name *', exact: true })).toHaveValue(profile.full_name);
});

test('account expiry cancels a pending action before its response can enter another account', async ({ page, fixture }) => {
  await fixture.open('connections');
  fixture.holdAction = true;
  await card(page).getByRole('button', { name: 'Open sign-in: Naukri', exact: true }).click();
  await expect.poll(() => Boolean(fixture.heldAction)).toBe(true);
  fixture.authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event('account-expired')));
  await expect(page).toHaveURL(/#\/login$/);
  await fixture.releaseAction();
  await expect(page.locator('.connection-card')).toHaveCount(0);
  await expect(page.locator('.connections-page')).toHaveCount(0);
});

test('resume, selected accounts and review steps have no WCAG accessibility violations', async ({ page, fixture }) => {
  fixture.setup.resume_artifact_id = savedResume.id;
  fixture.setup.platforms = ['naukri', 'google'];
  await fixture.open();
  for (const [title, heading, image] of [
    ['Your resume', '02 · Add your resume', 'resume'],
    ['Connect accounts', '03 · Connect the accounts you use', 'connect'],
    ['Review setup', '04 · Review your setup', 'review'],
  ]) {
    await step(page, title).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    if (title === 'Connect accounts') await expect(card(page)).toBeVisible();
    if (title === 'Review setup') await expect(page.locator('.onboarding-runtime-review')).toContainText('0 of 2 sign-ins checked');
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) }))).toEqual([]);
    await page.screenshot({ path: `artifacts/onboarding/${image}-desktop.png`, fullPage: true, animations: 'disabled' });
  }
});

for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 375, 812]]) {
  test(`setup and Connections remain accessible and fit the ${name} viewport`, async ({ page, fixture }) => {
    await page.setViewportSize({ width, height });
    await fixture.open();
    await expect(page.getByRole('textbox', { name: 'Full name *', exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `artifacts/onboarding/setup-${name}.png`, fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    let result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) }))).toEqual([]);
    await page.evaluate(() => { location.hash = '#/connections'; });
    await expect(card(page)).toBeVisible();
    await page.screenshot({ path: `artifacts/onboarding/connections-${name}.png`, fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) }))).toEqual([]);
    expect(fixture.actions).toEqual([]);
  });
}
