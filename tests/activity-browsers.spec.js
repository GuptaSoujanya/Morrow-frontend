import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';

// Every API is synthetic; these cases never launch agents or act on a job site.
const at = '2026-10-24T11:30:00+05:30';
const naukri = {id: 'count-naukri', label: 'Naukri', action: 'naukri', running: true, status: 'running', seconds: 12, started_at: '2026-10-24T11:29:50+05:30'};
const hirist = {id: 'count-hirist', label: 'Hirist', action: 'boards', running: true, status: 'running', seconds: 14, started_at: '2026-10-24T11:29:48+05:30'};
const initial = {epoch: 'browser-count-test', revision: 1, next: 2, active_count: 2, running: true, label: 'Naukri', seconds: 12, stopping: false, last: null,
  runs: [naukri, hirist], lines: [[0, 'Naukri is checking matching roles.', naukri.id, at], [1, 'Hirist is reviewing technology roles.', hirist.id, at]]};
const counts = {runs: [{...naukri, open_browser_count: 2, count_status: 'ready'}, {...hirist, open_browser_count: 1, count_status: 'ready'}]};
const activity = page => page.getByRole('region', {name: 'Activity', exact: true});
const roster = page => page.locator('.activity-agent-roster');
const row = (page, id) => roster(page).locator(`[data-run-id="${id}"]`);

async function fixture(page) {
  const state = {snapshot: structuredClone(initial), counts: structuredClone(counts), reads: [], mutations: [], unexpected: [], errors: [], held: null, hold: false, failure: false, session: {mode: 'local', user: null, legacy_access: true}};
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(snapshot => {
    window.__countSources = []; window.__countRequests = []; window.__countOpens = [];
    class FixtureEventSource extends EventTarget {
      constructor(url) {super(); this.url = url; this.closed = false; window.__countSources.push(this); queueMicrotask(() => this.send(snapshot));}
      send(value) {if (!this.closed) this.dispatchEvent(new MessageEvent('run', {data: JSON.stringify(value)}));}
      close() {this.closed = true;}
    }
    window.EventSource = FixtureEventSource;
    window.open = (...args) => {window.__countOpens.push(args); return null;};
    const fetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (url.pathname !== '/api/run/browsers') return fetch(input, options);
      const entry = {aborted: false, pending: true}; window.__countRequests.push(entry);
      options?.signal?.addEventListener('abort', () => {entry.aborted = true;}, {once: true});
      return fetch(input, options).finally(() => {entry.pending = false;});
    };
  }, state.snapshot);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (route.request().method() !== 'GET') {
      state.mutations.push({path, body: route.request().postDataJSON()});
      return route.fulfill({status: 409, json: {error: 'Synthetic guard: no action was executed.'}});
    }
    if (path === '/api/run/browsers') {
      state.reads.push(Object.fromEntries(url.searchParams));
      if (state.hold) {state.hold = false; state.held = route; return;}
      return state.failure ? route.fulfill({status: 503, json: {error: 'Counts temporarily unavailable.'}}) : route.fulfill({json: state.counts});
    }
    const replies = {
      '/api/session': state.session,
      '/api/connections': {scope: 'main', scopes: [{id: 'main', label: 'Main browser'}], connections: [], browser_available: true},
      '/api/meta': {files: {}, answer_modes: [], linkedin_modes: []},
      '/api/status': {name: 'Synthetic workspace', greeting: 'Hello', date: '2026-10-24', date_long: '24 October 2026', run: state.snapshot, questions: [], facts: [], sites: [], study: {today: 0, read: 0, total: 0}, report: {ready: false, days: []}},
      '/api/course': {today: 0, read: 0, total: 0, lessons: [], modules: []},
      '/api/bots': {bots: [{id: 'naukri', running: true}, {id: 'hirist', running: true}], run: state.snapshot},
      '/api/run': state.snapshot,
      '/api/v1/auth/options': {provider: 'local', google: false},
    };
    if (Object.hasOwn(replies, path)) return route.fulfill({json: replies[path]});
    state.unexpected.push(path);
    return route.fulfill({status: 404, json: {error: 'No synthetic fixture.'}});
  });
  state.push = async snapshot => {state.snapshot = snapshot; await page.evaluate(value => window.__countSources.at(-1).send(value), snapshot);};
  state.release = async data => {const held = state.held; state.held = null; await held.fulfill({json: data || state.counts}).catch(() => {});};
  await page.clock.install({time: new Date(at)});
  await page.goto('/#/bots');
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  if (await activity(page).getAttribute('data-size') === 'collapsed') await activity(page).locator('.activity-launch').click();
  await expect.poll(() => state.reads.length).toBeGreaterThan(0);
  await expect(page.locator('.activity-browser-total')).toHaveText('3 agent browsers open');
  return state;
}

