import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

// Synthetic screenshots and intercepted API requests only. This suite never
// starts an agent, opens Chrome for an agent, or visits a third-party site.
const capturedAt = '2026-10-24T11:30:00+05:30';
const purpleFrame = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAABJklEQVR4nO3dsU0EURAFwUmNOEgWG5MAMM49GyQ8kri/s2qVVAE8qb1xZt7fPgib9QUcNesLOGrWF3DUrC/gqFlfwFGzvoCjZn0BR836Ao6a9QUcNesLOGrWF3DUrC/gqPl+PA/5+f1jncBxAscJHCdwnMBxAscJHCdwnMBxAsctBP78evBaAscJHCdwnMBxAscJHHevwFxJ4DiB4wSOEzhO4DiB4wSOEzhO4DinygKB4wSOEzhO4DiB4+4VmCsJHCdwnMBxAscJHCdwnMBxAscJHCdwnFt0gcBxAscJHCdwnMBx9wrMlQSOEzhO4DiB4wSOEzhO4DiB4wS+1KEPlALfhcBxAscJHCdwnMBxAscJHCcwLyZwnMBxAscJHCdwnMBxAsf9A4X2RvLaAS2lAAAAAElFTkSuQmCC';
const greenFrame = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAABEElEQVR4nO3dsQ3CQBBFQXdBk5RBdYQUQODUMUhkNGHfnZ5GmgJWetlPdrs97oRt0y/gUgLHCRwncJzAcQLHCRwncJzAcQLHCRwncNz23o+LfL4/phM4TuA4geMEjhM4TuA4geMEjhM4TuC4CYGfr51zCRwncJzAcQLHCRwncNxagRlJ4DiB4wSOEzhO4DiB4wSOEzhO4DhTZYHAcQLHCRwncJzAcWsFZiSB4wSOEzhO4DiB4wSOEzhO4DiB4wSOs0UXCBwncJzAcQLHCRy3VmBGEjhO4DiB4wSOEzhO4DiB4wSOE3ioiz5QCrwKgeMEjhM4TuA4geMEjhM4TmBOJnCcwHECxwkcJ3CcwHECx/0Bpb09fDrWBx4AAAAASUVORK5CYII=';
const naukri = { id: 'naukri-browser-fixture', label: 'Naukri', action: 'naukri', shown: 'python naukri_bot.py', running: true, status: 'running', stopping: false, seconds: 12, browser_mode: 'background', started_at: '2026-10-24T11:29:50+05:30', resources: ['browser:naukri'] };
const hirist = { id: 'hirist-browser-fixture', label: 'Hirist', action: 'boards', shown: 'python boards_bot.py --site hirist', running: true, status: 'running', stopping: false, seconds: 14, browser_mode: 'background', started_at: '2026-10-24T11:29:48+05:30', resources: ['browser:hirist'] };
const initial = { epoch: 'browser-viewer-test', revision: 1, next: 2, active_count: 2, running: true, label: 'Naukri', seconds: 12, stopping: false, last: null, runs: [naukri, hirist], lines: [[0, 'Reviewing matching roles.', naukri.id, capturedAt], [1, 'Opening matching roles.', hirist.id, capturedAt]] };

function readyFrame(query) {
  const isHirist = query.id === hirist.id;
  const browser = query.browser || 'primary';
  const tabs = browser === 'helper'
    ? [{ id: 'resume', title: 'Resume preview', site: 'example.test' }]
    : [{ id: 'roles', title: isHirist ? 'Hirist roles' : 'Naukri roles', site: isHirist ? 'hirist.example.test' : 'naukri.example.test' }, { id: 'details', title: 'Role details', site: 'jobs.example.test' }];
  const tab = tabs.find(item => item.id === query.tab) || tabs[0];
  return {
    state: 'ready', run_id: query.id, label: isHirist ? 'Hirist' : 'Naukri',
    browsers: [{ id: 'primary', label: 'Application browser' }, { id: 'helper', label: 'Resume browser' }],
    browser_id: browser, tabs, tab_id: tab.id, title: tab.title, site: tab.site,
    image: isHirist || browser === 'helper' || tab.id === 'details' ? greenFrame : purpleFrame, captured_at: capturedAt,
  };
}

