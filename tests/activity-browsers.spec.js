import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

// Metadata and screenshots are synthetic. Every API request is intercepted;
// no test can start an agent, submit an application, or launch a browser process.
const at = '2026-10-24T11:30:00+05:30';
const frame = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAABJklEQVR4nO3dsU0EURAFwUmNOEgWG5MAMM49GyQ8kri/s2qVVAE8qb1xZt7fPgib9QUcNesLOGrWF3DUrC/gqFlfwFGzvoCjZn0BR836Ao6a9QUcNesLOGrWF3DUrC/gqPl+PA/5+f1jncBxAscJHCdwnMBxAscJHCdwnMBxAsctBP78evBaAscJHCdwnMBxAscJHHevwFxJ4DiB4wSOEzhO4DiB4wSOEzhO4DinygKB4wSOEzhO4DiB4+4VmCsJHCdwnMBxAscJHCdwnMBxAscJHCdwnFt0gcBxAscJHCdwnMBx9wrMlQSOEzhO4DiB4wSOEzhO4DiB4wS+1KEPlALfhcBxAscJHCdwnMBxAscJHCcwLyZwnMBxAscJHCdwnMBxAsf9A4X2RvLaAS2lAAAAAElFTkSuQmCC';
const naukri = { id: 'roster-naukri', label: 'Naukri', action: 'naukri', shown: 'python naukri_bot.py', running: true, status: 'running', stopping: false, seconds: 12, started_at: '2026-10-24T11:29:50+05:30' };
const hirist = { id: 'roster-hirist', label: 'Hirist', action: 'boards', shown: 'python boards_bot.py --site hirist', running: true, status: 'running', stopping: false, seconds: 14, started_at: '2026-10-24T11:29:48+05:30' };
const initial = { epoch: 'activity-browser-inventory-test', revision: 1, next: 2, active_count: 2, running: true, label: 'Naukri', seconds: 12, stopping: false, last: null, runs: [naukri, hirist], lines: [[0, 'Naukri is checking matching roles.', naukri.id, at], [1, 'Hirist is reviewing technology roles.', hirist.id, at]] };
const inventory = { runs: [
  { ...naukri, browser_state: 'ready', message: '', browsers: [
    { id: 'naukri-main', label: 'Naukri applications', state: 'ready', tabs: [{ id: 'naukri-roles', title: 'Naukri matching roles', site: 'naukri.example.test' }, { id: 'naukri-details', title: 'Platform engineer role', site: 'jobs.example.test' }] },
    { id: 'naukri-resume', label: 'Naukri resume helper', state: 'ready', tabs: [{ id: 'naukri-resume-tab', title: 'Tailored resume preview', site: 'resume.example.test' }] },
  ] },
  { ...hirist, browser_state: 'ready', message: '', browsers: [
    { id: 'hirist-main', label: 'Hirist applications', state: 'ready', tabs: [{ id: 'hirist-roles', title: 'Hirist technology roles', site: 'hirist.example.test' }] },
  ] },
] };