async function assertReadOnly(page, state) {
  expect(state.mutations).toEqual([]); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
  expect(state.reads.every(query => query.counts === '1' && Object.keys(query).length === 1)).toBe(true);
  expect(await page.evaluate(() => window.__countOpens)).toEqual([]);
  await expect(page.locator('#browser-catalog, #browser-viewer')).toHaveCount(0);
  await expect(activity(page).getByRole('button', {name: /All browsers|Open browser|Watch browser/})).toHaveCount(0);
}
async function agents(page) {await activity(page).getByRole('tab', {name: /^Agents/}).click();}
async function tick(page, state) {const before = state.reads.length; await page.clock.fastForward(5500); await expect.poll(() => state.reads.length).toBeGreaterThan(before);}

for (const [status, label] of [['stopped', 'Stopped'], ['failed', 'Needs attention'], ['completed', 'Completed']]) {
  test(`a ${status} agent leaves the live browser total while the other run continues`, async ({page}) => {
    const state = await fixture(page);
    await agents(page);
    await expect(row(page, naukri.id)).toContainText('2 browsers open');
    await expect(row(page, hirist.id)).toContainText('1 browser open');
    const terminal = {...naukri, running: false, status, exit: status === 'failed' ? 3 : 0};
    await state.push({...state.snapshot, revision: 2, runs: [terminal, hirist], active_count: 1});
    await expect(row(page, naukri.id)).toHaveCount(0);
    await expect(page.locator('.activity-browser-total')).toHaveText('1 agent browser open');
    // The inventory deliberately still says both are running: it cannot restore one.
    await tick(page, state);
    await expect(row(page, naukri.id)).toHaveCount(0);
    await expect(page.locator('.activity-browser-total')).toHaveText('1 agent browser open');
    await activity(page).getByRole('tab', {name: /^Progress/}).click();
    await page.getByRole('combobox', {name: 'Agent run', exact: true}).selectOption(naukri.id);
    await expect(page.locator('.activity-state')).toHaveText(label);
    await expect(page.locator('.activity-selected-browsers')).not.toBeVisible();
    await expect(activity(page).getByRole('button', {name: 'Stop', exact: true})).not.toBeVisible();
    await assertReadOnly(page, state);
  });
}

test('parallel agents show counts and isolated progress without private tabs or popup viewers', async ({page}) => {
  const state = await fixture(page);
  state.counts.runs[0].browsers = [{id: 'private-browser', tabs: [{title: 'Private page title', site: 'private.example'}]}];
  await tick(page, state);
  await expect(activity(page)).not.toContainText('Private page title');
  await expect(page.locator('.activity-selected-browsers')).toHaveText('2 browsers open');
  await agents(page);
  await row(page, hirist.id).getByRole('button', {name: 'View activity for Hirist'}).click();
  await expect(page.locator('.activity-selected-browsers')).toHaveText('1 browser open');
  await activity(page).locator('.activity-details > summary').click();
  await expect(page.getByRole('log', {name: 'Run output'})).toContainText('Hirist is reviewing technology roles.');
  await expect(page.getByRole('log', {name: 'Run output'})).not.toContainText('Naukri is checking');
  await activity(page).getByRole('tab', {name: /^Browsers/}).click();
  await expect(page.locator('.activity-browser-overview-count')).toHaveText('3 agent browsers open');
  await assertReadOnly(page, state);
});

