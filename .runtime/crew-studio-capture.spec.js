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
      '/api/bots': { bots: ["naukri", "hirist", "instahyre", "cutshort", "wellfound", "startups", "external", "profile", "linkedin", "linkedin_profile", "cold_email", "resume", "learn", "brief", "research", "company_research", "company_outreach", "hirist_profile", "instahyre_profile", "cutshort_profile", "wellfound_profile"].map((id, index) => ({ id, running: false, status: 'idle', last_run: index < 5 || ['linkedin', 'brief', 'profile'].includes(id) ? { at: '2026-11-03T06:45:00Z', practice: false, finished: true } : null })), run: emptyRun },
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
  await expect(historyPanel(page)).toBeVisible();
  return state;
}


test('capture current crew and realistic recorded outcomes without real API access', async ({ page }) => {
  await page.setViewportSize({ width:1440, height:1000 });
  const state = await workspace(page, { attempts:[...completed,
    attempt('review-1',{title:'AI Engineer',company:'Acme Labs'}),
    attempt('review-2',{title:'Platform Engineer',company:'Northstar Systems',state:'running'}),
    attempt('review-3',{title:'Senior Backend Engineer',company:'Orbit Technologies'}),
    attempt('review-4',{title:'Applied AI Engineer',company:'Meridian Labs'}),
    attempt('review-5',{title:'Software Engineer II',company:'Lattice Works'}),
    attempt('review-6',{title:'Machine Learning Engineer',company:'Vertex Systems'}),notSent] });
  await expect(filter(page,'Needs review (6)')).toHaveAttribute('aria-pressed','true');
  const cards = page.locator('.crew-bot-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(20);
  await expect(page.locator('[data-bot="naukri"] .crew-card-history')).toContainText('Last run');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => scrollTo(0,0));
  await page.mouse.move(0,0);
  await mkdir('artifacts/crew-studio',{recursive:true});
  await page.screenshot({path:'artifacts/crew-studio/before-1440.png',animations:'disabled'});
  await page.screenshot({path:'artifacts/crew-studio/before-full-1440.png',fullPage:true,animations:'disabled'});
  const metrics=await page.evaluate(() => ({cards:document.querySelectorAll('.crew-bot-card').length,pageHeight:document.documentElement.scrollHeight,names:[...document.querySelectorAll('.crew-bot-card h3')].map(node=>node.textContent),gridTop:document.querySelector('.crew-bot-grid').getBoundingClientRect().top,historyTop:document.querySelector('.application-history').getBoundingClientRect().top}));
  console.log(JSON.stringify(metrics));
  expect(state.writes).toEqual([]); expect(state.denied).toEqual([]);
});