async function workspace(page, { account = false, catalogData = inventory } = {}) {
  const state = { snapshot: structuredClone(initial), inventory: structuredClone(catalogData), inventoryReads: 0, captures: [], waitingCaptures: 0, denied: [], held: null, holdNext: false };
  let session = account ? {
    mode: 'accounts', legacy_access: true,
    user: { id: 'roster-owner', name: 'Roster Owner', email: 'roster@example.test', role: 'admin', plan_name: 'Pro', modules: [] },
  } : { mode: 'local', legacy_access: true, user: null };
  await page.addInitScript(snapshot => {
    window.__activityBrowserSources = [];
    class FixtureEventSource extends EventTarget {
      constructor(url) { super(); this.url = url; this.closed = false; window.__activityBrowserSources.push(this); queueMicrotask(() => this.send(snapshot)); }
      send(value) { if (!this.closed) this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(value) })); }
      close() { this.closed = true; }
    }
    window.EventSource = FixtureEventSource;
    window.__activityBrowserRequests = [];
    const fetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (!['/api/run/browsers', '/api/run/browser'].includes(url.pathname)) return fetch(input, options);
      const entry = { path: url.pathname, aborted: false, pending: true };
      window.__activityBrowserRequests.push(entry);
      options?.signal?.addEventListener('abort', () => { entry.aborted = true; }, { once: true });
      return fetch(input, options).finally(() => { entry.pending = false; });
    };
    window.__activityBrowserOpens = [];
    window.open = (...args) => { window.__activityBrowserOpens.push(args); return null; };
  }, state.snapshot);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      state.denied.push(`${route.request().method()} ${url.pathname}`);
      return route.fulfill({ status: 409, json: { error: 'Synthetic test guard: action was not executed.' } });
    }
    if (url.pathname === '/api/run/browsers') {
      state.inventoryReads++;
      if (state.holdNext) { state.holdNext = false; state.held = route; return; }
      return route.fulfill({ json: state.inventory });
    }
    if (url.pathname === '/api/run/browser') {
      const query = Object.fromEntries(url.searchParams); state.captures.push(query);
      if (state.waitingCaptures > 0) {
        state.waitingCaptures--;
        return route.fulfill({ json: { state: 'waiting', message: 'This selected browser is refreshing.' } });
      }
      const run = state.inventory.runs.find(item => item.id === query.id);
      const browser = run?.browsers.find(item => item.id === query.browser) || run?.browsers[0];
      const tab = browser?.tabs.find(item => item.id === query.tab) || browser?.tabs[0];
      if (!run || !browser || !tab) return route.fulfill({ status: 404, json: { error: 'No synthetic browser for this selection.' } });
      return route.fulfill({ json: { state: 'ready', run_id: run.id, label: run.label, browser_id: browser.id, tab_id: tab.id, browsers: run.browsers, tabs: browser.tabs, title: tab.title, site: tab.site, image: frame, captured_at: at } });
    }
    const replies = {
      '/api/session': session,
      '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
      '/api/status': { name: 'Synthetic workspace', greeting: 'Hello', date: '2026-10-24', date_long: '24 October 2026', run: state.snapshot, questions: [], facts: [], sites: [], study: { today: 0, read: 0, total: 0 }, report: { ready: false, days: [] } },
      '/api/course': { today: 0, read: 0, total: 0, lessons: [], modules: [] },
      '/api/bots': { bots: [{ id: 'naukri', running: true }, { id: 'hirist', running: true }], run: state.snapshot },
      '/api/run': state.snapshot,
      '/api/v1/auth/options': { provider: 'local', google: false },
    };
    return Object.hasOwn(replies, url.pathname) ? route.fulfill({ json: replies[url.pathname] })
      : route.fulfill({ status: 404, json: { error: `No synthetic fixture for ${url.pathname}` } });
  });
  state.hold = () => { state.holdNext = true; };
  state.release = async () => { const pending = state.held; state.held = null; await pending.fulfill({ json: state.inventory }); };
  state.signOut = () => { session = { mode: 'accounts', legacy_access: false, user: null }; };
  state.push = async value => { state.snapshot = value; await page.evaluate(snapshot => window.__activityBrowserSources.at(-1).send(snapshot), value); };
  await page.clock.install({ time: new Date(at) });
  await page.goto('/#/bots');
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  await expect(page.locator('.activity-agent-row')).toHaveCount(2);
  await expect.poll(() => state.inventoryReads).toBeGreaterThan(0);
  return state;
}

