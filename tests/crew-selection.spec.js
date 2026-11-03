import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

// Every request is intercepted. These tests must never start a real agent,
// submit an application, publish a post, or connect to an account service.
const botNames = {
  naukri: 'Naukri', hirist: 'Hirist', instahyre: 'Instahyre', cutshort: 'Cutshort',
  wellfound: 'Wellfound', startups: 'Startups', external: 'Company sites', profile: 'Naukri profile',
  linkedin: 'LinkedIn writer', linkedin_profile: 'LinkedIn profile', cold_email: 'Recruiter drafts',
  company_research: 'Company researcher', company_outreach: 'Company email drafts', resume: 'Resume tailor', learn: 'Learning assistant', brief: 'Daily briefing', research: 'Resume researcher',
  hirist_profile: 'Hirist profile', instahyre_profile: 'Instahyre profile',
  cutshort_profile: 'Cutshort profile', wellfound_profile: 'Wellfound profile',
};
const crewSize = Object.keys(botNames).length;
const applicationBots = ['Naukri', 'Hirist', 'Instahyre', 'Cutshort', 'Wellfound', 'Startups', 'Company sites'];
const reviewAttempts = Array.from({ length: 6 }, (_, index) => ({ job_id: `crew-review-${index}`, title: `Platform Engineer ${index + 1}`, company: `Company ${index + 1}`, state: index === 1 ? 'running' : 'uncertain', next_step: 'Check the application page and Sent before another attempt.', detail: 'No matching confirmation was found.', updated_at: '2026-11-03 10:30:00' }));
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

async function workspace(page, { account = false, conflict = '', partial = false, missing = '', multiple = true, history = false, applicationHistory = [] } = {}) {
  const state = { plans: [], batches: [], previews: [], individual: [], denied: [], held: null, holdNext: false, applicationAttempts: structuredClone(applicationHistory) };
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
      '/api/bots': { bots: Object.keys(botNames).map(id => ({ id, running: false, status: 'idle', last_run: history && id === 'naukri' ? { at: '2026-10-24T10:00:00Z', practice: false, finished: true } : null })), run: emptyRun },
      '/api/application-agent': { enabled: true, limit: 5, budget: 0, attempts: state.applicationAttempts },
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
  await expect(page.getByRole('heading', { name: 'Bot Crew', exact: true })).toBeVisible();
  await expect(page.locator('.crew-bot-card')).toHaveCount(crewSize);
  if (multiple) await page.getByRole('button', { name: 'Run multiple', exact: true }).click();
  return state;
}

const panel = page => page.getByRole('region', { name: 'Selected bots', exact: true });
const runSelected = page => panel(page).getByRole('button', { name: 'Review & start selected bots', exact: true });
const feedback = page => page.locator('.crew-launch-feedback');
const choose = (page, name) => page.getByRole('checkbox', { name: `Select ${name}`, exact: true }).check();
const singleRun = (page, name, label = 'Run now') => page.getByRole('button', { name: `${label} — ${name}`, exact: true });
const searchBox = page => page.getByRole('searchbox', { name: 'Find a bot', exact: true });
const settingsDialog = (page, name) => page.getByRole('dialog', { name: `${name} settings`, exact: true });
const backgroundToggle = page => page.getByRole('checkbox', { name: 'Run in background', exact: true });
const backgroundGuidance = 'Chrome opens normally. Turn on Run in background to hide browser windows for the next run. Logs and progress stay in Activity.';
const updateRequired = 'This dashboard service needs an update before it can run agents together. Restart the dashboard service, then try again. Your selection is saved.';

