/** Counts for active agent browsers. No screenshots, tabs, or remote controls. */
import {api, accountRequestSignal} from '../api.js';
import {S} from '../state.js';

const REFRESH_MS = 5000;
let context, onChange = () => {};
let activityOpen = false, pageAway = false, initialized = false;
let activityRuns = [], inventory = [], inventoryError = '', hasInventory = false;

const active = () => S.legacyAccess && !pageAway && !document.hidden && activityOpen && activityRuns.some(run => run.running);
const current = work => context === work && !work.scope.aborted;
export function browserInventoryForRun(id) {
  return activityRuns.some(run => run.id === id && run.running) ? inventory.find(run => run.id === id) : undefined;
}
export function browserInventoryError() { return inventoryError; }

export function browserCountSummary() {
  const runs = activityRuns.filter(run => run.running);
  const counts = runs.map(run => browserInventoryForRun(run.id));
  if (!runs.length) return {count: 0, state: 'ready'};
  if (inventoryError) return {count: null, state: 'unavailable'};
  if (counts.some(run => !run || run.count_status === 'checking')) return {count: null, state: 'checking'};
  if (counts.some(run => run.count_status !== 'ready')) return {count: null, state: 'unavailable'};
  return {count: counts.reduce((sum, run) => sum + run.open_browser_count, 0), state: 'ready'};
}

function notify() { onChange(); }
function purge() {
  inventory = []; inventoryError = ''; hasInventory = false;
  notify();
}
function cancel(work) {
  if (!work) return;
  clearTimeout(work.timer);
  work.generation += 1;
  work.request?.abort();
}
function discard() {
  const previous = context;
  context = null;
  if (previous) { cancel(previous); previous.scope.removeEventListener('abort', resetBrowserCatalog); }
}
function schedule(work, delay = REFRESH_MS) {
  clearTimeout(work.timer);
  if (current(work) && active()) work.timer = setTimeout(() => refresh(work), delay);
}
async function refresh(work) {
  if (!current(work) || !active()) return;
  if (work.pending) {
    // Opening another view shares the existing read. Only a cancelled request
    // needs an immediate replacement once it has finished unwinding.
    if (work.request?.signal.aborted) work.queued = true;
    return;
  }
  clearTimeout(work.timer);
  const generation = work.generation, request = new AbortController();
  work.pending = true; work.request = request;
  try {
    const result = await api('/api/run/browsers?counts=1', undefined, {signal: request.signal});
    if (!current(work) || !active() || generation !== work.generation) return;
    if (!Array.isArray(result?.runs)) throw new Error('The browser list could not be read.');
    // Store counts only. Tab titles, sites and screenshots do not belong here.
    const known = new Set(activityRuns.filter(run => run.running).map(run => run.id));
    inventory = result.runs.filter(run => typeof run?.id === 'string' && run.running && known.has(run.id)).map(run => ({
      id: run.id,
      open_browser_count: Number.isSafeInteger(run.open_browser_count) && run.open_browser_count >= 0 ? run.open_browser_count : null,
      count_status: run.count_status === 'ready' && Number.isSafeInteger(run.open_browser_count) && run.open_browser_count >= 0 ? 'ready'
        : run.count_status === 'checking' ? 'checking' : 'unavailable',
    }));
    hasInventory = true; inventoryError = ''; work.failures = 0;
    notify();
  } catch (error) {
    if (!current(work) || generation !== work.generation || error.name === 'AbortError') return;
    if (error.status === 401 || error.status === 403) { resetBrowserCatalog(); return; }
    inventoryError = hasInventory ? 'Browser count delayed. Checking again shortly.' : 'Browser count unavailable. Checking again shortly.';
    work.failures += 1;
    notify();
  } finally {
    work.pending = false;
    if (work.request === request) work.request = null;
    if (work.queued) { work.queued = false; schedule(work, 0); }
    else schedule(work, Math.min(REFRESH_MS * 2 ** work.failures, 20000));
  }
}
function syncPolling(immediate = false) {
  if (!active()) {
    cancel(context);
    if (!activityOpen || document.hidden || pageAway || !activityRuns.some(run => run.running)) { discard(); purge(); }
    return;
  }
  if (!context || context.scope.aborted) {
    context = {scope: accountRequestSignal(), generation: 0, failures: 0, pending: false, queued: false};
    context.scope.addEventListener('abort', resetBrowserCatalog, {once: true});
    immediate = true;
  }
  if (immediate) refresh(context);
  else if (!context.pending && !context.timer) schedule(context);
}

export function initBrowserCatalog(callback) {
  onChange = callback || (() => {});
  if (initialized) return;
  initialized = true;
  document.addEventListener('visibilitychange', () => syncPolling(!document.hidden));
  window.addEventListener('pagehide', () => { pageAway = true; syncPolling(); });
  window.addEventListener('pageshow', () => { pageAway = false; syncPolling(true); });
}

export function setBrowserCatalogActivityOpen(value) {
  const changed = activityOpen !== value;
  activityOpen = value;
  syncPolling(changed && value);
}

export function updateBrowserCatalogRuns(runs) {
  const before = activityRuns.filter(run => run.running).map(run => run.id).join('|');
  activityRuns = runs;
  inventory = inventory.filter(item => runs.some(run => run.id === item.id && run.running));
  notify();
  const changed = before !== runs.filter(run => run.running).map(run => run.id).join('|');
  if (changed) syncPolling(true);
}

export function resetBrowserCatalog() {
  activityOpen = false;
  discard();
  activityRuns = [];
  inventory = []; inventoryError = ''; hasInventory = false;
  notify();
}