async function workspace(page, { account = false } = {}) {
  const state = { reads: [], denied: [], held: null, holdNext: false, response: null, snapshot: structuredClone(initial) };
  let session = account ? {
    mode: 'accounts', legacy_access: true,
    user: { id: 'viewer-owner', name: 'Viewer Owner', email: 'viewer@example.test', role: 'admin', plan_name: 'Pro', modules: [] },
  } : { mode: 'local', legacy_access: true, user: null };
  await page.addInitScript(snapshot => {
    window.__viewerSources = [];
    class FixtureEventSource extends EventTarget {
      constructor(url) {
        super(); this.url = url; this.closed = false;
        window.__viewerSources.push(this);
        queueMicrotask(() => this.send(snapshot));
      }
      send(value) { if (!this.closed) this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(value) })); }
      close() { this.closed = true; }
    }
    window.EventSource = FixtureEventSource;
    window.__viewerFetches = [];
    const request = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (url.pathname !== '/api/run/browser') return request(input, options);
      const entry = { url: url.href, aborted: false, pending: true };
      window.__viewerFetches.push(entry);
      options?.signal?.addEventListener('abort', () => { entry.aborted = true; }, { once: true });
      return request(input, options).finally(() => { entry.pending = false; });
    };
    window.__viewerOpenedUrls = [];
    window.open = (...args) => { window.__viewerOpenedUrls.push(args); return null; };
  }, state.snapshot);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (method !== 'GET') {
      state.denied.push(`${method} ${url.pathname}`);
      return route.fulfill({ status: 409, json: { error: 'Synthetic test guard: no action was executed.' } });
    }
    if (url.pathname === '/api/run/browser') {
      const query = Object.fromEntries(url.searchParams); state.reads.push(query);
      if (![naukri.id, hirist.id].includes(query.id)) return route.fulfill({ status: 404, json: { error: 'Unknown synthetic run.' } });
      if (state.holdNext) { state.holdNext = false; state.held = { route, query }; return; }
      const reply = typeof state.response === 'function' ? state.response(query) : state.response;
      return route.fulfill(reply || { json: readyFrame(query) });
    }
    const replies = {
      '/api/session': session,
      '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
      '/api/status': { name: 'Synthetic workspace', greeting: 'Hello', date: '2026-10-24', date_long: '24 October 2026', run: state.snapshot, questions: [], facts: [], sites: [], study: { today: 0, read: 0, total: 0 }, report: { ready: false, days: [] } },
      '/api/course': { today: 0, read: 0, total: 0, lessons: [], modules: [] },
      '/api/bots': { bots: [{ id: 'naukri', running: true }, { id: 'hirist', running: true }], run: state.snapshot },
      '/api/run': state.snapshot,
      '/api/run/browsers': { runs: state.snapshot.runs.filter(run => run.running).map(run => ({
        ...run, browser_state: 'ready', message: '', browsers: readyFrame({ id: run.id }).browsers.map(browser => ({
          ...browser, state: 'ready', tabs: readyFrame({ id: run.id, browser: browser.id }).tabs,
        })),
      })) },
      '/api/v1/auth/options': { provider: 'local', google: false },
    };
    return Object.hasOwn(replies, url.pathname) ? route.fulfill({ json: replies[url.pathname] })
      : route.fulfill({ status: 404, json: { error: `No synthetic fixture for ${url.pathname}` } });
  });
  state.hold = () => { state.holdNext = true; };
  state.release = async () => {
    const pending = state.held; state.held = null;
    await pending.route.fulfill({ json: readyFrame(pending.query) });
  };
  state.signOut = () => { session = { mode: 'accounts', legacy_access: false, user: null }; };
  state.push = async value => { state.snapshot = value; await page.evaluate(snapshot => window.__viewerSources.at(-1).send(snapshot), value); };
  await page.goto('/#/bots');
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  await expect(page.getByRole('combobox', { name: 'Agent run', exact: true })).toBeVisible();
  await page.clock.install({ time: new Date(capturedAt) });
  return state;
}

