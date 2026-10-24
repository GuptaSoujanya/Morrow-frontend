import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const DAY = '2026-10-22';
const OLDER = '2026-10-21';
const EMPTY_DAY = '2026-10-20';
const idle = { epoch: 'flows-fixture', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const signIn = {
  kind: 'sign_in', title: "Restore the site's sign-in",
  explanation: 'The recorded error points to an expired or missing session for the site used by this step.',
  steps: ["Open the bot's browser and sign in to the affected site.", 'Complete any verification there, then retry this step using the same browser session.'],
  action: { label: 'Open Bot Crew', href: '#/bots' },
};
const interrupted = {
  kind: 'interrupted', title: 'This step did not finish',
  explanation: 'The checkpoint still says running, but no active process could be confirmed. The run may have been stopped or the app restarted.',
  steps: ["Check Activity and the bot's browser for any unfinished work.", 'Confirm no separate copy is still running, then resume this step.'],
};
const quiet = {
  kind: 'no_recent_update', title: 'No recent update',
  explanation: 'The process is still active, but this step has not saved a recent checkpoint. This alone does not mean it is stuck.',
  steps: ['Check the current output in Activity and any open bot browser.', 'If it is waiting for you, complete that action. Retry only after the current run has stopped.'],
};
const resumeOptions = (day, groups) => ({ command: 'continue', date: day, groups, dry_run: false, cli: 'kiro', agents: 2, bots: 1, containers: false });
const recovery = (day, groups, active = false) => ({ available: groups.length > 0 && !active,
  reason: active ? 'Wait for the active run to finish or stop it in Activity before resuming.' : groups.length ? '' : 'All recorded steps are complete.',
  settings_source: 'saved', options: groups.length && !active ? resumeOptions(day, groups) : null });

function checkpoint(day = DAY) {
  const error = { message: 'Naukri session expired. Sign in again before retrying.', at: `${day}T09:13:00`, exit_code: 2 };
  const stages = [
    { name: 'learn', status: 'done', state: 'done', attempts: 1, at: `${day}T09:00:00`, finished_at: `${day}T09:00:00`, retry: recovery(day, []), last_error: null, attention: null },
    { name: 'profile:naukri', status: 'failed', state: 'failed', attempts: 2, at: `${day}T09:13:00`, finished_at: `${day}T09:13:00`, retry: recovery(day, ['profile:naukri']), last_error: error, attention: signIn },
    { name: 'brief:goal', status: 'pending', state: 'pending', attempts: 0, retry: recovery(day, ['brief:goal']), last_error: null, attention: null },
  ];
  return { date: day, status: 'in progress', available_dates: [DAY, OLDER, EMPTY_DAY], watch: [], stages,
    summary: { total: 3, completed: 1, running: 0, pending: 1, remaining: 2, attention: 1, no_recent_update: 0, active: false },
    latest_error: { ...error, stage: 'profile:naukri', attention: signIn }, resume: recovery(day, ['profile:naukri', 'brief:goal']) };
}

function emptyCheckpoint(day) {
  return { date: day, status: 'not started', available_dates: [DAY, OLDER, EMPTY_DAY], watch: [], stages: [], latest_error: null,
    summary: { total: 0, completed: 0, running: 0, pending: 0, remaining: 0, attention: 0, active: false },
    resume: { ...recovery(day, []), reason: 'No workflow is recorded for this day.' } };
}

function shown(request) {
  const options = request.options;
  return ['python -m pipeline', options.command || 'run', '--date', options.date,
    ...(options.groups || (options.group ? [options.group] : [])).flatMap(stage => ['--only', stage]),
    ...(options.cli ? ['--cli', options.cli] : []), ...(options.fresh ? ['--fresh'] : []), ...(options.redo ? ['--redo'] : [])].join(' ');
}

// All API reads and writes are synthetic. No test starts a real workflow,
// inspects user data, signs in, contacts a provider, or changes a checkpoint.
const test = base.extend({
  fixture: async ({ page }, use) => {
    const state = { data: { [DAY]: checkpoint(), [OLDER]: checkpoint(OLDER), [EMPTY_DAY]: emptyCheckpoint(EMPTY_DAY) },
      reads: [], previews: [], runs: [], unexpected: [], errors: [], fail: false, hold: false, held: null, holdPreview: false, heldPreview: null };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.addInitScript(snapshot => {
      class FixtureEventSource extends EventTarget {
        constructor() { super(); this.first = setTimeout(() => this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(snapshot) })), 0); }
        close() { clearTimeout(this.first); }
      }
      window.EventSource = FixtureEventSource;
    }, idle);
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (request.method() === 'POST' && path === '/api/preview') {
        const body = request.postDataJSON(); state.previews.push(body);
        if (state.holdPreview && body.options.command === 'continue') { state.holdPreview = false; state.heldPreview = { route, body }; return; }
        return route.fulfill({ json: { shown: shown(body) } });
      }
      if (request.method() === 'POST' && path === '/api/run') {
        state.runs.push(request.postDataJSON());
        return route.fulfill({ json: { ok: true, id: 'synthetic-flow', run: idle } });
      }
      if (request.method() !== 'GET') {
        state.unexpected.push(`${request.method()} ${path}`);
        return route.fulfill({ status: 409, json: { error: 'Fixture guard: this action cannot execute.' } });
      }
      if (path === '/api/pipeline') {
        const date = url.searchParams.get('date') || DAY;
        state.reads.push(date);
        if (state.hold) { state.hold = false; state.held = { route, data: structuredClone(state.data[date] || emptyCheckpoint(date)) }; return; }
        if (state.fail) return route.fulfill({ status: 503, json: { error: 'The checkpoint is temporarily unavailable.' } });
        return route.fulfill({ json: state.data[date] || emptyCheckpoint(date) });
      }
      const replies = {
        '/api/session': { mode: 'local', legacy_access: true, user: null },
        '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
        '/api/status': { name: 'Synthetic workspace', greeting: 'Hello', date: DAY, date_long: '22 October 2026', run: idle,
          questions: [], facts: [], sites: [], study: { today: 1, read: 0, total: 0 }, report: { ready: false, days: [] } },
        '/api/course': { today: 1, read: 0, total: 0, lessons: [], modules: [] },
        '/api/run': idle,
        '/api/v1/auth/options': { provider: 'local', google: false },
      };
      if (Object.hasOwn(replies, path)) return route.fulfill({ json: replies[path] });
      state.unexpected.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 404, json: { error: 'No fixture is configured for this request.' } });
    });
    state.open = async () => {
      await page.goto(`/#/pipeline?date=${DAY}`);
      await expect(page.getByRole('heading', { name: 'Flows', exact: true })).toBeVisible();
      await expect(page.locator('.flow-status-card')).toBeVisible();
    };
    state.release = async () => { const pending = state.held; state.held = null; await pending.route.fulfill({ json: pending.data }); };
    state.releasePreview = async () => { const pending = state.heldPreview; state.heldPreview = null; await pending.route.fulfill({ json: { shown: shown(pending.body) } }); };
    await use(state);
    expect(state.unexpected, 'Every API call must stay inside the fixture.').toEqual([]);
    expect(state.errors, 'The page must not throw.').toEqual([]);
  },
});

