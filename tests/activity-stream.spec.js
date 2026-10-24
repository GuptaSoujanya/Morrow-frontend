import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';

const at = '2026-10-24T10:30:00+05:30';
const learning = {id: 'learn-one', label: 'Learning assistant', action: 'pipeline', shown: 'python -m pipeline run --only learn', running: true, stopping: false, status: 'running', seconds: 12, started_at: '2026-10-24T10:30:01+05:30', resources: []};
const research = {id: 'research-one', label: 'Resume researcher', action: 'pipeline', shown: 'python -m pipeline run --only research', running: true, stopping: false, status: 'running', seconds: 14, started_at: at, resources: []};
const initial = {epoch: 'activity-test', revision: 1, next: 2, running: true, label: learning.label, seconds: 12, stopping: false, last: null, runs: [learning, research], lines: [[0, 'Writing daily lesson with the AI CLI.', learning.id, at], [1, 'Sign-in required. Review your platform session.', research.id, at]]};

async function fixture(page) {
  const state = {snapshot: structuredClone(initial), stops: [], statusReads: 0, polls: 0, runFailure: false};
  await page.addInitScript(snapshot => {
    window.__activitySnapshot = JSON.parse(sessionStorage.getItem('activity-test-snapshot') || 'null') || snapshot;
    window.__activitySources = [];
    window.__activityReconnect = true;
    class FakeEventSource extends EventTarget {
      constructor(url, options) {
        super(); this.url = url; this.withCredentials = options?.withCredentials; this.closed = false;
        window.__activitySources.push(this);
        queueMicrotask(() => { if (!this.closed && (window.__activitySources.length === 1 || window.__activityReconnect)) this.dispatchEvent(new MessageEvent('run', {data: JSON.stringify(window.__activitySnapshot)})); });
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
    if (path === '/api/run') {
      state.polls++;
      return state.runFailure ? route.fulfill({status: 503, json: {error: 'Synthetic activity connection unavailable.'}}) : route.fulfill({json: state.snapshot});
    }
    if (path === '/api/run/browsers') return route.fulfill({json: {runs: state.snapshot.runs.filter(run => run.running).map(run => ({...run, open_browser_count: 0, count_status: 'ready'}))}});
    if (path === '/api/connections') return route.fulfill({json: {scope: 'main', scopes: [{id: 'main', label: 'Main browser'}], connections: [], browser_available: true}});
    return route.fulfill({json: {}});
  });
  state.push = async snapshot => { state.snapshot = snapshot; await page.evaluate(value => window.sendActivity(value), snapshot); };
  state.disconnect = () => page.evaluate(() => {
    window.__activityReconnect = false;
    window.__activitySources.at(-1).dispatchEvent(new Event('error'));
  });
  return state;
}

async function openActivity(page) {
  await page.goto('/#/bots');
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  if (await page.locator('.activity-console').getAttribute('data-size') === 'collapsed') await page.locator('.activity-launch').click();
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
  expect(state.polls).toBe(0);
  await page.getByRole('button', {name: 'Stop', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('Other agents will keep running');
  await page.getByRole('dialog').getByRole('button', {name: 'Stop', exact: true}).click();
  await expect.poll(() => state.stops).toEqual([{id: research.id}]);
  // Stop explicitly reconciles runner metadata; healthy SSE adds no polling.
  await expect.poll(() => state.polls).toBe(1);
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
  if (await page.locator('.activity-console').getAttribute('data-size') === 'collapsed') await page.locator('.activity-launch').click();
  await expect(page.locator('.activity-state')).toHaveText('Running');
  await expect(progress).toContainText('Preparing your content');
  expect(state.polls).toBe(1);
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

const activity = page => page.getByRole('region', {name: 'Activity', exact: true});
const roster = page => page.locator('.activity-agent-roster');
const runPicker = page => page.getByRole('combobox', {name: 'Agent run', exact: true});
const activityTab = (page, name) => activity(page).getByRole('tab', {name: new RegExp(`^${name}`)});
function terminalSnapshot(state, status) {
  return {...state.snapshot, revision: state.snapshot.revision + 1, lines: [], runs: [
    {...learning, seconds: 24},
    {...research, running: false, stopping: false, status, stopped: status === 'stopped', exit: status === 'completed' ? 0 : status === 'stopped' ? 130 : 1, finished: '2026-10-24T10:30:25+05:30'},
  ]};
}

for (const [status, label] of [['stopped', 'Stopped'], ['failed', 'Needs attention'], ['completed', 'Completed']]) {
  test(`a selected ${status} agent leaves the active roster while another run keeps working`, async ({page}) => {
    await page.clock.install();
    const state = await fixture(page);
    await openActivity(page);
    await runPicker(page).selectOption(research.id);
    await expect(page.locator('.activity-state')).toHaveText('Running');
    await state.push(terminalSnapshot(state, status));
    await expect(page.locator('.activity-state')).toHaveText(label);
    await expect(runPicker(page)).toHaveValue(research.id);
    await expect(runPicker(page).locator('option:checked')).toContainText(label);
    await expect(activity(page).getByRole('button', {name: 'Stop', exact: true})).not.toBeVisible();
    await expect(activity(page).getByRole('button', {name: 'Open browser', exact: true})).not.toBeVisible();
    await activityTab(page, 'Agents').click();
    await expect(roster(page).locator('[data-run-id]')).toHaveCount(1);
    await expect(roster(page).locator(`[data-run-id="${research.id}"]`)).toHaveCount(0);
    await expect(roster(page).locator(`[data-run-id="${learning.id}"]`)).toContainText('Running');
    await expect(page.locator('.activity-caption')).toContainText('Learning assistant');
    if (status !== 'completed') {
      await activityTab(page, 'Progress').click();
      await mkdir('artifacts/activity-status', {recursive: true});
      for (const [width, height] of [[1280, 812], [375, 667]]) {
        await page.setViewportSize({width, height});
        await page.locator('.activity-summary').screenshot({path: `artifacts/activity-status/${status}-${width}.png`, animations: 'disabled'});
      }
      await activityTab(page, 'Agents').click();
    }
    // Losing the connection afterward must not downgrade a known outcome.
    state.runFailure = true;
    await state.disconnect();
    await expect(roster(page).locator(`[data-run-id="${learning.id}"]`)).toContainText('Status unknown');
    await activityTab(page, 'Progress').click();
    await expect(page.locator('.activity-state')).toHaveText(label);
    await expect(page.locator('.console-dot')).not.toHaveClass(/\blive\b/);
    expect(state.stops).toEqual([]);
  });
}

for (const [connection, status, label] of [['reconnecting', 'stopped', 'Stopped'], ['offline', 'failed', 'Needs attention']]) {
  test(`${connection} activity marks the last active run unknown until its ${status} result arrives`, async ({page}) => {
    await page.clock.install();
    const state = await fixture(page);
    await openActivity(page);
    await runPicker(page).selectOption(research.id);
    state.runFailure = true;
    await state.disconnect();
    await expect(page.locator('.activity-connection')).toHaveText('Reconnecting…');
    await expect(page.locator('.activity-state')).toHaveText('Status unknown');
    await expect(runPicker(page).locator('option:checked')).toContainText('Status unknown');
    await expect(page.locator('.activity-summary')).toContainText(/last (?:confirmed|seen).*running/i);
    await expect(activity(page).locator('.activity-selected-browsers')).toHaveText('Browser count unknown');
    await expect(activity(page).getByRole('button', {name: 'Stop', exact: true})).toBeEnabled();
    await activityTab(page, 'Agents').click();
    await expect(page.locator('.activity-agent-heading')).toContainText('Last known agents · 2');
    await expect(roster(page)).toHaveAttribute('aria-label', 'Last known agents');
    await expect(roster(page).locator('.activity-agent-run-state')).toHaveText(['Status unknown', 'Status unknown']);
    await expect(roster(page).locator('.activity-agent-browser-state')).toHaveText(['Browser count unknown', 'Browser count unknown']);
    await expect(page.locator('.activity-caption')).not.toContainText('agents working');
    await expect(page.locator('.console-dot')).not.toHaveClass(/\blive\b/);
    await expect(activity(page)).not.toHaveAttribute('data-state', 'live');
    await activityTab(page, 'Progress').click();
    if (connection === 'offline') {
      for (const delay of [1000, 2000, 5000]) {
        await page.clock.fastForward(delay);
        await state.disconnect();
      }
      await expect(page.locator('.activity-connection')).toHaveText('Connection lost');
      await expect(page.locator('.activity-state')).toHaveText('Status unknown');
      await expect.poll(() => state.polls).toBeGreaterThan(0);
      await page.clock.fastForward(30000);
    } else {
      await mkdir('artifacts/activity-status', {recursive: true});
      for (const [width, height] of [[1280, 812], [375, 667]]) {
        await page.setViewportSize({width, height});
        await page.locator('.activity-summary').screenshot({path: `artifacts/activity-status/unknown-${width}.png`, animations: 'disabled'});
      }
      await page.clock.fastForward(1000);
    }
    state.runFailure = false;
    await state.push(terminalSnapshot(state, status));
    await expect(page.locator('.activity-connection')).toHaveText('Live updates');
    await expect(page.locator('.activity-state')).toHaveText(label);
    await expect(runPicker(page)).toHaveValue(research.id);
    await expect(activity(page).getByRole('button', {name: 'Stop', exact: true})).not.toBeVisible();
    await expect(page.locator('.activity-summary')).not.toContainText('Status unknown');
    await activityTab(page, 'Agents').click();
    await expect(roster(page).locator('[data-run-id]')).toHaveCount(1);
    await expect(roster(page)).not.toContainText('Status unknown');
    await expect(page.locator('.activity-agent-heading')).toContainText('Running agents · 1');
    await expect(roster(page)).toHaveAttribute('aria-label', 'Running agents');
    expect(state.stops).toEqual([]);
  });
}

test('a refreshed terminal snapshot takes effect while the stream is still reconnecting', async ({page}) => {
  await page.clock.install();
  const state = await fixture(page);
  await openActivity(page);
  await runPicker(page).selectOption(research.id);
  await state.disconnect();
  await expect(page.locator('.activity-state')).toHaveText('Status unknown');
  state.snapshot = terminalSnapshot(state, 'failed');
  // Returning to the tab requests current metadata without fabricating an SSE event.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => state.polls).toBeGreaterThan(0);
  await expect(page.locator('.activity-state')).toHaveText('Needs attention');
  await expect(page.locator('.activity-connection')).toHaveText('Reconnecting…');
  await expect(runPicker(page)).toHaveValue(research.id);
  await activityTab(page, 'Agents').click();
  await expect(roster(page).locator(`[data-run-id="${research.id}"]`)).toHaveCount(0);
  await expect(roster(page).locator(`[data-run-id="${learning.id}"]`)).toContainText('Status unknown');
  await expect(page.locator('.console-dot')).not.toHaveClass(/\blive\b/);
  expect(state.stops).toEqual([]);
});

test('Activity starts with progress and its tabs support keyboard navigation without losing focus on updates', async ({page}) => {
  const state = await fixture(page);
  await openActivity(page);
  const progress = activityTab(page, 'Progress'), agents = activityTab(page, 'Agents'), browsers = activityTab(page, 'Browsers');
  await expect(progress).toHaveAttribute('aria-selected', 'true');
  await expect(progress).toHaveAttribute('tabindex', '0');
  await expect(agents).toHaveAttribute('tabindex', '-1');
  await expect(browsers).toHaveAttribute('tabindex', '-1');
  await expect(page.getByRole('log', {name: 'Run progress', exact: true})).toBeVisible();
  await expect(roster(page)).toBeHidden();
  await expect(activity(page).locator('.signin-browsers')).toBeHidden();
  await expect(agents).toContainText('2');

  await progress.focus();
  await page.keyboard.press('ArrowRight');
  await expect(agents).toBeFocused();
  await expect(agents).toHaveAttribute('aria-selected', 'true');
  await expect(agents).toHaveAttribute('tabindex', '0');
  await expect(progress).toHaveAttribute('tabindex', '-1');
  await expect(roster(page)).toBeVisible();
  await expect(page.locator('.activity-progress')).toBeHidden();
  await state.push({...state.snapshot, revision: 2, lines: [], runs: [{...learning, seconds: 22}, {...research, seconds: 24}]});
  await expect(agents).toBeFocused();
  await expect(agents).toHaveAttribute('aria-selected', 'true');
  await state.push(terminalSnapshot(state, 'completed'));
  await expect(agents).toContainText('1');
  await expect(agents).toBeFocused();

  await page.keyboard.press('End');
  await expect(browsers).toBeFocused();
  await expect(browsers).toHaveAttribute('aria-selected', 'true');
  await expect(activity(page).locator('.signin-browsers')).toBeVisible();
  await expect(roster(page)).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(progress).toBeFocused();
  await expect(progress).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(browsers).toBeFocused();
  await page.keyboard.press('Home');
  await expect(progress).toBeFocused();
  await expect(progress).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab');
  await expect(activity(page).getByRole('tabpanel', {name: /^Progress/})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(runPicker(page)).toBeFocused();

  // Compact mode exposes one selector; Expanded additionally exposes the rail.
  await activity(page).getByRole('button', {name: 'Expand activity', exact: true}).click();
  await progress.focus();
  await page.keyboard.press('Tab');
  await expect(activity(page).getByRole('tabpanel', {name: /^Progress/})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: /^Follow Learning assistant /})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: /^Follow Resume researcher /})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(runPicker(page)).toBeFocused();

  await activityTab(page, 'Agents').click();
  const viewLearning = roster(page).getByRole('button', {name: 'View activity for Learning assistant', exact: true});
  await viewLearning.focus();
  await state.push({...state.snapshot, revision: 4, lines: [], runs: state.snapshot.runs.map(run => ({...run, seconds: run.seconds + 1}))});
  await expect(viewLearning).toBeFocused();
  await viewLearning.click();
  await expect(progress).toHaveAttribute('aria-selected', 'true');
  await expect(runPicker(page)).toBeFocused();
  await expect(runPicker(page)).toHaveValue(learning.id);
  expect(state.stops).toEqual([]);
});

test('recent progress discloses earlier updates without losing full output or the selected run', async ({page}) => {
  const state = await fixture(page);
  await openActivity(page);
  const messages = [
    'Opening browser for this run.', 'Searching for roles.', 'Found 4 jobs.',
    'Reading job descriptions.', 'Writing tailored content.', 'Saved results.',
    'WARNING A few matches need review.',
  ];
  await state.push({...state.snapshot, revision: 2, next: 9, lines: messages.map((text, index) => [index + 2, text, learning.id, at])});
  const progress = page.getByRole('log', {name: 'Run progress', exact: true});
  await expect(progress.locator('.activity-event')).toHaveCount(5);
  await expect(progress).toContainText('The agent reported a warning');
  await expect(progress).not.toContainText('Opening the workspace');
  await expect(progress).not.toContainText('Looking for opportunities');
  await page.getByRole('button', {name: /^Show earlier updates/}).click();
  await expect(page.getByRole('button', {name: 'Show fewer updates', exact: true})).toHaveAttribute('aria-expanded', 'true');
  await expect(progress.locator('.activity-event')).toHaveCount(8);
  await expect(progress).toContainText('Opening the workspace');
  await expect(progress).toContainText('Looking for opportunities');
  await state.push({...state.snapshot, revision: 3, lines: []});
  await expect(progress.locator('.activity-event')).toHaveCount(8);
  await page.getByRole('button', {name: 'Show fewer updates', exact: true}).click();
  await expect(progress.locator('.activity-event')).toHaveCount(5);
  await expect(page.getByRole('button', {name: 'Show earlier updates', exact: true})).toHaveAttribute('aria-expanded', 'false');
  await page.getByText('Technical details · 8 lines', {exact: true}).click();
  const output = page.getByRole('log', {name: 'Run output', exact: true});
  await expect(output).toContainText('Writing daily lesson with the AI CLI.');
  for (const message of messages) await expect(output).toContainText(message);
  await runPicker(page).selectOption(research.id);
  await expect(progress.locator('.activity-event')).toHaveCount(1);
  await expect(progress).toContainText('Sign-in required');
  await expect(progress).not.toContainText('Opening the workspace');
  await expect(output).not.toContainText('Writing daily lesson');
  await expect(page.getByRole('button', {name: /^Show earlier updates/})).not.toBeVisible();
  expect(state.stops).toEqual([]);
});

test('attention selects the failed run and external Open Activity returns to progress from Browsers', async ({page}) => {
  const state = await fixture(page);
  await openActivity(page);
  await expect(runPicker(page)).toHaveValue(learning.id);
  await state.push(terminalSnapshot(state, 'failed'));
  const review = activity(page).getByRole('button', {name: '1 run needs attention · Review', exact: true});
  await expect(review).toBeVisible();
  await expect(page.locator('.activity-caption')).toContainText('1 run needs attention');
  await review.click();
  await expect(runPicker(page)).toHaveValue(research.id);
  await expect(runPicker(page)).toBeFocused();
  await expect(page.locator('.activity-state')).toHaveText('Needs attention');
  await expect(review).not.toBeVisible();

  await activityTab(page, 'Browsers').click();
  await activity(page).getByRole('button', {name: 'Close activity', exact: true}).click();
  await expect(activity(page)).toHaveAttribute('data-size', 'collapsed');
  await activity(page).locator('.activity-launch').click();
  await expect(activityTab(page, 'Browsers')).toHaveAttribute('aria-selected', 'true');
  await activity(page).getByRole('button', {name: 'Close activity', exact: true}).click();
  await page.getByRole('button', {name: 'Open Activity', exact: true}).click();
  await expect(activity(page)).toHaveAttribute('data-size', 'normal');
  await expect(activityTab(page, 'Progress')).toHaveAttribute('aria-selected', 'true');
  await expect(runPicker(page)).toBeVisible();
  await expect(runPicker(page)).toHaveValue(research.id);
  await expect(page.locator('.activity-state')).toHaveText('Needs attention');
  expect(state.stops).toEqual([]);
});

test('the Activity run list switches isolated output and retains focused, selected runs through updates and completion', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  const state = await fixture(page);
  await openActivity(page);
  await activity(page).getByRole('button', {name: 'Expand activity', exact: true}).click();
  const list = page.locator('.activity-run-list');
  const followLearning = list.getByRole('button', {name: /^Follow Learning assistant /});
  const followResearch = list.getByRole('button', {name: /^Follow Resume researcher /});
  const progress = page.getByRole('log', {name: 'Run progress', exact: true});
  await expect(list).toHaveAttribute('role', 'list');
  await expect(followLearning).toHaveAttribute('aria-pressed', 'true');
  await page.getByText('Technical details · 1 line', {exact: true}).click();
  const output = page.getByRole('log', {name: 'Run output', exact: true});
  await expect(output).toContainText('Writing daily lesson');

  await followResearch.click();
  await expect(runPicker(page)).toHaveValue(research.id);
  await expect(followResearch).toHaveAttribute('aria-pressed', 'true');
  await expect(followLearning).toHaveAttribute('aria-pressed', 'false');
  await expect(progress).toContainText('Sign-in required');
  await expect(progress).not.toContainText('Preparing your content');
  await expect(output).toContainText('Sign-in required');
  await expect(output).not.toContainText('Writing daily lesson');
  await followResearch.focus();
  await state.push({...state.snapshot, revision: 2, lines: [], runs: [{...learning, seconds: 22}, {...research, seconds: 24}]});
  await expect(followResearch).toBeFocused();
  await expect(followResearch).toHaveAttribute('aria-pressed', 'true');

  await state.push(terminalSnapshot(state, 'completed'));
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(followResearch).toBeVisible();
  await expect(followResearch).toBeFocused();
  await expect(followResearch).toHaveAttribute('aria-pressed', 'true');
  await expect(followResearch).toContainText('Completed');
  await expect(page.locator('.activity-state')).toHaveText('Completed');
  await expect(runPicker(page)).toHaveValue(research.id);
  await expect(output).toContainText('Sign-in required');
  await expect(activity(page).getByRole('button', {name: 'Stop', exact: true})).not.toBeVisible();
  expect(state.stops).toEqual([]);
});

test('changing accounts removes private runs from the Activity run list', async ({page}) => {
  await fixture(page);
  await openActivity(page);
  await activity(page).getByRole('button', {name: 'Expand activity', exact: true}).click();
  const list = page.locator('.activity-run-list');
  await expect(list.locator('button')).toHaveCount(2);
  await page.route('**/api/session', route => route.fulfill({json: {mode: 'accounts', user: null, legacy_access: false}}));
  await page.evaluate(() => window.__activitySources.at(-1).dispatchEvent(new Event('access-revoked')));
  await expect(list.locator('button')).toHaveCount(0);
  await expect(list).not.toContainText(learning.label);
  await expect(list).not.toContainText(research.label);
  await expect(page.locator('#activity-run option')).toHaveCount(0);
  await expect(page.locator('.activity-launch-badge')).toBeHidden();
  await expect(page.locator('.activity-launch-badge')).toHaveText('');
  await expect(page.locator('.activity-launch-description')).not.toContainText(learning.label);
  await expect(page.locator('.activity-launch-description')).not.toContainText(research.label);
  await expect(page.locator('#console-dock')).toBeHidden();
});

test('compact Activity uses its run picker and the expanded workbench fits desktop widths', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await fixture(page);
  await openActivity(page);
  await mkdir('artifacts/activity', {recursive: true});
  const list = page.locator('.activity-run-list');
  for (const width of [1440, 768]) {
    await page.setViewportSize({width, height: 900});
    await expect(activity(page)).toHaveAttribute('data-size', 'normal');
    await expect(list).toBeHidden();
    await expect(runPicker(page)).toBeVisible();
    await runPicker(page).selectOption(research.id);
    await expect(page.locator('.activity-summary strong')).toHaveText(research.label);
    await expect(page.getByRole('log', {name: 'Run progress', exact: true})).toContainText('Sign-in required');
    const compact = await activity(page).boundingBox();
    expect(compact.width).toBeLessThanOrEqual(480);
    expect(compact.x).toBeGreaterThanOrEqual(0);
    expect(compact.x + compact.width).toBeLessThanOrEqual(width);
    expect(compact.y).toBeGreaterThanOrEqual(0);
    expect(compact.y + compact.height).toBeLessThanOrEqual(900);
    if (width === 1440) await page.screenshot({path: 'artifacts/activity/compact-normal-1440.png', animations: 'disabled'});

    await activity(page).getByRole('button', {name: 'Expand activity', exact: true}).click();
    await expect(activity(page)).toHaveAttribute('data-size', 'expanded');
    await expect(list).toBeVisible();
    await expect(runPicker(page)).toBeVisible();
    await expect(runPicker(page)).toHaveValue(research.id);
    const box = await activity(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    await page.screenshot({path: `artifacts/activity/compact-expanded-${width}.png`, animations: 'disabled'});
    await activity(page).getByRole('button', {name: 'Restore activity size', exact: true}).click();
    await expect(runPicker(page)).toHaveValue(research.id);
  }

  await page.setViewportSize({width: 375, height: 667});
  await expect(list).toBeHidden();
  await expect(runPicker(page)).toBeVisible();
  await runPicker(page).selectOption(research.id);
  await expect(page.locator('.activity-summary strong')).toHaveText(research.label);
  await expect(page.getByRole('log', {name: 'Run progress', exact: true})).toContainText('Sign-in required');
  const box = await activity(page).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(667);
  await page.screenshot({path: 'artifacts/activity/compact-normal-375.png', animations: 'disabled'});
});

test('mobile Activity preserves the reading position and returns to the latest output in its detail scroller', async ({page}) => {
  await page.setViewportSize({width: 375, height: 667});
  const state = await fixture(page);
  await openActivity(page);
  const messages = ['Searching for roles.', 'Reading job descriptions.', 'Writing tailored content.', 'Saved results.'];
  const entries = Array.from({length: 32}, (_, index) => [index + 2, `${messages[index % messages.length]} Batch ${index + 1}.`, learning.id, at]);
  await state.push({...state.snapshot, revision: 2, next: 34, lines: entries});
  await page.getByText('Technical details · 33 lines', {exact: true}).click();
  const output = page.getByRole('log', {name: 'Run output', exact: true});
  await expect(output).toContainText('Batch 32.');
  const scroller = page.locator('.activity-run-detail');
  const latest = activity(page).getByRole('button', {name: 'Back to latest', exact: true});
  const distanceFromBottom = () => scroller.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop);
  await expect(scroller).toHaveCSS('overflow-y', 'auto');
  await expect.poll(() => scroller.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(300);
  await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
  await expect(latest).toBeHidden();

  await scroller.evaluate(node => { node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight - 220); });
  await expect(latest).toBeVisible();
  // The action must be reachable where the reader stopped, without first
  // scrolling to the bottom and inadvertently resuming automatic following.
  await expect(latest).toBeInViewport();
  const readingPosition = await scroller.evaluate(node => node.scrollTop);
  await state.push({...state.snapshot, revision: 3, lines: [], runs: [{...learning, seconds: 22}, research]});
  await expect(page.locator('.activity-elapsed')).toContainText('Elapsed 22s');
  await expect.poll(() => scroller.evaluate((node, position) => Math.abs(node.scrollTop - position), readingPosition)).toBeLessThanOrEqual(2);
  const marker = 'Output marker: retained reading position.';
  await state.push({...state.snapshot, revision: 4, next: 35, lines: [[34, marker, learning.id, at]]});
  await expect(output).toContainText(marker);
  await expect.poll(() => scroller.evaluate((node, position) => Math.abs(node.scrollTop - position), readingPosition)).toBeLessThanOrEqual(2);
  await expect(latest).toBeVisible();
  await expect(latest).toBeInViewport();

  await latest.click();
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
  await expect(latest).toBeHidden();
  expect(state.stops).toEqual([]);
});

test('the floating Activity circle opens a bounded sheet and restores keyboard focus when closed', async ({page}) => {
  await fixture(page);
  await page.goto('/#/bots');
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  await mkdir('artifacts/activity', {recursive: true});
  const launcher = activity(page).locator('.activity-launch');
  const sheet = activity(page).locator('.activity-sheet');
  const heading = sheet.locator('.activity-sheet-heading');
  const expand = heading.getByRole('button', {name: 'Expand activity', exact: true});
  const restore = heading.getByRole('button', {name: 'Restore activity size', exact: true});
  const close = activity(page).getByRole('button', {name: 'Close activity', exact: true});
  await expect(launcher).toHaveAttribute('aria-controls', 'activity-content');
  await expect(launcher).toHaveAttribute('aria-describedby', /\S+/);

  for (const [width, height] of [[1440, 900], [375, 667]]) {
    await page.setViewportSize({width, height});
    await expect(activity(page)).toHaveAttribute('data-size', 'collapsed');
    await expect(launcher).toBeVisible();
    await expect(launcher).toHaveAttribute('aria-expanded', 'false');
    await expect(sheet).toBeHidden();
    const circle = await launcher.boundingBox();
    expect(circle.width).toBeCloseTo(60, 0);
    expect(circle.height).toBeCloseTo(60, 0);
    expect(circle.x).toBeGreaterThanOrEqual(0);
    expect(circle.x + circle.width).toBeLessThanOrEqual(width);
    expect(circle.y + circle.height).toBeLessThanOrEqual(height);
    const rounded = await launcher.evaluate(node => {
      const radius = getComputedStyle(node).borderTopLeftRadius;
      return radius.endsWith('%') ? parseFloat(radius) >= 50 : parseFloat(radius) >= node.clientWidth / 2;
    });
    expect(rounded, 'The closed Activity control should remain circular.').toBe(true);
    if (width === 1440) await page.screenshot({path: 'artifacts/activity/orb-closed-1440.png', animations: 'disabled'});

    await launcher.click();
    await expect(sheet).toBeVisible();
    await expect.poll(() => sheet.evaluate(node => node.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
    await expect(launcher).toHaveAttribute('aria-expanded', 'true');
    await expect(launcher).toHaveAccessibleName('Close activity');
    await expect(activityTab(page, 'Progress')).toBeFocused();
    await expect(launcher).toBeInViewport({ratio: 1});
    await expect(close).toHaveCount(1);
    await expect(heading.getByRole('button', {name: 'Close activity', exact: true})).toHaveCount(0);
    const panel = await sheet.boundingBox(), openCircle = await launcher.boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    expect(panel.y + panel.height).toBeLessThanOrEqual(openCircle.y);
    expect(openCircle.y + openCircle.height).toBeLessThanOrEqual(height);
    await expect(expand).toHaveText('Expand');
    for (const control of [expand, close]) {
      await expect(control).toBeInViewport({ratio: 1});
      expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    expect(await heading.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({path: `artifacts/activity/compact-normal-${width}.png`, animations: 'disabled'});

    await runPicker(page).selectOption(research.id);
    await activityTab(page, 'Agents').click();
    await expand.click();
    await expect(activity(page)).toHaveAttribute('data-size', 'expanded');
    await expect(restore).toHaveText('Restore');
    await expect(restore).toBeFocused();
    await expect(activityTab(page, 'Agents')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('combobox', {name: 'Agent run', exact: true, includeHidden: true})).toHaveValue(research.id);
    await expect(launcher).toBeInViewport({ratio: 1});
    await expect(close).toHaveCount(1);
    await expect(heading.getByRole('button', {name: 'Close activity', exact: true})).toHaveCount(0);
    const expanded = await sheet.boundingBox(), expandedCircle = await launcher.boundingBox();
    expect(expanded.width > panel.width + 20 || expanded.height > panel.height + 20,
      'Expanding Activity should provide more reading space at every viewport.').toBe(true);
    if (width < 768) expect(expanded.height).toBeGreaterThan(panel.height + 60);
    expect(expanded.x).toBeGreaterThanOrEqual(0);
    expect(expanded.y).toBeGreaterThanOrEqual(0);
    expect(expanded.x + expanded.width).toBeLessThanOrEqual(width);
    expect(expanded.y + expanded.height).toBeLessThanOrEqual(expandedCircle.y);
    expect(expandedCircle.y + expandedCircle.height).toBeLessThanOrEqual(height);
    await launcher.click({trial: true});
    expect((await restore.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await heading.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await activityTab(page, 'Progress').click();
    await expect(runPicker(page)).toHaveValue(research.id);
    await page.screenshot({path: `artifacts/activity/compact-expanded-${width}.png`, animations: 'disabled'});

    await restore.click();
    await expect(activity(page)).toHaveAttribute('data-size', 'normal');
    await expect(expand).toBeFocused();
    await expect(activityTab(page, 'Progress')).toHaveAttribute('aria-selected', 'true');
    await expect(runPicker(page)).toHaveValue(research.id);

    await close.click();
    await expect(sheet).toBeHidden();
    await expect(launcher).toBeVisible();
    await expect(launcher).toHaveAccessibleName(/^Activity(?: ·|$)/);
    await expect(launcher).toBeFocused();
    await launcher.press('Enter');
    await expect(activityTab(page, 'Progress')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(launcher).toBeVisible();
    await expect(launcher).toBeFocused();
  }

  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect.poll(() => launcher.evaluate(node => node.getAnimations({subtree: true}).filter(animation => animation.playState === 'running').length)).toBe(0);
});

test('the closed Activity circle reports all runs without opening or following only the selected result', async ({page}) => {
  const state = await fixture(page);
  await page.goto('/#/bots');
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  const launcher = activity(page).locator('.activity-launch');
  const badge = activity(page).locator('.activity-launch-badge');
  await expect(activity(page)).toHaveAttribute('data-size', 'collapsed');
  await expect(badge).toHaveAttribute('aria-hidden', 'true');
  await expect(badge).toHaveText('2');
  await expect(activity(page)).toHaveAttribute('data-launch-state', 'live');
  await state.push({...state.snapshot, revision: 2, lines: [], runs: [{...learning, seconds: 22}, {...research, seconds: 24}]});
  await expect(activity(page)).toHaveAttribute('data-size', 'collapsed');
  await expect(badge).toHaveText('2');

  await launcher.click();
  await runPicker(page).selectOption(research.id);
  await state.push(terminalSnapshot(state, 'completed'));
  await expect(page.locator('.activity-state')).toHaveText('Completed');
  await expect(runPicker(page)).toHaveValue(research.id);
  await expect(badge).toHaveText('1');
  await expect(activity(page)).toHaveAttribute('data-launch-state', 'live');
  await activity(page).getByRole('button', {name: 'Close activity', exact: true}).click();
  await state.push(terminalSnapshot(state, 'failed'));
  await expect(activity(page)).toHaveAttribute('data-size', 'collapsed');
  await expect(badge).toHaveText('!');
  await expect(activity(page)).toHaveAttribute('data-launch-state', 'attention');
  await expect(page.locator('.activity-launch-description')).toContainText('attention');
  await expect(launcher).toBeFocused();
  expect(state.stops).toEqual([]);
});
