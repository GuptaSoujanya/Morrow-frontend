/** Manual sign-in browser controls in Activity, separate from agent browser counts. */
import {h} from '../dom.js';
import {api, accountRequestSignal} from '../api.js';

const SCOPES = new Set(['main', 'lane:hirist', 'lane:instahyre', 'lane:cutshort', 'lane:wellfound']);
const PROVIDERS = {naukri: 'Naukri', linkedin: 'LinkedIn', hirist: 'Hirist', instahyre: 'Instahyre', cutshort: 'Cutshort', wellfound: 'Wellfound', google: 'Google / Gmail'};
const TRANSITIONAL = new Set(['opening', 'checking', 'closing', 'switching', 'disconnecting']);
const STATES = {connected: 'Sign-in checked', needs_sign_in: 'Sign-in needed', needs_attention: 'Needs attention', not_connected: 'Not checked', opening: 'Opening…', checking: 'Checking…', closing: 'Closing…', switching: 'Changing account…', disconnecting: 'Disconnecting…'};
const views = new Set(), snapshots = new Map(), failures = new Map(), selections = new Map(), chosenAccounts = new Set(), actionErrors = new Map();
let work, activityOpen = false, pageAway = false, notice = '', noticeError = false, closing = null, checking = null;
const active = () => !pageAway && !document.hidden && activityOpen;
const current = token => work === token && !token.scope.aborted;
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

function clearData() {
  snapshots.clear(); failures.clear(); selections.clear(); chosenAccounts.clear(); actionErrors.clear(); notice = ''; noticeError = false; closing = null; checking = null; render();
}
function cancelRead(token) {
  if (!token) return;
  clearTimeout(token.timer); token.timer = null;
  token.revision++; token.request?.abort();
}
function discard() {
  if (work) { cancelRead(work); work.scope.removeEventListener('abort', resetSignInBrowsers); }
  work = null; clearData();
}
function schedule(token, delay = 5000) {
  clearTimeout(token.timer);
  if (current(token) && active()) token.timer = setTimeout(() => refresh(token), delay);
}
function validSnapshot(value, scope) {
  if (!Array.isArray(value?.connections) || (value.scope && value.scope !== scope)) throw new Error('The sign-in browser status could not be read.');
  return {...value, connections: value.connections.filter(row => Object.hasOwn(PROVIDERS, row?.id) &&
    (scope === 'main' || row.id === 'google' || row.id === scope.slice(5)))};
}
async function refresh(token) {
  if (!current(token) || !active() || token.mutation) return;
  if (token.reading) { token.queued = true; return; }
  clearTimeout(token.timer); token.timer = null;
  const request = new AbortController(), revision = ++token.revision;
  token.request = request; token.reading = true; render();
  const stillCurrent = () => current(token) && active() && revision === token.revision;
  async function read(scope) {
    try {
      const result = validSnapshot(await api('/api/connections?' + new URLSearchParams({scope}), undefined, {signal: request.signal}), scope);
      if (!stillCurrent()) return;
      snapshots.set(scope, result); failures.delete(scope); render();
      return result;
    } catch (error) {
      if (!stillCurrent() || error.name === 'AbortError') return;
      // Do not leave private statuses actionable when permission has changed.
      if (error.status === 401 || error.status === 403) snapshots.delete(scope);
      failures.set(scope, error.message); render();
    }
  }
  try {
    const main = await read('main');
    if (!stillCurrent()) return;
    const scopes = main?.scopes || snapshots.get('main')?.scopes || [];
    const lanes = [...new Set(scopes.map(item => item.id).filter(id => SCOPES.has(id) && id !== 'main'))];
    for (const scope of snapshots.keys()) if (scope !== 'main' && !lanes.includes(scope)) { snapshots.delete(scope); failures.delete(scope); }
    await Promise.all(lanes.map(read));
  } finally {
    token.reading = false;
    if (token.request === request) token.request = null;
    if (current(token)) { render(); schedule(token, token.queued ? 0 : 5000); token.queued = false; }
  }
}
function sync(immediate = false) {
  if (!active()) {
    // Pausing the view must not release an in-flight mutation. Its account token
    // and outcome survive collapse/reopen; only account reset discards them.
    cancelRead(work); snapshots.clear(); failures.clear(); render(); return;
  }
  if (!work || work.scope.aborted) {
    work = {scope: accountRequestSignal(), revision: 0, reading: false, mutation: null, queued: false};
    work.scope.addEventListener('abort', resetSignInBrowsers, {once: true});
    immediate = true;
  }
  render();
  if (immediate) refresh(work);
  else if (!work.reading && !work.timer) schedule(work);
}
export function setSignInBrowsersActivityOpen(value) { const changed = activityOpen !== value; activityOpen = value; sync(changed && value); }
export function resetSignInBrowsers() { activityOpen = false; discard(); }

