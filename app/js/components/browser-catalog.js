/** Metadata-only browser inventory. Screenshots are requested only by the viewer. */
import {h} from '../dom.js';
import {icon} from '../icons.js';
import {api, accountRequestSignal} from '../api.js';
import {duration} from '../format.js';
import {openBrowserViewer} from './browser-viewer.js';

const REFRESH_MS = 5000;
let parts, context, onChange = () => {};
let activityOpen = false, viewerOpen = false, pageAway = false, initialized = false;
let activityRuns = [], inventory = [], inventoryError = '', hasInventory = false;

const active = () => !pageAway && !document.hidden && !viewerOpen && (activityOpen || !!parts?.dialog.open);
const current = work => context === work && !work.scope.aborted;
const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };

function order(parent, nodes) {
  const wanted = new Set(nodes);
  for (const child of [...parent.children]) if (!wanted.has(child)) child.remove();
  nodes.forEach((node, index) => { if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null); });
}

export function browserInventoryForRun(id) {
  return inventory.find(run => run.id === id);
}

function mergedRuns() {
  const known = new Map(activityRuns.map(run => [run.id, run]));
  // Activity is authoritative about which runs still exist and are running.
  // A slow inventory response cannot restore a finished run, even after history
  // retention has removed that run from the latest activity snapshot.
  const combined = new Map(inventory.filter(run => run.running && known.get(run.id)?.running === true).map(run => [run.id, run]));
  for (const run of activityRuns) if (run.running) combined.set(run.id, {...combined.get(run.id), ...run,
    browsers: browserInventoryForRun(run.id)?.browsers || [],
    browser_state: browserInventoryForRun(run.id)?.browser_state || (run.id === 'legacy' ? 'unavailable' : 'waiting'),
    message: browserInventoryForRun(run.id)?.message || (run.id === 'legacy' ? 'This earlier run does not have a browser preview.' : ''),
  });
  return [...combined.values()];
}

function notify() { onChange(); renderCatalog(); }
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
  if (work.pending) { work.queued = true; return; }
  clearTimeout(work.timer);
  const generation = work.generation, request = new AbortController();
  work.pending = true; work.request = request;
  try {
    const result = await api('/api/run/browsers', undefined, {signal: request.signal});
    if (!current(work) || !active() || generation !== work.generation) return;
    if (!Array.isArray(result?.runs)) throw new Error('The browser list could not be read.');
    inventory = result.runs.filter(run => typeof run?.id === 'string' && run.running).map(run => ({...run,
      browsers: (Array.isArray(run.browsers) ? run.browsers : []).filter(browser => typeof browser?.id === 'string').map(browser => ({...browser,
        tabs: (Array.isArray(browser.tabs) ? browser.tabs : []).filter(tab => typeof tab?.id === 'string'),
      })),
    }));
    hasInventory = true; inventoryError = ''; work.failures = 0;
    notify();
  } catch (error) {
    if (!current(work) || generation !== work.generation || error.name === 'AbortError') return;
    if (error.status === 401 || error.status === 403) { resetBrowserCatalog(); return; }
    inventoryError = hasInventory ? 'Browser list delayed. Showing the last available update.' : 'The browser list is unavailable. Retrying shortly.';
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
    if ((!activityOpen && !parts?.dialog.open && !viewerOpen) || document.hidden || pageAway) { discard(); purge(); }
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
  window.addEventListener('browser-viewer-change', event => { viewerOpen = !!event.detail?.open; syncPolling(!viewerOpen); });
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
  renderCatalog();
  const changed = before !== runs.filter(run => run.running).map(run => run.id).join('|');
  if (changed && active()) syncPolling(true);
}

export function resetBrowserCatalog() {
  activityOpen = false; viewerOpen = false;
  discard();
  activityRuns = [];
  if (parts?.dialog.open) parts.dialog.close();
  inventory = []; inventoryError = ''; hasInventory = false;
  if (parts) { parts.groups.replaceChildren(); parts.rows.clear(); }
  notify();
}

