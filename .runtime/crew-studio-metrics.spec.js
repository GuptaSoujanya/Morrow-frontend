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


test('measure crew studio density with synthetic APIs', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  const state=await workspace(page,{multiple:false,applicationHistory:reviewAttempts});
  await expect(page.getByRole('button',{name:/^Application history/})).toContainText('6');
  await page.evaluate(()=>document.fonts.ready);
  const results=[];
  for(const height of [900,1000]) {
    await page.setViewportSize({width:1440,height});
    await page.evaluate(()=>scrollTo(0,0));
    results.push(await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},documentHeight:document.documentElement.scrollHeight,firstRowY:document.querySelector('.crew-bot-card').getBoundingClientRect().top,visibleBotNames:[...document.querySelectorAll('.crew-bot-card h3')].filter(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}).map(node=>node.textContent),botCount:document.querySelectorAll('.crew-bot-card').length,historyHidden:document.querySelector('.application-history').hidden})));
  }
  console.log(JSON.stringify(results));
  expect(state.batches).toEqual([]);expect(state.denied).toEqual([]);
});
