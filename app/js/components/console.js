/** Persistent Activity sheet. Each workspace-owned run has its own progress and controls. */
import {h} from '../dom.js';
import {icon} from '../icons.js';
import {api, accountRequestSignal} from '../api.js';
import {toast} from './toast.js';
import {confirmDialog} from './dialog.js';
import {avatar} from './identity.js';
import {S, hooks} from '../state.js';
import {duration} from '../format.js';
import {activityRuns, activityState, readableActivity, activityDescription, activityRecovery} from './activity-format.js';
import {initBrowserCatalog, resetBrowserCatalog, setBrowserCatalogActivityOpen, updateBrowserCatalogRuns, browserInventoryForRun, browserInventoryError, browserCountSummary} from './browser-catalog.js';
import {createSignInBrowsers, setSignInBrowsersActivityOpen} from './signin-browsers.js';

let parts = null, wasRunning = false, consoleAvailable = false;
const MAX_LINES = 5000;
const clock = value => value && !Number.isNaN(new Date(value).valueOf()) ? new Date(value).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '';
const selectedRun = () => parts?.runs.find(run => run.id === parts.selected);
const selectedLines = () => parts.entries.filter(entry => entry[2] ? entry[2] === parts.selected : parts.selected === 'legacy' || parts.runs.length <= 1);
const statusUncertain = () => ['connecting', 'reconnecting', 'offline'].includes(parts?.connectionState);
const runState = run => run?.running && statusUncertain() ? 'Status unknown' : activityState(run);
// Match the existing Bot Crew artwork without loading the Bot Crew route.
const runArtwork = run => {
  const label = String(run?.label || '').toLowerCase();
  const board = ['hirist', 'instahyre', 'cutshort', 'wellfound'].findIndex(name => label.includes(name));
  if (board >= 0) return /profile/.test(label) ? 16 + board : 1 + board;
  if (/learning/.test(label)) return 11;
  if (/briefing/.test(label)) return 12;
  if (/research/.test(label)) return 13;
  return {naukri: 0, external: 5, profile: 6, linkedin: 7, linkedin_profile: 8, cold_email: 9, resume: 10}[run?.action] ?? 22;
};

function setActivityView(view, focus = false) {
  if (!parts) return;
  if (!S.legacyAccess) view = 'browsers';
  parts.view = view;
  parts.root.dataset.view = view;
  for (const [name, tab] of Object.entries(parts.tabs)) {
    const selected = name === view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    parts.panels[name].hidden = !selected;
  }
  if (focus) parts.tabs[view].focus();
  if (view === 'progress') requestAnimationFrame(followLatest);
}

function selectRun(id, focus = false) {
  parts.selected = id; parts.picker.value = id; parts.follow = true; parts.rawKey = ''; parts.showEarlier = false;
  setActivityView('progress');
  renderProgress(); renderSummary();
  if (focus) parts.picker.focus();
}

function syncConsolePolling() {
  const active = consoleAvailable && S.consoleSize !== 'collapsed';
  setBrowserCatalogActivityOpen(active);
  setSignInBrowsersActivityOpen(active);
}

export function setConsoleAccess(available) {
  consoleAvailable = !!available;
  if (!parts) return;
  const accessChanged = parts.root.dataset.access !== (S.legacyAccess ? 'workspace' : 'connections');
  parts.root.dataset.access = S.legacyAccess ? 'workspace' : 'connections';
  parts.tablist.hidden = !S.legacyAccess;
  setActivityView(S.legacyAccess ? accessChanged ? 'progress' : parts.view : 'browsers');
  // Account resets also reset the stored size. Keep the mounted sheet in sync
  // so a new session never inherits an expanded, privately populated view.
  if (parts.root.dataset.size !== S.consoleSize) setConsoleSize(S.consoleSize, {preserveView: true});
  else syncConsolePolling();
  renderSummary();
}