function closeCatalog() {
  if (parts?.dialog.open) parts.dialog.close();
  syncPolling();
}

function openPreview(row, card) {
  const run = row.run, browser = card.browser;
  if (!run.running || !browser.tabs.length || browser.state !== 'ready') return;
  const selectedTab = browser.tabs.find(tab => tab.id === card.tabs.value) || browser.tabs[0];
  // Pause before closing the catalog so the dialog handoff never starts another
  // metadata request. The viewer's open/close event keeps this state current.
  viewerOpen = true;
  cancel(context);
  parts.dialog.close();
  const opened = openBrowserViewer(run, {browserId: browser.id, tabId: selectedTab.id, onBack: openBrowserCatalog});
  if (!opened) { viewerOpen = false; openBrowserCatalog(); }
}

function browserCard(row, browser) {
  let card = row.cards.get(browser.id);
  if (!card) {
    const title = h('h4'), state = h('span', {class: 'browser-catalog-browser-state'}), message = h('p', {class: 'browser-catalog-browser-message'});
    const sites = h('p', {class: 'browser-catalog-sites'});
    const tabs = h('select', {class: 'browser-catalog-tabs'});
    const preview = h('button', {class: 'btn btn-sm', type: 'button', text: 'Open preview', onclick: () => openPreview(row, card)});
    const element = h('article', {class: 'browser-catalog-browser', dataset: {browserId: browser.id}},
      h('div', {class: 'browser-catalog-browser-head'}, title, state), sites, message, h('div', {class: 'browser-catalog-browser-actions'}, tabs, preview));
    card = {element, title, state, sites, message, tabs, preview, browser, tabKey: ''};
    row.cards.set(browser.id, card);
  }
  card.browser = browser;
  const ready = browser.state === 'ready' && browser.tabs.length > 0;
  const label = browser.display_label || browser.label || 'Agent browser';
  text(card.title, label);
  text(card.state, ready ? 'Ready to view' : browser.state === 'unavailable' ? 'Unavailable' : 'Waiting');
  text(card.message, browser.message || (ready ? `${browser.tabs.length} ${browser.tabs.length === 1 ? 'tab' : 'tabs'} available` : 'Waiting for a viewable browser tab.'));
  text(card.sites, [...new Set(browser.tabs.map(tab => tab.site).filter(Boolean))].join(' · '));
  card.sites.hidden = !card.sites.textContent;
  card.element.dataset.state = browser.state;
  card.preview.disabled = !ready;
  card.preview.setAttribute('aria-label', `Open preview for ${label}`);
  card.tabs.setAttribute('aria-label', `Browser tab for ${label}`);
  const key = JSON.stringify(browser.tabs.map(tab => [tab.id, tab.title, tab.site]));
  if (key !== card.tabKey) {
    const selected = card.tabs.value;
    card.tabs.replaceChildren(...browser.tabs.map(tab => h('option', {value: tab.id, text: tab.title || tab.site || 'Browser tab'})));
    if (browser.tabs.some(tab => tab.id === selected)) card.tabs.value = selected;
    card.tabKey = key;
  }
  card.tabs.hidden = !browser.tabs.length;
  return card.element;
}