const activity = page => page.getByRole('region', { name: 'Activity', exact: true });
const roster = page => page.locator('.activity-agent-roster');
const catalog = page => page.getByRole('dialog', { name: 'All browsers', exact: true });
const viewer = page => page.getByRole('dialog', { name: 'Browser view', exact: true });
const catalogRun = (page, id) => catalog(page).locator(`.browser-catalog-agent[data-run-id="${id}"]`);
async function openCatalog(page) {
  await activity(page).getByRole('button', { name: 'All browsers', exact: true }).click();
  await expect(catalog(page)).toBeVisible();
}
async function noCommands(page, state) {
  expect(state.denied).toEqual([]);
  expect(await page.evaluate(() => window.__activityBrowserOpens)).toEqual([]);
}

test('the Activity roster names every running agent and directly switches its logs', async ({ page }) => {
  const state = await workspace(page);
  await expect(roster(page)).toContainText('Naukri');
  await expect(roster(page)).toContainText('Hirist');
  for (const name of ['Naukri', 'Hirist']) {
    await expect(roster(page).getByRole('button', { name: `View activity for ${name}`, exact: true })).toBeVisible();
    await expect(roster(page).getByRole('button', { name: `Watch browser for ${name}`, exact: true })).toBeVisible();
  }
  await roster(page).getByRole('button', { name: 'View activity for Hirist', exact: true }).click();
  await expect(page.locator('.activity-summary strong')).toHaveText('Hirist');
  await page.getByText('Technical details · 1 line', { exact: true }).click();
  const log = page.getByRole('log', { name: 'Run output', exact: true });
  await expect(log).toContainText('Hirist is reviewing technology roles.');
  await expect(log).not.toContainText('Naukri is checking matching roles.');
  await roster(page).getByRole('button', { name: 'View activity for Naukri', exact: true }).click();
  await expect(page.locator('.activity-summary strong')).toHaveText('Naukri');
  await expect(log).toContainText('Naukri is checking matching roles.');
  await expect(log).not.toContainText('Hirist is reviewing technology roles.');
  expect(state.captures).toEqual([]);
  await noCommands(page, state);
});

test('All browsers lists every session and opens exactly the selected run, browser and tab', async ({ page }) => {
  const state = await workspace(page);
  await openCatalog(page);
  await expect(catalog(page).locator('.browser-catalog-agent')).toHaveCount(2);
  await expect(catalog(page).locator('.browser-catalog-browser')).toHaveCount(3);
  await expect(catalogRun(page, naukri.id)).toContainText('Naukri matching roles');
  await expect(catalogRun(page, naukri.id)).toContainText('Platform engineer role');
  await expect(catalogRun(page, naukri.id)).toContainText('Tailored resume preview');
  await expect(catalogRun(page, hirist.id)).toContainText('Hirist technology roles');
  expect(state.captures).toEqual([]);
  await expect(catalog(page).locator('img')).toHaveCount(0);
  await catalogRun(page, naukri.id).getByRole('button', { name: 'Open preview for Naukri resume helper', exact: true }).click();
  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page).getByRole('img', { name: 'Agent browser screenshot', exact: true })).toHaveAttribute('src', frame);
  expect(state.captures[0]).toEqual({ id: naukri.id, browser: 'naukri-resume', tab: 'naukri-resume-tab' });
  await expect(viewer(page).getByRole('combobox', { name: 'Browser session', exact: true })).toHaveValue('naukri-resume');
  await expect(viewer(page).getByRole('combobox', { name: 'Browser tab', exact: true })).toHaveValue('naukri-resume-tab');
  await viewer(page).getByRole('button', { name: 'Back to all browsers', exact: true }).click();
  await expect(catalog(page)).toBeVisible();
  await expect(page.locator('#browser-viewer img[src]')).toHaveCount(0);
  await expect(catalog(page).locator('.browser-catalog-browser')).toHaveCount(3);
  await catalogRun(page, hirist.id).getByRole('button', { name: 'Open preview for Hirist applications', exact: true }).click();
  await expect(viewer(page).getByRole('img', { name: 'Agent browser screenshot', exact: true })).toBeVisible();
  expect(state.captures.at(-1)).toEqual({ id: hirist.id, browser: 'hirist-main', tab: 'hirist-roles' });
  const allowed = new Set([`${naukri.id}:naukri-resume`, `${hirist.id}:hirist-main`]);
  expect(state.captures.every(query => allowed.has(`${query.id}:${query.browser}`))).toBe(true);
  await noCommands(page, state);
});