async function openSettings(page, name) {
  if (await page.getByRole('button', { name: 'Run multiple', exact: true }).isVisible()) await page.getByRole('button', { name: 'Run multiple', exact: true }).click();
  if (name) await choose(page, name);
  await panel(page).getByRole('button', { name: 'Run settings', exact: true }).click();
  const dialog = page.locator('.crew-settings-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}
async function openAdvanced(dialog) {
  const details = dialog.locator('.crew-advanced-settings');
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
}
async function saveBackground(page, name = 'Naukri') {
  const dialog = await openSettings(page, name);
  await openAdvanced(dialog);
  await backgroundToggle(page).check();
  await dialog.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await panel(page).getByRole('button', { name: 'Clear selection', exact: true }).click();
}

test('all bots and their individual run actions are visible immediately without setup steps', async ({ page }) => {
  const state = await workspace(page, { multiple: false });
  await expect(page.locator('.crew-team')).toHaveCount(3);
  await expect(page.locator('.crew-team[data-team="applications"] .crew-bot-card h3')).toHaveText(applicationBots);
  await expect(page.locator('.crew-team[data-team="profiles"] .crew-bot-card')).toHaveCount(6);
  await expect(page.locator('.crew-team[data-team="career"] .crew-bot-card')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'All bots', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(singleRun(page, 'Naukri')).toBeVisible();
  await expect(singleRun(page, 'LinkedIn writer', 'Create draft')).toBeVisible();
  await expect(singleRun(page, 'Company sites', 'Set up')).toBeVisible();
  await expect(singleRun(page, 'Resume tailor', 'Set up')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Configure / })).toHaveCount(crewSize);
  await expect(page.getByRole('button', { name: /^Application history/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Bot Crew workspace', exact: true }).getByRole('button', { name: 'Your crew', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.application-history')).not.toBeVisible();
  await expect(page.locator('[data-crew-pick]')).toHaveCount(0);
  await expect(panel(page)).not.toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Setup progress', exact: true })).toHaveCount(0);
  expect(state.plans).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('history counts are live and switching views preserves the selected crew and its filter', async ({ page }) => {
  const state = await workspace(page, { applicationHistory: [...reviewAttempts,
    { job_id: 'already-checked', title: 'Checked role', company: 'Company', state: 'needs_you', next_step: 'Nothing was sent; retry is allowed.' },
    { job_id: 'already-confirmed', title: 'Confirmed role', company: 'Company', state: 'confirmed', next_step: 'Do not submit again.' },
  ] });
  const history = page.getByRole('button', { name: /^Application history/ });
  await expect(history).toContainText('6');
  await choose(page, 'Naukri');
  await page.getByRole('button', { name: 'Career', exact: true }).click();
  await searchBox(page).fill('Learning assistant');
  await choose(page, 'Learning assistant');
  await history.click();
  await expect(history).toHaveAttribute('aria-pressed', 'true');
  const records = page.getByRole('region', { name: 'Application history', exact: true });
  await expect(records).toBeVisible();
  await expect(records.getByRole('button', { name: 'Needs review (6)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(records.locator('article[data-attempt]')).toHaveCount(6);
  await expect(page.locator('.crew-team:visible')).toHaveCount(0);
  state.applicationAttempts = state.applicationAttempts.map(item => item.job_id === 'crew-review-0' ? { ...item, state: 'confirmed' } : item);
  await records.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(records.getByRole('button', { name: 'Needs review (5)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Your crew', exact: true }).click();
  await expect(records).not.toBeVisible();
  await expect(history).toContainText('5');
  await expect(page.getByRole('button', { name: 'Career', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(searchBox(page)).toHaveValue('Learning assistant');
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeChecked();
  await expect(panel(page)).toContainText('Naukri');
  await expect(panel(page)).toContainText('Learning assistant');
  await page.getByRole('button', { name: 'All bots', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Naukri', exact: true })).toBeChecked();
  expect(state.plans).toEqual([]); expect(state.batches).toEqual([]); expect(state.denied).toEqual([]);
});

test('cards show recorded history, recognizable portraits and separate Configure and Run actions', async ({ page }) => {
  const state = await workspace(page, { multiple: false, history: true });
  const card = page.locator('[data-bot="naukri"]');
  await expect(card.locator('.bot-status')).not.toBeVisible();
  await expect(card.locator('.crew-card-history')).toContainText('Last run Oct 24');
  await expect(page.locator('[data-bot="hirist"] .crew-card-history')).toHaveCount(0);
  const portrait = await card.locator('.bot-icon').boundingBox();
  expect(portrait.width).toBeGreaterThanOrEqual(48);
  expect(portrait.height).toBeGreaterThanOrEqual(48);
  const configure = await card.getByRole('button', { name: 'Configure Naukri', exact: true }).boundingBox();
  const run = await singleRun(page, 'Naukri').boundingBox();
  expect(Math.min(configure.x + configure.width, run.x + run.width) <= Math.max(configure.x, run.x)
    || Math.min(configure.y + configure.height, run.y + run.height) <= Math.max(configure.y, run.y)).toBe(true);
  expect(configure.height).toBeGreaterThanOrEqual(44);
  expect(run.height).toBeGreaterThanOrEqual(44);
  expect(state.plans).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('one click on Naukri reviews only that bot and starts the exact approved action', async ({ page }) => {
  const state = await workspace(page, { multiple: false });
  await singleRun(page, 'Naukri').click();
  const dialog = page.getByRole('dialog', { name: 'Run Naukri?', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Submit matching job applications on Naukri');
  await expect(page.locator('.crew-settings-dialog')).toHaveCount(0);
  expect(state.batches).toEqual([]);
  expect(state.plans).toEqual([{ runs: [{ key: 'naukri', action: 'naukri', options: { dry_run: false, browser_mode: 'visible' } }] }]);
  await dialog.getByRole('button', { name: 'Run now', exact: true }).click();
  await expect.poll(() => state.batches.length).toBe(1);
  expect(state.batches).toEqual(state.plans);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('multi mode replaces individual run buttons and starts exactly the selected sites', async ({ page }) => {
  const state = await workspace(page);
  await expect(page.getByRole('button', { name: 'Cancel selection', exact: true })).toBeVisible();
  await expect(page.locator('[data-crew-pick]')).toHaveCount(crewSize);
  await expect(page.locator('.crew-card-run')).toHaveCount(0);
  await expect(runSelected(page)).toBeDisabled();
  for (const name of ['Naukri', 'Hirist', 'Instahyre']) await choose(page, name);
  await runSelected(page).click();
  const dialog = page.getByRole('dialog', { name: 'Start 3 agents?', exact: true });
  await expect(dialog).toBeVisible();
  expect(state.batches).toEqual([]);
  await dialog.getByRole('button', { name: 'Start agents', exact: true }).click();
  await expect.poll(() => state.batches.length).toBe(1);
  expect(state.batches[0]).toEqual({ runs: [
    { key: 'naukri', action: 'naukri', options: { dry_run: false, browser_mode: 'visible' } },
    { key: 'hirist', action: 'boards', options: { board: 'hirist', dry_run: false, browser_mode: 'visible' } },
    { key: 'instahyre', action: 'boards', options: { board: 'instahyre', dry_run: false, browser_mode: 'visible' } },
  ] });
  expect(state.plans).toEqual(state.batches);
  await expect(page.getByRole('button', { name: 'Run multiple', exact: true })).toBeVisible();
  await expect(page.locator('[data-crew-pick]')).toHaveCount(0);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('two assistants have one review with optional exact-command details', async ({ page }) => {
  const state = await workspace(page);
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  await runSelected(page).click();
  const dialog = page.getByRole('dialog', { name: 'Start 2 agents?', exact: true });
  await expect(dialog).toContainText('Learning assistant');
  await expect(dialog).toContainText('Daily briefing');
  const details = dialog.locator('.crew-command-details');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(details.locator('pre')).not.toBeVisible();
  await details.locator('summary').click();
  await expect(dialog).toContainText('--only learn');
  await expect(dialog).toContainText('--only brief');
  expect(state.batches).toEqual([]);
  expect(state.plans).toEqual([{ runs: [
    { key: 'learn', action: 'pipeline', options: { group: 'learn', dry_run: false, browser_mode: 'visible' } },
    { key: 'brief', action: 'pipeline', options: { group: 'brief', dry_run: false, browser_mode: 'visible' } },
  ] }]);
  await dialog.getByRole('button', { name: 'Start agents', exact: true }).click();
  await expect.poll(() => state.batches.length).toBe(1);
  expect(state.batches).toEqual(state.plans);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('Cancel and Escape discard selected-run drafts and restore focus to Run settings', async ({ page }) => {
  const state = await workspace(page, { multiple: false });
  for (const cancelWith of ['button', 'escape']) {
    const dialog = await openSettings(page, 'Naukri');
    await expect(dialog.getByRole('textbox', { name: 'Keywords', exact: true })).toHaveValue('');
    await expect(dialog.locator('.crew-advanced-settings')).not.toHaveAttribute('open', '');
    await dialog.getByRole('textbox', { name: 'Keywords', exact: true }).fill('Discard this draft');
    await openAdvanced(dialog);
    await expect(backgroundToggle(page)).not.toBeChecked();
    await backgroundToggle(page).check();
    if (cancelWith === 'button') await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Run settings', exact: true })).toBeFocused();
  }
  await page.getByRole('button', { name: 'Cancel selection', exact: true }).click();
  await singleRun(page, 'Naukri').click();
  await expect(page.getByRole('dialog', { name: /^Run .+\?$/ })).toBeVisible();
  expect(state.plans).toEqual([{ runs: [{ key: 'naukri', action: 'naukri', options: { dry_run: false, browser_mode: 'visible' } }] }]);
  expect(state.batches).toEqual([]);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('Apply settings commits a selected-run draft without launching and shares its browser preference', async ({ page }) => {
  const state = await workspace(page, { multiple: false });
  const settings = await openSettings(page, 'Naukri');
  await settings.getByRole('textbox', { name: 'Keywords', exact: true }).fill('Platform engineer');
  await settings.getByRole('spinbutton', { name: 'Naukri job limit', exact: true }).fill('12');
  await openAdvanced(settings);
  await expect(settings).toContainText('This browser preference applies to all Bot Crew runs.');
  await backgroundToggle(page).check();
  await settings.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await expect(settings).not.toBeVisible();
  expect(state.plans).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.previews).toEqual([]);
  await page.getByRole('button', { name: 'Cancel selection', exact: true }).click();
  await singleRun(page, 'Naukri').click();
  const dialog = page.getByRole('dialog', { name: /^Run .+\?$/ });
  await expect(dialog).toBeVisible();
  expect(state.plans[0]).toEqual({ runs: [{ key: 'naukri', action: 'naukri', options: {
    keywords: 'Platform engineer', limit: '12', dry_run: false, browser_mode: 'background',
  } }] });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await singleRun(page, 'Hirist').click();
  await expect(dialog).toBeVisible();
  expect(state.plans[1]).toEqual({ runs: [{ key: 'hirist', action: 'boards', options: { board: 'hirist', dry_run: false, browser_mode: 'background' } }] });
  expect(state.batches).toEqual([]);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('selected bots and saved browser preference survive filters and route navigation', async ({ page }) => {
  const state = await workspace(page);
  await saveBackground(page);
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  await page.getByRole('button', { name: 'Career', exact: true }).click();
  await page.evaluate(() => { location.hash = '#/naukri'; });
  await expect(page.getByRole('heading', { name: 'Apply on Naukri', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Bot Crew', exact: true }).click();
  await expect(panel(page)).toContainText('Learning assistant');
  await expect(panel(page)).toContainText('Daily briefing');
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Daily briefing', exact: true })).toBeChecked();
  const settings = await openSettings(page, 'Learning assistant');
  await openAdvanced(settings);
  await expect(backgroundToggle(page)).toBeChecked();
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
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

test('pending review freezes selection, settings and mode changes and preserves the approved payload', async ({ page }) => {
  const state = await workspace(page);
  await saveBackground(page);
  await choose(page, 'Naukri');
  await choose(page, 'Hirist');
  state.holdPlan();
  await runSelected(page).click();
  await expect.poll(() => Boolean(state.held)).toBe(true);
  await expect(page.getByRole('button', { name: 'Cancel selection', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Your crew', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Application history/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Configure Naukri', exact: true })).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: 'Run settings', exact: true })).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: 'Remove Naukri', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Select Naukri', exact: true })).toBeDisabled();
  await expect(page.locator('.crew-settings-dialog')).toHaveCount(0);
  const approved = structuredClone(state.held.request);
  expect(approved.runs.every(run => run.options.browser_mode === 'background' && !Object.hasOwn(run.options, 'headless'))).toBe(true);
  await state.releasePlan();
  await expect(page.getByRole('dialog', { name: 'Start 2 agents?', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Start agents', exact: true }).click();
  await expect.poll(() => state.batches.length).toBe(1);
  expect(state.batches[0]).toEqual(approved);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('individual full settings retain their practice default and explicit browser preference', async ({ page }) => {
  const state = await workspace(page, { multiple: false });
  await page.evaluate(() => { location.hash = '#/naukri'; });
  await expect(page.getByRole('heading', { name: 'Apply on Naukri', exact: true })).toBeVisible();
  await expect(page.getByText(backgroundGuidance, { exact: true })).toBeVisible();
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
  expect(Object.hasOwn(state.individual[0].options, 'headless')).toBe(false);
  expect(state.individual[0]).toEqual(state.previews.at(-1));
  expect(state.denied).toEqual([]);
});

for (const missing of ['preview', 'start']) {
  test(`missing batch ${missing} explains recovery and preserves selection without fallback`, async ({ page }) => {
    const state = await workspace(page, { missing });
    await choose(page, 'Learning assistant');
    await choose(page, 'Daily briefing');
    await runSelected(page).click();
    if (missing === 'start') await page.getByRole('dialog').getByRole('button', { name: 'Start agents', exact: true }).click();
    await expect(feedback(page).getByRole('alert')).toHaveText(updateRequired);
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Select Daily briefing', exact: true })).toBeChecked();
    await expect(runSelected(page)).toBeEnabled();
    await page.getByRole('button', { name: 'Career', exact: true }).click();
    await expect(feedback(page).getByRole('alert')).toHaveText(updateRequired);
    expect(state.plans).toHaveLength(1);
    expect(state.batches).toEqual(missing === 'start' ? state.plans : []);
    expect(state.previews).toEqual([]);
    expect(state.individual).toEqual([]);
    expect(state.denied).toEqual([]);
  });
}

test('search, filters and keyboard selection preserve the crew until selection is cancelled', async ({ page }) => {
  const state = await workspace(page);
  await searchBox(page).fill('Learning assistant');
  const selection = page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true });
  await selection.focus();
  await selection.press('Space');
  await expect(selection).toBeChecked();
  await searchBox(page).fill('no-bot-with-this-name');
  await expect(page.locator('.crew-bot-card')).toHaveCount(0);
  await expect(panel(page)).toContainText('Learning assistant');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(searchBox(page)).toHaveValue('');
  await expect(page.locator('.crew-bot-card')).toHaveCount(crewSize);
  await page.getByRole('button', { name: 'Applications', exact: true }).click();
  await expect(page.locator('.crew-bot-card')).toHaveCount(applicationBots.length);
  await expect(panel(page)).toContainText('Learning assistant');
  await searchBox(page).fill('Learning assistant');
  await expect(page.locator('.crew-bot-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'All bots', exact: true }).click();
  await expect(searchBox(page)).toHaveValue('');
  await expect(selection).toBeChecked();
  await page.getByRole('button', { name: 'Cancel selection', exact: true }).click();
  await expect(page.locator('[data-crew-pick]')).toHaveCount(0);
  await expect(panel(page)).not.toBeVisible();
  await page.getByRole('button', { name: 'Run multiple', exact: true }).click();
  await expect(selection).not.toBeChecked();
  await expect(runSelected(page)).toBeDisabled();
  expect(state.plans).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('settings validate limits and share the configured board limit across selected sites', async ({ page }) => {
  const state = await workspace(page);
  const naukri = await openSettings(page, 'Naukri');
  await naukri.getByRole('textbox', { name: 'Keywords', exact: true }).fill('Platform engineer');
  await naukri.getByRole('spinbutton', { name: 'Naukri job limit', exact: true }).fill('0');
  await naukri.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await expect(naukri.getByRole('spinbutton', { name: 'Naukri job limit', exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(naukri).toBeVisible();
  expect(state.plans).toEqual([]);
  await naukri.getByRole('spinbutton', { name: 'Naukri job limit', exact: true }).fill('12');
  await naukri.getByRole('button', { name: 'Apply settings', exact: true }).click();
  const hirist = await openSettings(page, 'Hirist');
  await hirist.getByRole('spinbutton', { name: 'Application limit per board', exact: true }).fill('7');
  await hirist.getByRole('button', { name: 'Apply settings', exact: true }).click();
  for (const name of ['Naukri', 'Hirist', 'Instahyre']) await choose(page, name);
  await runSelected(page).click();
  await expect(page.getByRole('dialog', { name: 'Start 3 agents?', exact: true })).toBeVisible();
  expect(state.plans).toEqual([{ runs: [
    { key: 'naukri', action: 'naukri', options: { keywords: 'Platform engineer', limit: '12', dry_run: false, browser_mode: 'visible' } },
    { key: 'hirist', action: 'boards', options: { board: 'hirist', limit: '7', dry_run: false, browser_mode: 'visible' } },
    { key: 'instahyre', action: 'boards', options: { board: 'instahyre', limit: '7', dry_run: false, browser_mode: 'visible' } },
  ] }]);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('Configure opens the existing bot page directly and returns with selection and settings intact', async ({ page }) => {
  const state = await workspace(page);
  await choose(page, 'Naukri');
  await page.getByRole('button', { name: 'Configure Naukri', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Apply on Naukri', exact: true })).toBeVisible();
  await expect(page.locator('.crew-settings-dialog')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Keywords', exact: true }).fill('Platform engineer');
  await page.getByRole('spinbutton', { name: 'Limit', exact: true }).fill('12');
  await page.getByRole('link', { name: 'Back to Bot Crew', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Naukri', exact: true })).toBeChecked();
  await runSelected(page).click();
  await expect(page.getByRole('dialog', { name: 'Run Naukri?', exact: true })).toBeVisible();
  expect(state.plans).toEqual([{ runs: [{ key: 'naukri', action: 'naukri', options: {
    keywords: 'Platform engineer', limit: '12', dry_run: false, browser_mode: 'visible', answer_mode: '', llm_backend: '',
  } }] }]);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(state.batches).toEqual([]);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('Company sites asks for a valid URL only when needed and reviews after setup', async ({ page }) => {
  const state = await workspace(page, { multiple: false });
  await singleRun(page, 'Company sites', 'Set up').click();
  const settings = settingsDialog(page, 'Company sites');
  const url = settings.getByRole('textbox', { name: 'Application URL', exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Review & run', exact: true }).click();
  await expect(url).toHaveAttribute('aria-invalid', 'true');
  await expect(url).toBeFocused();
  expect(state.plans).toEqual([]);
  await url.fill('ftp://example.test/job');
  await settings.getByRole('button', { name: 'Review & run', exact: true }).click();
  await expect(url).toHaveAttribute('aria-invalid', 'true');
  expect(state.plans).toEqual([]);
  await url.fill('https://example.test/jobs/platform');
  await settings.getByRole('button', { name: 'Review & run', exact: true }).click();
  await expect(settings).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: /^Run .+\?$/ })).toBeVisible();
  expect(state.plans).toEqual([{ runs: [{ key: 'external', action: 'external', options: {
    url: 'https://example.test/jobs/platform', dry_run: false, browser_mode: 'visible',
  } }] }]);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('resume setup validates its description and Cancel discards the unsaved draft', async ({ page }) => {
  const state = await workspace(page, { multiple: false });
  await singleRun(page, 'Resume tailor', 'Set up').click();
  const settings = settingsDialog(page, 'Resume tailor');
  const description = settings.getByRole('textbox', { name: 'Job description', exact: true });
  await settings.getByRole('button', { name: 'Review & run', exact: true }).click();
  await expect(description).toHaveAttribute('aria-invalid', 'true');
  expect(state.plans).toEqual([]);
  await description.fill('Unsaved job description');
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await singleRun(page, 'Resume tailor', 'Set up').click();
  await expect(description).toHaveValue('');
  await description.fill('Platform engineer building reliable APIs and distributed systems.');
  await settings.getByRole('button', { name: 'Review & run', exact: true }).click();
  await expect(settings).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: /^Run .+\?$/ })).toBeVisible();
  expect(state.plans[0]).toMatchObject({ runs: [{ key: 'resume', action: 'resume', options: {
    jd_text: 'Platform engineer building reliable APIs and distributed systems.', browser_mode: 'visible',
  } }] });
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('a multi run collects required setup together before previewing the exact selected bots', async ({ page }) => {
  const state = await workspace(page);
  await choose(page, 'Company sites');
  await choose(page, 'Resume tailor');
  await runSelected(page).click();
  const settings = page.getByRole('dialog', { name: 'Selected bot settings', exact: true });
  await expect(settings).toBeVisible();
  expect(state.plans).toEqual([]);
  await settings.getByRole('textbox', { name: 'Application URL', exact: true }).fill('https://example.test/jobs/platform');
  await settings.getByRole('textbox', { name: 'Job description', exact: true }).fill('Platform engineering role.');
  await settings.getByRole('button', { name: 'Review & run', exact: true }).click();
  await expect(settings).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Start 2 agents?', exact: true })).toBeVisible();
  expect(state.plans[0].runs.map(run => run.key)).toEqual(['external', 'resume']);
  expect(state.plans[0].runs[0].options.url).toBe('https://example.test/jobs/platform');
  expect(state.plans[0].runs[1].options.jd_text).toBe('Platform engineering role.');
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('a shared-site conflict keeps selection and explains how to resolve it', async ({ page }) => {
  const problem = 'Hirist and Hirist profile share the same browser. Run them one at a time.';
  const state = await workspace(page, { conflict: problem });
  await choose(page, 'Hirist');
  await choose(page, 'Hirist profile');
  await runSelected(page).click();
  await expect(feedback(page)).toContainText(problem);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select Hirist', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Hirist profile', exact: true })).toBeChecked();
  expect(state.plans).toHaveLength(1);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('the eight-bot limit is reversible and setup requirements do not block selection', async ({ page }) => {
  const state = await workspace(page);
  for (const name of ['Naukri', 'Hirist', 'Instahyre', 'Cutshort', 'Wellfound', 'Naukri profile', 'LinkedIn writer', 'LinkedIn profile']) await choose(page, name);
  await expect(panel(page)).toContainText('8 of 8 bots selected');
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Select Naukri', exact: true })).toBeEnabled();
  await panel(page).getByRole('button', { name: 'Remove Naukri', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: 'Select Company sites', exact: true })).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: 'Select Resume tailor', exact: true })).toBeEnabled();
  await panel(page).getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(runSelected(page)).toBeDisabled();
  expect(state.plans).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('partial success keeps failed bots selected and retains multi mode with clear feedback', async ({ page }) => {
  const state = await workspace(page, { partial: true });
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  await runSelected(page).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start agents', exact: true }).click();
  await expect(feedback(page)).toContainText('The AI service is temporarily unavailable. Try this agent again.');
  await expect(runSelected(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cancel selection', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select Learning assistant', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Daily briefing', exact: true })).toBeChecked();
  expect(state.batches).toHaveLength(1);
  expect(state.plans).toHaveLength(1);
  expect(state.denied).toEqual([]);
});

test('Hirist runs directly with the correct board and actual-work default', async ({ page }) => {
  const state = await workspace(page, { multiple: false });
  await singleRun(page, 'Hirist').click();
  const dialog = page.getByRole('dialog', { name: 'Run Hirist?', exact: true });
  await expect(dialog).toContainText('Submit matching job applications on Hirist');
  expect(state.batches).toEqual([]);
  await dialog.getByRole('button', { name: 'Run now', exact: true }).click();
  await expect.poll(() => state.batches.length).toBe(1);
  expect(state.batches[0]).toEqual({ runs: [{ key: 'hirist', action: 'boards', options: { board: 'hirist', dry_run: false, browser_mode: 'visible' } }] });
  expect(state.plans).toEqual(state.batches);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('Startups reviews and launches only its own action while explaining email drafts', async ({ page }) => {
  const state = await workspace(page, { multiple: false });
  const configure = page.getByRole('button', { name: 'Configure Startups', exact: true });
  await configure.click();
  const settings = settingsDialog(page, 'Startups');
  const limit = settings.getByRole('spinbutton', { name: 'Startup job limit', exact: true });
  await expect(limit).toHaveValue('');
  await expect(limit).toHaveAttribute('placeholder', '10');
  await limit.fill('17');
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(configure).toBeFocused();
  await configure.click();
  await expect(limit).toHaveValue('');
  await limit.fill('51');
  await settings.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await expect(limit).toHaveAttribute('aria-invalid', 'true');
  await limit.fill('7');
  await openAdvanced(settings);
  await expect(settings.getByRole('button', { name: 'Open full settings for Startups', exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await expect(settings).not.toBeVisible();
  expect(state.plans).toEqual([]); expect(state.batches).toEqual([]);
  await singleRun(page, 'Startups').click();
  const dialog = page.getByRole('dialog', { name: 'Run Startups?', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Emails are never sent.');
  expect(state.plans).toEqual([{ runs: [{ key: 'startups', action: 'startups', options: { limit: '7', dry_run: false, browser_mode: 'visible' } }] }]);
  expect(state.batches).toEqual([]);
  await dialog.getByRole('button', { name: 'Run now', exact: true }).click();
  await expect.poll(() => state.batches.length).toBe(1);
  expect(state.batches).toEqual(state.plans); expect(state.individual).toEqual([]); expect(state.denied).toEqual([]);
});

test('LinkedIn writer creates a draft directly without publishing a post', async ({ page }) => {
  const state = await workspace(page, { multiple: false });
  await singleRun(page, 'LinkedIn writer', 'Create draft').click();
  const dialog = page.getByRole('dialog', { name: 'Run LinkedIn writer?', exact: true });
  await expect(dialog).toContainText('Save a LinkedIn draft');
  await dialog.getByText('Technical details', { exact: true }).click();
  await expect(dialog).toContainText('--mode propose');
  expect(state.batches).toEqual([]);
  await dialog.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect.poll(() => state.batches.length).toBe(1);
  expect(state.batches[0]).toEqual({ runs: [{ key: 'linkedin', action: 'linkedin', options: { mode: 'propose', browser_mode: 'visible' } }] });
  expect(state.plans).toEqual(state.batches);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('repeated run clicks send one preview and cancelling restores the single-run trigger', async ({ page }) => {
  const state = await workspace(page, { multiple: false });
  const trigger = singleRun(page, 'Naukri');
  await trigger.focus();
  state.holdPlan();
  await trigger.evaluate(button => { button.click(); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await expect.poll(() => Boolean(state.held)).toBe(true);
  await expect(trigger).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Configure Naukri', exact: true })).toBeDisabled();
  expect(state.plans).toHaveLength(1);
  await state.releasePlan();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(trigger).toBeEnabled();
  await expect(trigger).toBeFocused();
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('account expiration closes pending confirmation without stale starts or success', async ({ page }) => {
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

test('late preflight from an expired account cannot reopen confirmation', async ({ page }) => {
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

test('account expiration closes selected-run settings without committing or running the draft', async ({ page }) => {
  const state = await workspace(page, { account: true, multiple: false });
  const settings = await openSettings(page, 'Naukri');
  await settings.getByRole('textbox', { name: 'Keywords', exact: true }).fill('Private unsaved edit');
  state.signOut();
  await page.evaluate(() => window.dispatchEvent(new Event('account-expired')));
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.locator('.crew-settings-dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  expect(state.plans).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.individual).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('the selected crew remains reachable without overlapping Activity on mobile and desktop', async ({ page }) => {
  const state = await workspace(page);
  await choose(page, 'Learning assistant');
  await choose(page, 'Daily briefing');
  await mkdir('artifacts/crew-refinement', { recursive: true });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[data-bot="company_outreach"]').scrollIntoViewIfNeeded();
    await expect(runSelected(page)).toBeInViewport({ ratio: 1 });
    await runSelected(page).click({ trial: true });
    if (width > 767) await panel(page).getByRole('button', { name: 'Clear selection', exact: true }).click({ trial: true });
    else {
      await expect(panel(page).getByRole('button', { name: 'Clear selection', exact: true })).not.toBeVisible();
      await panel(page).getByRole('button', { name: 'Run settings', exact: true }).click({ trial: true });
    }
    await page.screenshot({ path: `artifacts/crew-refinement/refined-sticky-${width}.png`, animations: 'disabled' });
  }
  expect(state.plans).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});

test('catalogue, single review, settings drawer and multi selection fit four widths accessibly', async ({ page }) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const state = await workspace(page, { multiple: false, applicationHistory: reviewAttempts });
  await mkdir('artifacts/crew-studio', { recursive: true });
  const audit = async selector => {
    const result = await new AxeBuilder({ page }).include(selector)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target).join(', ')}`)).toEqual([]);
  };
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('heading', { name: 'Bot Crew', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const overflowingActions = await page.locator('.crew-bot-card').evaluateAll(cards => cards.flatMap(card => {
      const bounds = card.getBoundingClientRect();
      return [...card.querySelectorAll('.bot-actions button')].filter(button => {
        const action = button.getBoundingClientRect();
        return action.left < bounds.left - 1 || action.right > bounds.right + 1 || action.top < bounds.top - 1 || action.bottom > bounds.bottom + 1;
      }).map(button => `${card.dataset.bot}: ${button.textContent.trim()}`);
    }));
    expect(overflowingActions, `Card actions must fit at ${width}px`).toEqual([]);
    await page.screenshot({ path: `artifacts/crew-studio/after-default-${width}.png`, animations: 'disabled' });
    if (width === 1440) await page.screenshot({ path: 'artifacts/crew-studio/after-full-1440.png', fullPage: true, animations: 'disabled' });
    await audit('.bot-page');
    await page.getByRole('button', { name: /^Application history/ }).click();
    await expect(page.getByRole('region', { name: 'Application history', exact: true }).locator('article[data-attempt]')).toHaveCount(6);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/crew-studio/after-history-${width}.png`, animations: 'disabled' });
    await audit('.bot-page');
    await page.getByRole('button', { name: 'Your crew', exact: true }).click();
    await singleRun(page, 'Naukri').click();
    const review = page.getByRole('dialog', { name: /^Run .+\?$/ });
    await expect(review).toBeVisible();
    await page.screenshot({ path: `artifacts/crew-studio/after-review-${width}.png`, animations: 'disabled' });
    await audit('#confirm');
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Run multiple', exact: true }).click();
    await choose(page, 'Naukri');
    await choose(page, 'Hirist');
    const settings = await openSettings(page);
    await page.screenshot({ path: `artifacts/crew-studio/after-settings-${width}.png`, animations: 'disabled' });
    await audit('.crew-settings-dialog');
    await openAdvanced(settings);
    const bounds = await settings.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await audit('.crew-settings-dialog');
    await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('heading', { name: 'Bot Crew', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `artifacts/crew-studio/after-multiple-${width}.png`, animations: 'disabled' });
    await audit('.bot-page');
    await page.getByRole('button', { name: 'Cancel selection', exact: true }).click();
  }
  expect(errors).toEqual([]);
  expect(state.batches).toEqual([]);
  expect(state.denied).toEqual([]);
});
