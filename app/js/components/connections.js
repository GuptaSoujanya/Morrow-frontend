import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';
import { icon } from '../icons.js';
import { avatar } from './identity.js';
import { field } from '../forms.js';
import { confirmDialog } from './dialog.js';
import { errorState, loadingState } from './panel.js';

export const PROVIDERS = [
  ['naukri', 'Naukri', 0], ['linkedin', 'LinkedIn', 6], ['hirist', 'Hirist', 1],
  ['instahyre', 'Instahyre', 2], ['cutshort', 'Cutshort', 3], ['wellfound', 'Wellfound', 4], ['google', 'Google / Gmail', 20],
];
const states = { connected: 'Sign-in checked', needs_sign_in: 'Sign-in needed', needs_attention: 'Check needed',
  opening: 'Opening browser', checking: 'Checking sign-in', closing: 'Closing browser', disconnected: 'Not connected', not_connected: 'Not connected' };
const activeStates = new Set(['opening', 'checking', 'closing', 'switching', 'disconnecting']);

function browserGroups(rows, scope, scopes = []) {
  const groups = new Map();
  for (const row of rows) {
    const id = row.browser_group || (scope !== 'main' ? scope : row.id === 'linkedin' ? 'linkedin' : 'main');
    if (!groups.has(id)) groups.set(id, { id, rows: [], label: id === 'linkedin' ? 'LinkedIn browser' : scopes.find(item => item.id === id)?.label || 'Main browser' });
    groups.get(id).rows.push(row);
  }
  for (const group of groups.values()) {
    group.open = group.rows.some(row => row.browser_open);
    group.busy = group.rows.some(row => row.pending || row.profile_busy || activeStates.has(row.state));
    const explicit = group.rows.find(row => row.browser_active === true && row.browser_open);
    const provider = group.rows.find(row => row.browser_provider)?.browser_provider;
    const hasMetadata = group.rows.some(row => typeof row.browser_active === 'boolean' || typeof row.browser_provider === 'string');
    // Earlier runners exposed only the shared window flag. Infer at most one
    // selected account there; never turn every saved account into an open tab.
    const fallback = !hasMetadata && (group.rows.find(row => row.browser_open && activeStates.has(row.state)) ||
      group.rows.find(row => row.browser_open && row.state === 'needs_sign_in' && row.account_configured) ||
      group.rows.find(row => row.browser_open && row.account_configured));
    group.provider = group.open ? explicit?.id || provider || fallback?.id || '' : '';
  }
  return groups;
}

