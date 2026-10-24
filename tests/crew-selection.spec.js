import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

// Every request is intercepted. These tests must never start a real agent,
// submit an application, publish a post, or connect to an account service.
const botNames = {
  naukri: 'Naukri', hirist: 'Hirist', instahyre: 'Instahyre', cutshort: 'Cutshort',
  wellfound: 'Wellfound', external: 'Company sites', profile: 'Naukri profile',
  linkedin: 'LinkedIn writer', linkedin_profile: 'LinkedIn profile', cold_email: 'Recruiter drafts',
  resume: 'Resume tailor', learn: 'Learning assistant', brief: 'Daily briefing', research: 'Resume researcher',
  hirist_profile: 'Hirist profile', instahyre_profile: 'Instahyre profile',
  cutshort_profile: 'Cutshort profile', wellfound_profile: 'Wellfound profile',
};
const emptyRun = {
  epoch: 'crew-selection-fixture', revision: 0, next: 0, running: false,
  stopping: false, label: '', shown: '', action: '', seconds: 0,
  last: null, active_count: 0, runs: [], lines: [],
};

function command(item) {
  if (item.action === 'pipeline') return `python -m pipeline run --only ${item.options.group}`;
  if (item.action === 'boards') return `python boards_bot.py --site ${item.options.board}`;
  if (item.action === 'linkedin') return `python linkedin_bot.py --mode ${item.options.mode}`;
  return `python ${item.action}_bot.py`;
}

