import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';

const at = '2026-10-24T10:30:00+05:30';
const learning = {id: 'learn-one', label: 'Learning assistant', action: 'pipeline', shown: 'python -m pipeline run --only learn', running: true, stopping: false, status: 'running', seconds: 12, started_at: '2026-10-24T10:30:01+05:30', resources: []};
const research = {id: 'research-one', label: 'Resume researcher', action: 'pipeline', shown: 'python -m pipeline run --only research', running: true, stopping: false, status: 'running', seconds: 14, started_at: at, resources: []};
const initial = {epoch: 'activity-test', revision: 1, next: 2, running: true, label: learning.label, seconds: 12, stopping: false, last: null, runs: [learning, research], lines: [[0, 'Writing daily lesson with the AI CLI.', learning.id, at], [1, 'Sign-in required. Review your platform session.', research.id, at]]};

async function fixture(page) {
  const state = {snapshot: structuredClone(initial), stops: [], statusReads: 0, polls: 0};
  await page.addInitScript(snapshot => {
    window.__activitySnapshot = JSON.parse(sessionStorage.getItem('activity-test-snapshot') || 'null') || snapshot;
    window.__activitySources = [];
    class FakeEventSource extends EventTarget {
      constructor(url, options) {
        super(); this.url = url; this.withCredentials = options?.withCredentials; this.closed = false;
        window.__activitySources.push(this);
        queueMicrotask(() => { if (!this.closed) this.dispatchEvent(new MessageEvent('run', {data: JSON.stringify(window.__activitySnapshot)})); });
      }
      close() { this.closed = true; }
    }
    window.EventSource = FakeEventSource;
    window.sendActivity = snapshot => {
      window.__activitySnapshot = snapshot;
      sessionStorage.setItem('activity-test-snapshot', JSON.stringify(snapshot));
      window.__activitySources.at(-1).dispatchEvent(new MessageEvent('run', {data: JSON.stringify(snapshot)}));
    };
  }, state.snapshot);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') {
      if (path === '/api/stop') { state.stops.push(route.request().postDataJSON()); return route.fulfill({json: {ok: true, message: 'Stopping the selected agent.'}}); }
      return route.fulfill({status: 409, json: {error: 'Test guard: no real action was executed.'}});
    }
    if (path === '/api/session') return route.fulfill({json: {mode: 'local', user: null, legacy_access: true}});
    if (path === '/api/meta') return route.fulfill({json: {files: {}, answer_modes: [], linkedin_modes: []}});
    if (path === '/api/status') { state.statusReads++; return route.fulfill({json: {name: 'Demo workspace', greeting: 'Hello', date: '2026-10-24', date_long: '24 October 2026', report: {ready: false, days: []}, questions: [], facts: [], sites: [], study: {today: 0, read: 0, total: 0}, run: {...state.snapshot, lines: []}}}); }
    if (path === '/api/course') return route.fulfill({json: {today: 0, read: 0, total: 0, modules: []}});
    if (path === '/api/bots') return route.fulfill({json: {bots: [{id: 'learn', running: true}, {id: 'research', running: true}], run: state.snapshot}});
    if (path === '/api/run') { state.polls++; return route.fulfill({json: state.snapshot}); }
    if (path === '/api/run/browsers') return route.fulfill({json: {runs: state.snapshot.runs.filter(run => run.running).map(run => ({...run, browser_state: 'waiting', message: 'Waiting for a browser', browsers: []}))}});
    return route.fulfill({json: {}});
  });
  state.push = async snapshot => { state.snapshot = snapshot; await page.evaluate(value => window.sendActivity(value), snapshot); };
  return state;
}

async function openActivity(page) {
  await page.goto('/#/bots');
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  await expect(page.getByRole('combobox', {name: 'Agent run', exact: true})).toBeVisible();
}

