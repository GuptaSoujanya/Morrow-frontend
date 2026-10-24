import {api, accountRequestSignal} from './api.js';
import {S, hooks} from './state.js';
import {h} from './dom.js';
import {confirmDialog} from './components/dialog.js';
import {setConsoleSize} from './components/console.js';
import {toast} from './components/toast.js';

/** Validate the whole selection, confirm once, then start only that exact set. */
export async function launchCrew(specs, onChange = () => {}) {
  const scope = accountRequestSignal(), launch = S.crewLaunch;
  if (scope.aborted || launch.pending || !specs.length) return;
  const trigger = document.activeElement;
  const selected = structuredClone(specs);
  const runs = selected.map(({key, action, options}) => ({key, action, options}));
  launch.pending = true; launch.error = ''; launch.conflicts = []; launch.results = [];
  const changed = () => { if (!scope.aborted && S.crewLaunch === launch) onChange(); };
  changed();
  try {
    if (selected.some(spec => !spec.ready)) throw new Error('Complete the settings for each selected agent first.');
    const plan = await api('/api/run/batch/preview', {runs});
    scope.throwIfAborted();
    if (!plan.ready) {
      launch.conflicts = [...(plan.conflicts || []).map(conflict => conflict.message), ...(plan.items || []).filter(item => item.error).map(item => `${item.label || item.key}: ${item.error}`)];
      launch.error = 'Adjust your selection before starting.';
      return;
    }
    const dialog = document.getElementById('confirm');
    if (dialog.open) return;
    const commands = plan.items.map(item => `${selected.find(spec => spec.key === item.key)?.name || item.label}\n$ ${item.shown}`).join('\n\n');
    const content = h('div', {},
      h('ul', {class: 'crew-confirm-list'}, selected.map(spec => h('li', {}, h('strong', {text: spec.name}), h('span', {text: spec.effect})))),
      h('details', {class: 'crew-command-details'}, h('summary', {text: 'Technical details'}), h('pre', {class: 'confirm-code'}, h('code', {text: commands}))));
    const confirmation = confirmDialog({
      title: `Start ${runs.length} ${runs.length === 1 ? 'agent' : 'agents'}?`,
      body: 'Review what each agent will do with your saved settings. You can follow progress and stop individual agents in Activity.',
      content,
      ok: 'Start agents',
    });
    const contents = dialog.firstElementChild;
    const cancel = () => { if (dialog.open && dialog.firstElementChild === contents) dialog.dispatchEvent(new Event('cancel', {cancelable: true})); };
    scope.addEventListener('abort', cancel, {once: true});
    let confirmed;
    try { confirmed = await confirmation; }
    finally { scope.removeEventListener('abort', cancel); }
    if (!confirmed) return;
    scope.throwIfAborted();
    const reply = await api('/api/run/batch', {runs});
    scope.throwIfAborted();
    launch.results = reply.results || [];
    const successful = new Set(launch.results.filter(result => result.ok).map(result => result.key));
    S.crewSelection = S.crewSelection.filter(key => !successful.has(key));
    if (successful.size) {
      setConsoleSize('normal');
      toast(`Started ${successful.size} ${successful.size === 1 ? 'agent' : 'agents'}. Follow each run in Activity.`, 'info');
    }
    if (!reply.ok) launch.error = 'Some agents could not start. Started agents are still running; review the results below.';
    try { await hooks.refreshStatus(); }
    catch (error) { if (!scope.aborted) launch.error ||= `The launch result is shown below. Activity could not refresh: ${error.message}`; }
  } catch (error) {
    if (!scope.aborted && error.name !== 'AbortError') {
      launch.error = error.status === 404
        ? 'This dashboard service needs an update before it can run agents together. Restart the dashboard service, then try again. Your selection is saved.'
        : error.message;
      launch.conflicts = (error.details?.conflicts || []).map(conflict => conflict.message);
    }
  } finally {
    if (!scope.aborted && S.crewLaunch === launch) {
      launch.pending = false; changed();
      const dialog = document.getElementById('confirm');
      if (trigger?.isConnected && !dialog?.open &&
          (document.activeElement === document.body || dialog?.contains(document.activeElement))) trigger.focus({preventScroll:true});
    }
  }
}