test('browser counts can rise and fall independently of the number of active tasks', async ({page}) => {
  const state = await fixture(page); await agents(page);
  state.counts.runs[0].open_browser_count = 0;
  state.counts.runs[1].open_browser_count = 3;
  await tick(page, state);
  await expect(row(page, naukri.id)).toContainText('0 browsers open');
  await expect(row(page, hirist.id)).toContainText('3 browsers open');
  await expect(roster(page).locator('.activity-agent-row')).toHaveCount(2);
  await expect(page.locator('.activity-browser-total')).toHaveText('3 agent browsers open');
  await assertReadOnly(page, state);
});

test('delayed or incomplete counts never claim zero or keep an old exact total', async ({page}) => {
  const state = await fixture(page); await agents(page);
  state.failure = true; await tick(page, state);
  await expect(page.locator('.activity-browser-total')).toHaveText('Browser count unavailable');
  await expect(row(page, naukri.id)).toContainText('Browser count unavailable');
  state.failure = false; state.counts.runs[0].count_status = 'checking';
  await page.clock.fastForward(11000);
  await expect(page.locator('.activity-browser-total')).toHaveText('Checking browser count…');
  state.counts.runs[0].count_status = 'unavailable'; await tick(page, state);
  await expect(page.locator('.activity-browser-total')).toHaveText('Browser count unavailable');
  state.counts.runs[0].count_status = 'ready'; await tick(page, state);
  await expect(page.locator('.activity-browser-total')).toHaveText('3 agent browsers open');
  await assertReadOnly(page, state);
});

test('a slow count response cannot resurrect a run removed from Activity', async ({page}) => {
  const state = await fixture(page); await agents(page);
  state.hold = true; await tick(page, state); await expect.poll(() => !!state.held).toBe(true);
  await state.push({...state.snapshot, revision: 2, runs: [hirist], active_count: 1});
  await expect(roster(page).locator('.activity-agent-row')).toHaveCount(1);
  await state.release();
  await expect(page.locator('.activity-browser-total')).toHaveText('1 agent browser open');
  await expect(row(page, naukri.id)).toHaveCount(0);
  await assertReadOnly(page, state);
});

test('closing Activity aborts counts and reopening refreshes; no running tasks means no count polling', async ({page}) => {
  const state = await fixture(page);
  state.hold = true; await tick(page, state); await expect.poll(() => !!state.held).toBe(true);
  await activity(page).getByRole('button', {name: 'Close activity', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.__countRequests.some(request => request.aborted))).toBe(true);
  await state.release();
  const closed = state.reads.length; await page.clock.fastForward(16000); expect(state.reads).toHaveLength(closed);
  await activity(page).locator('.activity-launch').click();
  await expect.poll(() => state.reads.length).toBeGreaterThan(closed);
  await state.push({...state.snapshot, revision: 2, runs: [], running: false, active_count: 0});
  await expect(page.locator('.activity-browser-total')).toHaveText('0 agent browsers open');
  const empty = state.reads.length; await page.clock.fastForward(16000); expect(state.reads).toHaveLength(empty);
  await assertReadOnly(page, state);
});

test('account reset aborts count reads and cannot restore another workspace’s browser count', async ({page}) => {
  const state = await fixture(page);
  state.hold = true; await tick(page, state); await expect.poll(() => !!state.held).toBe(true);
  state.session = {mode: 'accounts', user: null, legacy_access: false};
  await page.evaluate(() => window.__countSources.at(-1).dispatchEvent(new Event('access-revoked')));
  await expect.poll(() => page.evaluate(() => window.__countRequests.some(request => request.aborted))).toBe(true);
  await state.release();
  await expect(roster(page).locator('.activity-agent-row')).toHaveCount(0);
  await expect(page.locator('.activity-browser-total')).not.toBeVisible();
  await assertReadOnly(page, state);
});

test('agent count summary fits desktop and phone and passes accessibility checks', async ({page}) => {
  const state = await fixture(page); await agents(page);
  await mkdir('artifacts/activity-counts', {recursive: true});
  for (const [width, height] of [[1280, 900], [375, 812]]) {
    await page.setViewportSize({width, height});
    await expect(row(page, naukri.id)).toBeVisible();
    const bounds = await activity(page).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await activity(page).screenshot({path: `artifacts/activity-counts/agents-${width}.png`, animations: 'disabled'});
    const audit = await new AxeBuilder({page}).include('.activity-console').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations).toEqual([]);
  }
  await assertReadOnly(page, state);
});