async function workspace(page, { account = false, conflict = '', partial = false, missing = '' } = {}) {
  const state = { plans: [], batches: [], previews: [], individual: [], denied: [], held: null, holdNext: false };
  let session = account ? {
    mode: 'accounts', legacy_access: true,
    user: { id: 'crew-owner', name: 'Crew Owner', email: 'crew@example.test', role: 'admin', plan_name: 'Pro', modules: [] },
  } : { mode: 'local', legacy_access: true, user: null };
  await page.addInitScript(snapshot => {
    window.__crewSources = [];
    class FixtureEventSource extends EventTarget {
      constructor(url) {
        super(); this.url = url; this.closed = false;
        window.__crewSources.push(this);
        this.first = setTimeout(() => this.send(snapshot), 0);
        this.heartbeat = setInterval(() => this.send({ ...snapshot, lines: [] }), 10000);
      }
      send(snapshot) { if (!this.closed) this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(snapshot) })); }
      close() { this.closed = true; clearTimeout(this.first); clearInterval(this.heartbeat); }
    }
    window.EventSource = FixtureEventSource;
  }, emptyRun);
  const plan = request => ({
    ready: !conflict, max_active: 8, active_count: 0,
    items: request.runs.map(item => ({ key: item.key, label: botNames[item.key], shown: command(item), resources: [item.key] })),
    conflicts: conflict ? [{ keys: request.runs.map(item => item.key), message: conflict }] : [],
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'POST' && path === '/api/run/batch/preview') {
      const request = route.request().postDataJSON(); state.plans.push(request);
      if (missing === 'preview') return route.fulfill({ status: 404, json: { error: 'Not found' } });
      if (state.holdNext) { state.holdNext = false; state.held = { route, request }; return; }
      return route.fulfill({ json: plan(request) });
    }
    if (method === 'POST' && path === '/api/run/batch') {
      const request = route.request().postDataJSON(); state.batches.push(request);
      if (missing === 'start') return route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Not found</h1>' });
      return route.fulfill({ json: {
        ok: !partial, run: emptyRun,
        results: request.runs.map((item, index) => partial && index === 1
          ? { key: item.key, label: botNames[item.key], ok: false, error: 'The AI service is temporarily unavailable. Try this agent again.' }
          : { key: item.key, label: botNames[item.key], ok: true, id: `fixture-${item.key}` }),
      } });
    }
    if (method === 'POST' && path === '/api/preview') {
      const request = route.request().postDataJSON(); state.previews.push(request);
      return route.fulfill({ json: { shown: command(request) } });
    }
    if (method === 'POST' && path === '/api/run') {
      const request = route.request().postDataJSON(); state.individual.push(request);
      return route.fulfill({ json: { ok: true, id: 'fixture-individual', label: 'Synthetic agent', run: emptyRun } });
    }
    if (method !== 'GET') {
      state.denied.push(`${method} ${path}`);
      return route.fulfill({ status: 409, json: { error: 'Synthetic test safety guard: no action was executed.' } });
    }
    const replies = {
      '/api/session': session,
      '/api/meta': { files: {}, answer_modes: [{ value: '', label: 'Use configured mode' }], linkedin_modes: [] },
      '/api/status': {
        name: 'Synthetic workspace', greeting: 'Hello', date: '2026-10-24', date_long: '24 October 2026',
        run: emptyRun, questions: [], facts: [], sites: [], study: { today: 1, read: 0, total: 0 }, report: { ready: false, days: [] },
      },
      '/api/course': { today: 1, read: 0, total: 0, lessons: [], modules: [] },
      '/api/bots': { bots: Object.keys(botNames).map(id => ({ id, running: false, status: 'idle', last_run: null })), run: emptyRun },
      '/api/run': emptyRun,
      '/api/run/browsers': { runs: [] },
      '/api/v1/auth/options': { provider: 'local', google: false },
    };
    return Object.hasOwn(replies, path)
      ? route.fulfill({ json: replies[path] })
      : route.fulfill({ status: 404, json: { error: `No synthetic fixture for ${path}` } });
  });
  state.holdPlan = () => { state.holdNext = true; };
  state.releasePlan = async () => {
    const pending = state.held; state.held = null;
    await pending.route.fulfill({ json: plan(pending.request) });
  };
  state.signOut = () => { session = { mode: 'accounts', legacy_access: false, user: null }; };
  await page.goto('/#/bots');
  await expect(page.getByRole('heading', { name: 'Meet your Bot Crew', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeEnabled();
  return state;
}

const panel = page => page.getByRole('region', { name: 'Run agents together', exact: true });
const choose = (page, name) => page.getByRole('checkbox', { name: `Select ${name}`, exact: true }).check();
const runSelected = page => panel(page).getByRole('button', { name: 'Run selected', exact: true });
const crewBrowser = page => page.getByRole('combobox', { name: 'Browser for crew runs', exact: true });
const backgroundGuidance = 'Chrome opens normally. Turn on Run in background to hide browser windows for the next run. Logs and progress stay in Activity.';
const backgroundToggle = page => page.getByRole('checkbox', { name: 'Run in background', exact: true });
const updateRequired = 'This dashboard service needs an update before it can run agents together. Restart the dashboard service, then try again. Your selection is saved.';

test('Naukri, Hirist and Instahyre launch together with separate site selections', async ({page}) => {
  const state = await workspace(page);
  for (const name of ['Naukri', 'Hirist', 'Instahyre']) await choose(page, name);
  await expect(page.getByText(/Each site has its own browser session/)).toBeVisible();
  await runSelected(page).click();
  const dialog = page.getByRole('dialog', {name: 'Start 3 agents?', exact: true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Start agents', exact: true}).click();
  await expect.poll(() => state.batches.length).toBe(1);
  expect(state.batches[0]).toEqual({runs: [
    {key: 'naukri', action: 'naukri', options: {dry_run: false, browser_mode: 'visible'}},
    {key: 'hirist', action: 'boards', options: {board: 'hirist', dry_run: false, browser_mode: 'visible'}},
    {key: 'instahyre', action: 'boards', options: {board: 'instahyre', dry_run: false, browser_mode: 'visible'}},
  ]});
  expect(state.plans[0]).toEqual(state.batches[0]);
  expect(state.denied).toEqual([]);
});

test('two selected assistants start real work together after one exact-command confirmation', async ({ page }) => {
  const state = await workspace(page);
  await expect(crewBrowser(page)).toHaveCount(0);
  await expect(page.getByText(backgroundGuidance, { exact: true })).toBeVisible();
  await expect(backgroundToggle(page)).not.toBeChecked();
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  await expect(panel(page)).toContainText('Learning assistant');
  await expect(panel(page)).toContainText('Daily briefing');
  await runSelected(page).click();
  const dialog = page.getByRole('dialog', { name: 'Start 2 agents?', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Learning assistant');
  await expect(dialog).toContainText('Daily briefing');
  const details = dialog.locator('details').filter({ has: page.getByText('Technical details', { exact: true }) });
  await expect(details).not.toHaveAttribute('open', '');
  await expect(details.locator('pre')).not.toBeVisible();
  await details.getByText('Technical details', { exact: true }).click();
  await expect(details.locator('pre')).toBeVisible();
  await expect(dialog).toContainText('--only learn');
  await expect(dialog).toContainText('--only brief');
  expect(state.batches).toEqual([]);
  expect(state.plans).toEqual([{ runs: [
    { key: 'learn', action: 'pipeline', options: { group: 'learn', dry_run: false, browser_mode: 'visible' } },
    { key: 'brief', action: 'pipeline', options: { group: 'brief', dry_run: false, browser_mode: 'visible' } },
  ] }]);
  await dialog.getByRole('button', { name: 'Start agents', exact: true }).click();
  await expect.poll(() => state.batches.length).toBe(1);
  expect(state.batches[0]).toEqual(state.plans[0]);
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Daily briefing', exact: true })).not.toBeChecked();
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('background choice and selected agents survive navigation before starting a batch', async ({ page }) => {
  const state = await workspace(page);
  await backgroundToggle(page).check();
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  await expect(crewBrowser(page)).toHaveCount(0);
  await expect(page.getByText(backgroundGuidance, { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Daily briefing', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Career & research', exact: true }).click();
  await page.evaluate(() => { location.hash = '#/naukri'; });
  await expect(page.getByText(backgroundGuidance, { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Browser mode', exact: true })).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/bots'; });
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Daily briefing', exact: true })).toBeChecked();
  await expect(backgroundToggle(page)).toBeChecked();
  await runSelected(page).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start agents', exact: true }).click();
  await expect.poll(() => state.batches.length).toBe(1);
  expect(state.plans).toEqual([{ runs: [
    { key: 'learn', action: 'pipeline', options: { group: 'learn', dry_run: false, browser_mode: 'background' } },
    { key: 'brief', action: 'pipeline', options: { group: 'brief', dry_run: false, browser_mode: 'background' } },
  ] }]);
  expect(state.batches).toEqual(state.plans);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('a selected card can start actual work directly in the background', async ({ page }) => {
  const state = await workspace(page);
  await backgroundToggle(page).check();
  await choose(page, 'Hirist');
  await expect(crewBrowser(page)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Select Hirist', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Run now — Hirist', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Run it', exact: true }).click();
  await expect.poll(() => state.individual.length).toBe(1);
  const approved = { action: 'boards', options: { board: 'hirist', dry_run: false, browser_mode: 'background' } };
  expect(state.previews.at(-1)).toEqual(approved);
  expect(state.individual).toEqual([approved]);
  expect(state.plans).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('background batch commands stay frozen while the selected agents are being reviewed', async ({ page }) => {
  const state = await workspace(page);
  await backgroundToggle(page).check();
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  state.holdPlan();
  await runSelected(page).click();
  await expect.poll(() => Boolean(state.held)).toBe(true);
  await expect(backgroundToggle(page)).toBeDisabled();
  await expect(crewBrowser(page)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeDisabled();
  const approved = structuredClone(state.held.request);
  expect(approved.runs.every(run => run.options.browser_mode === 'background' && !Object.hasOwn(run.options, 'headless'))).toBe(true);
  await state.releasePlan();
  await expect(page.getByRole('dialog', { name: 'Start 2 agents?', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select Daily briefing', exact: true })).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Start agents', exact: true }).click();
  await expect.poll(() => state.batches.length).toBe(1);
  expect(state.batches[0]).toEqual(approved);
  await expect(crewBrowser(page)).toHaveCount(0);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('individual settings default to visible Chrome and preview an explicit background choice', async ({ page }) => {
  const state = await workspace(page);
  await page.evaluate(() => { location.hash = '#/naukri'; });
  await expect(page.getByRole('heading', { name: 'Apply on Naukri', exact: true })).toBeVisible();
  const browser = page.getByRole('combobox', { name: 'Browser mode', exact: true });
  await expect(browser).toHaveCount(0);
  await expect(page.getByText(backgroundGuidance, { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /headless/i })).toHaveCount(0);
  await expect(backgroundToggle(page)).not.toBeChecked();
  await expect.poll(() => state.previews.some(request => request.action === 'naukri' && request.options.browser_mode === 'visible')).toBe(true);
  await backgroundToggle(page).check();
  await expect.poll(() => state.previews.at(-1)?.options.browser_mode).toBe('background');
  await page.getByRole('textbox', { name: 'Keywords', exact: true }).fill('Platform engineer');
  await expect.poll(() => state.previews.at(-1)?.options.keywords).toBe('Platform engineer');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Run it', exact: true }).click();
  await expect.poll(() => state.individual.length).toBe(1);
  expect(state.individual[0]).toMatchObject({ action: 'naukri', options: { browser_mode: 'background', keywords: 'Platform engineer', dry_run: true } });
  expect(state.previews.at(-1).options.browser_mode).toBe('background');
  expect(Object.hasOwn(state.individual[0].options, 'headless')).toBe(false);
  expect(state.individual[0]).toEqual(state.previews.at(-1));
  expect(state.denied).toEqual([]);
});

test('missing batch preview explains how to recover and preserves selection without starting individual agents', async ({ page }) => {
  const state = await workspace(page, { missing: 'preview' });
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  await runSelected(page).click();
  await expect(panel(page).getByRole('alert')).toHaveText(updateRequired);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Daily briefing', exact: true })).toBeChecked();
  await expect(runSelected(page)).toBeEnabled();
  await page.evaluate(snapshot => window.__crewSources.at(-1).send(snapshot), { ...emptyRun, revision: 1 });
  await page.getByRole('button', { name: 'Career & research', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toHaveText(updateRequired);
  await expect(page.locator('.toast-text')).toHaveCount(0);
  expect(state.plans).toHaveLength(1);
  expect(state.batches).toEqual([]);
  expect(state.previews).toEqual([]);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('missing batch start retains the confirmed selection and reports no false success or fallback', async ({ page }) => {
  const state = await workspace(page, { missing: 'start' });
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  await runSelected(page).click();
  const dialog = page.getByRole('dialog', { name: 'Start 2 agents?', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Start agents', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toHaveText(updateRequired);
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Daily briefing', exact: true })).toBeChecked();
  await expect(runSelected(page)).toBeEnabled();
  await page.evaluate(snapshot => window.__crewSources.at(-1).send(snapshot), { ...emptyRun, revision: 1 });
  await page.getByRole('button', { name: 'Career & research', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toHaveText(updateRequired);
  await expect(page.locator('.toast-text')).toHaveCount(0);
  expect(state.plans).toHaveLength(1);
  expect(state.batches).toEqual(state.plans);
  expect(state.previews).toEqual([]);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('simple steps explain the workflow and selected agent settings are easy to find', async ({ page }) => {
  const state = await workspace(page);
  for (const step of ['Choose agents', 'Review together', 'Follow progress']) {
    await expect(page.getByText(step, { exact: true })).toBeVisible();
  }
  const card = page.locator('[data-bot="hirist"]');
  const selection = card.getByRole('checkbox', { name: 'Select Hirist', exact: true });
  const checkboxBounds = await selection.boundingBox();
  const headingBounds = await card.getByRole('heading', { name: 'Hirist', exact: true }).boundingBox();
  expect(checkboxBounds.y).toBeLessThan(headingBounds.y);
  await selection.check();
  const configure = card.getByRole('button', { name: 'Configure Hirist', exact: true });
  await expect(configure).toBeVisible();
  await expect(configure).toContainText('Configure');
  expect(state.plans).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('selection survives searching, changing category and visiting another route', async ({ page }) => {
  const state = await workspace(page);
  await choose(page, 'Learning assistant');
  await page.getByRole('searchbox', { name: 'Find a bot', exact: true }).fill('Hirist');
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toHaveCount(0);
  await expect(panel(page)).toContainText('Learning assistant');
  await choose(page, 'Hirist');
  await page.getByRole('searchbox', { name: 'Find a bot', exact: true }).clear();
  await page.getByRole('button', { name: 'Career & research', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeChecked();
  await expect(panel(page)).toContainText('Hirist');
  await page.evaluate(() => { location.hash = '#/naukri'; });
  await expect(page.getByRole('heading', { name: 'Apply on Naukri', exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/bots'; });
  await expect(panel(page)).toContainText('Learning assistant');
  await expect(panel(page)).toContainText('Hirist');
  await panel(page).getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).not.toBeChecked();
  await expect(runSelected(page)).toBeDisabled();
  expect(state.batches).toEqual([]);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('a shared-browser conflict explains the problem and keeps selection without starting anything', async ({ page }) => {
  const problem = 'Hirist and Hirist profile share the same browser. Run them one at a time.';
  const state = await workspace(page, { conflict: problem });
  await choose(page, 'Hirist');
  await choose(page, 'Hirist profile');
  await runSelected(page).click();
  await expect(panel(page)).toContainText(problem);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select Hirist', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Hirist profile', exact: true })).toBeChecked();
  expect(state.plans).toHaveLength(1);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('the eight-agent limit remains reversible and agents needing setup explain why they cannot be selected', async ({ page }) => {
  const state = await workspace(page);
  for (const name of ['Naukri', 'Hirist', 'Instahyre', 'Cutshort', 'Wellfound', 'Naukri profile', 'LinkedIn writer', 'LinkedIn profile']) {
    await choose(page, name);
  }
  await expect(panel(page)).toContainText('8 of 8 agents selected');
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Select Naukri', exact: true })).toBeEnabled();
  await panel(page).getByRole('button', { name: 'Remove Naukri', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: 'Select Company sites', exact: true })).toBeDisabled();
  await expect(page.locator('[data-bot="external"]')).toContainText('Add an application URL in settings first.');
  await expect(page.getByRole('checkbox', { name: 'Select Resume tailor', exact: true })).toBeDisabled();
  await expect(page.locator('[data-bot="resume"]')).toContainText('Add a job description in settings first.');
  expect(state.plans).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('partial success removes only started agents and keeps failed agents with a clear error', async ({ page }) => {
  const state = await workspace(page, { partial: true });
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  await runSelected(page).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start agents', exact: true }).click();
  await expect(panel(page)).toContainText('The AI service is temporarily unavailable. Try this agent again.');
  await expect(panel(page)).toContainText('Daily briefing');
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Daily briefing', exact: true })).toBeChecked();
  await expect(runSelected(page)).toBeEnabled();
  expect(state.batches).toHaveLength(1);
  expect(state.plans).toHaveLength(1);
  expect(state.denied).toEqual([]);
});

for (const [name, action, options] of [
  ['Hirist', 'boards', { board: 'hirist', dry_run: false, browser_mode: 'visible' }],
  ['Naukri', 'naukri', { dry_run: false, browser_mode: 'visible' }],
]) {
  test(`${name} Run now starts actual work without practice mode`, async ({ page }) => {
    const state = await workspace(page);
    await page.getByRole('button', { name: `Run now — ${name}`, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText('--dry-run');
    expect(state.individual).toEqual([]);
    await dialog.getByRole('button', { name: 'Run it', exact: true }).click();
    await expect.poll(() => state.individual.length).toBe(1);
    expect(state.individual[0]).toEqual({ action, options });
    expect(state.previews.at(-1)).toEqual(state.individual[0]);
    expect(state.denied).toEqual([]);
  });
}

test('LinkedIn writer creates a saved draft instead of simulating or publishing a post', async ({ page }) => {
  const state = await workspace(page);
  await page.getByRole('button', { name: 'Create draft — LinkedIn writer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('--mode propose');
  await dialog.getByRole('button', { name: 'Run it', exact: true }).click();
  await expect.poll(() => state.individual.length).toBe(1);
  expect(state.individual[0]).toEqual({ action: 'linkedin', options: { mode: 'propose', browser_mode: 'visible' } });
  expect(state.denied).toEqual([]);
});

test('repeated clicks during preflight make one request and cancelling starts no agents', async ({ page }) => {
  const state = await workspace(page);
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  state.holdPlan();
  const start = runSelected(page);
  await start.evaluate(button => {
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect.poll(() => Boolean(state.held)).toBe(true);
  await expect(start).toBeDisabled();
  expect(state.plans).toHaveLength(1);
  await state.releasePlan();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(start).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Daily briefing', exact: true })).toBeChecked();
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('account expiration closes a pending batch confirmation without starting or reporting stale success', async ({ page }) => {
  const state = await workspace(page, { account: true });
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  await runSelected(page).click();
  const dialog = page.getByRole('dialog', { name: 'Start 2 agents?', exact: true });
  await expect(dialog).toBeVisible();
  state.signOut();
  await page.evaluate(() => window.dispatchEvent(new Event('account-expired')));
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('.toast-text')).toHaveCount(0);
  expect(await page.evaluate(() => window.__crewSources.every(source => source.closed))).toBe(true);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('an old-account preflight response cannot reopen a batch confirmation after sign-out', async ({ page }) => {
  const state = await workspace(page, { account: true });
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  state.holdPlan();
  await runSelected(page).click();
  await expect.poll(() => Boolean(state.held)).toBe(true);
  state.signOut();
  await page.evaluate(() => window.dispatchEvent(new Event('account-expired')));
  await expect(page).toHaveURL(/#\/login$/);
  await state.releasePlan();
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.toast-text')).toHaveCount(0);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('selected agents can be started without scrolling back up on mobile and desktop', async ({ page }) => {
  const state = await workspace(page);
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  await mkdir('artifacts/crew-selection', { recursive: true });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[data-bot="wellfound_profile"]').scrollIntoViewIfNeeded();
    await expect(runSelected(page)).toBeInViewport({ ratio: 1 });
    await expect(panel(page).getByRole('button', { name: 'Clear selection', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(panel(page)).toContainText('Learning assistant');
    await expect(panel(page)).toContainText('Daily briefing');
    // Trial clicks also verify the sticky action is not covered by navigation,
    // the Activity launcher, or a card. No command is submitted.
    await runSelected(page).click({ trial: true });
    await page.screenshot({ path: `artifacts/crew-selection/sticky-${width}.png`, animations: 'disabled' });
  }
  expect(state.plans).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('the parallel selection panel fits mobile and desktop and has accessible controls', async ({ page }) => {
  const state = await workspace(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  await mkdir('artifacts/crew-selection', { recursive: true });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.crew-browser-setting').screenshot({ path: `artifacts/crew-selection/browser-${width}.png`, animations: 'disabled' });
    await panel(page).scrollIntoViewIfNeeded();
    const bounds = await panel(page).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await panel(page).screenshot({ path: `artifacts/crew-selection/panel-${width}.png`, animations: 'disabled' });
    await page.screenshot({ path: `artifacts/crew-selection/crew-${width}.png`, fullPage: true, animations: 'disabled' });
    const result = await new AxeBuilder({ page }).include('.bot-page')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target).join(', ')}`)).toEqual([]);
  }
  expect(errors).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});