test('an agent’s direct Watch browser control opens that agent even when another log is selected', async ({ page }) => {
  const state = await workspace(page);
  await roster(page).getByRole('button', { name: 'View activity for Naukri', exact: true }).click();
  await roster(page).getByRole('button', { name: 'Watch browser for Hirist', exact: true }).click();
  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page).locator('.browser-viewer-agent')).toHaveText('Hirist');
  await expect(viewer(page).getByRole('img', { name: 'Agent browser screenshot', exact: true })).toBeVisible();
  expect(state.captures[0].id).toBe(hirist.id);
  expect(state.captures.every(query => query.id === hirist.id)).toBe(true);
  await noCommands(page, state);
});

test('a busy targeted browser keeps its exact run, session and tab when the waiting response omits metadata', async ({ page }) => {
  const state = await workspace(page);
  await openCatalog(page);
  state.waitingCaptures = 1;
  await catalogRun(page, naukri.id).getByRole('button', { name: 'Open preview for Naukri resume helper', exact: true }).click();
  await expect(viewer(page)).toContainText('This selected browser is refreshing.');
  await expect(viewer(page).getByRole('img', { name: 'Agent browser screenshot', exact: true })).not.toBeVisible();
  const expected = { id: naukri.id, browser: 'naukri-resume', tab: 'naukri-resume-tab' };
  expect(state.captures).toEqual([expected]);
  await page.clock.fastForward(2100);
  await expect(viewer(page).getByRole('img', { name: 'Agent browser screenshot', exact: true })).toHaveAttribute('src', frame);
  expect(state.captures.length).toBeGreaterThan(1);
  for (const query of state.captures) expect(query).toEqual(expected);
  await expect(viewer(page).getByRole('combobox', { name: 'Browser session', exact: true })).toHaveValue('naukri-resume');
  await expect(viewer(page).getByRole('combobox', { name: 'Browser tab', exact: true })).toHaveValue('naukri-resume-tab');
  await noCommands(page, state);
});

test('waiting and unavailable agents have clear browser states and an empty roster never invents sessions', async ({ page }) => {
  const catalogData = { runs: [
    { ...naukri, browser_state: 'waiting', message: 'The application browser is still starting.', browsers: [] },
    { ...hirist, browser_state: 'unavailable', message: 'This container run cannot share a browser preview. Check Flows for details.', browsers: [] },
  ] };
  const state = await workspace(page, { catalogData });
  await openCatalog(page);
  await expect(catalogRun(page, naukri.id)).toContainText('Waiting for a browser');
  await expect(catalogRun(page, hirist.id)).toContainText('Browser preview unavailable');
  await expect(catalogRun(page, hirist.id)).toContainText('Check Flows for details');
  await expect(catalog(page).locator('.browser-catalog-browser')).toHaveCount(0);
  state.inventory = { runs: [] };
  await state.push({ ...initial, revision: 2, running: false, active_count: 0, runs: [], lines: [] });
  await page.clock.fastForward(5100);
  await expect(catalog(page)).toContainText('No agents are running');
  await expect(page.locator('.activity-agent-row')).toHaveCount(0);
  await expect(catalog(page).locator('.browser-catalog-agent')).toHaveCount(0);
  expect(state.captures).toEqual([]);
  await noCommands(page, state);
});

