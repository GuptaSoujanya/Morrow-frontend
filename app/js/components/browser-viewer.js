/** Read-only screenshots of an agent browser; this never opens or controls Chrome. */
import {h} from '../dom.js';
import {icon} from '../icons.js';
import {api, accountRequestSignal} from '../api.js';

const REFRESH_MS = 2000;
const MAX_FAILURES = 3;
let parts, session, announcedOpen = false;

function announceVisibility(open) {
  if (announcedOpen === open) return;
  announcedOpen = open;
  window.dispatchEvent(new CustomEvent('browser-viewer-change', {detail: {open}}));
}

function available(current) {
  return session === current && parts.dialog.open && !current.scope.aborted;
}
function stopRequest(current) {
  clearTimeout(current.timer);
  current.generation += 1;
  current.request?.abort();
}
function clearFrame() {
  parts.image.removeAttribute('src');
  parts.image.hidden = true;
  parts.time.removeAttribute('datetime');
  parts.time.textContent = 'No preview captured yet';
  parts.site.textContent = '';
}
function state(current, value, label, message) {
  if (!available(current)) return;
  parts.dialog.dataset.state = value;
  parts.status.textContent = label;
  parts.message.textContent = message || '';
  parts.placeholder.hidden = current.hasFrame;
  parts.placeholderTitle.textContent = label;
  parts.placeholderText.textContent = message || '';
  parts.retry.hidden = !(value === 'delayed' || value === 'unavailable');
}
function cleanSession() {
  const previous = session;
  session = null;
  if (previous) {
    stopRequest(previous);
    previous.scope.removeEventListener('abort', closeBrowserViewer);
    document.removeEventListener('visibilitychange', previous.visibility);
  }
  if (parts) {
    clearFrame();
    selectItems(parts.browser, [], '', 'Waiting for a browser');
    selectItems(parts.tab, [], '', 'Waiting for a tab');
    parts.agent.textContent = '';
    parts.status.textContent = '';
    parts.message.textContent = '';
    parts.placeholderTitle.textContent = '';
    parts.placeholderText.textContent = '';
    parts.retry.hidden = true;
    parts.back.hidden = true;
  }
}

export function closeBrowserViewer() {
  cleanSession();
  if (parts?.dialog.open) parts.dialog.close();
  announceVisibility(false);
}

function backToBrowsers() {
  const current = session;
  if (!current || !available(current) || typeof current.onBack !== 'function') return;
  const onBack = current.onBack;
  closeBrowserViewer();
  if (!current.scope.aborted) onBack();
}

function selectItems(select, items, chosen, fallback) {
  const options = (Array.isArray(items) ? items : []).filter(item => typeof item?.id === 'string');
  const signature = JSON.stringify(options.map(item => [item.id, item.label || item.title || item.site || item.id]));
  if (select.dataset.options !== signature) {
    select.replaceChildren(...(options.length ? options.map(item => h('option', {
      value: item.id, text: item.label || item.title || item.site || item.id,
    })) : [h('option', {value: '', text: fallback})]));
    select.dataset.options = signature;
  }
  select.disabled = !options.length;
  select.value = options.some(item => item.id === chosen) ? chosen : options[0]?.id || '';
  return select.value;
}