const viewer = page => page.getByRole('dialog', { name: 'Browser view', exact: true });
const screenshot = page => viewer(page).getByRole('img', { name: 'Agent browser screenshot', exact: true });
async function watch(page, id = naukri.id) {
  await page.getByRole('combobox', { name: 'Agent run', exact: true }).selectOption(id);
  await page.getByRole('button', { name: 'Watch browser', exact: true }).click();
  await expect(viewer(page)).toBeVisible();
}
async function tick(page, milliseconds = 2100) { await page.clock.fastForward(milliseconds); }
async function assertNoActions(page, state) {
  expect(state.denied).toEqual([]);
  expect(await page.evaluate(() => window.__viewerOpenedUrls)).toEqual([]);
}

test('browser view shows the selected run’s actual image and keeps parallel runs, browsers and tabs separate', async ({ page }) => {
  const state = await workspace(page);
  await watch(page);
  await expect(screenshot(page)).toHaveAttribute('src', purpleFrame);
  await expect.poll(() => screenshot(page).evaluate(image => image.complete && image.naturalWidth)).toBe(160);
  await expect(viewer(page).locator('.browser-viewer-agent')).toContainText('Naukri');
  expect(state.reads[0].id).toBe(naukri.id);
  await viewer(page).getByRole('combobox', { name: 'Browser tab', exact: true }).selectOption('details');
  await expect.poll(() => state.reads.at(-1)).toMatchObject({ id: naukri.id, browser: 'primary', tab: 'details' });
  await expect(viewer(page)).toContainText('Role details');
  await viewer(page).getByRole('combobox', { name: 'Browser session', exact: true }).selectOption('helper');
  await expect.poll(() => state.reads.at(-1)).toMatchObject({ id: naukri.id, browser: 'helper' });
  await expect(viewer(page)).toContainText('Resume preview');
  await viewer(page).getByRole('button', { name: 'Close browser view', exact: true }).click();
  await watch(page, hirist.id);
  await expect(screenshot(page)).toHaveAttribute('src', greenFrame);
  await expect.poll(() => screenshot(page).evaluate(image => image.complete && image.naturalWidth)).toBe(160);
  await expect(viewer(page).locator('.browser-viewer-agent')).toContainText('Hirist');
  expect(state.reads.at(-1).id).toBe(hirist.id);
  await expect(viewer(page)).not.toContainText('Naukri roles');
  await assertNoActions(page, state);
});

test('waiting for an agent browser shows no invented frame and becomes ready on a later capture', async ({ page }) => {
  const state = await workspace(page);
  state.response = { json: { state: 'waiting', message: 'Waiting for the agent’s browser…', browsers: [], tabs: [] } };
  await watch(page);
  await expect(viewer(page)).toContainText('Waiting for the agent’s browser');
  await expect(screenshot(page)).not.toBeVisible();
  state.response = null;
  await tick(page);
  await expect(screenshot(page)).toHaveAttribute('src', purpleFrame);
  await expect(screenshot(page)).toBeVisible();
  await assertNoActions(page, state);
});

test('an unavailable browser explains the limitation without displaying a placeholder as a real screenshot', async ({ page }) => {
  const state = await workspace(page);
  state.response = { json: { state: 'unavailable', message: 'This agent has not shared a browser preview.', browsers: [], tabs: [] } };
  await watch(page);
  await expect(viewer(page).locator('.browser-viewer-status')).toHaveText('Preview unavailable');
  await expect(viewer(page)).toContainText('This agent has not shared a browser preview.');
  await expect(screenshot(page)).not.toBeVisible();
  await expect(viewer(page).locator('.browser-viewer-time')).toHaveText('No preview captured yet');
  const count = state.reads.length;
  await tick(page, 10000);
  expect(state.reads).toHaveLength(count);
  await assertNoActions(page, state);
});

