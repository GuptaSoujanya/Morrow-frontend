import { h } from '../dom.js';
import { icon } from '../icons.js';
import { S } from '../state.js';
import { accountRequestSignal } from '../api.js';

const PREFIX = 'morrow.study-timer.v1:';
const MAX_TIME = 24 * 60 * 60 * 1000;
const localDay = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const validElapsed = value => Number.isFinite(value) ? Math.max(0, Math.min(MAX_TIME, value)) : 0;
const learningRoute = () => /^#\/learning(?:[/?]|$)/.test(location.hash);
const ownerKey = () => S.accountMode === 'local' && S.legacyAccess ? 'local'
  : S.user?.id ? `account:${S.user.id}` : null;

/** Measure elapsed clock time, rather than assuming every interval ran on time. */
export function createStudyClock({ date, elapsedMs = 0, now = () => performance.now() }) {
  let day = date, elapsed = validElapsed(elapsedMs), started = null;
  const value = () => validElapsed(elapsed + (started === null ? 0 : Math.max(0, now() - started)));
  return {
    read: () => ({ date: day, elapsedMs: value(), running: started !== null }),
    start() { if (started === null) started = now(); },
    pause() { elapsed = value(); started = null; },
    reset() { elapsed = 0; started = null; },
    day(date) {
      if (date === day) return false;
      day = date; elapsed = 0; started = null;
      return true;
    },
  };
}

export function formatStudyTime(milliseconds) {
  const seconds = Math.floor(validElapsed(milliseconds) / 1000);
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? String(hours).padStart(2, '0') + ':' : ''}${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

let activeService;

/** Call when any Learning route mounts so a reload inside a lesson can resume. */
export function restoreStudyTimer() {
  const owner = ownerKey(), scope = accountRequestSignal();
  if (!owner || scope.aborted || !learningRoute()) return;
  if (activeService?.owner === owner && activeService.scope === scope) return;
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(PREFIX + encodeURIComponent(owner))); } catch { return; }
  if (saved?.date === localDay() && saved.resumeOnReload
    && performance.getEntriesByType?.('navigation')?.[0]?.type === 'reload') timerService(owner, scope);
}

function timerService(owner, scope) {
  if (activeService?.owner === owner && activeService.scope === scope) return activeService;
  activeService?.dispose();
  const key = PREFIX + encodeURIComponent(owner), today = localDay();
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(key)); } catch { /* Storage may be unavailable. */ }
  const clock = createStudyClock({ date: today, elapsedMs: saved?.date === today ? saved.elapsedMs : 0 });
  const subscribers = new Set();
  let disposed = false, interval, midnight, reloadIntent = false, note = '';
  const current = () => !disposed && !scope.aborted && ownerKey() === owner;
  const snapshot = () => ({ ...clock.read(), note, available: current() });
  function persist() {
    try { sessionStorage.setItem(key, JSON.stringify({ ...clock.read(), resumeOnReload: reloadIntent })); } catch { /* The timer still works in memory. */ }
  }
  function notify() { const state = snapshot(); subscribers.forEach(callback => callback(state)); }
  function scheduleMidnight() {
    clearTimeout(midnight);
    const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    midnight = setTimeout(tick, Math.max(1, next.getTime() - now.getTime() + 20));
  }
  function syncInterval() {
    clearInterval(interval); interval = undefined;
    if (clock.read().running) interval = setInterval(tick, 1000);
  }
  function checkDay() {
    if (!clock.day(localDay())) return false;
    reloadIntent = false; note = 'A new day. Start when you are ready.';
    syncInterval(); scheduleMidnight();
    return true;
  }
  function tick() {
    if (!current()) { dispose(); return; }
    checkDay();
    if (document.hidden || !learningRoute()) pause(document.hidden ? 'Paused while this tab is hidden.' : 'Paused outside Learning.');
    else { persist(); notify(); }
  }
  function pause(message = '', allowReload = false) {
    if (disposed) return;
    const wasRunning = clock.read().running;
    clock.pause(); reloadIntent = allowReload && wasRunning;
    note = message; syncInterval(); persist(); notify();
  }
  function visibility() {
    if (document.hidden) {
      if (clock.read().running) pause('Paused while this tab is hidden.', true);
    } else {
      // Returning from another tab never silently restarts a paused timer.
      reloadIntent = false; checkDay(); persist(); notify();
    }
  }
  function routeChanged() {
    if (!learningRoute()) { pause('Paused outside Learning.'); dispose(); }
  }
  function pageLeaving() {
    if (clock.read().running) pause('', true);
    else persist();
  }
  function dispose() {
    if (disposed) return;
    clock.pause(); reloadIntent = false; persist();
    disposed = true;
    clearInterval(interval); clearTimeout(midnight);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('hashchange', routeChanged);
    window.removeEventListener('pagehide', pageLeaving);
    scope.removeEventListener('abort', dispose);
    subscribers.clear();
    if (activeService === service) activeService = null;
  }
  const service = {
    owner, scope, dispose,
    subscribe(callback) { subscribers.add(callback); checkDay(); callback(snapshot()); return () => subscribers.delete(callback); },
    toggle() {
      if (!current()) return;
      checkDay();
      if (clock.read().running) { pause('Paused. Your time is saved in this tab.'); return; }
      if (document.hidden || !learningRoute()) return;
      note = ''; reloadIntent = true; clock.start(); syncInterval(); persist(); notify();
    },
    reset() {
      if (!current() || clock.read().running) return;
      checkDay(); clock.reset(); reloadIntent = false; note = ''; persist(); notify();
    },
  };
  activeService = service;
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('hashchange', routeChanged);
  window.addEventListener('pagehide', pageLeaving);
  scope.addEventListener('abort', dispose, { once: true });
  // Reloads keep the explicit running choice, but never count unload/load time.
  const reloaded = performance.getEntriesByType?.('navigation')?.[0]?.type === 'reload';
  if (saved?.date === today && saved.resumeOnReload && reloaded && !document.hidden && learningRoute()) {
    clock.start(); reloadIntent = true;
  }
  syncInterval(); scheduleMidnight(); persist();
  return service;
}

