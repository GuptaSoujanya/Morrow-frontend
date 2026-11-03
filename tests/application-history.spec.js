import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

// All API reads and writes are synthetic. No application outcome, bot run,
// account, email or real workspace record can be changed by these tests.
const emptyRun = { epoch: 'application-history-fixture', revision: 0, next: 0, running: false, stopping: false, label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const attempt = (job_id, overrides = {}) => ({ job_id, title: `Engineer ${job_id}`, company: 'Acme Labs', url: `https://example.test/jobs/${job_id}`, state: 'uncertain', next_step: 'Check the application page and Sent before another attempt.', detail: 'No matching confirmation was found.', updated_at: '2026-11-03 10:30:00', ...overrides });
const completed = Array.from({ length: 8 }, (_, index) => attempt(`done-${index}`, { state: 'confirmed', title: `Completed role ${index + 1}`, next_step: 'Do not submit again.' }));
const attention = [attempt('review-1', { title: 'AI Engineer' }), attempt('review-2', { title: 'Platform Engineer', company: 'Northstar Systems', state: 'running' }), ...Array.from({ length: 4 }, (_, index) => attempt(`review-${index + 3}`, { title: `Research Engineer ${index + 1}` }))];
const notSent = attempt('not-sent', { title: 'Previously checked role', state: 'needs_you', next_step: 'The user checked that nothing was sent; retry is allowed.', detail: 'Submission outcome checked by the user' });
const historyPanel = page => page.getByRole('region', { name: 'Application history', exact: true });
const row = (page, id) => historyPanel(page).locator(`[data-attempt="${id}"]`);
const filter = (page, name) => historyPanel(page).getByRole('group', { name: 'Application history filter', exact: true }).getByRole('button', { name, exact: true });
const refresh = page => historyPanel(page).getByRole('button', { name: 'Refresh', exact: true });
const review = (page, id = 'review-1') => row(page, id).getByRole('button', { name: /^Review / });

async function captureHistory(page, name, width) {
  await page.mouse.move(0, 0);
  await historyPanel(page).evaluate(panel => window.scrollBy({ top: panel.getBoundingClientRect().top - 110, behavior: 'instant' }));
  await page.screenshot({ path: `artifacts/application-history/${name}-${width}.png`, animations: 'disabled' });
}

async function workspace(page, { attempts = [...completed, ...attention, notSent], holdHistory = false, historyError = '', account = false, enabled = true } = {}) {
  const state = { attempts: structuredClone(attempts), reads: 0, writes: [], denied: [], historyError, resolveError: '', holdHistory, heldHistory: null, holdResolve: false, heldResolve: null };
  let session = account ? { mode: 'accounts', legacy_access: true, user: { id: 'history-owner', name: 'History Owner', email: 'history@example.test', role: 'admin', plan_name: 'Pro', modules: [] } } : { mode: 'local', legacy_access: true, user: null };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(snapshot => {
    class FixtureEventSource extends EventTarget {
      constructor(url) { super(); this.url = url; this.closed = false; this.first = setTimeout(() => this.send(snapshot), 0); this.heartbeat = setInterval(() => this.send(snapshot), 10000); }
      send(data) { if (!this.closed) this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(data) })); }
      close() { this.closed = true; clearTimeout(this.first); clearInterval(this.heartbeat); }
    }
    window.EventSource = FixtureEventSource;
  }, emptyRun);
  const historyReply = () => ({ enabled, limit: 5, budget: 0, timeout: 300, attempts: state.attempts });
  async function resolveReply(route, request) {
    if (state.resolveError) return route.fulfill({ status: 409, json: { error: state.resolveError } });
    state.attempts = state.attempts.map(item => item.job_id === request.job_id ? { ...item, state: request.outcome === 'confirmed' ? 'confirmed' : 'needs_you', next_step: request.outcome === 'confirmed' ? 'Do not submit again.' : 'The user checked that nothing was sent; retry is allowed.', detail: 'Submission outcome checked by the user' } : item);
    return route.fulfill({ json: { ok: true } });
  }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (path === '/api/application-agent' && method === 'GET') {
      state.reads++;
      if (state.holdHistory) { state.holdHistory = false; state.heldHistory = route; return; }
      if (state.historyError) return route.fulfill({ status: 503, json: { error: state.historyError } });
      return route.fulfill({ json: historyReply() });
    }
    if (path === '/api/application-agent/resolve' && method === 'POST') {
      const request = route.request().postDataJSON(); state.writes.push(request);
      if (state.holdResolve) { state.holdResolve = false; state.heldResolve = { route, request }; return; }
      return resolveReply(route, request);
    }
    if (!['GET', 'HEAD'].includes(method)) {
      state.denied.push(`${method} ${path}`);
      return route.fulfill({ status: 409, json: { error: 'Synthetic test safety guard: no real action was executed.' } });
    }
    const replies = {
      '/api/session': session,
      '/api/meta': { files: {}, answer_modes: [{ value: '', label: 'Use configured mode' }], linkedin_modes: [] },
      '/api/status': { name: 'Synthetic workspace', greeting: 'Hello', date: '2026-11-03', date_long: '3 November 2026', run: emptyRun, questions: [], facts: [], sites: [], study: { today: 1, read: 0, total: 0 }, report: { ready: false, days: [] } },
      '/api/course': { today: 1, read: 0, total: 0, lessons: [], modules: [] },
      '/api/bots': { bots: [], run: emptyRun },
      '/api/run': emptyRun,
      '/api/run/browsers': { runs: [] },
      '/api/v1/auth/options': { provider: 'local', google: false },
    };
    return Object.hasOwn(replies, path) ? route.fulfill({ json: replies[path] }) : route.fulfill({ status: 404, json: { error: `No synthetic fixture for ${path}` } });
  });
  state.releaseHistory = async () => { const route = state.heldHistory; state.heldHistory = null; await route.fulfill({ json: historyReply() }); };
  state.releaseResolve = async () => { const pending = state.heldResolve; state.heldResolve = null; await resolveReply(pending.route, pending.request); };
  state.signOut = () => { session = { mode: 'accounts', legacy_access: false, user: null }; };
  await page.goto('/#/bots');
  await page.getByRole('button', { name: /^Application history/ }).click();
  await expect(historyPanel(page)).toBeVisible();
  return state;
}

