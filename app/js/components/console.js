/** Persistent Activity sheet. Each workspace-owned run has its own progress and controls. */
import {h} from '../dom.js';
import {icon} from '../icons.js';
import {api, accountRequestSignal} from '../api.js';
import {toast} from './toast.js';
import {confirmDialog} from './dialog.js';
import {avatar} from './identity.js';
import {S, hooks} from '../state.js';
import {duration} from '../format.js';
import {activityRuns, activityState, readableActivity, activityDescription} from './activity-format.js';
import {openBrowserViewer, closeBrowserViewer, updateBrowserViewerRun} from './browser-viewer.js';
import {initBrowserCatalog, openBrowserCatalog, resetBrowserCatalog, setBrowserCatalogActivityOpen, updateBrowserCatalogRuns, browserInventoryForRun} from './browser-catalog.js';

let parts = null, wasRunning = false;
const MAX_LINES = 5000;
const clock = value => value && !Number.isNaN(new Date(value).valueOf()) ? new Date(value).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '';
const selectedRun = () => parts?.runs.find(run => run.id === parts.selected);
const selectedLines = () => parts.entries.filter(entry => entry[2] ? entry[2] === parts.selected : parts.selected === 'legacy' || parts.runs.length <= 1);

export function setConsoleSize(size) {
  S.consoleSize = size;
  if (!parts) return;
  const collapsed = size === 'collapsed';
  if (collapsed && parts.body.contains(document.activeElement)) parts.toggleButton.focus();
  parts.root.dataset.size = size;
  parts.body.hidden = collapsed;
  parts.toggleButton.setAttribute('aria-expanded', String(!collapsed));
  parts.toggleButton.title = collapsed ? 'Open Activity' : 'Collapse Activity';
  parts.toggleIcon.replaceChildren(icon(collapsed ? 'chevron-up' : 'chevron-down', 'icon icon-sm'));
  parts.resize.textContent = size === 'expanded' ? 'Compact view' : 'Expand output';
  setBrowserCatalogActivityOpen(!collapsed);
  if (!collapsed) requestAnimationFrame(followLatest);
}

function followLatest() {
  if (parts?.follow) parts.scroll.scrollTop = parts.scroll.scrollHeight;
}

async function stopRun() {
  const scope = accountRequestSignal();
  const run = selectedRun();
  if (!run?.running || parts.stopping.has(run.id)) return;
  const stopping = run.stopping;
  const dialog = document.getElementById('confirm');
  if (dialog?.open) return;
  const answer = confirmDialog(stopping ? {
    title: `Force stop ${run.label}?`, body: 'This ends this run immediately and may leave its browser window open.', ok: 'Force stop', tone: 'danger',
  } : {
    title: `Stop ${run.label}?`, body: 'This agent gets a chance to close safely. Other agents will keep running.', ok: 'Stop', tone: 'danger',
  });
  const contents = dialog?.firstElementChild;
  const cancel = () => {
    if (dialog?.open && dialog.firstElementChild === contents) dialog.dispatchEvent(new Event('cancel', {cancelable: true}));
  };
  scope.addEventListener('abort', cancel, {once: true});
  let confirmed;
  try { confirmed = await answer; }
  finally { scope.removeEventListener('abort', cancel); }
  if (!confirmed) return;
  if (scope.aborted) return;
  const current = parts.runs.find(item => item.id === run.id);
  if (!current?.running) { toast('This run has already finished.', 'info'); return; }
  if (!!current.stopping !== !!stopping) { toast('This run is already stopping. Choose Force stop if it does not finish closing.', 'info'); return; }
  parts.stopping.add(run.id);
  renderSummary();
  try {
    const reply = await api('/api/stop', run.id === 'legacy' ? {} : {id: run.id});
    scope.throwIfAborted();
    toast(reply.message, reply.ok ? 'info' : 'warn');
    await hooks.refreshStatus();
  } catch (error) {
    if (!scope.aborted && error.name !== 'AbortError') toast(error.message, 'error');
  } finally {
    if (!scope.aborted) { parts.stopping.delete(run.id); renderSummary(); }
  }
}