// Only the status part of a card refreshes. Email drafts and focus remain intact.
export function connectionPanel({ providers, hints = {}, onUpdate = () => {}, onHint = () => {}, scope = 'main', focusProvider = '' } = {}) {
  const signal = accountRequestSignal();
  let disposed = false, timer, fetching = false, pending = false, state, ownedDialog, selectedScope = scope, refreshRevision = 0, errorKind = '', focusPending = !!focusProvider;
  const cards = new Map();
  const feedback = h('div', { class: 'connection-feedback' });
  const list = h('div', { class: 'connection-list' });
  const status = h('p', { class: 'connection-freshness', role: 'status' });
  const refreshButton = h('button', { class: 'btn', type: 'button', onclick: () => refresh() }, icon('refresh', 'icon icon-sm'), 'Check connection status');
  const scopeSelect = h('select', { class: 'input', 'aria-label': 'Automation browser group', onchange: e => {
    Object.assign(hints, root.getHints()); selectedScope = e.target.value; refreshRevision += 1; fetching = false; state = null;
    cards.clear(); list.replaceChildren(loadingState('Checking this browser group…')); refresh();
  } });
  const scopeField = field('Automation browser group', scopeSelect, 'Sign-ins are reused only by runs using this browser group.');
  scopeField.hidden = true;
  const runtime = h('p', { class: 'connection-runtime', hidden: true });
  const root = h('section', { class: 'connection-manager', 'aria-label': 'Automation browser connections' },
    h('div', { class: 'connection-toolbar' }, h('div', {}, h('h3', { text: 'Your automation browser' }),
      h('p', { text: 'Open sign-in here, complete it in the bot’s Chrome window, then check the connection. Close that window before starting a workflow.' })), refreshButton),
    runtime, scopeField, feedback, list, status);
  const current = () => !disposed && !signal.aborted && root.isConnected;
  function showError(error, kind = 'action') { errorKind = kind; feedback.replaceChildren(errorState(error, kind === 'refresh' ? () => refresh() : null)); }
  function cancelDialog() {
    const dialog = document.getElementById('confirm');
    if (ownedDialog && dialog?.open && dialog.firstElementChild === ownedDialog) dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    ownedDialog = null;
  }
  function dispose() { disposed = true; clearTimeout(timer); cancelDialog(); signal.removeEventListener('abort', dispose); window.removeEventListener('connections-changed', refresh); }
  signal.addEventListener('abort', dispose, { once: true });
  window.addEventListener('connections-changed', refresh);
  root.dispose = dispose;
  root.refresh = refresh;
  root.getStatus = () => state;
  root.getHints = () => Object.fromEntries([...cards].map(([id, card]) => [id, card.input.value.trim()]));
  root.validate = () => {
    const invalid = [...cards.values()].filter(card => !card.emailField.validate());
    invalid[0]?.input.focus();
    return !invalid.length;
  };

  async function action(id, operation) {
    if (!current() || pending) return;
    const card = cards.get(id), row = card.row;
    if (!card.emailField.validate()) { card.input.focus(); return; }
    let focusEmail = false;
    card.actionError.hidden = true; card.actionError.textContent = '';
    pending = true; refreshRevision += 1; fetching = false; clearTimeout(timer); render();
    try {
      if (['switch', 'disconnect'].includes(operation)) {
        const title = operation === 'switch' ? 'Change ' + row.label + ' account?' : 'Disconnect ' + row.label + '?';
        const answer = confirmDialog({ title, body: 'This clears ' + row.label + ' sign-in data from this automation browser. ' + (operation === 'switch' ? 'Sign in with the new account in the browser, then check it again.' : 'You will need to sign in again before using this connection.'), ok: operation === 'switch' ? 'Change account' : 'Disconnect', tone: 'danger' });
        ownedDialog = document.getElementById('confirm')?.firstElementChild;
        if (!(await answer) || !current()) return;
        ownedDialog = null;
      }
      feedback.replaceChildren(); errorKind = '';
      state = await api('/api/connections/' + id + '/' + operation, { scope: selectedScope, expected_account: card.input.value.trim() });
      if (!current()) return;
      render(); onUpdate(state);
      window.dispatchEvent(new Event('connections-changed'));
    } catch (error) {
      if (current() && error.name !== 'AbortError') {
        if ([400, 422].includes(error.status) && /email|expected_account|account hint/i.test(error.message)) {
          card.emailField.setError(error.message); focusEmail = true;
        } else {
          card.actionError.textContent = error.message; card.actionError.hidden = false;
        }
      }
    }
    finally { if (current()) { pending = false; render(); if (focusEmail) card.input.focus(); timer = setTimeout(refresh, 1500); } }
  }
  function cardFor(row) {
    const [id, label, art] = PROVIDERS.find(([id]) => id === row.id) || [row.id, row.label, 0];
    const configured = row.account_configured ?? (Boolean(row.expected_account) || row.state !== 'not_connected');
    const input = h('input', { class: 'input', type: 'email', autocomplete: 'off', maxLength: 254, value: configured ? (row.expected_account || '') : (hints[id] || ''),
      placeholder: 'Optional email to verify', oninput: e => { onHint(id, e.target.value.trim()); } });
    const emailField = field(label + ' account email', input, 'Optional. A matching email must be visible in the signed-in account to verify it.', {
      deferButtonBlur: true,
      validate: target => target.value.trim() && !/^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/.test(target.value.trim())
        ? 'Enter a complete email address, like name@example.com, or leave this empty.' : '',
    });
    const badge = h('span', { class: 'connection-state' });
    const detail = h('p', { class: 'connection-detail' });
    const fix = h('p', { class: 'connection-fix' });
    const browserNote = h('p', { class: 'connection-fix connection-browser-note', hidden: true });
    const checked = h('p', { class: 'connection-checked' });
    const buttons = h('div', { class: 'connection-actions' });
    const actionError = h('p', { class: 'field-error connection-action-error', role: 'status', hidden: true });
    const card = { input, emailField, badge, detail, fix, browserNote, checked, buttons, actionError, row };
    card.node = h('article', { class: 'connection-card', dataset: { provider: id }, tabindex: '-1', 'aria-label': label + ' connection' },
      h('div', { class: 'connection-heading' }, avatar(art, 'connection-avatar'), h('h4', { text: label }), badge),
      id === 'naukri' ? h('p', { class: 'connection-fix connection-provider-note', text: 'Google and Naukri use separate sign-ins. Connecting Google does not sign you in to Naukri.' }) : null,
      detail, fix, browserNote, emailField, buttons, actionError, checked);
    cards.set(id, card); list.append(card.node); return card;
  }
  function render() {
    if (!state) return;
    const available = (state.connections || []).filter(row => !providers || providers.includes(row.id))
      .sort((a, b) => Number(b.id === focusProvider) - Number(a.id === focusProvider));
    const groups = browserGroups(state.connections || [], selectedScope, state.scopes);
    for (const row of available) {
      const card = cards.get(row.id) || cardFor(row); card.row = row;
      const group = groups.get(row.browser_group || (selectedScope !== 'main' ? selectedScope : row.id === 'linkedin' ? 'linkedin' : 'main'));
      const browserActive = Boolean(row.browser_open && group?.provider === row.id);
      const busy = pending || group?.busy;
      card.node.dataset.state = row.state;
      card.node.dataset.browserActive = String(browserActive);
      card.badge.textContent = row.state === 'connected' && card.input.value.trim() !== (row.expected_account || '') ? 'Check changed email' : states[row.state] || 'Check needed';
      card.detail.textContent = row.message || 'No sign-in has been checked for this browser yet.';
      card.fix.textContent = row.fix || ''; card.fix.hidden = !row.fix;
      const openedFor = PROVIDERS.find(([id]) => id === group?.provider)?.[1];
      card.browserNote.hidden = !group?.open || browserActive;
      card.browserNote.textContent = group?.open && !browserActive ? `${group.label} is open${openedFor ? ' for ' + openedFor : ''}. Open ${row.label} in that same window to sign in or check this account.` : '';
      card.checked.textContent = [row.session_scope, row.last_verified_at ? 'Last checked ' + new Date(row.last_verified_at).toLocaleString() : '', row.verified_account ? 'Account: ' + row.verified_account : ''].filter(Boolean).join(' · ');
      card.input.disabled = busy;
      const button = (text, op, enabled, primary = false) => h('button', { class: 'btn' + (primary ? ' btn-primary' : ''), type: 'button', disabled: busy || !enabled, onclick: () => action(row.id, op), 'aria-label': text + ': ' + row.label }, text);
      const focus = card.buttons.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
      card.buttons.replaceChildren(...[
        button(browserActive ? 'Check sign-in' : 'Open sign-in', browserActive ? 'check' : 'open', browserActive ? row.can_check : row.can_open, true),
        browserActive ? button('Close browser', 'close', row.can_close) : null,
        button('Change account', 'switch', row.can_open || row.can_check),
        row.state === 'connected' || row.last_verified_at ? button('Disconnect', 'disconnect', row.can_open || row.can_check) : null,
      ].filter(Boolean));
      if (focus) [...card.buttons.children].find(button => button.getAttribute('aria-label') === focus)?.focus({ preventScroll: true });
    }
    for (const [id, card] of cards) if (!available.some(row => row.id === id)) { card.node.remove(); cards.delete(id); }
    if (!available.length) list.replaceChildren(h('p', { class: 'muted', text: 'Select at least one account to connect.' }));
    // Deep links may focus a provider once after navigation. Polling and delayed
    // responses must never pull focus away from something the user has chosen.
    if (focusPending) {
      focusPending = false;
      const target = cards.get(focusProvider)?.node;
      if (target && (document.activeElement === document.body || document.activeElement?.id === 'content')) {
        target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' });
      }
    }
    if (state.scopes?.length > 1) {
      scopeField.hidden = false;
      if ([...scopeSelect.options].map(option => option.value).join() !== state.scopes.map(item => item.id).join()) scopeSelect.replaceChildren(...state.scopes.map(item => h('option', { value: item.id, text: item.label })));
      scopeSelect.value = selectedScope;
    }
    refreshButton.disabled = pending || fetching; scopeSelect.disabled = pending;
    runtime.hidden = false;
    runtime.textContent = state.browser_available ? 'Chrome is available on this computer. ' + (state.runtime?.claude_installed || state.runtime?.kiro_installed ? 'AI tools found: ' + [state.runtime?.claude_installed ? 'Claude' : '', state.runtime?.kiro_installed ? 'Kiro' : ''].filter(Boolean).join(', ') + '. Sign in through your own CLI subscription before AI-assisted runs.' : 'Install and sign in to your own Claude or Kiro CLI before AI-assisted runs.') : 'Google Chrome is not installed or could not be found on this computer. Install Chrome, then check connection status again.';
    if (state.runtime?.pdftotext_available === false) runtime.textContent += ' PDF reading needs Poppler installed on this computer before you can finish setup.';
  }
  async function refresh() {
    if (!current() || pending || fetching) return;
    clearTimeout(timer);
    if (document.hidden) { timer = setTimeout(refresh, 5000); return; }
    fetching = true; refreshButton.disabled = true;
    const revision = ++refreshRevision;
    try {
      const result = await api('/api/connections?' + new URLSearchParams({ scope: selectedScope }), undefined, { fresh: true });
      if (!current() || revision !== refreshRevision) return;
      state = result; list.querySelector('.state-loading')?.remove(); render(); onUpdate(state);
      if (errorKind === 'refresh') { feedback.replaceChildren(); errorKind = ''; }
      status.textContent = 'Status updates every 5 seconds. Saved sign-ins can expire or require verification.';
    } catch (error) { if (current() && revision === refreshRevision && error.name !== 'AbortError') { list.querySelector('.state-loading')?.remove(); showError(error.message, 'refresh'); status.textContent = 'Could not refresh. The last connection status is still shown.'; } }
    finally { if (current() && revision === refreshRevision) { fetching = false; refreshButton.disabled = false; timer = setTimeout(refresh, 5000); } }
  }
  list.append(loadingState('Checking this computer’s browser connections…'));
  queueMicrotask(refresh);
  return root;
}