test('finished agents disappear from the roster and browser inventory while other agents keep running', async ({ page }) => {
  const state = await workspace(page);
  await openCatalog(page);
  await expect(catalog(page).locator('.browser-catalog-browser')).toHaveCount(3);
  state.inventory.runs = state.inventory.runs.filter(run => run.id === naukri.id);
  const completed = { ...hirist, running: false, status: 'completed', exit: 0, finished: at };
  await state.push({ ...initial, revision: 2, active_count: 1, runs: [naukri, completed], lines: [] });
  await page.clock.fastForward(5100);
  await expect(page.locator('.activity-agent-row')).toHaveCount(1);
  await expect(roster(page)).toContainText('Naukri');
  await expect(roster(page)).not.toContainText('Hirist');
  await expect(catalog(page).locator('.browser-catalog-agent')).toHaveCount(1);
  await expect(catalogRun(page, hirist.id)).toHaveCount(0);
  await expect(catalog(page).locator('.browser-catalog-browser')).toHaveCount(2);
  expect(state.captures).toEqual([]);
  await noCommands(page, state);
});

test('a late inventory cannot restore a run that has already been removed from live Activity', async ({ page }) => {
  const state = await workspace(page);
  await openCatalog(page);
  await expect(catalog(page).locator('.browser-catalog-agent')).toHaveCount(2);
  state.hold();
  await page.clock.fastForward(5100);
  await expect.poll(() => Boolean(state.held)).toBe(true);
  // The delayed server response still contains Hirist, while the newer live
  // Activity snapshot has already removed it entirely.
  await state.push({ ...initial, revision: 2, active_count: 1, runs: [naukri], lines: [] });
  await expect(page.locator('.activity-agent-row')).toHaveCount(1);
  await state.release();
  await expect.poll(() => page.evaluate(() => window.__activityBrowserRequests.filter(request => request.path === '/api/run/browsers').at(-1).pending)).toBe(false);
  await expect(catalog(page).locator('.browser-catalog-agent')).toHaveCount(1);
  await expect(catalogRun(page, hirist.id)).toHaveCount(0);
  await expect(roster(page)).not.toContainText('Hirist');
  expect(state.captures).toEqual([]);
  await noCommands(page, state);
});

test('metadata polling pauses while a screenshot viewer is open and resumes when returning to All browsers', async ({ page }) => {
  const state = await workspace(page);
  await openCatalog(page);
  await catalogRun(page, naukri.id).getByRole('button', { name: 'Open preview for Naukri resume helper', exact: true }).click();
  await expect(viewer(page).getByRole('img', { name: 'Agent browser screenshot', exact: true })).toBeVisible();
  const before = state.inventoryReads;
  await page.clock.fastForward(16000);
  expect(state.inventoryReads).toBe(before);
  expect(state.captures.every(query => query.id === naukri.id && query.browser === 'naukri-resume')).toBe(true);
  await viewer(page).getByRole('button', { name: 'Back to all browsers', exact: true }).click();
  await expect(catalog(page)).toBeVisible();
  await page.clock.fastForward(5100);
  await expect.poll(() => state.inventoryReads).toBeGreaterThan(before);
  const captures = state.captures.length;
  await page.clock.fastForward(5100);
  expect(state.captures).toHaveLength(captures);
  await noCommands(page, state);
});

test('collapsed Activity with a closed catalog aborts metadata work and prevents late content from reopening', async ({ page }) => {
  const state = await workspace(page);
  await openCatalog(page);
  state.hold();
  await page.clock.fastForward(5100);
  await expect.poll(() => Boolean(state.held)).toBe(true);
  const count = state.inventoryReads;
  await page.clock.fastForward(16000);
  expect(state.inventoryReads).toBe(count);
  await catalog(page).getByRole('button', { name: 'Close all browsers', exact: true }).click();
  await page.locator('.activity-launch').click();
  await expect(activity(page)).toHaveAttribute('data-size', 'collapsed');
  await expect.poll(() => page.evaluate(() => window.__activityBrowserRequests.filter(request => request.path === '/api/run/browsers').at(-1).aborted)).toBe(true);
  await state.release();
  await page.clock.fastForward(16000);
  expect(state.inventoryReads).toBe(count);
  await expect(catalog(page)).not.toBeVisible();
  await expect(page.locator('#browser-catalog .browser-catalog-browser')).toHaveCount(0);
  await expect(page.locator('#browser-catalog')).not.toContainText('Tailored resume preview');
  expect(state.captures).toEqual([]);
  await noCommands(page, state);
});