// Workspace actions open Progress; the launcher preserves its current view.
export function setConsoleSize(size, {preserveView = false} = {}) {
  S.consoleSize = size;
  if (!parts) return;
  const collapsed = size === 'collapsed';
  if (!collapsed && !preserveView) setActivityView('progress');
  const restoreFocus = collapsed && parts.sheet.contains(document.activeElement);
  parts.root.dataset.size = size;
  if (restoreFocus) parts.toggleButton.focus();
  parts.sheet.hidden = collapsed;
  parts.body.hidden = collapsed;
  parts.toggleButton.setAttribute('aria-expanded', String(!collapsed));
  parts.toggleButton.title = collapsed ? 'Open Activity' : 'Close activity';
  parts.toggleIcon.replaceChildren(icon(collapsed ? 'activity' : 'x'));
  parts.resize.replaceChildren(icon(size === 'expanded' ? 'minimize' : 'maximize'), h('span', {text: size === 'expanded' ? 'Restore' : 'Expand'}));
  parts.resize.setAttribute('aria-label', size === 'expanded' ? 'Restore activity size' : 'Expand activity');
  parts.resize.title = size === 'expanded' ? 'Restore activity size' : 'Expand activity';
  parts.resize.setAttribute('aria-expanded', String(size === 'expanded'));
  renderLauncher();
  syncConsolePolling();
  if (!collapsed && consoleAvailable && S.legacyAccess) requestAnimationFrame(followLatest);
}

function timelineScroller() {
  return getComputedStyle(parts.runDetail).overflowY === 'auto' ? parts.runDetail : parts.scroll;
}

function followLatest() {
  if (!parts?.follow) return;
  const scroll = timelineScroller();
  scroll.scrollTop = parts.details.open ? scroll.scrollHeight : 0;
}

async function stopRun() {
  if (!S.legacyAccess) return;
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
  if (!S.legacyAccess) return;
  const text = selectedLines().map(([, line,, at]) => `${clock(at) ? `[${clock(at)}] ` : ''}${line}`).join('\n');
  try { await navigator.clipboard.writeText(text); toast('This run’s output was copied.', 'info', 2000); }
  catch { toast('The browser didn’t allow copying.', 'warn'); }
}