function agentGroup(run) {
  let row = parts.rows.get(run.id);
  if (!row) {
    const title = h('h3'), status = h('span', {class: 'browser-catalog-agent-state'}), message = h('p', {class: 'browser-catalog-agent-message'});
    const list = h('div', {class: 'browser-catalog-browser-list'});
    const element = h('section', {class: 'browser-catalog-agent', dataset: {runId: run.id}}, h('div', {class: 'browser-catalog-agent-head'}, title, status), message, list);
    row = {element, title, status, message, list, cards: new Map(), run}; parts.rows.set(run.id, row);
  }
  row.run = run;
  text(row.title, run.label || 'Agent');
  text(row.status, `${run.stopping || run.status === 'stopping' ? 'Stopping' : 'Running'} · ${duration(run.seconds)}`);
  const browsers = run.browsers || [];
  const stateMessage = run.browser_state === 'unavailable' ? 'Browser preview unavailable' : !hasInventory ? 'Checking for browsers…' : 'Waiting for a browser';
  text(row.message, browsers.length ? (run.message || '') : [stateMessage, run.message].filter(Boolean).join(' — '));
  row.message.hidden = !row.message.textContent;
  const ids = new Set(browsers.map(browser => browser.id));
  for (const [id] of row.cards) if (!ids.has(id)) row.cards.delete(id);
  const counts = new Map(), occurrences = new Map();
  for (const browser of browsers) { const label = browser.label || 'Agent browser'; counts.set(label, (counts.get(label) || 0) + 1); }
  order(row.list, browsers.map(browser => {
    const label = browser.label || 'Agent browser', occurrence = (occurrences.get(label) || 0) + 1;
    occurrences.set(label, occurrence);
    return browserCard(row, {...browser, display_label: counts.get(label) > 1 ? `${label} · ${occurrence}` : label});
  }));
  return row.element;
}

function renderCatalog() {
  if (!parts) return;
  const runs = mergedRuns();
  const ready = runs.reduce((count, run) => count + (run.browsers || []).filter(browser => browser.state === 'ready' && browser.tabs?.length).length, 0);
  text(parts.summary, `${runs.length} ${runs.length === 1 ? 'agent' : 'agents'} running · ${ready} ${ready === 1 ? 'browser' : 'browsers'} ready to view`);
  text(parts.status, inventoryError || (hasInventory ? 'Browser details update every 5 seconds.' : 'Checking your agents’ browsers…'));
  parts.status.dataset.state = inventoryError ? 'delayed' : 'ready';
  parts.empty.hidden = runs.length > 0;
  const ids = new Set(runs.map(run => run.id));
  for (const [id] of parts.rows) if (!ids.has(id)) parts.rows.delete(id);
  order(parts.groups, runs.map(agentGroup));
}

function createCatalog() {
  if (parts) return;
  const title = h('h2', {id: 'browser-catalog-title', text: 'All browsers'});
  const close = h('button', {class: 'btn', type: 'button', 'aria-label': 'Close all browsers', onclick: closeCatalog}, icon('x', 'icon icon-sm'), 'Close');
  const summary = h('p', {class: 'browser-catalog-summary'});
  const status = h('p', {class: 'browser-catalog-status', role: 'status'});
  const groups = h('div', {class: 'browser-catalog-groups'});
  const empty = h('div', {class: 'browser-catalog-empty'}, h('h3', {text: 'No agents are running'}), h('p', {text: 'Start an agent to see its browsers here. Previews open only when you choose one.'}));
  const dialog = h('dialog', {id: 'browser-catalog', class: 'browser-catalog', 'aria-labelledby': title.id, 'aria-describedby': 'browser-catalog-description',
    oncancel: event => {event.preventDefault(); closeCatalog();}, onclose: () => {if (!parts.dialog.open) syncPolling();}},
    h('header', {class: 'browser-catalog-header'}, h('div', {}, h('span', {class: 'browser-catalog-eyebrow', text: 'YOUR ACTIVE CREW'}), title, summary), close),
    h('p', {id: 'browser-catalog-description', class: 'browser-catalog-description', text: 'See which browsers each agent is using. Choose a preview to watch without bringing Chrome to the front.'}),
    status, h('div', {class: 'browser-catalog-scroll'}, empty, groups));
  document.body.append(dialog);
  parts = {dialog, summary, status, groups, empty, rows: new Map()};
}

export function openBrowserCatalog() {
  if (document.querySelector('dialog[open]')) return false;
  createCatalog();
  renderCatalog();
  parts.dialog.showModal();
  syncPolling(true);
  return true;
}