test.beforeAll(async ({ baseURL }) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname);
  await mkdir('artifacts/flows', { recursive: true });
});

test('failed steps explain the last cause and corrective action, then retry only the confirmed stage', async ({ page, fixture }) => {
  await fixture.open();
  const error = page.locator('.flow-latest-error');
  await expect(error).toContainText('Naukri session expired. Sign in again before retrying.');
  await expect(error).toContainText("Open the bot's browser and sign in to the affected site.");
  await expect(error.getByRole('link', { name: 'Open Bot Crew' })).toHaveAttribute('href', '#/bots');
  await error.getByRole('button', { name: 'Retry this stage: Naukri profile', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Retry Naukri profile?', exact: true });
  await expect(dialog).toContainText('This stage restarts from its beginning.');
  await expect(dialog).toContainText(`--date ${DAY} --only profile:naukri`);
  expect(fixture.runs).toEqual([]);
  await dialog.getByRole('button', { name: 'Retry stage', exact: true }).click();
  await expect.poll(() => fixture.runs).toEqual([{ action: 'pipeline', options: resumeOptions(DAY, ['profile:naukri']) }]);
});

test('resume keeps the historical date and unfinished stages while ignoring new-run reset settings', async ({ page, fixture }) => {
  await fixture.open();
  await page.getByText('Advanced settings', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Research agents', exact: true }).fill('7');
  await page.getByRole('checkbox', { name: /Rerun selected completed stages/ }).check();
  await page.getByRole('checkbox', { name: /Reset this date’s checkpoint/ }).check();
  await page.getByRole('button', { name: 'Resume workflow', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Resume this workflow?', exact: true });
  await expect(dialog).toContainText(`Continue the saved workflow for ${DAY}.`);
  await expect(dialog).toContainText('Only unfinished stages will run. Completed stages are skipped.');
  await expect(dialog.locator('pre')).not.toContainText('--fresh');
  await expect(dialog.locator('pre')).not.toContainText('--redo');
  expect(fixture.runs).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(fixture.runs).toEqual([]);
  await page.getByRole('button', { name: 'Resume workflow', exact: true }).click();
  await dialog.getByRole('button', { name: 'Resume workflow', exact: true }).click();
  await expect.poll(() => fixture.runs).toEqual([{ action: 'pipeline', options: resumeOptions(DAY, ['profile:naukri', 'brief:goal']) }]);
});

test('progress is rechecked after confirmation so another active run cannot be resumed twice', async ({ page, fixture }) => {
  await fixture.open();
  await page.getByRole('button', { name: 'Resume workflow', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Resume this workflow?', exact: true });
  await expect(dialog).toBeVisible();
  fixture.data[DAY].summary = { ...fixture.data[DAY].summary, running: 1, active: true };
  fixture.data[DAY].resume = recovery(DAY, ['profile:naukri', 'brief:goal'], true);
  await dialog.getByRole('button', { name: 'Resume workflow', exact: true }).click();
  await expect(page.locator('.flow-feedback').getByRole('alert')).toContainText('Progress changed while you were confirming.');
  await expect(page.getByRole('button', { name: 'Resume workflow', exact: true })).toBeDisabled();
  expect(fixture.runs).toEqual([]);
});

test('an interrupted checkpoint is distinct from a slow process that is still running', async ({ page, fixture }) => {
  const state = fixture.data[DAY], stage = state.stages[1];
  Object.assign(stage, { status: 'running', state: 'interrupted', attention: interrupted, last_error: null });
  state.latest_error = null;
  await fixture.open();
  const row = page.locator('[data-stage="profile:naukri"]');
  await expect(row).toContainText('Interrupted');
  await row.getByText('This step did not finish', { exact: true }).click();
  await expect(row).toContainText('no active process could be confirmed');
  await expect(row.getByRole('button', { name: 'Retry this stage: Naukri profile' })).toBeEnabled();
  Object.assign(stage, { state: 'running', attention: quiet, retry: recovery(DAY, ['profile:naukri'], true) });
  state.summary = { ...state.summary, running: 1, attention: 0, active: true, no_recent_update: 1 };
  state.resume = recovery(DAY, ['profile:naukri', 'brief:goal'], true);
  await page.getByRole('button', { name: 'Refresh progress' }).click();
  await expect(page.locator('.flow-status-card')).toContainText('Your workflow is running.');
  await expect(row).toContainText('This alone does not mean it is stuck.');
  await expect(row.getByRole('button', { name: 'Retry this stage: Naukri profile' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Resume workflow', exact: true })).toBeDisabled();
});

test('the five-second poll updates progress without replacing a focused configuration field', async ({ page, fixture }) => {
  await fixture.open();
  await page.getByText('Advanced settings', { exact: true }).click();
  const input = page.getByRole('spinbutton', { name: 'Research agents', exact: true });
  await input.fill('6');
  await input.evaluate(element => { window.__flowFocusedInput = element; });
  const reads = fixture.reads.length;
  Object.assign(fixture.data[DAY].stages[2], { status: 'done', state: 'done', attempts: 1, retry: recovery(DAY, []) });
  Object.assign(fixture.data[DAY].summary, { completed: 2, pending: 0, remaining: 1 });
  fixture.data[DAY].resume = recovery(DAY, ['profile:naukri']);
  await expect.poll(() => fixture.reads.length, { timeout: 9000 }).toBeGreaterThan(reads);
  await expect(page.locator('[data-flow-detail="brief"] > summary')).toContainText('Complete');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('6');
  expect(await input.evaluate(element => element === window.__flowFocusedInput)).toBe(true);
  expect(fixture.runs).toEqual([]);
});

test('refresh failures preserve the last view and recover without hiding the error', async ({ page, fixture }) => {
  await fixture.open();
  fixture.fail = true;
  await page.getByRole('button', { name: 'Refresh progress' }).click();
  const alert = page.locator('.flow-feedback').getByRole('alert');
  await expect(alert).toContainText('Progress could not refresh. Showing the last saved view.');
  await expect(alert).toContainText('The checkpoint is temporarily unavailable.');
  await expect(page.locator('.flow-latest-error')).toContainText('Naukri session expired.');
  await expect(page.locator('[data-stage="profile:naukri"]')).toBeVisible();
  fixture.fail = false;
  await alert.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.locator('.flow-freshness')).toContainText('updates every 5 seconds');
  expect(fixture.runs).toEqual([]);
});

test('date changes reject late progress and leaving Flows cancels a pending resume preview', async ({ page, fixture }) => {
  await fixture.open();
  fixture.hold = true;
  await page.getByRole('button', { name: 'Refresh progress' }).click();
  await expect.poll(() => Boolean(fixture.held)).toBe(true);
  await page.getByRole('button', { name: OLDER, exact: true }).click();
  await expect(page.locator('.flow-status-card')).toContainText(OLDER);
  await fixture.release();
  await expect(page.locator('.flow-status-card')).toContainText(OLDER);
  await expect(page.getByRole('textbox', { name: 'Workflow date', exact: true })).toHaveValue(OLDER);
  await expect(page).toHaveURL(new RegExp(`date=${OLDER}$`));
  const input = page.getByRole('textbox', { name: 'Workflow date', exact: true });
  const reads = fixture.reads.length;
  await input.fill('2026-10-');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(fixture.reads.length).toBe(reads);
  await input.fill(EMPTY_DAY);
  await input.press('Enter');
  await expect(page.locator('.flow-status-card')).toContainText('Ready when you are.');
  await expect(page.getByRole('button', { name: 'Resume workflow', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: DAY, exact: true }).click();
  await expect(page.locator('.flow-status-card')).toContainText(DAY);
  fixture.holdPreview = true;
  await page.getByRole('button', { name: 'Resume workflow', exact: true }).click();
  await expect.poll(() => Boolean(fixture.heldPreview)).toBe(true);
  await page.evaluate(() => { location.hash = '#/missing-flow-test'; });
  await expect(page.locator('.not-found-page')).toBeVisible();
  await fixture.releasePreview();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.flows-page')).toHaveCount(0);
  expect(fixture.runs).toEqual([]);
});

test('recovery controls remain accessible and fit desktop, tablet and mobile', async ({ page, fixture }) => {
  await fixture.open();
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
    await page.evaluate(async () => { await document.fonts.ready; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px horizontal overflow`).toBe(true);
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(accessibility.violations.map(issue => ({ id: issue.id, targets: issue.nodes.map(node => node.target) }))).toEqual([]);
    await page.screenshot({ path: `artifacts/flows/recovery-${width}.png`, animations: 'disabled', fullPage: true });
    expect((await page.getByRole('button', { name: 'Resume workflow', exact: true }).boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  expect(fixture.runs).toEqual([]);
});