export function initConsole() {
  const label = h('span', {class: 'activity-caption', text: 'Ready when you are'});
  const dot = h('span', {class: 'console-dot'});
  const toggleIcon = h('span', {class: 'activity-launch-symbol', 'aria-hidden': 'true'}, icon('activity'));
  const launchBadge = h('span', {class: 'activity-launch-badge', 'aria-hidden': 'true', hidden: true});
  const launchDescription = h('span', {class: 'activity-launch-description', id: 'activity-launch-description', text: 'No agents running.'});
  const toggleButton = h('button', {class: 'activity-launch', type: 'button', title: 'Open Activity', 'aria-label': 'Activity', 'aria-describedby': 'activity-launch-description', 'aria-expanded': 'false', 'aria-controls': 'activity-content', onclick: () => {
    const opening = S.consoleSize === 'collapsed';
    setConsoleSize(opening ? 'normal' : 'collapsed', {preserveView: true});
    if (opening) (S.legacyAccess ? parts.tabs[parts.view] : parts.resize).focus();
  }}, h('span', {class: 'activity-launch-ring', 'aria-hidden': 'true'}), toggleIcon);
  // Keep the decorative count outside the icon button's visible label. Its
  // accessible description already explains the complete run and browser state.
  const launchControl = h('div', {class: 'activity-launch-control'}, toggleButton, launchBadge);
  const resize = h('button', {class: 'activity-window-control activity-resize', type: 'button', 'aria-label': 'Expand activity', title: 'Expand activity', 'aria-expanded': 'false', onclick: () => setConsoleSize(S.consoleSize === 'expanded' ? 'normal' : 'expanded', {preserveView: true})}, icon('maximize'), h('span', {text: 'Expand'}));
  const heading = h('header', {class: 'activity-sheet-heading'}, h('div', {class: 'activity-heading-copy'}, h('h2', {}, 'Activity', dot), label), h('div', {class: 'activity-window-controls'}, resize));
  const picker = h('select', {class: 'activity-run-picker', id: 'activity-run', 'aria-label': 'Agent run', title: 'Switch agent run', onchange: () => selectRun(picker.value)});
  const connection = h('span', {class: 'activity-connection', role: 'status', text: 'Connecting…'});
  const rosterTitle = h('h3', {text: 'Running agents'});
  const roster = h('div', {class: 'activity-agent-roster', role: 'list', 'aria-label': 'Running agents'});
  const rosterEmpty = h('p', {class: 'activity-agent-empty', text: 'No agents are running'});
  const browserTotal = h('span', {class: 'activity-browser-total', text: 'Checking browser count…'});
  const browserOverview = h('strong', {class: 'activity-browser-overview-count', text: 'Checking browser count…'});
  const rosterSection = h('div', {class: 'activity-agent-section'}, h('div', {class: 'activity-agent-heading'}, rosterTitle, browserTotal),
    h('p', {class: 'activity-section-help', text: 'Follow each agent’s progress and see how many browsers it is using.'}), roster, rosterEmpty);
  const browserCount = h('span', {class: 'activity-tab-count', hidden: true});
  const signInBrowsers = createSignInBrowsers({compact: true, onChange: ({count, attention}) => {
    browserCount.textContent = attention ? '!' : String(count);
    browserCount.hidden = !count && !attention;
    browserCount.dataset.attention = String(attention);
    browserCount.setAttribute('aria-label', attention ? 'Sign-in browsers need attention' : `${count} sign-in ${count === 1 ? 'browser' : 'browsers'} open`);
    if (parts) { parts.signInCount = count; parts.signInAttention = attention; renderLauncher(); }
  }});
  const pickerWrap = h('div', {class: 'activity-run-control', hidden: true}, h('label', {class: 'visually-hidden', for: 'activity-run', text: 'Agent run'}), picker);
  const runListCount = h('span', {class: 'activity-run-count'});
  const runList = h('div', {class: 'activity-run-list', role: 'list', 'aria-label': 'Agent runs'});
  const runListEmpty = h('p', {class: 'activity-run-list-empty', text: 'Your runs will appear here.'});
  const runRail = h('aside', {class: 'activity-run-rail', 'aria-label': 'Run selection'},
    h('div', {class: 'activity-run-rail-heading'}, h('h3', {text: 'Runs'}), runListCount), runList, runListEmpty);
  const summaryTitle = h('strong', {text: 'Your crew is ready'});
  const summaryArtwork = h('div', {class: 'activity-run-artwork', 'aria-hidden': 'true'});
  const summaryText = h('span', {text: 'Run a bot to follow its progress here.'});
  const recovery = h('a', {class: 'btn btn-sm activity-recovery', hidden: true, onclick: event => {
    // An account reset or selection change may invalidate a previously shown link.
    const current = S.legacyAccess && activityRecovery(selectedRun(), progressEvents());
    if (!current) { event.preventDefault(); return; }
    setConsoleSize('collapsed');
  }});
  const elapsed = h('span', {class: 'activity-elapsed'});
  const status = h('span', {class: 'activity-state', text: 'Standby', role: 'status'});
  const progress = h('div', {class: 'activity-progress', role: 'log', 'aria-label': 'Run progress', 'aria-live': 'off'});
  // Raw output is optional and intentionally not a live region: noisy output must
  // not interrupt a screen reader on every line.
  const lines = h('div', {class: 'console-lines', role: 'log', 'aria-label': 'Run output', 'aria-live': 'off', tabindex: '0'});
  const detailLabel = h('span', {text: 'Technical details'});
  const details = h('details', {class: 'activity-details', hidden: true, ontoggle: () => { if (details.open) { renderRaw(); followLatest(); } }}, h('summary', {}, icon('chevron-right'), detailLabel), lines);
  const empty = h('div', {class: 'activity-empty'}, avatar(23, 'activity-empty-art'), h('h3', {text: 'No runs yet'}), h('p', {text: 'Start a bot or flow to see its progress here. Each run keeps its own updates and output.'}), h('a', {class: 'btn', href: '#/bots', onclick: () => setConsoleSize('collapsed'), text: 'Browse bots'}));
  const stopBtn = h('button', {class: 'btn btn-sm btn-danger', type: 'button', onclick: stopRun, hidden: true}, icon('stop', 'icon icon-sm'), 'Stop');
  const copy = h('button', {class: 'btn btn-sm', type: 'button', 'aria-label': 'Copy output', onclick: copyConsole, disabled: true}, icon('copy', 'icon icon-sm'), 'Copy');
  details.insertBefore(h('div', {class: 'activity-detail-toolbar'}, h('span', {text: 'Full output for this run'}), copy), lines);
  const selectedBrowsers = h('span', {class: 'activity-selected-browsers', hidden: true});
  const retention = h('p', {class: 'activity-retention', hidden: true, text: 'Showing the most recent output; earlier details are no longer available.'});
  const progressCount = h('span', {class: 'activity-progress-count'});
  const earlier = h('button', {class: 'text-link activity-earlier', type: 'button', hidden: true, text: 'Show earlier updates', 'aria-expanded': 'false', onclick: () => {
    parts.showEarlier = !parts.showEarlier;
    parts.follow = false;
    renderProgress();
  }});
  const progressHeading = h('div', {class: 'activity-progress-heading'}, h('h3', {text: 'Recent progress'}), progressCount);
  const scroll = h('div', {class: 'activity-scroll', tabindex: '0', 'aria-label': 'Activity timeline'}, empty, retention, progressHeading, progress, earlier, details);
  const jump = h('button', {class: 'activity-jump', type: 'button', text: 'Back to latest', hidden: true, onclick: () => { parts.follow = true; followLatest(); jump.hidden = true; }});
  // Keep native keyboard and screen-reader selection, with the selected run's
  // identity as its visible face instead of repeating it in a second dropdown.
  pickerWrap.append(h('div', {class: 'activity-summary-heading'},
    summaryArtwork, h('div', {class: 'activity-run-identity'}, summaryTitle, status), icon('chevron-down', 'icon activity-run-chevron')));
  const runSummary = h('div', {class: 'activity-summary'}, pickerWrap, summaryText, elapsed, recovery);
  const runLog = h('div', {class: 'activity-log-wrap'}, scroll);
  const runFooter = h('div', {class: 'activity-footer'}, jump, h('div', {class: 'activity-footer-context'}, connection, h('div', {class: 'activity-browser-summary'}, icon('globe'), selectedBrowsers)), stopBtn);
  const attention = h('button', {class: 'activity-attention', type: 'button', hidden: true, onclick: () => {
    const run = parts.runs.find(item => item.status === 'failed');
    if (run) selectRun(run.id, true);
  }});
  const agentCount = h('span', {class: 'activity-tab-count', hidden: true});
  const tabs = {}, panels = {};
  for (const [name, title, glyph, count] of [['progress', 'Progress', 'activity'], ['agents', 'Agents', 'bot', agentCount], ['browsers', 'Browsers', 'globe', browserCount]]) {
    tabs[name] = h('button', {type: 'button', class: 'activity-tab', role: 'tab', id: `activity-tab-${name}`, 'aria-controls': `activity-panel-${name}`, 'aria-selected': String(name === 'progress'), tabindex: name === 'progress' ? '0' : '-1', onclick: () => setActivityView(name)}, icon(glyph, 'icon icon-sm'), title, count);
    panels[name] = h('div', {class: `activity-panel activity-${name}-panel`, role: 'tabpanel', id: `activity-panel-${name}`, 'aria-labelledby': `activity-tab-${name}`, hidden: name !== 'progress', tabindex: '0'});
  }
  const tablist = h('div', {class: 'activity-tabs', role: 'tablist', 'aria-label': 'Activity views', onkeydown: event => {
    const names = Object.keys(tabs), index = names.indexOf(parts.view);
    const next = event.key === 'ArrowRight' ? (index + 1) % names.length : event.key === 'ArrowLeft' ? (index + names.length - 1) % names.length : event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); setActivityView(names[next], true); }
  }}, Object.values(tabs));
  const runDetail = h('div', {class: 'activity-run-detail'}, attention, runSummary, runLog);
  panels.progress.append(runRail, runDetail, runFooter);
  panels.agents.append(rosterSection);
  panels.browsers.append(h('div', {class: 'activity-browser-overview'}, h('div', {}, h('h3', {text: 'Agent browsers'}), browserOverview, h('p', {text: 'Your agents use their own Chrome windows. Follow their live progress in Activity.'}))), signInBrowsers);
  const body = h('div', {id: 'activity-content', class: 'console-body', hidden: true}, tablist, ...Object.values(panels));
  const sheet = h('div', {class: 'activity-sheet', hidden: true}, heading, body);
  const root = h('section', {class: 'console activity-console', 'aria-label': 'Activity', dataset: {size: 'collapsed'}, onkeydown: event => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.preventDefault(); setConsoleSize('collapsed'); }
  }}, sheet, launchControl, launchDescription);
  document.getElementById('console-dock').append(root);
  parts = {root, sheet, body, launchBadge, launchDescription, signInCount: 0, signInAttention: false, label, dot, lines, empty, progress, details, detailLabel, retention, scroll, picker, pickerWrap, connection, runList, runListCount, runListEmpty, runRows: new Map(), runDetail, roster, rosterTitle, rosterEmpty, rosterRows: new Map(), stopBtn, copy, selectedBrowsers, browserTotal, browserOverview, resize, jump, toggleIcon, toggleButton, summaryTitle, summaryArtwork, summaryText, recovery, elapsed, status, runSummary, runFooter, progressHeading, progressCount, earlier, attention, agentCount, tablist, tabs, panels, view: 'progress', showEarlier: false, follow: true, runs: [], entries: [], entryKeys: new Set(), eventByKey: new Map(), selected: '', stopping: new Set(), rawKey: '', pickerKey: '', snapshot: null};
  initBrowserCatalog(renderRoster);
  window.addEventListener('signin-browsers-manage', () => setConsoleSize('collapsed'));
  for (const container of [scroll, runDetail]) container.addEventListener('scroll', () => {
    if (container !== timelineScroller()) return;
    parts.follow = parts.details.open ? container.scrollTop + container.clientHeight >= container.scrollHeight - 24 : container.scrollTop <= 24;
    jump.hidden = parts.follow;
  });
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
  return events;
}