function capturedTime(value) {
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return value && !Number.isNaN(date.valueOf()) ? date : null;
}
function showSnapshot(current, result) {
  if (!result || !['ready', 'waiting', 'unavailable', 'finished'].includes(result.state)) throw new Error('The preview response could not be read.');
  const previousBrowser = current.browser, previousTab = current.tab;
  // A busy capture can return only a waiting message. Keep the exact selected
  // browser and tab until metadata arrives, instead of defaulting to another.
  if (Array.isArray(result.browsers)) current.browser = selectItems(parts.browser, result.browsers, result.browser_id || current.browser, 'Waiting for a browser');
  if (Array.isArray(result.tabs)) current.tab = selectItems(parts.tab, result.tabs, result.tab_id || current.tab, 'Waiting for a tab');
  if (result.state !== 'finished' && current.hasFrame &&
      ((current.browser && current.browser !== previousBrowser) || (current.tab && current.tab !== previousTab))) {
    current.hasFrame = false;
    clearFrame();
  }
  parts.site.textContent = [result.title, result.site].filter(Boolean).join(' · ');
  current.terminal = result.state === 'finished' || result.state === 'unavailable' ? result.state : '';
  if (result.state === 'ready') {
    const validImage = typeof result.image === 'string' && result.image.length <= 12000000 && /^data:image\/(?:jpeg|png);base64,[A-Za-z\d+/=\s]+$/.test(result.image);
    if (!validImage) throw new Error('The preview image could not be read.');
    current.failures = 0;
    current.hasFrame = true;
    parts.image.src = result.image;
    parts.image.hidden = false;
    const at = capturedTime(result.captured_at);
    if (at) {
      parts.time.dateTime = at.toISOString();
      parts.time.textContent = `Captured ${at.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'})}`;
    } else {
      parts.time.removeAttribute('datetime');
      parts.time.textContent = 'Capture time unavailable';
    }
    state(current, 'ready', 'Preview updating', 'Read-only preview. Your agent keeps working in the background.');
  } else if (result.state === 'waiting') {
    current.failures = 0;
    state(current, 'waiting', 'Waiting for the agent’s browser…', result.message || 'The browser may still be starting, or this agent may be working on another step.');
  } else if (result.state === 'finished') {
    finish(current, result.message);
  } else {
    state(current, 'unavailable', 'Preview unavailable', result.message || 'This run is not sharing a browser preview. You can still follow its progress in Activity.');
  }
}
function finish(current, message) {
  stopRequest(current);
  current.terminal = 'finished';
  current.queued = false;
  state(current, 'finished', 'Run finished', message || (current.hasFrame
    ? 'This is the last captured frame. The preview is no longer updating.'
    : 'This run has finished. There is no active browser preview.'));
  parts.browser.disabled = true;
  parts.tab.disabled = true;
}
function schedule(current, delay = REFRESH_MS) {
  clearTimeout(current.timer);
  if (available(current) && !document.hidden && !current.terminal) current.timer = setTimeout(() => refresh(current), delay);
}
async function refresh(current) {
  if (!available(current) || document.hidden || current.terminal) return;
  if (current.pending) { current.queued = true; return; }
  clearTimeout(current.timer);
  const generation = current.generation;
  const request = new AbortController();
  current.request = request;
  current.pending = true;
  const query = new URLSearchParams({id: current.id});
  if (current.browser) query.set('browser', current.browser);
  if (current.tab) query.set('tab', current.tab);
  try {
    const result = await api(`/api/run/browser?${query}`, undefined, {signal: request.signal});
    if (!available(current) || generation !== current.generation || document.hidden) return;
    showSnapshot(current, result);
  } catch (error) {
    if (!available(current) || generation !== current.generation || error.name === 'AbortError') return;
    if (error.status === 401 || error.status === 403) { closeBrowserViewer(); return; }
    current.failures += 1;
    if (current.failures >= MAX_FAILURES) current.terminal = 'errors';
    state(current, 'delayed', 'Preview delayed', current.terminal === 'errors'
      ? 'Updates paused after repeated connection errors. Retry when you’re ready.'
      : current.hasFrame ? 'The last frame is still shown. Reconnecting before capturing another preview.' : 'The preview could not be reached. Trying again shortly.');
  } finally {
    current.pending = false;
    if (current.request === request) current.request = null;
    if (current.queued) { current.queued = false; schedule(current, 0); }
    else schedule(current, Math.min(REFRESH_MS * 2 ** current.failures, 8000));
  }
}
function changeSelection(kind) {
  const current = session;
  if (!current || current.terminal === 'finished') return;
  stopRequest(current);
  current.failures = 0;
  current.terminal = '';
  current.browser = parts.browser.value;
  current.tab = kind === 'browser' ? '' : parts.tab.value;
  if (kind === 'browser') selectItems(parts.tab, [], '', 'Waiting for a tab');
  current.hasFrame = false;
  clearFrame();
  state(current, 'waiting', 'Waiting for the agent’s browser…', 'Loading the selected browser view.');
  refresh(current);
}
function retry() {
  if (!session || session.terminal === 'finished') return;
  session.failures = 0;
  session.terminal = '';
  state(session, 'waiting', 'Updating preview…', session.hasFrame ? 'The previous frame stays visible until a new capture arrives.' : 'Connecting to the agent’s browser.');
  refresh(session);
}
function createViewer() {
  if (parts) return;
  const title = h('h2', {id: 'browser-viewer-title', text: 'Browser view'});
  const agent = h('p', {class: 'browser-viewer-agent'});
  const back = h('button', {class: 'text-link browser-viewer-back', type: 'button', hidden: true,
    text: 'Back to all browsers', onclick: backToBrowsers});
  const close = h('button', {class: 'btn browser-viewer-close', type: 'button', 'aria-label': 'Close browser view', onclick: closeBrowserViewer}, icon('x', 'icon icon-sm'), 'Close');
  const browser = h('select', {id: 'browser-viewer-browser', class: 'browser-viewer-select', onchange: () => changeSelection('browser')});
  const tab = h('select', {id: 'browser-viewer-tab', class: 'browser-viewer-select', onchange: () => changeSelection('tab')});
  const status = h('strong', {class: 'browser-viewer-status', role: 'status'});
  const message = h('p', {class: 'browser-viewer-message'});
  const retryButton = h('button', {class: 'btn btn-sm', type: 'button', text: 'Retry preview', hidden: true, onclick: retry});
  const image = h('img', {class: 'browser-viewer-image', alt: 'Agent browser screenshot', hidden: true, draggable: false, onerror: () => {
    if (!session || !available(session)) return;
    session.hasFrame = false;
    clearFrame();
    state(session, 'delayed', 'Preview delayed', 'The preview image could not be displayed. Waiting for another capture.');
  }});
  const placeholderTitle = h('strong'), placeholderText = h('p');
  const placeholder = h('div', {class: 'browser-viewer-placeholder'}, icon('eye', 'icon'), placeholderTitle, placeholderText);
  const site = h('span', {class: 'browser-viewer-site'});
  const time = h('time', {class: 'browser-viewer-time', text: 'No preview captured yet'});
  const dialog = h('dialog', {id: 'browser-viewer', class: 'browser-viewer', 'aria-labelledby': title.id,
    'aria-describedby': 'browser-viewer-description', oncancel: event => {event.preventDefault(); closeBrowserViewer();}, onclose: () => {
      if (!parts.dialog.open) { cleanSession(); announceVisibility(false); }
    }},
    h('header', {class: 'browser-viewer-header'}, h('div', {}, back, h('span', {class: 'browser-viewer-eyebrow', text: 'READ-ONLY'}), title, agent), close),
    h('p', {id: 'browser-viewer-description', class: 'browser-viewer-description', text: 'Watch without opening Chrome on your desktop. Preview updates every 2 seconds.'}),
    h('div', {class: 'browser-viewer-controls'},
      h('div', {}, h('label', {for: browser.id, text: 'Browser session'}), browser),
      h('div', {}, h('label', {for: tab.id, text: 'Browser tab'}), tab)),
    h('div', {class: 'browser-viewer-feedback'}, h('div', {}, status, message), retryButton),
    h('div', {class: 'browser-viewer-canvas'}, placeholder, image),
    h('footer', {class: 'browser-viewer-footer'}, site, time));
  document.body.append(dialog);
  parts = {dialog, agent, back, browser, tab, image, placeholder, placeholderTitle, placeholderText, status, message, retry: retryButton, site, time};
  window.addEventListener('pagehide', closeBrowserViewer);
}

