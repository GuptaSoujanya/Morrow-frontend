import { h } from '../dom.js';
import { icon } from '../icons.js';
import { S } from '../state.js';
import { accountRequestSignal } from '../api.js';
import { browserRunToggle } from '../forms.js';
import { crewRunSpec } from '../crew-options.js';
import { crewSetup } from './crew-setup.js';
import { toast } from './toast.js';

let titleSequence = 0;

/** Edits a private draft; only an explicit apply or run action commits it. */
export function crewSettings(bots, {
  onSave = () => {}, onRun = () => {}, onAdvanced = () => {}, purpose = 'settings',
} = {}) {
  const scope = accountRequestSignal();
  if (scope.aborted || !bots.length) return null;
  const existing = document.querySelector('.crew-settings-dialog[open]');
  if (existing) { existing.focus(); return existing; }

  const selected = bots.slice();
  const actions = [...new Set(selected.map(bot => bot.action || bot.id))];
  const draft = structuredClone(S.forms);
  let browserMode = S.crewBrowserMode;
  let closed = false;
  const trigger = document.activeElement;
  const titleId = `crew-settings-title-${++titleSequence}`;
  const dialog = h('dialog', {
    class: 'crew-settings-dialog', dataset: { purpose }, 'aria-labelledby': titleId,
  });
  const current = () => !scope.aborted && accountRequestSignal() === scope;

  function close({ restoreFocus = true } = {}) {
    if (closed) return;
    closed = true;
    scope.removeEventListener('abort', accountChanged);
    window.removeEventListener('hashchange', routeChanged);
    dialog.removeEventListener('close', nativeClosed);
    if (dialog.open) dialog.close();
    // Remove synchronously so the run confirmation cannot share a modal layer.
    dialog.remove();
    if (restoreFocus && current() && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }
  function accountChanged() { close({ restoreFocus: false }); }
  function routeChanged() { close({ restoreFocus: false }); }
  function nativeClosed() { close(); }
  function commit() {
    if (!current()) { close({ restoreFocus: false }); return false; }
    for (const action of actions) {
      if (Object.hasOwn(draft, action)) S.forms[action] = structuredClone(draft[action]);
    }
    S.crewBrowserMode = browserMode;
    return true;
  }
  function report(error) {
    if (current()) toast(error?.message || 'Could not complete this action. Please try again.', 'error');
  }
  function follow(callback, ...args) {
    if (!current()) return;
    try { Promise.resolve(callback(...args)).catch(report); }
    catch (error) { report(error); }
  }

  const setup = crewSetup(selected, () => {}, { forms: draft });
  setup.element.querySelector(':scope > p')?.remove();
  let advanced;
  if (purpose === 'run') {
    // Keep this same disclosure so field validation can open it when necessary.
    advanced = setup.options;
    advanced.className = 'crew-advanced-settings';
    advanced.querySelector('summary').textContent = 'Advanced settings';
  } else {
    const fields = setup.options.querySelector('.crew-setup-fields');
    setup.options.replaceWith(fields);
    advanced = h('details', { class: 'crew-advanced-settings' }, h('summary', { text: 'Advanced settings' }));
    setup.element.append(advanced);
  }
  advanced.append(
    h('div', { class: 'crew-browser-setting' }, browserRunToggle(browserMode, mode => { browserMode = mode; })),
    h('p', {class:'crew-setting-note',text:'This browser preference applies to all Bot Crew runs.'}),
    h('div', { class: 'crew-full-settings' }, selected.filter(bot => bot.route !== 'bots').map(bot => h('button', {
      class: 'text-link', type: 'button', text: `Open full settings for ${bot.name}`,
      onclick: () => {
        // Opening full settings is navigation, so leave unapplied draft edits behind.
        close();
        follow(onAdvanced, bot);
      },
    }))),
  );

  const effects = selected.map(bot => ({ bot, effect: crewRunSpec(bot, draft, browserMode).effect }));
  const summary = selected.length === 1
    ? h('p', { class: 'crew-setting-effect', text: effects[0].effect })
    : h('ul', { class: 'crew-dialog-bots' }, effects.map(({ bot, effect }) => h('li', {},
      h('strong', { text: bot.name }), h('span', { class: 'crew-setting-effect', text: effect }))));
  const save = h('button', {
    class: 'btn btn-primary', type: 'button', text: purpose === 'run' ? 'Review & run' : 'Apply settings',
    onclick: () => {
      if (!current()) { close({ restoreFocus: false }); return; }
      if (!setup.validate() || !commit()) return;
      close();
      try {
        onSave();
        if (purpose === 'run') follow(onRun, selected);
      } catch (error) { report(error); }
    },
  });
  dialog.append(
    h('header', { class: 'crew-settings-header' },
      h('h2', { id: titleId, tabindex: '-1', text: selected.length === 1 ? `${selected[0].name} settings` : 'Selected bot settings' }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close settings', onclick: () => close() }, icon('x'))),
    h('div', { class: 'crew-settings-body' }, summary, setup.element,
      h('p',{class:'crew-setting-note',text:'Used for this session. Your saved defaults stay unchanged.'})),
    h('footer', { class: 'crew-settings-footer' },
      h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => close() }), save),
  );
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', nativeClosed);
  scope.addEventListener('abort', accountChanged, { once: true });
  window.addEventListener('hashchange', routeChanged);
  document.body.append(dialog);
  dialog.showModal();
  (dialog.querySelector('.crew-required-settings input, .crew-required-settings textarea')
    || (purpose === 'settings' ? dialog.querySelector('.crew-setup-fields input') : null)
    || dialog.querySelector('h2')).focus({ preventScroll: true });
  return dialog;
}