function renderProgress() {
  if (!parts) return;
  const scroller = timelineScroller(), readingPosition = scroller.scrollTop;
  const run = selectedRun(), entries = selectedLines(), allEvents = progressEvents();
  const events = allEvents.slice(parts.showEarlier ? -40 : -5).reverse();
  parts.empty.hidden = !!run || entries.length > 0;
  parts.progress.hidden = !parts.empty.hidden;
  parts.progressHeading.hidden = !parts.empty.hidden;
  parts.progressCount.textContent = allEvents.length ? `${events.length} of ${allEvents.length}` : '';
  parts.earlier.hidden = allEvents.length <= 5;
  parts.earlier.textContent = parts.showEarlier ? 'Show fewer updates' : 'Show earlier updates';
  parts.earlier.setAttribute('aria-expanded', String(parts.showEarlier));
  parts.copy.disabled = !entries.length;
  parts.details.hidden = !entries.length;
  parts.detailLabel.textContent = `Technical details · ${entries.length.toLocaleString()} ${entries.length === 1 ? 'line' : 'lines'}`;
  const rows = events.map((event, index) => h('div', {class: 'activity-event', dataset: {kind: event.kind}},
    h('span', {class: 'activity-event-mark', 'aria-hidden': 'true'}, event.kind === 'attention' ? icon('alert-triangle') : index === 0 ? icon('activity') : '•'),
    h('div', {class: 'activity-event-copy'}, h('strong', {text: event.title}), h('p', {text: event.detail})),
    event.at ? h('time', {datetime: event.at, text: clock(event.at)}) : null));
  if (!events.length && run) rows.push(h('div', {class: 'activity-waiting'}, h('strong', {text: run.running ? 'Waiting for the next update' : 'Run result available'}), h('p', {text: run.running ? 'Some steps take a little time to report progress. You can keep using the workspace.' : 'Review the status above and open Technical details for the full output.'})));
  parts.progress.replaceChildren(...rows);
  renderRaw();
  if (parts.follow) followLatest();
  else {
    parts.jump.hidden = false;
    // Replacing summarized events must not let browser scroll anchoring move
    // someone who is reading the retained output when a new line arrives.
    scroller.scrollTop = readingPosition;
  }
}