test('initial loading is announced and Refresh cannot issue another request', async ({ page }) => {
  const state = await workspace(page, { holdHistory: true });
  await expect.poll(() => Boolean(state.heldHistory)).toBe(true);
  await expect(historyPanel(page)).toHaveAttribute('aria-busy', 'true');
  await expect(historyPanel(page).getByRole('status')).toBeVisible();
  await expect(refresh(page)).toBeDisabled();
  expect(state.reads).toBe(1);
  await state.releaseHistory();
  await expect(filter(page, 'Needs review (6)')).toHaveAttribute('aria-pressed', 'true');
  await expect(historyPanel(page)).toHaveAttribute('aria-busy', 'false');
  await expect(refresh(page)).toBeEnabled();
  expect(state.writes).toEqual([]); expect(state.denied).toEqual([]);
});

test('failed initial history can be retried without a false empty state', async ({ page }) => {
  const state = await workspace(page, { historyError: 'Application history is temporarily unavailable.' });
  await expect(historyPanel(page).getByRole('alert')).toContainText('Application history is temporarily unavailable.');
  await expect(historyPanel(page).locator('article[data-attempt]')).toHaveCount(0);
  state.historyError = '';
  await historyPanel(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(filter(page, 'Needs review (6)')).toHaveAttribute('aria-pressed', 'true');
  await expect(historyPanel(page).getByRole('alert')).toHaveCount(0);
  expect(state.writes).toEqual([]); expect(state.denied).toEqual([]);
});

test('all reviewable outcomes are prioritized even after eight completed records', async ({ page }) => {
  const state = await workspace(page);
  await expect(filter(page, 'Needs review (6)')).toHaveAttribute('aria-pressed', 'true');
  await expect(filter(page, 'All history (15)')).toHaveAttribute('aria-pressed', 'false');
  await expect(historyPanel(page).locator('article[data-attempt]')).toHaveCount(6);
  for (const item of attention) await expect(row(page, item.job_id)).toBeVisible();
  await expect(row(page, 'review-1')).toContainText('Needs review');
  await expect(row(page, 'review-2')).toContainText('Outcome not recorded');
  await expect(row(page, 'not-sent')).toHaveCount(0);
  await expect(row(page, 'done-0')).toHaveCount(0);
  await expect(historyPanel(page).getByRole('button', { name: 'I verified it was sent', exact: true })).toHaveCount(0);
  for (const detail of await historyPanel(page).getByText('No matching confirmation was found.', { exact: true }).all()) await expect(detail).not.toBeVisible();
  await expect(historyPanel(page).locator('.agent-task-limits')).not.toBeVisible();
  expect(state.writes).toEqual([]); expect(state.denied).toEqual([]);
});

test('one review opens at a time and history expands without treating not-sent as unresolved', async ({ page }) => {
  const state = await workspace(page);
  await review(page).click();
  await expect(row(page, 'review-1').getByRole('button', { name: 'I verified it was sent', exact: true })).toBeVisible();
  await expect(row(page, 'review-1').locator('details')).not.toHaveAttribute('open', '');
  await expect(row(page, 'review-1').getByText('No matching confirmation was found.', { exact: true })).not.toBeVisible();
  await row(page, 'review-1').locator('summary').filter({ hasText: 'What happened' }).click();
  const beforeRefresh = state.reads;
  await refresh(page).click();
  await expect.poll(() => state.reads).toBeGreaterThan(beforeRefresh);
  await expect(refresh(page)).toBeEnabled();
  await expect(review(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, 'review-1').locator('details')).toHaveAttribute('open', '');
  await review(page, 'review-2').click();
  await expect(row(page, 'review-1').getByRole('button', { name: 'I verified it was sent', exact: true })).not.toBeVisible();
  await expect(row(page, 'review-2').getByRole('button', { name: 'I verified nothing was sent', exact: true })).toBeVisible();
  await filter(page, 'All history (15)').click();
  await expect(historyPanel(page).locator('article[data-attempt]')).toHaveCount(8);
  await historyPanel(page).getByRole('button', { name: /^Show \d+ more$/ }).click();
  await expect(historyPanel(page).locator('article[data-attempt]')).toHaveCount(15);
  await expect(row(page, 'not-sent')).toContainText('Not submitted');
  await row(page, 'not-sent').getByRole('button', { name: /^Details/ }).click();
  await expect(row(page, 'not-sent')).toContainText(notSent.next_step);
  await expect(row(page, 'not-sent').getByRole('button', { name: /^I verified/ })).toHaveCount(0);
  await expect(row(page, 'not-sent').getByRole('link', { name: 'Open application', exact: true })).toHaveAttribute('href', notSent.url);
  expect(state.writes).toEqual([]); expect(state.denied).toEqual([]);
});

test('Escape cancels a decision, restores focus and leaves the review pending', async ({ page }) => {
  const state = await workspace(page, { attempts: [attention[0]] });
  await review(page).click();
  const action = row(page, 'review-1').getByRole('button', { name: 'I verified nothing was sent', exact: true });
  await action.click();
  const dialog = page.getByRole('dialog', { name: 'Allow another attempt?', exact: true });
  await expect(dialog).toContainText('Gmail Sent');
  await expect(refresh(page)).toBeDisabled();
  await expect(action).toBeDisabled();
  expect(state.writes).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(action).toBeEnabled();
  await expect(action).toBeFocused();
  await expect(filter(page, 'Needs review (1)')).toHaveAttribute('aria-pressed', 'true');
  expect(state.writes).toEqual([]); expect(state.denied).toEqual([]);
});

for (const [action, confirmation, outcome, status] of [
  ['I verified it was sent', 'Mark as confirmed', 'confirmed', 'Confirmed'],
  ['I verified nothing was sent', 'I checked: nothing was sent', 'not_sent', 'Not submitted'],
]) test(`only an explicit ${outcome} decision updates the exact job and removes it from review`, async ({ page }) => {
  const state = await workspace(page, { attempts: [attention[0], attention[1]] });
  await review(page).click();
  await row(page, 'review-1').getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(state.writes).toEqual([]);
  await dialog.getByRole('button', { name: confirmation, exact: true }).click();
  await expect(filter(page, 'Needs review (1)')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'review-1')).toHaveCount(0);
  await expect(row(page, 'review-2')).toBeVisible();
  expect(state.writes).toEqual([{ job_id: 'review-1', outcome }]);
  await filter(page, 'All history (2)').click();
  await expect(row(page, 'review-1')).toContainText(status);
  await row(page, 'review-1').getByRole('button', { name: /^Details/ }).click();
  await expect(row(page, 'review-1').getByRole('button', { name: /^I verified/ })).toHaveCount(0);
  expect(state.denied).toEqual([]);
});