test('switching tabs aborts a pending capture and its late frame cannot overwrite the newly selected tab', async ({ page }) => {
  const state = await workspace(page);
  await watch(page);
  await expect(screenshot(page)).toHaveAttribute('src', purpleFrame);
  state.hold();
  await tick(page);
  await expect.poll(() => Boolean(state.held)).toBe(true);
  const staleFetch = await page.evaluate(() => window.__viewerFetches.length - 1);
  await viewer(page).getByRole('combobox', { name: 'Browser tab', exact: true }).selectOption('details');
  await expect.poll(() => page.evaluate(index => window.__viewerFetches[index].aborted, staleFetch)).toBe(true);
  await expect(screenshot(page)).toHaveAttribute('src', greenFrame);
  await state.release();
  await expect.poll(() => page.evaluate(index => window.__viewerFetches[index].pending, staleFetch)).toBe(false);
  await expect(viewer(page).getByRole('combobox', { name: 'Browser tab', exact: true })).toHaveValue('details');
  await expect(screenshot(page)).toHaveAttribute('src', greenFrame);
  await expect(viewer(page).locator('.browser-viewer-site')).toContainText('Role details');
  await assertNoActions(page, state);
});

test('reopening the same run fetches a fresh frame instead of restoring a cached screenshot', async ({ page }) => {
  const state = await workspace(page);
  await watch(page);
  await expect(screenshot(page)).toHaveAttribute('src', purpleFrame);
  await viewer(page).getByRole('button', { name: 'Close browser view', exact: true }).click();
  const count = state.reads.length;
  state.response = query => ({ json: { ...readyFrame(query), image: greenFrame, captured_at: '2026-10-24T11:30:05+05:30' } });
  await watch(page);
  await expect(screenshot(page)).toHaveAttribute('src', greenFrame);
  expect(state.reads.length).toBeGreaterThan(count);
  expect(state.reads.at(-1).id).toBe(naukri.id);
  await assertNoActions(page, state);
});

test('an external image URL is rejected rather than fetched or presented as an agent capture', async ({ page }) => {
  const state = await workspace(page);
  const external = [];
  await page.route('https://outside.example.test/**', async route => {
    external.push(route.request().url());
    await route.fulfill({ status: 403, body: 'Synthetic guard: external images are not allowed.' });
  });
  state.response = query => ({ json: { ...readyFrame(query), image: 'https://outside.example.test/private-capture.png' } });
  await watch(page);
  await expect(viewer(page).locator('.browser-viewer-status')).toHaveText('Preview delayed');
  await expect(screenshot(page)).not.toBeVisible();
  await expect(page.locator('#browser-viewer img[src]')).toHaveCount(0);
  expect(external).toEqual([]);
  await assertNoActions(page, state);
});

test('a delayed capture keeps its last image and timestamp while clearly reporting that it is not live', async ({ page }) => {
  const state = await workspace(page);
  await watch(page);
  await expect(screenshot(page)).toHaveAttribute('src', purpleFrame);
  const time = await viewer(page).locator('.browser-viewer-time').textContent();
  state.response = { status: 503, json: { error: 'The browser capture timed out.' } };
  await tick(page);
  await expect(viewer(page).locator('.browser-viewer-status')).toContainText('Preview delayed');
  await expect(viewer(page).locator('.browser-viewer-status')).not.toContainText(/live/i);
  await expect(screenshot(page)).toHaveAttribute('src', purpleFrame);
  await expect(viewer(page).locator('.browser-viewer-time')).toHaveText(time);
  await assertNoActions(page, state);
});