function renderSummary() {
  if (!parts) return;
  renderRunList();
  renderLauncher();
  const run = selectedRun(), events = progressEvents(), recovery = S.legacyAccess ? activityRecovery(run, events) : null;
  parts.runSummary.hidden = !run;
  parts.runFooter.hidden = !run;
  parts.recovery.hidden = !recovery;
  parts.recovery.textContent = recovery?.label || '';
  if (recovery) parts.recovery.setAttribute('href', recovery.href);
  else parts.recovery.removeAttribute('href');
  if (!S.legacyAccess) {
    parts.root.dataset.state = 'idle';
    parts.dot.className = 'console-dot';
    parts.label.textContent = 'Your sign-in browser controls';
    renderRoster();
    return;
  }
  const live = parts.runs.filter(item => item.running), state = runState(run), latest = events.at(-1);
  const failed = parts.runs.filter(item => item.status === 'failed');
  parts.agentCount.textContent = String(live.length);
  parts.agentCount.hidden = !live.length;
  parts.attention.hidden = !failed.length || run?.status === 'failed';
  const attentionText = `${failed.length} ${failed.length === 1 ? 'run needs' : 'runs need'} attention`;
  parts.attention.textContent = `${attentionText} · Review`;
  const uncertain = statusUncertain(), selectedUncertain = !!run?.running && uncertain;
  parts.root.dataset.state = selectedUncertain ? 'unknown' : run?.running ? 'live' : run?.status === 'failed' ? 'error' : 'idle';
  parts.dot.className = `console-dot ${live.length && !uncertain ? 'live' : ''}`;
  parts.label.textContent = live.length && uncertain ? 'Agent status unknown · checking for updates' : live.length > 1 ? `${live.length} agents working${failed.length ? ` · ${attentionText}` : ''}` : live.length ? `${live[0].label} · ${duration(live[0].seconds)}${failed.length ? ` · ${attentionText}` : ''}` : failed.length ? attentionText : run ? `${run.label} · ${state.toLowerCase()}` : 'Ready when you are';
  parts.summaryTitle.textContent = run?.label || 'Your crew is ready';
  if (parts.summaryArtwork.dataset.run !== (run?.id || '')) {
    parts.summaryArtwork.replaceChildren(avatar(runArtwork(run)));
    parts.summaryArtwork.dataset.run = run?.id || '';
  }
  parts.runSummary.dataset.attention = String(!!recovery || run?.status === 'failed');
  parts.summaryText.textContent = selectedUncertain ? `Updates are interrupted. This agent was last seen ${run.stopping ? 'stopping' : 'running'}; its current status is unknown. Checking again automatically.` : recovery && run?.status === 'failed' ? recovery.detail : activityDescription(run, latest);
  // The latest event already contains this detail. Reserve the overview for
  // lifecycle results, connection uncertainty, and actionable recovery.
  parts.summaryText.hidden = !!run?.running && !run.stopping && !selectedUncertain && !recovery && !!latest;
  const lastAt = selectedLines().at(-1)?.[3];
  parts.elapsed.textContent = run ? `${selectedUncertain ? 'Last known duration' : run.running ? 'Elapsed' : 'Duration'} ${duration(run.seconds)}${lastAt ? ` · Last output ${clock(lastAt)}` : ''}` : '';
  if (parts.status.textContent !== state) parts.status.textContent = state;
  parts.stopBtn.hidden = !run?.running;
  parts.stopBtn.disabled = !!run && parts.stopping.has(run.id);
  parts.stopBtn.replaceChildren(icon('stop', 'icon icon-sm'), parts.stopBtn.disabled ? 'Requesting…' : run?.stopping ? 'Force stop' : 'Stop');
  parts.stopBtn.title = run ? `Stop only ${run.label}` : '';
  renderRoster();
}

