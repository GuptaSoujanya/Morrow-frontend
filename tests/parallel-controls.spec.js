import { test, expect } from '@playwright/test';

// All API responses are synthetic. No browser in this suite can execute a bot,
// apply for a job, write a file, or contact an account service.
const startedAt = '2026-10-24T12:00:00';
function snapshot(active = false) {
  const run = {
    id: 'learning-fixture', label: 'Learning agent', action: 'pipeline', day: '',
    shown: 'python pipeline.py --only learn', running: true, stopping: false,
    status: 'running', seconds: 12, started_at: startedAt, finished: null,
    exit: null, stopped: false, resources: ['learning'],
  };
  return {
    epoch: 'parallel-controls-fixture', revision: active ? 1 : 0, next: active ? 1 : 0,
    running: active, stopping: false, label: active ? run.label : '',
    shown: active ? run.shown : '', action: active ? run.action : '', seconds: active ? 12 : 0,
    last: null, active_count: active ? 1 : 0, runs: active ? [run] : [],
    lines: active ? [[0, 'Building your next lesson', run.id, startedAt]] : [],
  };
}

async function workspace(page, { learning = false, account = false } = {}) {
  const activity = snapshot(learning), submitted = [], previews = [], denied = [];
  let holdNext = false, pendingPreview = null;
  let session = account ? {
    mode: 'accounts', legacy_access: true,
    user: { id: 'synthetic-owner', name: 'Synthetic Owner', email: 'owner@example.test', role: 'admin', plan_name: 'Pro', modules: [] },
  } : { mode: 'local', legacy_access: true, user: null };
  await page.addInitScript(initial => {
    window.__parallelStreams = [];
    class TestEventSource extends EventTarget {
      constructor(url) {
        super(); this.url = url; this.closed = false;
        window.__parallelStreams.push(this);
        this.first = setTimeout(() => this.emit(initial), 0);
        this.heartbeat = setInterval(() => this.emit({ ...initial, lines: [] }), 10000);
      }
      emit(value) {
        if (this.closed) return;
        this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(value) }));
      }
      close() { this.closed = true; clearTimeout(this.first); clearInterval(this.heartbeat); }
    }
    window.EventSource = TestEventSource;
  }, activity);
  const previewResult = request => ({ shown: `python naukri_bot.py --keywords ${JSON.stringify(request.options.keywords || '')} --limit ${request.options.limit || 20} --dry-run` });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (method === 'POST' && url.pathname === '/api/preview') {
      const request = route.request().postDataJSON(); previews.push(request);
      if (holdNext) { holdNext = false; pendingPreview = { route, request }; return; }
      return route.fulfill({ json: previewResult(request) });
    }
    if (method === 'POST' && url.pathname === '/api/run') {
      submitted.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, id: 'submitted-fixture', label: 'Synthetic Naukri run', run: activity } });
    }
    if (method !== 'GET') {
      denied.push(`${method} ${url.pathname}`);
      return route.fulfill({ status: 409, json: { error: 'Test safety guard: action was not executed.' } });
    }
    const replies = {
      '/api/session': session,
      '/api/meta': { answer_modes: [{ value: '', label: 'Use configured mode' }] },
      '/api/status': { name: 'Synthetic workspace', run: activity, questions: [], facts: [], study: { today: 1, read: 0, total: 0 } },
      '/api/course': { today: 1, read: 0, total: 0, lessons: [] },
      '/api/run': activity,
      '/api/run/browsers': { runs: activity.runs.filter(run => run.running).map(run => ({ ...run, browser_state: 'waiting', message: 'Waiting for a browser', browsers: [] })) },
      '/api/v1/auth/options': { provider: 'local', google: false },
    };
    return Object.hasOwn(replies, url.pathname)
      ? route.fulfill({ json: replies[url.pathname] })
      : route.fulfill({ status: 404, json: { error: `No synthetic fixture for ${url.pathname}` } });
  });
  await page.goto('/#/naukri');
  await expect(page.getByRole('heading', { name: 'Apply on Naukri', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__parallelStreams.length)).toBe(1);
  return {
    submitted, previews, denied,
    holdPreview() { holdNext = true; },
    get held() { return pendingPreview; },
    async releasePreview() {
      const held = pendingPreview; pendingPreview = null;
      await held.route.fulfill({ json: previewResult(held.request) });
    },
    signedOut() { session = { mode: 'accounts', legacy_access: false, user: null }; },
  };
}