test('live activity isolates parallel agent logs, stops only the selected agent, and restores after refresh', async ({page}) => {
  const state = await fixture(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await openActivity(page);
  const picker = page.getByRole('combobox', {name: 'Agent run', exact: true});
  const progress = page.getByRole('log', {name: 'Run progress', exact: true});
  await expect(page.locator('.activity-caption')).toContainText('2 agents working');
  await expect(progress).toContainText('Preparing your content');
  await expect(progress).not.toContainText('Sign-in required');
  await page.getByText('Technical details · 1 line', {exact: true}).click();
  const raw = page.getByRole('log', {name: 'Run output', exact: true});
  await expect(raw).toContainText('Writing daily lesson');
  await picker.selectOption(research.id);
  await expect(progress).toContainText('Sign-in required');
  await expect(raw).toContainText('Sign-in required');
  await expect(raw).not.toContainText('Writing daily lesson');
  await picker.focus();
  await state.push({...state.snapshot, revision: 2, lines: [], runs: [{...learning, seconds: 22}, {...research, seconds: 24}]});
  await expect(picker).toBeFocused();
  await expect(page.locator('.activity-details')).toHaveAttribute('open', '');
  await page.getByRole('button', {name: 'Stop', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('Other agents will keep running');
  await page.getByRole('dialog').getByRole('button', {name: 'Stop', exact: true}).click();
  await expect.poll(() => state.stops).toEqual([{id: research.id}]);
  const finished = {...research, running: false, status: 'stopped', stopped: true, exit: 130, finished: '2026-10-24T10:30:25+05:30'};
  await state.push({...state.snapshot, revision: 3, next: 3, runs: [learning, finished], lines: [[2, '○ Resume researcher — stopped (24s)', research.id, finished.finished]]});
  await expect(page.locator('.activity-state')).toHaveText('Stopped');
  await expect(page.getByRole('button', {name: 'Stop', exact: true})).not.toBeVisible();
  await expect(page.locator('.activity-caption')).toContainText('Learning assistant');
  await expect.poll(() => state.statusReads).toBeGreaterThan(1);
  await picker.selectOption(learning.id);
  await expect(page.locator('.activity-state')).toHaveText('Running');
  const restored = {...state.snapshot, lines: [...initial.lines, ...state.snapshot.lines]};
  await state.push(restored);
  await page.reload();
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  await expect(page.locator('.activity-state')).toHaveText('Running');
  await expect(progress).toContainText('Preparing your content');
  expect(state.polls).toBe(0);
  expect(errors).toEqual([]);
});

test('activity keeps progress visible while reconnecting and fits mobile and desktop accessibly', async ({page}) => {
  await fixture(page);
  await openActivity(page);
  await page.evaluate(() => window.__activitySources.at(-1).dispatchEvent(new Event('error')));
  await expect(page.locator('.activity-connection')).toHaveText('Reconnecting…');
  await expect(page.getByRole('log', {name: 'Run progress', exact: true})).toContainText('Preparing your content');
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  await mkdir('artifacts/activity', {recursive: true});
  for (const width of [1280, 375]) {
    await page.setViewportSize({width, height: 812});
    await expect(page.locator('.activity-console')).toBeInViewport();
    const box = await page.locator('.activity-console').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(812);
    await page.locator('.activity-console').screenshot({path: `artifacts/activity/parallel-${width}.png`, animations: 'disabled'});
    const result = await new AxeBuilder({page}).include('.activity-console').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target).join(', ')}`)).toEqual([]);
  }
});

test('retained-output notices survive heartbeats and changing accounts cancels pending stop confirmation', async ({page}) => {
  const state = await fixture(page);
  await openActivity(page);
  await state.push({...state.snapshot, revision: 2, truncated: true, first: 1, lines: []});
  await expect(page.locator('.activity-retention')).toBeVisible();
  await state.push({...state.snapshot, revision: 3, truncated: false, lines: []});
  await expect(page.locator('.activity-retention')).toBeVisible();
  await page.getByRole('button', {name: 'Stop', exact: true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.__activitySources.at(-1).dispatchEvent(new Event('access-revoked')));
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  expect(state.stops).toEqual([]);
});