test('hidden tabs stop inventory polling and becoming visible resumes metadata without taking screenshots', async ({ page }) => {
  const state = await workspace(page);
  await openCatalog(page);
  await expect(catalog(page).locator('.browser-catalog-browser')).toHaveCount(3);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const count = state.inventoryReads;
  await page.clock.fastForward(16000);
  expect(state.inventoryReads).toBe(count);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => state.inventoryReads).toBeGreaterThan(count);
  expect(state.captures).toEqual([]);
  await noCommands(page, state);
});

test('changing accounts closes the catalog, clears private session names and discards a late inventory response', async ({ page }) => {
  const state = await workspace(page, { account: true });
  await openCatalog(page);
  await expect(catalog(page)).toContainText('Tailored resume preview');
  state.hold();
  await page.clock.fastForward(5100);
  await expect.poll(() => Boolean(state.held)).toBe(true);
  state.signOut();
  await page.evaluate(() => window.dispatchEvent(new Event('account-expired')));
  await expect(page).toHaveURL(/#\/login$/);
  await expect(catalog(page)).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__activityBrowserRequests.filter(request => request.path === '/api/run/browsers').at(-1).aborted)).toBe(true);
  await state.release();
  await page.clock.fastForward(16000);
  await expect(page.locator('#browser-catalog')).not.toContainText('Tailored resume preview');
  await expect(page.locator('#browser-catalog .browser-catalog-agent')).toHaveCount(0);
  await expect(page.locator('.activity-agent-row')).toHaveCount(0);
  await expect(catalog(page)).not.toBeVisible();
  expect(state.captures).toEqual([]);
  await noCommands(page, state);
});

test('the roster and browser catalog fit mobile and desktop with accessible controls', async ({ page }) => {
  const state = await workspace(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mkdir('artifacts/activity-browsers', { recursive: true });
  for (const [width, height] of [[1280, 812], [375, 812], [375, 667]]) {
    await page.setViewportSize({ width, height });
    await roster(page).getByRole('button', { name: 'View activity for Hirist', exact: true }).scrollIntoViewIfNeeded();
    await expect(roster(page).getByRole('button', { name: 'View activity for Hirist', exact: true })).toBeInViewport({ ratio: 1 });
    await roster(page).getByRole('button', { name: 'View activity for Hirist', exact: true }).click({ trial: true });
    await activity(page).getByRole('button', { name: 'Stop', exact: true }).click({ trial: true });
    const sheet = await activity(page).boundingBox();
    expect(sheet.x).toBeGreaterThanOrEqual(0);
    expect(sheet.y).toBeGreaterThanOrEqual(0);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(width);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(height);
    const size = height === 812 ? String(width) : `${width}x${height}`;
    await activity(page).screenshot({ path: `artifacts/activity-browsers/roster-${size}.png`, animations: 'disabled' });
    const rosterAudit = await new AxeBuilder({ page }).include('.activity-console').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(rosterAudit.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target).join(', ')}`)).toEqual([]);
    await openCatalog(page);
    await expect(catalog(page).locator('.browser-catalog-browser')).toHaveCount(3);
    const bounds = await catalog(page).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    await expect(catalog(page).getByRole('button', { name: 'Close all browsers', exact: true })).toBeInViewport({ ratio: 1 });
    await catalog(page).screenshot({ path: `artifacts/activity-browsers/catalog-${size}.png`, animations: 'disabled' });
    const report = await new AxeBuilder({ page }).include('#browser-catalog').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(report.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target).join(', ')}`)).toEqual([]);
    await catalog(page).getByRole('button', { name: 'Close all browsers', exact: true }).click();
  }
  expect(errors).toEqual([]);
  expect(state.captures).toEqual([]);
  await noCommands(page, state);
});