async function copyConsole() {
  const text = selectedLines().map(([, line,, at]) => `${clock(at) ? `[${clock(at)}] ` : ''}${line}`).join('\n');
  try { await navigator.clipboard.writeText(text); toast('This run’s output was copied.', 'info', 2000); }
  catch { toast('The browser didn’t allow copying.', 'warn'); }
}

export function initConsole() {
  const label = h('span', {class: 'activity-caption', text: 'Ready when you are'});
  const dot = h('span', {class: 'console-dot'});
  const toggleIcon = h('span', {class: 'activity-chevron'}, icon('chevron-up', 'icon icon-sm'));
  const toggleButton = h('button', {class: 'activity-launch', type: 'button', title: 'Open Activity', 'aria-expanded': 'false', 'aria-controls': 'activity-content', onclick: () => setConsoleSize(S.consoleSize === 'collapsed' ? 'normal' : 'collapsed')},
    avatar(22, 'activity-avatar'), h('span', {class: 'activity-launch-copy'}, h('strong', {}, 'Activity', dot), label), toggleIcon);
  const picker = h('select', {class: 'activity-run-picker', id: 'activity-run', 'aria-label': 'Agent run', onchange: () => {
    parts.selected = picker.value; parts.follow = true; parts.rawKey = ''; renderProgress(); renderSummary();
  }});
  const connection = h('span', {class: 'activity-connection', role: 'status', text: 'Connecting…'});
  const rosterTitle = h('h3', {text: 'Running agents'});
  const roster = h('div', {class: 'activity-agent-roster', role: 'list', 'aria-label': 'Running agents'});
  const rosterEmpty = h('p', {class: 'activity-agent-empty', text: 'No agents are running'});
  const allBrowsers = h('button', {class: 'btn btn-sm activity-all-browsers', type: 'button', text: 'All browsers', onclick: openBrowserCatalog});
  const rosterSection = h('div', {class: 'activity-agent-section'}, h('div', {class: 'activity-agent-heading'}, rosterTitle, allBrowsers), roster, rosterEmpty);
  const pickerWrap = h('div', {class: 'activity-run-control', hidden: true}, h('label', {for: 'activity-run', text: 'Agent run'}), picker);
  const summaryTitle = h('strong', {text: 'Your crew is ready'});
  const summaryText = h('span', {text: 'Run a bot to follow its progress here.'});
  const elapsed = h('span', {class: 'activity-elapsed'});
  const status = h('span', {class: 'activity-state', text: 'Standby', role: 'status'});
  const progress = h('div', {class: 'activity-progress', role: 'log', 'aria-label': 'Run progress', 'aria-live': 'off'});
  // Raw output is optional and intentionally not a live region: noisy output must
  // not interrupt a screen reader on every line.
  const lines = h('div', {class: 'console-lines', role: 'log', 'aria-label': 'Run output', 'aria-live': 'off', tabindex: '0'});
  const detailLabel = h('summary', {text: 'Technical details'});
  const details = h('details', {class: 'activity-details', hidden: true, ontoggle: () => { if (details.open) { renderRaw(); followLatest(); } }}, detailLabel, lines);
  const empty = h('div', {class: 'activity-empty'}, avatar(23, 'activity-empty-art'), h('h3', {text: 'A little quiet. A lot of possibility.'}), h('p', {text: 'Start a bot or flow. Follow each agent here, even when several are working at once.'}), h('a', {class: 'btn', href: '#/bots', onclick: () => setConsoleSize('collapsed'), text: 'Find your next bot'}));
  const stopBtn = h('button', {class: 'btn btn-sm btn-danger', type: 'button', onclick: stopRun, hidden: true}, icon('stop', 'icon icon-sm'), 'Stop');
  const copy = h('button', {class: 'btn btn-sm', type: 'button', 'aria-label': 'Copy output', onclick: copyConsole, disabled: true}, icon('copy', 'icon icon-sm'), 'Copy');
  const watch = h('button', {class: 'btn btn-sm activity-watch', type: 'button', hidden: true, text: 'Watch browser', onclick: () => openBrowserViewer(selectedRun())});
  const resize = h('button', {class: 'text-link', type: 'button', text: 'Expand output', onclick: () => setConsoleSize(S.consoleSize === 'expanded' ? 'normal' : 'expanded')});
  const retention = h('p', {class: 'activity-retention', hidden: true, text: 'Showing the most recent output; earlier details are no longer available.'});
  const scroll = h('div', {class: 'activity-scroll', tabindex: '0', 'aria-label': 'Activity timeline'}, empty, retention, progress, details);
  const jump = h('button', {class: 'activity-jump', type: 'button', text: 'Latest output ↓', hidden: true, onclick: () => { parts.follow = true; followLatest(); jump.hidden = true; }});
  const body = h('div', {id: 'activity-content', class: 'console-body', hidden: true},
    rosterSection,
    h('div', {class: 'activity-toolbar'}, pickerWrap, connection),
    h('div', {class: 'activity-summary'}, h('div', {}, summaryTitle, summaryText, elapsed), status),
    h('div', {class: 'activity-log-wrap'}, scroll, jump),
    h('div', {class: 'activity-footer'}, resize, h('div', {class: 'row'}, watch, copy, stopBtn)));
  const root = h('section', {class: 'console activity-console', 'aria-label': 'Activity', dataset: {size: 'collapsed'}, onkeydown: event => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.preventDefault(); setConsoleSize('collapsed'); }
  }}, toggleButton, body);
  document.getElementById('console-dock').append(root);
  parts = {root, body, label, dot, lines, empty, progress, details, detailLabel, retention, scroll, picker, pickerWrap, connection, roster, rosterTitle, rosterEmpty, rosterRows: new Map(), stopBtn, copy, watch, resize, jump, toggleIcon, toggleButton, summaryTitle, summaryText, elapsed, status, follow: true, runs: [], entries: [], entryKeys: new Set(), eventByKey: new Map(), selected: '', stopping: new Set(), rawKey: '', pickerKey: '', snapshot: null};
  initBrowserCatalog(renderRoster);
  scroll.addEventListener('scroll', () => { parts.follow = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 24; jump.hidden = parts.follow; });
  return parts;
}