/** A view subscription; its clock keeps running while another Learning view opens. */
export function studyTimer({ date, compact = false } = {}) {
  const owner = ownerKey(), scope = accountRequestSignal();
  const service = owner && !scope.aborted ? timerService(owner, scope) : null;
  const value = h('output', { class: 'study-timer-value', role: 'timer',
    'aria-label': compact ? 'Study time tracked in this tab today' : 'Tracked study time', 'aria-live': 'off', text: '00:00' });
  const status = h('p', { class: 'study-timer-status', role: 'status' });
  const toggle = h('button', { type: 'button', class: 'btn study-timer-toggle', text: 'Start timer', disabled: !service, onclick: () => service?.toggle() });
  const reset = h('button', { type: 'button', class: 'text-link study-timer-reset', text: 'Reset timer', disabled: true, onclick: () => service?.reset() });
  if (compact) {
    reset.replaceChildren(icon('refresh', 'icon icon-sm'), h('span', { class: 'sr-only', text: 'Reset timer' }));
    reset.title = 'Reset timer';
  }
  const compactState = compact ? h('span', { class: 'study-timer-compact-state', text: 'Paused' }) : null;
  const root = compact ? h('section', { class: 'study-timer study-timer-compact', 'aria-label': 'Study timer', 'data-study-date': date || localDay() },
    h('div', { class: 'study-timer-compact-readout' }, icon('clock', 'icon study-timer-compact-icon'),
      h('div', { class: 'study-timer-compact-copy' },
        h('p', { class: 'study-timer-compact-label', text: 'Study time today' }),
        h('div', { class: 'study-timer-compact-meta' }, value, compactState))),
    h('div', { class: 'study-timer-actions' }, toggle, reset),
    h('p', { class: 'study-timer-help', text: 'Time tracked in this tab today' }), status)
    : h('section', { class: 'study-timer', 'aria-label': 'Study timer', 'data-study-date': date || localDay() },
    h('div', { class: 'study-timer-heading' }, h('h3', { text: 'Study timer' }), h('span', { class: 'study-timer-indicator', 'aria-hidden': 'true' })),
    value, h('p', { class: 'study-timer-help', text: 'Time tracked in this tab today' }),
    h('div', { class: 'study-timer-actions' }, toggle, reset), status);
  const unsubscribe = service?.subscribe(state => {
    root.dataset.studyDate = state.date;
    root.dataset.timerRunning = String(state.running);
    const formatted = formatStudyTime(state.elapsedMs);
    if (value.textContent !== formatted) value.textContent = formatted;
    toggle.textContent = compact ? (state.running ? 'Pause' : 'Start') : state.running ? 'Pause timer' : 'Start timer';
    if (compact) toggle.setAttribute('aria-label', state.running ? 'Pause timer' : 'Start timer');
    toggle.disabled = !state.available;
    if (compactState) compactState.textContent = state.running ? 'Running' : 'Paused';
    reset.disabled = !state.available || state.running || state.elapsedMs === 0;
    const message = state.note || (state.running ? 'Running while you study.' : 'Start when you begin studying.');
    if (status.textContent !== message) status.textContent = message;
    if (compact) root.title = message + ' Time is tracked in this tab today.';
  });
  if (!service) {
    status.textContent = 'Open your workspace to start the timer.';
    if (compactState) compactState.textContent = 'Unavailable';
  }
  root.dispose = () => { unsubscribe?.(); scope.removeEventListener('abort', root.dispose); };
  scope.addEventListener('abort', root.dispose, { once: true });
  return root;
}