function renderLauncher() {
  const runs = S.legacyAccess ? parts.runs : [];
  const live = runs.filter(run => run.running).length;
  const failed = runs.filter(run => run.status === 'failed').length;
  const unknown = live > 0 && statusUncertain();
  const attention = failed > 0 || parts.signInAttention;
  parts.root.dataset.launchState = attention ? 'attention' : unknown ? 'unknown' : live ? 'live' : 'idle';
  parts.launchBadge.textContent = attention ? '!' : unknown ? '?' : live ? String(live) : parts.signInCount ? String(parts.signInCount) : '';
  parts.launchBadge.hidden = !parts.launchBadge.textContent;
  const status = unknown ? 'Agent status unknown. Checking for updates.' : live ? `${live} ${live === 1 ? 'agent running' : 'agents running'}.` : 'No agents running.';
  const name = attention ? 'Needs attention' : unknown ? 'Status unknown' : live ? `${live} ${live === 1 ? 'agent running' : 'agents running'}` : parts.signInCount ? `${parts.signInCount} sign-in browsers open` : '';
  parts.toggleButton.setAttribute('aria-label', S.consoleSize === 'collapsed' ? `Activity${name ? ` · ${name}` : ''}` : 'Close activity');
  parts.launchDescription.textContent = [status,
    failed ? `${failed} ${failed === 1 ? 'run needs' : 'runs need'} attention.` : '',
    parts.signInAttention ? 'A sign-in browser needs attention.' : parts.signInCount ? `${parts.signInCount} sign-in browsers open.` : '',
  ].filter(Boolean).join(' ');
}