function renderRaw() {
  if (!parts.details.open) return;
  const entries = selectedLines(), key = `${parts.selected}:${entries[0]?.[0] ?? ''}`;
  if (parts.rawKey !== key || parts.lines.children.length > entries.length) { parts.lines.replaceChildren(); parts.rawKey = key; }
  const fragment = document.createDocumentFragment();
  for (const [, text,, at] of entries.slice(parts.lines.children.length)) fragment.append(h('span', {class: 'console-line'},
    at ? h('time', {class: 'activity-line-time', datetime: at, text: `${clock(at)} `}) : null, text));
  parts.lines.append(fragment);
}

function progressEvents() {
  const events = [];
  for (const entry of selectedLines()) {
    const event = parts.eventByKey.get(`${entry[2] || 'legacy'}:${entry[0]}`);
    if (!event) continue;
    const previous = events.at(-1);
    if (previous?.title === event.title && previous.detail === event.detail) { previous.at = entry[3]; continue; }
    events.push({...event, at: entry[3]});
  }
  return events.slice(-40);
}

function renderProgress() {
  if (!parts) return;
  const run = selectedRun(), entries = selectedLines(), events = progressEvents();
  parts.empty.hidden = !!run || entries.length > 0;
  parts.progress.hidden = !parts.empty.hidden;
  parts.copy.disabled = !entries.length;
  parts.details.hidden = !entries.length;
  parts.detailLabel.textContent = `Technical details · ${entries.length.toLocaleString()} ${entries.length === 1 ? 'line' : 'lines'}`;
  const rows = events.map(event => h('div', {class: 'activity-event', dataset: {kind: event.kind}},
    h('span', {class: 'activity-event-mark', 'aria-hidden': 'true', text: event.kind === 'attention' ? '!' : '•'}),
    h('div', {}, h('strong', {text: event.title}), h('p', {text: event.detail})),
    event.at ? h('time', {datetime: event.at, text: clock(event.at)}) : null));
  if (!events.length && run) rows.push(h('div', {class: 'activity-waiting'}, h('strong', {text: run.running ? 'Waiting for the next update' : 'Run result available'}), h('p', {text: run.running ? 'Some steps take a little time to report progress. You can keep using the workspace.' : 'Review the status above and open Technical details for the full output.'})));
  parts.progress.replaceChildren(...rows);
  renderRaw();
  if (parts.follow) followLatest(); else parts.jump.hidden = false;
}