function groups() {
  const result = [];
  for (const [scope, snapshot] of snapshots) {
    const buckets = new Map();
    for (const row of snapshot.connections) {
      const id = scope === 'main' ? row.id === 'linkedin' ? 'linkedin' : 'main' : scope;
      if (!buckets.has(id)) buckets.set(id, []);
      buckets.get(id).push(row);
    }
    for (const [id, rows] of buckets) {
      if (!rows.some(row => row.browser_open || row.pending)) continue;
      const label = id === 'main' ? 'Main browser' : id === 'linkedin' ? 'LinkedIn browser' : 'Parallel lane · ' + PROVIDERS[id.slice(5)];
      const selected = selections.get(id);
      const targeted = rows.find(row => row.browser_active || row.browser_provider === row.id);
      if (!rows.some(row => row.id === selected) || (!chosenAccounts.has(id) && targeted)) selections.set(id, (targeted || rows.find(row => TRANSITIONAL.has(row.state)) || rows.find(row => row.state === 'needs_sign_in' && row.account_configured) || rows[0]).id);
      result.push({id, scope, label, rows});
    }
  }
  return result;
}
async function act(id, operation) {
  const token = work, group = groups().find(item => item.id === id);
  if (!token || !current(token) || !group || token.mutation || failures.has(group.scope)) return;
  const row = group.rows.find(item => item.id === selections.get(id));
  if (!row || group.rows.some(item => item.pending || TRANSITIONAL.has(item.state) || item.profile_busy) || !row[operation === 'check' ? 'can_check' : 'can_close']) return;
  cancelRead(token); actionErrors.delete(id); notice = ''; noticeError = false; closing = null; checking = null;
  token.mutation = {id, operation}; render();
  try {
    // Preserve the saved expected account. Activity is controlling the existing
    // window; editing credentials and account hints belongs in Connections.
    const result = validSnapshot(await api(`/api/connections/${row.id}/${operation}`, {scope: group.scope}), group.scope);
    if (!current(token)) return;
    snapshots.set(group.scope, result); failures.delete(group.scope);
    const updated = result.connections.find(item => item.id === row.id);
    notice = operation === 'close' ? (updated?.browser_open || updated?.pending ? 'Closing ' + group.label + '… Saved sign-ins will be kept.' : group.label + ' closed. Saved sign-ins are kept on this computer.') : 'Sign-in check requested for ' + PROVIDERS[row.id] + '. The result appears in this browser card.';
    if (operation === 'close' && (updated?.browser_open || updated?.pending)) closing = group;
    if (operation === 'check') checking = {scope: group.scope, provider: row.id};
    window.dispatchEvent(new Event('connections-changed'));
  } catch (error) {
    if (current(token) && error.name !== 'AbortError') actionErrors.set(id, error.message);
  } finally {
    if (current(token)) {
      token.mutation = null;
      if (!active()) { snapshots.clear(); failures.clear(); }
      render(); schedule(token, 1000);
    }
  }
}