function renderRunList() {
  const runs = S.legacyAccess ? parts.runs : [], ids = new Set(runs.map(run => run.id));
  const focused = parts.runList.contains(document.activeElement) ? document.activeElement : null;
  parts.root.dataset.empty = String(runs.length === 0);
  parts.runListCount.textContent = String(runs.length);
  parts.runListEmpty.hidden = runs.length > 0;
  for (const [id, row] of parts.runRows) if (!ids.has(id)) { row.element.remove(); parts.runRows.delete(id); }
  runs.forEach((run, index) => {
    let row = parts.runRows.get(run.id);
    if (!row) {
      const title = h('strong'), state = h('span', {class: 'activity-run-row-state'}), elapsed = h('span', {class: 'activity-run-row-time'});
      const artwork = h('span', {class: 'activity-run-row-art', 'aria-hidden': 'true'}, avatar(runArtwork(run)));
      const button = h('button', {class: 'activity-run-row', type: 'button', onclick: () => selectRun(row.run.id)},
        artwork, h('span', {class: 'activity-run-row-copy'}, title, ' ', h('span', {class: 'activity-run-row-meta'}, state, ' ', elapsed)));
      const element = h('div', {role: 'listitem'}, button);
      row = {element, button, title, state, elapsed, run}; parts.runRows.set(run.id, row);
    }
    row.run = run;
    row.title.textContent = run.label || 'Agent';
    row.state.textContent = runState(run);
    row.elapsed.textContent = duration(run.seconds);
    row.button.dataset.state = run.running && statusUncertain() ? 'unknown' : run.status;
    row.button.setAttribute('aria-label', `Follow ${run.label || 'Agent'} ${runState(run)} ${duration(run.seconds)}`);
    row.button.setAttribute('aria-pressed', String(parts.selected === run.id));
    // Keep focused controls mounted when activity arrives or a run finishes.
    if (parts.runList.children[index] !== row.element) parts.runList.insertBefore(row.element, parts.runList.children[index] || null);
  });
  if (focused?.isConnected && document.activeElement !== focused) focused.focus({preventScroll: true});
}

function browserCountText(run) {
  if (statusUncertain()) return 'Browser count unknown';
  const metadata = browserInventoryForRun(run.id);
  if (browserInventoryError() || metadata?.count_status === 'unavailable') return 'Browser count unavailable';
  if (!metadata || metadata.count_status !== 'ready') return 'Checking browser count…';
  const count = metadata.open_browser_count;
  return `${count} ${count === 1 ? 'browser' : 'browsers'} open`;
}

function renderRoster() {
  if (!parts) return;
  parts.roster.hidden = !S.legacyAccess;
  parts.browserOverview.closest('.activity-browser-overview').hidden = !S.legacyAccess;
  parts.browserTotal.hidden = !S.legacyAccess;
  const selected = selectedRun();
  parts.selectedBrowsers.hidden = !S.legacyAccess || !selected?.running;
  parts.selectedBrowsers.textContent = selected?.running ? browserCountText(selected) : '';
  if (!S.legacyAccess) {
    parts.rosterTitle.textContent = 'Browsers';
    parts.rosterEmpty.hidden = true;
    parts.roster.replaceChildren(); parts.rosterRows.clear();
    parts.browserTotal.textContent = ''; parts.browserOverview.textContent = '';
    return;
  }
  const runs = parts.runs.filter(run => run.running), ids = new Set(runs.map(run => run.id));
  const uncertain = statusUncertain();
  const summary = browserCountSummary();
  const totalText = uncertain && runs.length ? 'Browser count unknown' : summary.state === 'ready' ? `${summary.count} agent ${summary.count === 1 ? 'browser' : 'browsers'} open`
    : summary.state === 'checking' ? 'Checking browser count…' : 'Browser count unavailable';
  parts.browserTotal.textContent = totalText;
  parts.browserOverview.textContent = totalText;
  parts.rosterTitle.textContent = `${uncertain ? 'Last known agents' : 'Running agents'} · ${runs.length}`;
  parts.roster.setAttribute('aria-label', uncertain ? 'Last known agents' : 'Running agents');
  parts.rosterEmpty.textContent = uncertain ? 'Checking for running agents…' : 'No agents are running';
  parts.rosterEmpty.hidden = runs.length > 0;
  for (const [id, row] of parts.rosterRows) if (!ids.has(id)) { row.element.remove(); parts.rosterRows.delete(id); }
  runs.forEach((run, index) => {
    let row = parts.rosterRows.get(run.id);
    if (!row) {
      const title = h('strong'), state = h('span', {class: 'activity-agent-run-state'}), browsers = h('p', {class: 'activity-agent-browser-state'});
      const view = h('button', {class: 'btn btn-sm', type: 'button', text: 'View activity', onclick: () => selectRun(row.run.id, true)});
      const element = h('div', {class: 'activity-agent-row', role: 'listitem', dataset: {runId: run.id}},
        avatar(runArtwork(run), 'activity-agent-avatar'), h('div', {class: 'activity-agent-row-head'}, title, state), browsers, h('div', {class: 'activity-agent-row-actions'}, view));
      row = {element, title, state, browsers, view, run}; parts.rosterRows.set(run.id, row);
    }
    row.run = run;
    row.title.textContent = run.label || 'Agent';
    row.state.textContent = uncertain ? 'Status unknown' : `${run.stopping ? 'Stopping' : 'Running'} · ${duration(run.seconds)}`;
    row.browsers.textContent = browserCountText(run);
    row.element.dataset.selected = String(parts.selected === run.id);
    row.element.dataset.stopping = String(!!run.stopping);
    row.element.dataset.uncertain = String(uncertain);
    row.view.setAttribute('aria-label', `View activity for ${run.label || 'Agent'}`);
    row.view.setAttribute('aria-pressed', String(parts.selected === run.id));
    // Keep the same buttons mounted across both SSE and metadata updates.
    if (parts.roster.children[index] !== row.element) parts.roster.insertBefore(row.element, parts.roster.children[index] || null);
  });
}