function renderSummary() {
  if (!parts) return;
  const run = selectedRun(), live = parts.runs.filter(item => item.running), state = activityState(run), latest = progressEvents().at(-1);
  parts.root.dataset.state = run?.running ? 'live' : run?.status === 'failed' ? 'error' : 'idle';
  parts.dot.className = `console-dot ${live.length ? 'live' : ''}`;
  parts.label.textContent = live.length > 1 ? `${live.length} agents working · choose a run to follow` : live.length ? `${live[0].label} · ${duration(live[0].seconds)}` : run ? `${run.label} · ${state.toLowerCase()}` : 'Ready when you are';
  parts.summaryTitle.textContent = run?.label || 'Your crew is ready';
  parts.summaryText.textContent = activityDescription(run, latest);
  const lastAt = selectedLines().at(-1)?.[3];
  parts.elapsed.textContent = run ? `${run.running ? 'Elapsed' : 'Duration'} ${duration(run.seconds)}${lastAt ? ` · Last update ${clock(lastAt)}` : ''}` : '';
  if (parts.status.textContent !== state) parts.status.textContent = state;
  parts.stopBtn.hidden = !run?.running;
  parts.stopBtn.disabled = !!run && parts.stopping.has(run.id);
  parts.stopBtn.replaceChildren(icon('stop', 'icon icon-sm'), parts.stopBtn.disabled ? 'Requesting…' : run?.stopping ? 'Force stop' : 'Stop');
  parts.stopBtn.title = run ? `Stop only ${run.label}` : '';
  parts.watch.hidden = !run?.running || !run.id || run.id === 'legacy';
  parts.watch.title = run ? `Watch ${run.label} without opening its browser window` : '';
  renderRoster();
}

function renderRoster() {
  if (!parts) return;
  const runs = parts.runs.filter(run => run.running), ids = new Set(runs.map(run => run.id));
  parts.rosterTitle.textContent = `Running agents · ${runs.length}`;
  parts.rosterEmpty.hidden = runs.length > 0;
  for (const [id, row] of parts.rosterRows) if (!ids.has(id)) { row.element.remove(); parts.rosterRows.delete(id); }
  runs.forEach((run, index) => {
    let row = parts.rosterRows.get(run.id);
    if (!row) {
      const title = h('strong'), state = h('span', {class: 'activity-agent-run-state'}), browsers = h('p', {class: 'activity-agent-browser-state'});
      const view = h('button', {class: 'btn btn-sm', type: 'button', text: 'View activity', onclick: () => {
        parts.selected = row.run.id; parts.picker.value = row.run.id; parts.follow = true; parts.rawKey = '';
        renderProgress(); renderSummary();
      }});
      const watch = h('button', {class: 'btn btn-sm', type: 'button', text: 'Watch browser', onclick: () => openBrowserViewer(row.run)});
      const element = h('div', {class: 'activity-agent-row', role: 'listitem', dataset: {runId: run.id}}, h('div', {class: 'activity-agent-row-head'}, title, state), browsers, h('div', {class: 'activity-agent-row-actions'}, view, watch));
      row = {element, title, state, browsers, view, watch, run}; parts.rosterRows.set(run.id, row);
    }
    row.run = run;
    const metadata = browserInventoryForRun(run.id);
    const ready = (metadata?.browsers || []).filter(browser => browser.state === 'ready' && browser.tabs?.length).length;
    row.title.textContent = run.label || 'Agent';
    row.state.textContent = `${run.stopping ? 'Stopping' : 'Running'} · ${duration(run.seconds)}`;
    row.browsers.textContent = ready ? `${ready} ${ready === 1 ? 'browser' : 'browsers'} ready to view`
      : metadata?.browser_state === 'unavailable' ? 'Browser preview unavailable'
        : metadata ? 'Waiting for a browser' : 'Checking browser availability…';
    row.element.dataset.selected = String(parts.selected === run.id);
    row.element.dataset.stopping = String(!!run.stopping);
    row.view.setAttribute('aria-label', `View activity for ${run.label || 'Agent'}`);
    row.view.setAttribute('aria-pressed', String(parts.selected === run.id));
    row.watch.setAttribute('aria-label', `Watch browser for ${run.label || 'Agent'}`);
    row.watch.disabled = !run.id || run.id === 'legacy' || (metadata?.browser_state === 'unavailable' && !ready);
    row.watch.title = row.watch.disabled ? metadata?.message || 'This run does not have a browser preview.' : 'Watch this agent without opening Chrome on your desktop.';
    // Keep the same buttons mounted across both SSE and metadata updates.
    if (parts.roster.children[index] !== row.element) parts.roster.insertBefore(row.element, parts.roster.children[index] || null);
  });
}