function cardFor(view, group) {
  let card = view.cards.get(group.id);
  if (!card) {
    const title = h('h4'), state = h('span', {class: 'signin-browser-state'});
    const select = h('select', {class: 'browser-catalog-tabs', onchange: () => { selections.set(group.id, select.value); chosenAccounts.add(group.id); actionErrors.delete(group.id); render(); }});
    const detail = h('p', {class: 'signin-browser-detail'}), account = h('p', {class: 'signin-browser-account'});
    const check = h('button', {class: 'btn btn-sm', type: 'button', text: 'Check sign-in', onclick: () => act(group.id, 'check')});
    const close = h('button', {class: 'btn btn-sm', type: 'button', text: 'Close browser', onclick: () => act(group.id, 'close')});
    const error = h('p', {class: 'field-error', role: 'status', hidden: true});
    const node = h('article', {class: 'signin-browser-card', dataset: {browserGroup: group.id}},
      h('div', {class: 'signin-browser-heading'}, title, state), select, detail, account,
      h('div', {class: 'signin-browser-actions'}, check, close), error);
    card = {node, title, state, select, detail, account, check, close, error, key: ''}; view.cards.set(group.id, card);
  }
  const row = group.rows.find(item => item.id === selections.get(group.id));
  const pending = group.rows.some(item => item.pending || TRANSITIONAL.has(item.state));
  const busy = !!work?.mutation || pending || group.rows.some(item => item.profile_busy) || failures.has(group.scope);
  setText(card.title, group.label);
  const mutation = work?.mutation?.id === group.id ? work.mutation.operation : '';
  setText(card.state, mutation === 'close' ? 'Closing…' : mutation === 'check' ? 'Checking…' : pending ? 'Updating…' : 'Open');
  const key = group.rows.map(item => item.id).join('|');
  if (key !== card.key) { card.select.replaceChildren(...group.rows.map(item => h('option', {value: item.id, text: PROVIDERS[item.id]}))); card.key = key; }
  card.select.value = row.id; card.select.disabled = busy;
  card.select.setAttribute('aria-label', `Account to check in ${group.label}`);
  setText(card.detail, (STATES[row.state] || 'Check needed') + ' · ' + (row.message || 'Finish signing in in the automation browser, then check here.'));
  setText(card.account, row.expected_account ? 'Expected account: ' + row.expected_account : 'Uses the sign-in saved in this browser.');
  card.check.disabled = busy || !row.can_check;
  card.close.disabled = busy || !row.can_close;
  card.check.setAttribute('aria-label', `Check sign-in in ${group.label}`);
  card.close.setAttribute('aria-label', `Close browser in ${group.label}`);
  const message = actionErrors.get(group.id) || (failures.has(group.scope) ? 'Status could not refresh. Refresh before controlling this browser.' : group.rows.some(item => item.profile_busy) ? 'A workflow is using this browser. Wait until it finishes.' : '');
  setText(card.error, message); card.error.hidden = !message;
  return card.node;
}
function render() {
  const open = groups(), hasError = failures.size > 0;
  if (checking && !failures.has(checking.scope)) {
    const row = snapshots.get(checking.scope)?.connections.find(item => item.id === checking.provider);
    if (row && !row.pending && !TRANSITIONAL.has(row.state)) {
      notice = PROVIDERS[row.id] + ': ' + (row.message || STATES[row.state] || 'Check needed.');
      noticeError = row.state !== 'connected'; checking = null;
    }
  }
  if (closing && snapshots.has(closing.scope) && !failures.has(closing.scope) && !open.some(group => group.id === closing.id)) {
    notice = closing.label + ' closed. Saved sign-ins are kept on this computer.'; closing = null;
  }
  for (const view of views) {
    const message = !active() ? '' : hasError ? 'Some sign-in browser statuses could not load. Refresh to retry.' : work?.mutation && !snapshots.size ? 'Finishing the requested browser action…' : notice || (snapshots.size ? 'Your setup windows use the same saved sign-ins as Connections.' : work ? 'Checking your sign-in browsers…' : '');
    setText(view.status, message); view.status.hidden = !message;
    view.status.dataset.state = hasError || noticeError ? 'error' : 'ready';
    view.empty.hidden = open.length > 0 || !snapshots.size;
    view.refresh.disabled = !!work?.reading || !!work?.mutation;
    setText(view.count, open.length ? String(open.length) : ''); view.count.hidden = !open.length;
    const ids = new Set(open.map(group => group.id));
    for (const [id, card] of view.cards) if (!ids.has(id)) { card.node.remove(); view.cards.delete(id); }
    open.forEach((group, index) => { const node = cardFor(view, group); if (view.list.children[index] !== node) view.list.insertBefore(node, view.list.children[index] || null); });
    view.onChange?.({count: open.length, attention: hasError || noticeError || actionErrors.size > 0 || open.some(group => group.rows.some(row => row.state === 'needs_attention'))});
  }
}
export function createSignInBrowsers({compact = false, onChange} = {}) {
  const count = h('span', {class: 'signin-browser-count', hidden: true});
  const refreshButton = h('button', {class: 'btn btn-sm', type: 'button', text: 'Refresh', 'aria-label': 'Refresh sign-in browsers', onclick: () => sync(true)});
  const status = h('p', {class: 'signin-browsers-status', role: 'status'}), list = h('div', {class: 'signin-browser-list'});
  const empty = h('p', {class: 'signin-browsers-empty', text: 'No sign-in browsers are open.'});
  const manage = h('a', {class: 'text-link', href: '#/connections', text: 'Manage connections', onclick: () => window.dispatchEvent(new Event('signin-browsers-manage'))});
  const root = h('section', {class: 'signin-browsers' + (compact ? ' signin-browsers-compact' : ''), 'aria-label': 'Sign-in browsers'},
    h('div', {class: 'signin-browsers-heading'}, h('h3', {}, 'Sign-in browsers ', count), refreshButton),
    status, empty, list, h('p', {class: 'signin-browsers-help'}, 'Check a sign-in or close its setup window. Closing keeps your saved sign-ins. ', manage));
  views.add({root, count, status, empty, list, refresh: refreshButton, cards: new Map(), onChange}); render();
  return root;
}

document.addEventListener('visibilitychange', () => sync(!document.hidden));
window.addEventListener('pagehide', () => { pageAway = true; sync(); });
window.addEventListener('pageshow', () => { pageAway = false; sync(true); });
window.addEventListener('connections-changed', () => { if (active() && !work?.mutation) sync(true); });