test('an independent Learning agent does not block the Naukri Run control', async ({ page }) => {
  const fixture = await workspace(page, { learning: true });
  await expect(page.locator('.activity-summary strong')).toHaveText('Learning agent');
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  const run = page.getByRole('button', { name: 'Run', exact: true });
  await expect(run).toBeEnabled();
  await page.locator('.activity-launch').click();
  await run.click();
  await expect(page.getByRole('dialog', { name: 'Run this?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(run).toBeEnabled();
  expect(fixture.submitted).toEqual([]);
  expect(fixture.denied).toEqual([]);
});

test('repeated Run clicks during a delayed preview submit exactly once after confirmation', async ({ page }) => {
  const fixture = await workspace(page);
  const run = page.getByRole('button', { name: 'Run', exact: true });
  const previousPreviews = fixture.previews.length;
  fixture.holdPreview();
  await run.evaluate(button => {
    button.click();
    // Exercise the handler guard as well as the disabled native button.
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect.poll(() => !!fixture.held).toBe(true);
  await expect(run).toBeDisabled();
  expect(fixture.previews.length - previousPreviews).toBe(1);
  expect(fixture.submitted).toEqual([]);
  await fixture.releasePreview();
  await expect(page.getByRole('dialog', { name: 'Run this?' })).toBeVisible();
  await page.getByRole('button', { name: 'Run it', exact: true }).click();
  await expect.poll(() => fixture.submitted.length).toBe(1);
  await expect(page.locator('.toast-text')).toHaveText('Started Synthetic Naukri run.');
  await expect(run).toBeEnabled();
  expect(fixture.submitted[0].action).toBe('naukri');
  expect(fixture.denied).toEqual([]);
});

test('editing the form during confirmation preparation cannot change the approved options', async ({ page }) => {
  const fixture = await workspace(page);
  const run = page.getByRole('button', { name: 'Run', exact: true });
  await page.getByLabel('Keywords', { exact: true }).fill('Platform Engineer');
  await page.getByLabel('Limit', { exact: true }).fill('5');
  await expect(run).toBeEnabled();
  fixture.holdPreview();
  await run.click();
  await expect.poll(() => !!fixture.held).toBe(true);
  const approved = structuredClone(fixture.held.request);
  await page.getByLabel('Keywords', { exact: true }).fill('Changed after click');
  await page.getByLabel('Limit', { exact: true }).fill('17');
  await fixture.releasePreview();
  const dialog = page.getByRole('dialog', { name: 'Run this?' });
  await expect(dialog).toContainText('Platform Engineer');
  await expect(dialog).toContainText('--limit 5');
  await expect(dialog).not.toContainText('Changed after click');
  await page.getByRole('button', { name: 'Run it', exact: true }).click();
  await expect.poll(() => fixture.submitted.length).toBe(1);
  expect(fixture.submitted[0]).toEqual(approved);
  expect(fixture.submitted[0].options).toMatchObject({ keywords: 'Platform Engineer', limit: '5', dry_run: true });
  expect(fixture.denied).toEqual([]);
});

test('account expiration cancels an open confirmation without submitting or showing a stale success', async ({ page }) => {
  const fixture = await workspace(page, { account: true });
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Run this?' });
  await expect(dialog).toBeVisible();
  fixture.signedOut();
  await page.evaluate(() => window.dispatchEvent(new Event('account-expired')));
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  await expect(page.locator('#console-dock')).toBeHidden();
  await expect(page.locator('.toast-text')).toHaveCount(0);
  expect(await page.evaluate(() => window.__parallelStreams.every(source => source.closed))).toBe(true);
  expect(fixture.submitted).toEqual([]);
  expect(fixture.denied).toEqual([]);
});

test('restoring a cached page replaces its closed activity connection', async ({ page }) => {
  const fixture = await workspace(page, { learning: true });
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  expect(await page.evaluate(() => window.__parallelStreams[0].closed)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => page.evaluate(() => window.__parallelStreams.length)).toBe(2);
  await expect(page.locator('.activity-connection')).toHaveText('Live updates');
  expect(await page.evaluate(() => window.__parallelStreams.filter(source => !source.closed).length)).toBe(1);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  expect(fixture.submitted).toEqual([]);
  expect(fixture.denied).toEqual([]);
});