export function appendRunLines(entries) {
  if (!parts || !entries?.length) return;
  for (const entry of entries) {
    const key = `${entry[2] || 'legacy'}:${entry[0]}`;
    if (parts.entryKeys.has(key)) continue;
    parts.entries.push(entry); parts.entryKeys.add(key); parts.eventByKey.set(key, readableActivity(entry[1]));
  }
  if (parts.entries.length > MAX_LINES) {
    parts.retention.hidden = false;
    for (const entry of parts.entries.splice(0, parts.entries.length - MAX_LINES)) {
      const key = `${entry[2] || 'legacy'}:${entry[0]}`; parts.entryKeys.delete(key); parts.eventByKey.delete(key);
    }
  }
  renderProgress(); renderSummary();
}

export function clearConsoleLines() {
  resetBrowserCatalog();
  closeBrowserViewer();
  if (!parts) return;
  parts.entries = []; parts.entryKeys.clear(); parts.eventByKey.clear(); parts.runs = []; parts.selected = ''; parts.snapshot = null; parts.stopping.clear(); parts.pickerKey = ''; parts.rawKey = ''; parts.retention.hidden = true; wasRunning = false;
  parts.lines.replaceChildren(); parts.picker.replaceChildren(); parts.pickerWrap.hidden = true; parts.details.open = false; parts.jump.hidden = true; parts.follow = true;
  renderProgress(); renderSummary();
}

export function updateConsoleStatus(snapshot) {
  if (!parts || !snapshot) return;
  parts.snapshot = snapshot;
  parts.runs = activityRuns(snapshot).sort((a, b) => Number(b.running) - Number(a.running) || String(b.started_at || b.finished || '').localeCompare(String(a.started_at || a.finished || '')));
  updateBrowserCatalogRuns(parts.runs);
  updateBrowserViewerRun(parts.runs);
  const previous = parts.selected;
  if (!selectedRun() || (!wasRunning && parts.runs.some(run => run.running))) parts.selected = parts.runs[0]?.id || '';
  if (snapshot.truncated) parts.retention.hidden = false;
  const key = parts.runs.map(run => `${run.id}:${run.status}:${run.label}`).join('|');
  if (key !== parts.pickerKey) {
    parts.picker.replaceChildren(...parts.runs.map(run => h('option', {value: run.id, text: `${run.label} · ${activityState(run)}${clock(run.started_at || run.finished) ? ` · ${clock(run.started_at || run.finished)}` : ''}`})));
    parts.pickerKey = key;
  }
  parts.picker.value = parts.selected;
  parts.pickerWrap.hidden = !parts.runs.length;
  if (previous !== parts.selected) { parts.rawKey = ''; parts.follow = true; }
  renderProgress(); renderSummary();
  const live = parts.runs.some(run => run.running);
  if (live && !wasRunning && S.consoleSize === 'collapsed') setConsoleSize('normal');
  wasRunning = live;
}

export function updateConsoleConnection(state) {
  if (!parts) return;
  const labels = {connecting: 'Connecting…', live: 'Live updates', reconnecting: 'Reconnecting…', fallback: 'Periodic updates', offline: 'Connection lost'};
  parts.connection.textContent = labels[state] || labels.connecting;
  parts.connection.dataset.connection = state;
  parts.connection.title = {
    connecting: 'Connecting to agent activity.', live: 'Updates arrive as the agent reports progress.',
    reconnecting: 'Keeping the last update visible while the connection recovers.',
    fallback: 'The live connection is unavailable. Activity is checked periodically.',
    offline: 'The latest activity may be out of date. Reconnecting automatically.',
  }[state] || '';
}
