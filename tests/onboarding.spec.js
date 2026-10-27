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
const browserGroup = (scope, id) => scope === 'main' ? id === 'linkedin' ? 'linkedin' : 'main' : scope;

function defaultConnections(scope = 'main') {
  return { scope, scopes: [{ id: 'main', label: 'Main browser' }, { id: 'lane:hirist', label: 'Parallel lane · Hirist' }],
    browser_available: true, automation_available: false,
    runtime: { available: true, chrome_available: true, pdftotext_available: true, automation_available: false, active_browsers: 0, max_browsers: 3, location: 'This computer' },
    connections: providers.filter(([id]) => scope === 'main' || ['google', scope.split(':')[1]].includes(id)).map(([id, label]) => ({ id, label, state: 'not_connected', expected_account: '', account_configured: false,
      message: scope === 'main' ? 'Sign in to this account in your automation browser.' : 'This is a separate parallel lane session.',
      fix: 'Complete sign-in, check it, and close the browser before a run.', browser_open: false,
      browser_provider: '', browser_active: false, browser_group: browserGroup(scope, id), pending: false, profile_busy: false,
      can_open: true, can_check: true, can_close: false, session_scope: scope === 'main' ? 'Main browser' : 'Parallel lane · Hirist' })) };
}

// Every API endpoint is intercepted with synthetic fixtures. These tests cannot
// launch Chrome profiles, contact an account provider, or execute a real workflow.
const test = base.extend({
  fixture: async ({ page }, use) => {
    const state = { authenticated: true, user: structuredClone(user), legacy: false,
      setup: { version: 0, platforms: [], account_hints: {}, resume_artifact_id: null, resume: null,
        profile: { version: 1, data: structuredClone(profile), updated_at: '2026-10-24T09:00:00Z' }, completed_at: null },
      artifacts: [structuredClone(savedResume)], artifactReads: [], profiles: [], saves: [], uploads: [], actions: [], reads: [], syncs: [],
      connections: { main: defaultConnections(), 'lane:hirist': defaultConnections('lane:hirist') },
      unexpected: [], errors: [], profileConflict: false, profileError: null, setupConflict: false, connectionFailure: false, syncFailure: false,
      uploadFailure: false, actionFailure: false, holdProfile: false, heldProfile: null,
      holdConnections: false, heldConnection: null, holdAction: false, heldAction: null };
    state.targetBrowser = (scope, id, opened = true) => {
      for (const row of state.connections[scope].connections) if (browserGroup(scope, row.id) === browserGroup(scope, id)) {
        Object.assign(row, { browser_open: opened, browser_provider: opened ? id : '', browser_active: opened && row.id === id, can_close: opened });
      }
    };
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
        if (state.profileError) return route.fulfill({ status: 422, json: { detail: state.profileError } });
        if (state.holdProfile) { state.holdProfile = false; state.heldProfile = { route, body }; return; }
        state.setup.profile = { version: state.setup.profile.version + 1, data: body.data, updated_at: '2026-10-24T10:00:00Z' };
        return route.fulfill({ json: state.setup.profile });
      }
      if (path === '/api/v1/artifacts') {
        if (method === 'GET') {
          const limit = Number(url.searchParams.get('limit') || 100), offset = Number(url.searchParams.get('offset') || 0);
          state.artifactReads.push({ limit, offset });
          return route.fulfill({ json: { items: state.artifacts.slice(offset, offset + limit), limit, offset } });
        }
        if (method === 'POST') {
          state.uploads.push({ filename: url.searchParams.get('filename'), category: url.searchParams.get('category'), body: request.postDataBuffer().toString() });
          if (state.uploadFailure) return route.fulfill({ status: 503, json: { detail: 'Resume storage is temporarily unavailable. Try uploading again.' } });
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
        if (state.actionFailure) return route.fulfill({ status: 503, json: { error: 'This browser connection could not open. Try again.' } });
        const response = state.connections[body.scope || 'main'], row = response.connections.find(row => row.id === id);
        if (state.holdAction) { state.holdAction = false; state.heldAction = { route, data: structuredClone(response) }; return; }
        if (Object.hasOwn(body, 'expected_account')) row.expected_account = body.expected_account;
        row.account_configured = true;
        if (['open', 'switch', 'check'].includes(operation)) state.targetBrowser(body.scope || 'main', id);
        if (operation === 'switch' || (operation === 'open' && row.state !== 'connected')) Object.assign(row, { state: 'needs_sign_in', message: 'Complete the sign-in in the automation browser.' });
        if (operation === 'check') Object.assign(row, { state: 'connected', message: 'Signed-in account checked.', verified_account: body.expected_account, last_verified_at: '2026-10-24T10:00:00Z' });
        if (operation === 'close') { state.targetBrowser(body.scope || 'main', id, false); row.message = 'Browser closed. Saved sign-in can be reused.'; }
        if (operation === 'disconnect') { state.targetBrowser(body.scope || 'main', id, false); Object.assign(row, { state: 'not_connected', last_verified_at: null, verified_account: '' }); }
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
    state.releaseProfile = async () => {
      const held = state.heldProfile; state.heldProfile = null;
      state.setup.profile = { version: state.setup.profile.version + 1, data: held.body.data, updated_at: '2026-10-24T10:00:00Z' };
      await held.route.fulfill({ json: state.setup.profile }).catch(() => {});
    };
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
const fieldFor = input => input.locator('..');

for (const width of [375, 768, 1440]) {
  test(`profile validation stays readable and fits at ${width}px`, async ({ page, fixture }) => {
    fixture.setup.profile.data = {};
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 1000 });
    await fixture.open();
    const email = page.getByRole('textbox', { name: 'Contact email *', exact: true });
    await email.fill('incomplete@');
    await page.getByRole('button', { name: 'Save profile & continue' }).click();
    const name = page.getByRole('textbox', { name: 'Full name *', exact: true });
    await expect(name).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(fieldFor(email).locator('.field-error')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.locator('main').evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/onboarding/validation-${width}.png`, fullPage: true, animations: 'disabled' });
    await email.fill('corrected@example.com');
    await expect(email).toHaveAttribute('aria-invalid', 'false');
    await expect(fieldFor(email).locator('.field-error')).toBeHidden();
    expect(fixture.profiles).toEqual([]);
    expect(fixture.saves).toEqual([]);
  });
}

test('existing profile, selected resume and completed setup are clearly identified without saving again', async ({ page, fixture }) => {
  fixture.setup.version = 3;
  fixture.setup.resume_artifact_id = savedResume.id;
  fixture.setup.platforms = ['naukri'];
  fixture.setup.completed_at = '2026-10-24T10:00:00Z';
  await fixture.open();
  await expect(page.locator('.onboarding-saved-summary')).toContainText(/saved|complete/i);
  await expect(step(page, 'Your profile').locator('.onboarding-step-status')).toContainText(/saved/i);
  await expect(step(page, 'Your resume').locator('.onboarding-step-status')).toContainText(/saved/i);
  const name = page.getByRole('textbox', { name: 'Full name *', exact: true });
  await expect(name).toHaveValue(profile.full_name);
  await expect(fieldFor(name).locator('.onboarding-field-state')).toHaveText('Saved');
  await step(page, 'Your resume').click();
  await expect(page.locator('.onboarding-resume')).toContainText(savedResume.filename);
  await expect(page.locator('.onboarding-resume')).toContainText(/saved|selected/i);
  expect(fixture.profiles).toEqual([]);
  expect(fixture.saves).toEqual([]);
  expect(fixture.uploads).toEqual([]);
  expect(fixture.actions).toEqual([]);
});

test('a stored resume is offered without pretending it is selected or requiring another upload', async ({ page, fixture }) => {
  await fixture.open();
  await expect(page.locator('.onboarding-saved-summary')).toContainText(/resume|PDF/i);
  await expect(step(page, 'Your resume').locator('.onboarding-step-status')).not.toHaveText(/^Saved$/);
  await step(page, 'Your resume').click();
  await expect(page.getByRole('combobox', { name: 'Use a saved resume' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Use a saved resume' }).getByRole('option', { name: savedResume.filename })).toHaveCount(1);
  await expect(page.locator('.onboarding-content')).toContainText(/already|available|saved resume/i);
  expect(fixture.setup.resume_artifact_id).toBeNull();
  expect(fixture.uploads).toEqual([]);
  expect(fixture.saves).toEqual([]);
});

test('profile edits stay marked unsaved until the server confirms them', async ({ page, fixture }) => {
  await fixture.open();
  const input = page.getByRole('textbox', { name: 'Full name *', exact: true });
  await input.fill('Alice Pending');
  await expect(fieldFor(input).locator('.onboarding-field-state')).toHaveText('Unsaved');
  await expect(step(page, 'Your profile').locator('.onboarding-step-status')).toContainText(/unsaved/i);
  fixture.holdProfile = true;
  await page.getByRole('button', { name: 'Save profile & continue' }).click();
  await expect.poll(() => Boolean(fixture.heldProfile)).toBe(true);
  await expect(fieldFor(input).locator('.onboarding-field-state')).not.toHaveText('Saved');
  expect(fixture.setup.profile.data.full_name).toBe(profile.full_name);
  await fixture.releaseProfile();
  await expect(page.getByRole('heading', { name: '02 · Add your resume' })).toBeVisible();
  await step(page, 'Your profile').click();
  await expect(input).toHaveValue('Alice Pending');
  await expect(fieldFor(input).locator('.onboarding-field-state')).toHaveText('Saved');
  await expect(step(page, 'Your profile').locator('.onboarding-step-status')).toContainText(/saved/i);
});

test('older saved resumes can be found and selected without uploading another copy', async ({ page, fixture }) => {
  fixture.artifacts = [...Array.from({ length: 100 }, (_, index) => ({ ...savedResume,
    id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    filename: `report-${index}.txt`, category: 'reports', media_type: 'text/plain' })), structuredClone(savedResume)];
  await fixture.open();
  await step(page, 'Your resume').click();
  await page.getByRole('button', { name: 'Find older saved resumes', exact: true }).click();
  const select = page.getByRole('combobox', { name: 'Use a saved resume' });
  await expect(select.getByRole('option', { name: savedResume.filename })).toHaveCount(1);
  await expect(select).toHaveValue('');
  await select.selectOption(savedResume.id);
  await expect(page.locator('.onboarding-resume')).toContainText(savedResume.filename);
  await page.getByRole('button', { name: 'Save resume & continue' }).click();
  await expect(page.getByRole('heading', { name: '03 · Connect the accounts you use' })).toBeVisible();
  expect(fixture.artifactReads).toContainEqual({ limit: 100, offset: 100 });
  expect(fixture.setup.resume_artifact_id).toBe(savedResume.id);
  expect(fixture.uploads).toEqual([]);
});

test('an account email suggested into an empty profile is not labeled saved', async ({ page, fixture }) => {
  delete fixture.setup.profile.data.email;
  await fixture.open();
  const input = page.getByRole('textbox', { name: 'Contact email *', exact: true });
  await expect(input).toHaveValue(user.email);
  await expect(fieldFor(input).locator('.onboarding-field-state')).toHaveText('Unsaved');
  expect(fixture.profiles).toEqual([]);
  expect(fixture.setup.profile.data.email).toBeUndefined();
});

for (const [caseName, role, label, value] of [
  ['required name', 'textbox', 'Full name *', ''],
  ['whitespace-only name', 'textbox', 'Full name *', '   '],
  ['malformed email', 'textbox', 'Contact email *', 'alice@'],
  ['empty target roles list', 'textbox', 'Target roles *', ', ,'],
  ['out-of-range experience', 'spinbutton', 'Experience in years', '81'],
  ['fractional notice period', 'spinbutton', 'Notice period in days', '1.5'],
]) {
  test(`${caseName} shows an adjacent error, focuses the field and sends no save`, async ({ page, fixture }) => {
    await fixture.open();
    const input = page.getByRole(role, { name: label, exact: true });
    await input.fill(value);
    await page.getByRole('button', { name: 'Save profile & continue' }).click();
    const error = fieldFor(input).locator('.field-error');
    await expect(error).toBeVisible();
    await expect(error).not.toHaveText('');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toBeFocused();
    const errorId = await error.getAttribute('id');
    expect((await input.getAttribute('aria-describedby')).split(/\s+/)).toContain(errorId);
    expect(fixture.profiles).toEqual([]);
    expect(fixture.saves).toEqual([]);
  });
}

test('correcting an invalid field clears its local error and allows a valid save', async ({ page, fixture }) => {
  await fixture.open();
  const input = page.getByRole('textbox', { name: 'Contact email *', exact: true });
  await input.fill('alice@');
  await page.getByRole('button', { name: 'Save profile & continue' }).click();
  await expect(fieldFor(input).locator('.field-error')).toBeVisible();
  await input.fill('corrected@example.com');
  await expect(fieldFor(input).locator('.field-error')).toBeHidden();
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await page.getByRole('button', { name: 'Save profile & continue' }).click();
  await expect(page.getByRole('heading', { name: '02 · Add your resume' })).toBeVisible();
  expect(fixture.profiles).toHaveLength(1);
  expect(fixture.profiles[0].data.email).toBe('corrected@example.com');
});

test('a server field validation error is attached to its profile input and preserves edits', async ({ page, fixture }) => {
  fixture.profileError = [{ loc: ['body', 'data', 'email'], msg: 'Enter a valid contact email.', type: 'value_error' }];
  await fixture.open();
  const input = page.getByRole('textbox', { name: 'Contact email *', exact: true });
  await input.fill('edited@example.com');
  await page.getByRole('button', { name: 'Save profile & continue' }).click();
  await expect(fieldFor(input).locator('.field-error')).toContainText('Enter a valid contact email.');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('edited@example.com');
  await expect(fieldFor(input).locator('.onboarding-field-state')).toHaveText('Unsaved');
  await page.getByRole('textbox', { name: 'Full name *', exact: true }).focus();
  await expect(fieldFor(input).locator('.field-error')).toContainText('Enter a valid contact email.');
  await page.getByRole('button', { name: 'Save profile & continue' }).click();
  await expect(input).toBeFocused();
  expect(fixture.profiles).toHaveLength(1);
  await input.fill('fixed@example.com');
  await expect(fieldFor(input).locator('.field-error')).toBeHidden();
  expect(fixture.saves).toEqual([]);
});

test('a failed replacement upload keeps the selected saved resume and shows its error beside the uploader', async ({ page, fixture }) => {
  fixture.setup.resume_artifact_id = savedResume.id;
  fixture.uploadFailure = true;
  await fixture.open();
  await step(page, 'Your resume').click();
  const upload = page.getByLabel('Upload or replace resume');
  await upload.setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nreplacement fixture') });
  await expect(fieldFor(upload).locator('.field-error')).toContainText('Resume storage is temporarily unavailable.');
  await expect(upload).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.onboarding-resume')).toContainText(savedResume.filename);
  await expect(page.getByRole('combobox', { name: 'Use a saved resume' })).toHaveValue(savedResume.id);
  expect(fixture.setup.resume_artifact_id).toBe(savedResume.id);
  expect(fixture.saves).toEqual([]);
});

test('changing the saved resume selection updates its card immediately but stays unsaved until confirmed', async ({ page, fixture }) => {
  const replacement = { ...savedResume, id: '00000000-0000-4000-8000-000000000005', filename: 'another-saved-resume.pdf' };
  fixture.artifacts.push(replacement);
  fixture.setup.resume_artifact_id = savedResume.id;
  await fixture.open();
  await step(page, 'Your resume').click();
  await page.getByRole('combobox', { name: 'Use a saved resume' }).selectOption(replacement.id);
  await expect(page.locator('.onboarding-resume')).toContainText(replacement.filename);
  await expect(step(page, 'Your resume').locator('.onboarding-step-status')).toContainText(/unsaved/i);
  expect(fixture.setup.resume_artifact_id).toBe(savedResume.id);
  expect(fixture.saves).toEqual([]);
  await page.getByRole('button', { name: 'Save resume & continue' }).click();
  await expect(page.getByRole('heading', { name: '03 · Connect the accounts you use' })).toBeVisible();
  expect(fixture.setup.resume_artifact_id).toBe(replacement.id);
  await expect(step(page, 'Your resume').locator('.onboarding-step-status')).toContainText(/saved/i);
});

test('selecting no account shows the error beside the choices and focuses the first option', async ({ page, fixture }) => {
  await fixture.open();
  await step(page, 'Connect accounts').click();
  await page.getByRole('button', { name: 'Save connections & review' }).click();
  const first = page.getByRole('checkbox', { name: 'Naukri', exact: true });
  const group = page.locator('fieldset').filter({ has: first });
  await expect(group.locator('.field-error')).toBeVisible();
  await expect(group.locator('.field-error')).toContainText(/select|choose/i);
  await expect(first).toBeFocused();
  expect(fixture.saves).toEqual([]);
  expect(fixture.actions).toEqual([]);
});

test('review cannot finish with an unsaved profile hidden behind another step', async ({ page, fixture }) => {
  fixture.setup.resume_artifact_id = savedResume.id;
  fixture.setup.platforms = ['naukri'];
  await fixture.open();
  await page.getByRole('textbox', { name: 'Full name *', exact: true }).fill('Unsaved profile draft');
  await step(page, 'Review setup').click();
  await expect(page.locator('.onboarding-checks')).toContainText(/unsaved/i);
  const finish = page.getByRole('button', { name: 'Finish setup', exact: true });
  if (await finish.isEnabled()) await finish.click();
  expect(fixture.profiles).toEqual([]);
  expect(fixture.saves).toEqual([]);
  expect(fixture.syncs).toEqual([]);
  await step(page, 'Your profile').click();
  await expect(page.getByRole('textbox', { name: 'Full name *', exact: true })).toHaveValue('Unsaved profile draft');
});

test('invalid connection email is explained on its card before any browser action', async ({ page, fixture }) => {
  await fixture.open('connections');
  const input = card(page).getByRole('textbox', { name: 'Naukri account email' });
  await input.fill('invalid@');
  await card(page).getByRole('button', { name: 'Open sign-in: Naukri', exact: true }).click();
  await expect(fieldFor(input).locator('.field-error')).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toBeFocused();
  expect(fixture.actions).toEqual([]);
  await input.fill('jobs@example.com');
  await expect(fieldFor(input).locator('.field-error')).toBeHidden();
  await card(page).getByRole('button', { name: 'Open sign-in: Naukri', exact: true }).click();
  await expect.poll(() => fixture.actions.length).toBe(1);
});

test('a browser action failure stays on its provider card through refresh and clears after retry', async ({ page, fixture }) => {
  fixture.actionFailure = true;
  await fixture.open('connections');
  const input = card(page).getByRole('textbox', { name: 'Naukri account email' });
  await input.fill('jobs@example.com');
  await card(page).getByRole('button', { name: 'Open sign-in: Naukri', exact: true }).click();
  await expect(card(page).locator('.connection-action-error')).toContainText('This browser connection could not open.');
  await expect(page.locator('.connection-feedback')).not.toContainText('This browser connection could not open.');
  await page.getByRole('button', { name: 'Check connection status', exact: true }).click();
  await expect(card(page).locator('.connection-action-error')).toContainText('This browser connection could not open.');
  await expect(input).toHaveValue('jobs@example.com');
  await expect(card(page, 'linkedin')).not.toContainText('This browser connection could not open.');
  fixture.actionFailure = false;
  await card(page).getByRole('button', { name: 'Open sign-in: Naukri', exact: true }).click();
  await expect(card(page).locator('.connection-action-error')).toBeHidden();
  await expect(card(page).getByRole('button', { name: 'Check sign-in: Naukri', exact: true })).toBeEnabled();
});

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
  await expect(upload.locator('..').locator('.field-error')).toContainText('This file is not a PDF.');
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

test('opening one shared browser changes controls only for its targeted provider and preserves other account statuses', async ({ page, fixture }) => {
  for (const id of ['naukri', 'google']) Object.assign(fixture.connections.main.connections.find(row => row.id === id), {
    account_configured: true, state: 'connected', expected_account: `${id}@example.com`, verified_account: `${id}@example.com`, last_verified_at: '2026-10-24T09:00:00Z',
  });
  await fixture.open('connections');
  await card(page, 'hirist').getByRole('button', { name: 'Open sign-in: Hirist', exact: true }).click();
  await expect(card(page, 'hirist').getByRole('button', { name: 'Check sign-in: Hirist', exact: true })).toBeEnabled();
  await expect(card(page, 'hirist').getByRole('button', { name: 'Close browser: Hirist', exact: true })).toBeEnabled();
  for (const [id, label] of providers.filter(([id]) => !['hirist', 'linkedin'].includes(id))) {
    await expect(card(page, id).getByRole('button', { name: `Open sign-in: ${label}`, exact: true })).toBeEnabled();
    await expect(card(page, id).getByRole('button', { name: `Close browser: ${label}`, exact: true })).toHaveCount(0);
    await expect(card(page, id).locator('.connection-browser-note')).toContainText(`Main browser is open for Hirist. Open ${label} in that same window`);
  }
  await expect(card(page).locator('.connection-state')).toHaveText('Sign-in checked');
  await expect(card(page, 'google').locator('.connection-state')).toHaveText('Sign-in checked');
  await expect(card(page, 'instahyre').locator('.connection-state')).toHaveText('Not connected');
  await expect(card(page, 'linkedin').locator('.connection-browser-note')).toBeHidden();
  expect(fixture.connections.main.connections.filter(row => row.id !== 'linkedin').every(row => row.browser_open)).toBe(true);
  await page.screenshot({ path: 'artifacts/onboarding/shared-browser-controls-desktop.png', fullPage: true, animations: 'disabled' });

  await card(page).getByRole('button', { name: 'Open sign-in: Naukri', exact: true }).click();
  await expect(card(page).getByRole('button', { name: 'Check sign-in: Naukri', exact: true })).toBeEnabled();
  await expect(card(page).locator('.connection-state')).toHaveText('Sign-in checked');
  await expect(card(page, 'hirist').getByRole('button', { name: 'Open sign-in: Hirist', exact: true })).toBeEnabled();
  await expect(card(page, 'hirist').getByRole('button', { name: 'Close browser: Hirist', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Check sign-in: / })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Close browser: / })).toHaveCount(1);
  expect(fixture.actions).toEqual([
    { id: 'hirist', operation: 'open', body: { scope: 'main', expected_account: '' } },
    { id: 'naukri', operation: 'open', body: { scope: 'main', expected_account: 'naukri@example.com' } },
  ]);
});

test('LinkedIn and parallel lane targets keep independent controls for their own browser groups', async ({ page, fixture }) => {
  fixture.targetBrowser('main', 'hirist'); fixture.targetBrowser('main', 'linkedin');
  await fixture.open('connections');
  await expect(card(page, 'hirist').getByRole('button', { name: 'Check sign-in: Hirist', exact: true })).toBeEnabled();
  await expect(card(page, 'linkedin').getByRole('button', { name: 'Check sign-in: LinkedIn', exact: true })).toBeEnabled();
  await card(page, 'linkedin').getByRole('button', { name: 'Close browser: LinkedIn', exact: true }).click();
  await expect(card(page, 'linkedin').getByRole('button', { name: 'Open sign-in: LinkedIn', exact: true })).toBeEnabled();
  await expect(card(page, 'hirist').getByRole('button', { name: 'Check sign-in: Hirist', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Automation browser group' }).selectOption('lane:hirist');
  await card(page, 'google').getByRole('button', { name: 'Open sign-in: Google / Gmail', exact: true }).click();
  await expect(card(page, 'google').getByRole('button', { name: 'Check sign-in: Google / Gmail', exact: true })).toBeEnabled();
  await expect(card(page, 'hirist').getByRole('button', { name: 'Open sign-in: Hirist', exact: true })).toBeEnabled();
  await expect(card(page, 'hirist').locator('.connection-browser-note')).toContainText('Parallel lane · Hirist is open for Google / Gmail');
  expect(fixture.actions.at(-1)).toEqual({ id: 'google', operation: 'open', body: { scope: 'lane:hirist', expected_account: '' } });
  expect(fixture.connections.main.connections.find(row => row.id === 'hirist').browser_active).toBe(true);
});

test('a pending shared browser disables every provider in that group without changing unrelated controls', async ({ page, fixture }) => {
  fixture.targetBrowser('main', 'hirist');
  for (const row of fixture.connections.main.connections) if (row.id !== 'linkedin') row.pending = true;
  await fixture.open('connections');
  await expect(card(page, 'hirist').getByRole('button', { name: 'Check sign-in: Hirist', exact: true })).toBeDisabled();
  await expect(card(page).getByRole('button', { name: 'Open sign-in: Naukri', exact: true })).toBeDisabled();
  await expect(card(page, 'google').getByRole('textbox', { name: 'Google / Gmail account email' })).toBeDisabled();
  await expect(card(page, 'linkedin').getByRole('button', { name: 'Open sign-in: LinkedIn', exact: true })).toBeEnabled();
  expect(fixture.actions).toEqual([]);
});

test('older connection responses never turn every account in a shared window into an active provider', async ({ page, fixture }) => {
  for (const row of fixture.connections.main.connections) {
    delete row.browser_active; delete row.browser_provider;
    if (row.id !== 'linkedin') Object.assign(row, { browser_open: true, can_close: true, account_configured: true, state: 'connected' });
  }
  await fixture.open('connections');
  await expect(page.getByRole('button', { name: /^Check sign-in: / })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Close browser: / })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Open sign-in: / })).toHaveCount(6);
  expect(fixture.actions).toEqual([]);
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
  await expect(card(page, 'hirist')).toContainText('This is a separate parallel lane session.');
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