export function openBrowserViewer(run, {browserId = '', tabId = '', onBack} = {}) {
  if (!run?.running || !run.id || run.id === 'legacy' || document.querySelector('dialog[open]')) return false;
  createViewer();
  cleanSession();
  const current = {id: run.id, scope: accountRequestSignal(), browser: browserId, tab: tabId, onBack, generation: 0,
    failures: 0, terminal: '', pending: false, queued: false, hasFrame: false};
  session = current;
  parts.agent.textContent = run.label || 'Agent browser';
  parts.back.hidden = typeof onBack !== 'function';
  selectItems(parts.browser, [], '', 'Waiting for a browser');
  selectItems(parts.tab, [], '', 'Waiting for a tab');
  current.visibility = () => {
    if (!available(current) || current.terminal) return;
    if (document.hidden) {
      stopRequest(current);
      state(current, 'paused', 'Preview paused', 'Updates resume when you return to this tab.');
    } else {
      state(current, 'waiting', 'Updating preview…', 'Capturing the current browser view.');
      refresh(current);
    }
  };
  current.scope.addEventListener('abort', closeBrowserViewer, {once: true});
  document.addEventListener('visibilitychange', current.visibility);
  parts.dialog.showModal();
  announceVisibility(true);
  state(current, 'waiting', 'Waiting for the agent’s browser…', 'Connecting to the browser used by this agent.');
  refresh(current);
  return true;
}

/** Keep the watched run fixed even when another agent is selected in Activity. */
export function updateBrowserViewerRun(runs) {
  if (!session) return;
  const run = runs.find(item => item.id === session.id);
  if (!run || !run.running) finish(session);
}
