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

// Only the status part of a card refreshes. Email drafts and focus remain intact.
export function connectionPanel({ providers, hints = {}, onUpdate = () => {}, onHint = () => {}, scope = 'main' } = {}) {
  const signal = accountRequestSignal();
  let disposed = false, timer, fetching = false, pending = false, state, ownedDialog, selectedScope = scope, refreshRevision = 0, errorKind = '';
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
  function dispose() { disposed = true; clearTimeout(timer); cancelDialog(); signal.removeEventListener('abort', dispose); }
  signal.addEventListener('abort', dispose, { once: true });
  root.dispose = dispose;
  root.refresh = refresh;
  root.getStatus = () => state;
  root.getHints = () => Object.fromEntries([...cards].map(([id, card]) => [id, card.input.value.trim()]));

  async function action(id, operation) {
    if (!current() || pending) return;
    const card = cards.get(id), row = card.row;
    if (!card.input.reportValidity()) return;
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
    } catch (error) { if (current() && error.name !== 'AbortError') showError(error.message); }
    finally { if (current()) { pending = false; render(); timer = setTimeout(refresh, 1500); } }
  }
  function cardFor(row) {
    const [id, label, art] = PROVIDERS.find(([id]) => id === row.id) || [row.id, row.label, 0];
    const configured = row.account_configured ?? (Boolean(row.expected_account) || row.state !== 'not_connected');
    const input = h('input', { class: 'input', type: 'email', autocomplete: 'off', maxLength: 254, value: configured ? (row.expected_account || '') : (hints[id] || ''),
      placeholder: 'Optional email to verify', oninput: e => { onHint(id, e.target.value.trim()); } });
    const badge = h('span', { class: 'connection-state' });
    const detail = h('p', { class: 'connection-detail' });
    const fix = h('p', { class: 'connection-fix' });
    const checked = h('p', { class: 'connection-checked' });
    const buttons = h('div', { class: 'connection-actions' });
    const card = { input, badge, detail, fix, checked, buttons, row };
    card.node = h('article', { class: 'connection-card', dataset: { provider: id } },
      h('div', { class: 'connection-heading' }, avatar(art, 'connection-avatar'), h('h4', { text: label }), badge),
      detail, fix, field(label + ' account email', input, 'Optional. A matching email must be visible in the signed-in account to verify it.'), buttons, checked);
    cards.set(id, card); list.append(card.node); return card;
  }
  function render() {
    if (!state) return;
    const available = (state.connections || []).filter(row => !providers || providers.includes(row.id));
    for (const row of available) {
      const card = cards.get(row.id) || cardFor(row); card.row = row;
      const busy = pending || activeStates.has(row.state);
      card.node.dataset.state = row.state;
      card.badge.textContent = row.state === 'connected' && card.input.value.trim() !== (row.expected_account || '') ? 'Check changed email' : states[row.state] || 'Check needed';
      card.detail.textContent = row.message || 'No sign-in has been checked for this browser yet.';
      card.fix.textContent = row.fix || ''; card.fix.hidden = !row.fix;
      card.checked.textContent = [row.session_scope, row.last_verified_at ? 'Last checked ' + new Date(row.last_verified_at).toLocaleString() : '', row.verified_account ? 'Account: ' + row.verified_account : ''].filter(Boolean).join(' · ');
      card.input.disabled = busy;
      const button = (text, op, enabled, primary = false) => h('button', { class: 'btn' + (primary ? ' btn-primary' : ''), type: 'button', disabled: busy || !enabled, onclick: () => action(row.id, op), 'aria-label': text + ': ' + row.label }, text);
      const focus = card.buttons.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
      card.buttons.replaceChildren(...[
        button(row.browser_open ? 'Check sign-in' : 'Open sign-in', row.browser_open ? 'check' : 'open', row.browser_open ? row.can_check : row.can_open, true),
        row.browser_open ? button('Close browser', 'close', row.can_close) : null,
        button('Change account', 'switch', row.can_open || row.can_check),
        row.state === 'connected' || row.last_verified_at ? button('Disconnect', 'disconnect', row.can_open || row.can_check) : null,
      ].filter(Boolean));
      if (focus) [...card.buttons.children].find(button => button.getAttribute('aria-label') === focus)?.focus({ preventScroll: true });
    }
    for (const [id, card] of cards) if (!available.some(row => row.id === id)) { card.node.remove(); cards.delete(id); }
    if (!available.length) list.replaceChildren(h('p', { class: 'muted', text: 'Select at least one account to connect.' }));
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