test('pending resolution locks decisions and refresh until its updated history arrives', async ({ page }) => {
  const state = await workspace(page, { attempts: [attention[0], attention[1]] });
  state.holdResolve = true;
  await review(page).click();
  await row(page, 'review-1').getByRole('button', { name: 'I verified it was sent', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as confirmed', exact: true }).click();
  await expect.poll(() => Boolean(state.heldResolve)).toBe(true);
  await expect(refresh(page)).toBeDisabled();
  for (const action of await historyPanel(page).getByRole('button', { name: /^I verified/ }).all()) await expect(action).toBeDisabled();
  await expect(review(page, 'review-2')).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  state.holdHistory = true;
  await state.releaseResolve();
  await expect.poll(() => Boolean(state.heldHistory)).toBe(true);
  await expect(refresh(page)).toBeDisabled();
  await state.releaseHistory();
  await expect(filter(page, 'Needs review (1)')).toBeVisible();
  await expect(refresh(page)).toBeEnabled();
  expect(state.writes).toEqual([{ job_id: 'review-1', outcome: 'confirmed' }]); expect(state.denied).toEqual([]);
});

test('a rejected resolution preserves the record and permits a checked retry', async ({ page }) => {
  const state = await workspace(page, { attempts: [attention[0]] });
  state.resolveError = 'Stop active runs before reviewing a submission outcome.';
  await review(page).click();
  const action = row(page, 'review-1').getByRole('button', { name: 'I verified it was sent', exact: true });
  await action.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as confirmed', exact: true }).click();
  await expect(historyPanel(page).getByRole('alert')).toContainText(state.resolveError);
  await expect(row(page, 'review-1')).toBeVisible();
  await expect(action).toBeEnabled();
  await expect(refresh(page)).toBeEnabled();
  state.resolveError = '';
  await action.click();
  expect(state.writes).toHaveLength(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as confirmed', exact: true }).click();
  await expect(filter(page, 'Needs review (0)')).toBeVisible();
  expect(state.writes).toEqual([{ job_id: 'review-1', outcome: 'confirmed' }, { job_id: 'review-1', outcome: 'confirmed' }]); expect(state.denied).toEqual([]);
});

test('a failed refresh retains the current records and can recover', async ({ page }) => {
  const state = await workspace(page);
  await expect(row(page, 'review-1')).toBeVisible();
  state.historyError = 'History refresh failed. Your saved records are unchanged.';
  await refresh(page).click();
  await expect(historyPanel(page).getByRole('alert')).toContainText(state.historyError);
  await expect(row(page, 'review-1')).toBeVisible();
  await expect(historyPanel(page).locator('article[data-attempt]')).toHaveCount(6);
  state.historyError = '';
  await historyPanel(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(historyPanel(page).getByRole('alert')).toHaveCount(0);
  await expect(refresh(page)).toBeEnabled();
  expect(state.writes).toEqual([]); expect(state.denied).toEqual([]);
});

test('a successful decision stays saved when the following history refresh fails', async ({ page }) => {
  const state = await workspace(page, { attempts: [attention[0]] });
  await review(page).click();
  await row(page, 'review-1').getByRole('button', { name: 'I verified nothing was sent', exact: true }).click();
  state.historyError = 'History service is temporarily unavailable.';
  await page.getByRole('dialog').getByRole('button', { name: 'I checked: nothing was sent', exact: true }).click();
  await expect(historyPanel(page).getByRole('alert')).toContainText(state.historyError);
  await expect(filter(page, 'Needs review (0)')).toHaveAttribute('aria-pressed', 'true');
  await expect(historyPanel(page)).toContainText('Nothing needs review right now.');
  await expect(historyPanel(page).getByRole('button', { name: 'View all history', exact: true })).toBeFocused();
  await historyPanel(page).getByRole('button', { name: 'View all history', exact: true }).click();
  await expect(row(page, 'review-1')).toContainText('Not submitted');
  await row(page, 'review-1').getByRole('button', { name: /^Details/ }).click();
  await expect(row(page, 'review-1').getByRole('button', { name: /^I verified/ })).toHaveCount(0);
  expect(state.writes).toEqual([{ job_id: 'review-1', outcome: 'not_sent' }]); expect(state.denied).toEqual([]);
});

test('an empty history explains when outcomes appear and keeps assistance details collapsed', async ({ page }) => {
  const state = await workspace(page, { attempts: [], enabled: false });
  await expect(historyPanel(page)).toContainText('No application history yet.');
  await expect(historyPanel(page)).toContainText('Outcomes appear here when AI assistance handles an application.');
  expect(await historyPanel(page).evaluate(panel => [...panel.querySelector('.application-history-body').childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).filter(Boolean))).toEqual([]);
  await expect(historyPanel(page).locator('article[data-attempt]')).toHaveCount(0);
  await expect(historyPanel(page).getByRole('button', { name: /^Review / })).toHaveCount(0);
  const summary = historyPanel(page).locator('summary').filter({ hasText: 'Assistance & limits' });
  await expect(summary.locator('..')).not.toHaveAttribute('open', '');
  await summary.click();
  await expect(historyPanel(page).locator('.agent-task-limits')).toContainText('AI assistance is off.');
  expect(state.writes).toEqual([]); expect(state.denied).toEqual([]);
});

test('account expiry closes an unconfirmed review without changing its outcome', async ({ page }) => {
  const state = await workspace(page, { attempts: [attention[0]], account: true });
  await review(page).click();
  await row(page, 'review-1').getByRole('button', { name: 'I verified it was sent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm this application was sent?', exact: true });
  await expect(dialog).toBeVisible();
  state.signOut();
  await page.evaluate(() => window.dispatchEvent(new Event('account-expired')));
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  expect(state.writes).toEqual([]); expect(state.denied).toEqual([]);
});

for (const width of [1440, 1024, 768, 375]) test(`review history is accessible and its controls fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const state = await workspace(page);
  await expect(historyPanel(page).locator('article[data-attempt]')).toHaveCount(6);
  expect(await historyPanel(page).evaluate(panel => [...panel.querySelector('.application-history-body').childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).filter(Boolean))).toEqual([]);
  await mkdir('artifacts/application-history', { recursive: true });
  for (const item of attention) await review(page, item.job_id).click({ trial: true });
  await captureHistory(page, 'review', width);
  await review(page).focus();
  await page.keyboard.press('Enter');
  await expect(row(page, 'review-1').getByRole('button', { name: 'I verified it was sent', exact: true })).toBeVisible();
  const escaped = await historyPanel(page).evaluate(panel => {
    const box = panel.getBoundingClientRect();
    return [...panel.querySelectorAll('button, summary, a')].filter(element => element.getClientRects().length).flatMap(element => {
      const rect = element.getBoundingClientRect();
      return rect.left < box.left - 1 || rect.right > box.right + 1 || rect.height < 44 ? [{ text: element.textContent.trim(), x: rect.x, width: rect.width, height: rect.height }] : [];
    });
  });
  expect(escaped).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await captureHistory(page, 'expanded', width);
  const scan = await new AxeBuilder({ page }).include('.application-history').analyze();
  expect(scan.violations).toEqual([]);
  await row(page, 'review-1').getByRole('button', { name: 'I verified nothing was sent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Allow another attempt?', exact: true });
  await expect(dialog).toBeVisible();
  expect((await new AxeBuilder({ page }).include('#confirm').analyze()).violations).toEqual([]);
  await page.screenshot({ path: `artifacts/application-history/confirm-${width}.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  expect(state.writes).toEqual([]); expect(state.denied).toEqual([]);
});