test('closing the browser view aborts its current capture, clears the image and stops refreshing', async ({ page }) => {
  const state = await workspace(page);
  await watch(page);
  await expect(screenshot(page)).toHaveAttribute('src', purpleFrame);
  state.hold();
  await tick(page);
  await expect.poll(() => Boolean(state.held)).toBe(true);
  const count = state.reads.length;
  await viewer(page).getByRole('button', { name: 'Close browser view', exact: true }).click();
  await expect(viewer(page)).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__viewerFetches.at(-1).aborted)).toBe(true);
  await state.release();
  await tick(page, 10000);
  expect(state.reads).toHaveLength(count);
  await expect(page.locator('#browser-viewer img[src^="data:image/"]')).toHaveCount(0);
  await expect(viewer(page)).not.toBeVisible();
  await assertNoActions(page, state);
});

test('account expiration purges the private screenshot and a late capture cannot reopen it', async ({ page }) => {
  const state = await workspace(page, { account: true });
  await watch(page);
  await expect(screenshot(page)).toHaveAttribute('src', purpleFrame);
  state.hold();
  await tick(page);
  await expect.poll(() => Boolean(state.held)).toBe(true);
  state.signOut();
  await page.evaluate(() => window.dispatchEvent(new Event('account-expired')));
  await expect(page).toHaveURL(/#\/login$/);
  await expect(viewer(page)).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__viewerFetches.at(-1).aborted)).toBe(true);
  await state.release();
  await tick(page, 10000);
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await expect(page.locator('#browser-viewer img[src^="data:image/"]')).toHaveCount(0);
  await expect(viewer(page)).not.toBeVisible();
  await assertNoActions(page, state);
});

test('hidden tabs pause captures and visibility resumes the same selected browser', async ({ page }) => {
  const state = await workspace(page);
  await watch(page, hirist.id);
  await expect(screenshot(page)).toHaveAttribute('src', greenFrame);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const count = state.reads.length;
  await tick(page, 10000);
  expect(state.reads).toHaveLength(count);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => state.reads.length).toBeGreaterThan(count);
  expect(state.reads.at(-1).id).toBe(hirist.id);
  await expect(screenshot(page)).toHaveAttribute('src', greenFrame);
  await assertNoActions(page, state);
});

test('a finished run freezes its final screenshot instead of continuing to claim live progress', async ({ page }) => {
  const state = await workspace(page);
  await watch(page);
  await expect(screenshot(page)).toHaveAttribute('src', purpleFrame);
  state.response = { json: { state: 'finished', message: 'The agent run has finished.', browsers: [], tabs: [] } };
  await tick(page);
  await expect(viewer(page).locator('.browser-viewer-status')).toContainText('Run finished');
  await expect(screenshot(page)).toHaveAttribute('src', purpleFrame);
  const count = state.reads.length;
  await tick(page, 10000);
  expect(state.reads).toHaveLength(count);
  await assertNoActions(page, state);
});

test('the browser dialog is centered, usable on desktop and mobile, and accessible', async ({ page }) => {
  const state = await workspace(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await watch(page);
  await expect(screenshot(page)).toHaveAttribute('src', purpleFrame);
  await mkdir('artifacts/browser-viewer', { recursive: true });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    const bounds = await viewer(page).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(812);
    expect(Math.abs(bounds.x + bounds.width / 2 - width / 2)).toBeLessThanOrEqual(2);
    await expect(viewer(page).getByRole('button', { name: 'Close browser view', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(viewer(page).getByRole('combobox', { name: 'Browser tab', exact: true })).toBeInViewport({ ratio: 1 });
    await viewer(page).screenshot({ path: `artifacts/browser-viewer/viewer-${width}.png`, animations: 'disabled' });
    const report = await new AxeBuilder({ page }).include('#browser-viewer').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(report.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target).join(', ')}`)).toEqual([]);
  }
  expect(errors).toEqual([]);
  await assertNoActions(page, state);
});