export function appendRunLines(entries) {
  if (!parts || !S.legacyAccess || !entries?.length) return;
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
  if (!parts) return;
  parts.entries = []; parts.entryKeys.clear(); parts.eventByKey.clear(); parts.runs = []; parts.selected = ''; parts.snapshot = null; parts.stopping.clear(); parts.pickerKey = ''; parts.rawKey = ''; parts.retention.hidden = true; wasRunning = false;
  parts.lines.replaceChildren(); parts.picker.replaceChildren(); parts.pickerWrap.hidden = true; parts.details.open = false; parts.jump.hidden = true; parts.follow = true;
  parts.showEarlier = false;
  parts.signInCount = 0; parts.signInAttention = false;
  setActivityView(S.legacyAccess ? 'progress' : 'browsers');
  renderProgress(); renderSummary();
}

export function updateConsoleStatus(snapshot) {
  if (!parts || !S.legacyAccess || !snapshot) return;
  parts.snapshot = snapshot;
  parts.runs = activityRuns(snapshot).sort((a, b) => Number(b.running) - Number(a.running) || String(b.started_at || b.finished || '').localeCompare(String(a.started_at || a.finished || '')));
  updateBrowserCatalogRuns(parts.runs);
  const previous = parts.selected;
  if (!selectedRun() || (!wasRunning && parts.runs.some(run => run.running))) parts.selected = parts.runs[0]?.id || '';
  if (snapshot.truncated) parts.retention.hidden = false;
  renderRunPicker();
  if (previous !== parts.selected) { parts.rawKey = ''; parts.follow = true; parts.showEarlier = false; }
  renderProgress(); renderSummary();
  const live = parts.runs.some(run => run.running);
  // Incoming work updates the circle; opening the sheet remains a user action.
  if (live && !wasRunning && S.consoleSize === 'collapsed') setActivityView('progress');
  wasRunning = live;
}

function renderRunPicker() {
  const key = parts.runs.map(run => `${run.id}:${runState(run)}:${run.label}`).join('|');
  if (key !== parts.pickerKey) {
    parts.picker.replaceChildren(...parts.runs.map(run => h('option', {value: run.id, text: `${run.label} · ${runState(run)}${clock(run.started_at || run.finished) ? ` · ${clock(run.started_at || run.finished)}` : ''}`})));
    parts.pickerKey = key;
  }
  parts.picker.value = parts.selected;
  parts.pickerWrap.hidden = !parts.runs.length;
}

export function updateConsoleConnection(state) {
  if (!parts || !S.legacyAccess) return;
  parts.connectionState = state;
  const labels = {connecting: 'Connecting…', live: 'Live updates', reconnecting: 'Reconnecting…', fallback: 'Periodic updates', offline: 'Connection lost'};
  parts.connection.textContent = labels[state] || labels.connecting;
  parts.connection.dataset.connection = state;
  parts.connection.title = {
    connecting: 'Connecting to agent activity.', live: 'Updates arrive as the agent reports progress.',
    reconnecting: 'Keeping the last update visible while the connection recovers.',
    fallback: 'The live connection is unavailable. Activity is checked periodically.',
    offline: 'The latest activity may be out of date. Reconnecting automatically.',
  }[state] || '';
  renderRunPicker(); renderSummary();
}
