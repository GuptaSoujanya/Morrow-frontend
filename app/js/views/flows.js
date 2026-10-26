import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api, accountRequestSignal } from '../api.js';
import { S, hooks } from '../state.js';
import { parseRoute } from '../router.js';
import { avatar } from '../components/identity.js';
import { dateControl } from '../components/controls.js';
import { panel, empty, errorState, loadingState } from '../components/panel.js';
import { confirmDialog } from '../components/dialog.js';
import { setConsoleSize } from '../components/console.js';
import { field, selectInput, textInput, toggle, previewBox, runButton, quickButton, liveRunConfirm, schedulePreview, updateRunButtons } from '../forms.js';
import { stageChoices, stageName } from './automations.js';

const choices = entries => entries.map(([value, label]) => ({ value, label }));
const localDay = () => { const now = new Date(); return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-'); };
const timestamp = value => value && !Number.isNaN(new Date(value).valueOf())
  ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const stateNames = { done: 'Complete', running: 'Running', failed: 'Needs attention', interrupted: 'Interrupted', missing_output: 'Output missing', pending: 'Not started' };
let disposeCurrent;

function recoveryOptions(recovery, date) {
  const source = recovery.options || {};
  const options = { command: 'continue', date, dry_run: false };
  // Resume is deliberately separate from the configurable new-run form.
  for (const key of ['groups', 'group', 'cli', 'agents', 'bots', 'containers']) {
    if (source[key] !== undefined) options[key] = structuredClone(source[key]);
  }
  return options;
}

export function renderPipeline(group = '') {
  disposeCurrent?.();
  const scope = accountRequestSignal();
  let closed = false, timer, loading = false, busy = false, revision = 0, ownedDialog;
  let selectedDate = new URLSearchParams(location.hash.split('?')[1] || '').get('date') || S.flowDate || localDay();
  let data = S.pipeline?.data?.date === selectedDate ? S.pipeline.data : null;
  let lastSignature = '', checkedAt = '';
  const messages = { action: '', refresh: '' };
  if (['learn', 'brief', 'research', 'apply', 'profile', ...stageChoices.map(([id]) => id)].includes(group) && S.pipelineRouteArg !== group) {
    S.forms.pipeline = { ...S.forms.pipeline, group }; S.pipelineRouteArg = group;
  } else if (!group) S.pipelineRouteArg = '';
  S.flowDate = selectedDate;
  S.forms.pipeline.date = selectedDate;

  const current = () => !closed && !scope.aborted && page.isConnected;
  const feedback = h('div', { class: 'flow-feedback' });
  const progress = h('div', { class: 'flow-progress', 'aria-label': 'Workflow progress' });
  const freshness = h('p', { class: 'flow-freshness', role: 'status' });
  const refresh = h('button', { class: 'btn', type: 'button', onclick: () => refreshProgress() }, icon('refresh', 'icon icon-sm'), 'Refresh progress');
  const datePicker = dateControl({ value: selectedDate, commitOnly: true, onChange: value => changeDate(value || localDay()) });
  const savedDates = h('div', { class: 'flow-saved-dates' });
  const activityButton = () => h('button', { class: 'btn', type: 'button', onclick: () => setConsoleSize('normal') }, icon('activity', 'icon icon-sm'), 'Open Activity');

  function message(text, kind = 'action') {
    messages[kind] = text;
    feedback.replaceChildren(...Object.entries(messages).filter(([, value]) => value).map(([source, value]) =>
      errorState(value, source === 'refresh' ? () => refreshProgress() : null)));
  }
  function cancelDialog() {
    const dialog = document.getElementById('confirm');
    if (ownedDialog && dialog?.open && dialog.firstElementChild === ownedDialog) dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    ownedDialog = null;
  }
  function dispose() {
    closed = true; clearTimeout(timer); cancelDialog();
    window.removeEventListener('hashchange', onRouteChange);
    document.removeEventListener('visibilitychange', onVisibility);
    scope.removeEventListener('abort', dispose);
  }
  disposeCurrent = dispose;
  scope.addEventListener('abort', dispose, { once: true });
  const onRouteChange = () => { if (parseRoute().name !== 'pipeline') dispose(); };
  const onVisibility = () => { if (!document.hidden && current()) refreshProgress(); };
  window.addEventListener('hashchange', onRouteChange);
  document.addEventListener('visibilitychange', onVisibility);

  function changeDate(value) {
    if (!current() || busy || value === selectedDate) return;
    selectedDate = value; S.flowDate = value; S.forms.pipeline.date = value;
    datePicker.controlElement.value = value;
    datePicker.controlElement.dispatchEvent(new Event('input'));
    const base = location.hash.split('?')[0] || '#/pipeline';
    history.replaceState(null, '', `${base}?${new URLSearchParams({ date: value })}`);
    revision += 1; loading = false; data = null; lastSignature = ''; checkedAt = '';
    message(''); message('', 'refresh'); paint(); drawDiagnostics(); schedulePreview('pipeline'); refreshProgress();
  }

  async function readProgress() {
    return api('/api/pipeline?' + new URLSearchParams({ date: selectedDate }), undefined, { fresh: true });
  }
  async function refreshProgress() {
    if (!current() || loading || busy) return;
    clearTimeout(timer);
    if (document.hidden) { timer = setTimeout(refreshProgress, 5000); return; }
    const ticket = ++revision;
    loading = true; refresh.disabled = true;
    try {
      const result = await readProgress();
      if (!current() || ticket !== revision) return;
      data = result; S.pipeline = { data, at: Date.now() }; checkedAt = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      message('', 'refresh'); paint();
    } catch (error) {
      if (!current() || ticket !== revision || error.name === 'AbortError') return;
      message(`${data ? 'Progress could not refresh. Showing the last saved view. ' : ''}${error.message}`, 'refresh');
      if (!data) progress.replaceChildren();
    } finally {
      if (current() && ticket === revision) {
        loading = false; refresh.disabled = false;
        freshness.textContent = messages.refresh ? 'Updates paused · retrying automatically' : checkedAt ? `Checked ${checkedAt} · updates every 5 seconds` : '';
        timer = setTimeout(refreshProgress, 5000);
      }
    }
  }

  async function resume(stageNameOrNull) {
    if (!current() || busy) return;
    busy = true; revision += 1; loading = false; clearTimeout(timer); message(''); updateActions();
    try {
      const fresh = await readProgress();
      if (!current()) return;
      data = fresh; S.pipeline = { data, at: Date.now() };
      const target = stageNameOrNull ? data.stages.find(stage => stage.name === stageNameOrNull)?.retry : data.resume;
      if (!target?.available) { message(target?.reason || 'This workflow changed. Review its latest progress before continuing.'); return; }
      const options = recoveryOptions(target, data.date);
      const preview = await api('/api/preview', { action: 'pipeline', options });
      if (!current()) return;
      if (preview.needed || preview.error) throw new Error(String(preview.needed || preview.error));
      const dialog = document.getElementById('confirm');
      if (dialog?.open) return;
      const answer = confirmDialog({
        title: stageNameOrNull ? `Retry ${stageName(stageNameOrNull)}?` : 'Resume this workflow?',
        body: `Continue the saved workflow for ${data.date}. ${stageNameOrNull ? 'This stage restarts from its beginning.' : 'Only unfinished stages will run.'} Completed stages are skipped. ${target.settings_source === 'defaults' ? 'This checkpoint has no saved run settings. Current configured defaults will be used. ' : ''}This can submit applications or update profiles.`,
        code: preview.shown, ok: stageNameOrNull ? 'Retry stage' : 'Resume workflow', tone: 'primary',
      });
      ownedDialog = dialog?.firstElementChild;
      if (!(await answer) || !current()) return;
      ownedDialog = null;
      const latest = await readProgress();
      if (!current()) return;
      const latestTarget = stageNameOrNull ? latest.stages.find(stage => stage.name === stageNameOrNull)?.retry : latest.resume;
      data = latest;
      if (!latestTarget?.available || JSON.stringify(recoveryOptions(latestTarget, latest.date)) !== JSON.stringify(options)) {
        message('Progress changed while you were confirming. Review the latest steps and resume again.'); return;
      }
      await api('/api/run', { action: 'pipeline', options });
      if (!current()) return;
      setConsoleSize('normal');
      await hooks.refreshStatus();
    } catch (error) {
      if (current() && error.name !== 'AbortError') message(error.message);
    } finally {
      if (current()) { busy = false; lastSignature = ''; paint(); updateActions(); refreshProgress(); }
    }
  }

  function recoveryButton(recovery, stage = null) {
    return h('button', { class: `btn ${stage ? '' : 'btn-primary'}`, type: 'button',
      disabled: busy || !recovery?.available, title: recovery?.reason || '',
      dataset: { flowRecovery: stage || 'workflow', available: String(Boolean(recovery?.available)), flowFocus: stage ? `retry:${stage}` : 'resume' },
      'aria-label': stage ? `Retry this stage: ${stageName(stage)}` : 'Resume workflow', onclick: () => resume(stage),
    }, icon('play', 'icon icon-sm'), stage ? 'Retry this stage' : 'Resume workflow');
  }
  function updateActions() {
    for (const button of progress.querySelectorAll('[data-flow-recovery]')) button.disabled = busy || button.dataset.available !== 'true';
    refresh.disabled = busy || loading;
    for (const control of datePicker.querySelectorAll('input, button')) control.disabled = busy;
    for (const button of savedDates.querySelectorAll('button')) button.disabled = busy;
  }
  function fixInstructions(attention, error) {
    const action = ['sign_in', 'human_check'].includes(attention?.kind)
      ? { label: 'Open Connections', href: '#/connections' } : attention?.action;
    return h('div', { class: 'flow-fix' },
      attention?.explanation ? h('p', { text: attention.explanation }) : null,
      attention?.steps?.length ? h('ol', {}, attention.steps.map(step => h('li', { text: step }))) : null,
      error?.message ? h('div', { class: 'flow-error-message' }, h('span', { text: 'Last recorded error' }), h('code', { text: error.message })) : null,
      action?.href?.startsWith('#/') ? h('a', { class: 'flow-fix-link', href: action.href }, action.label, icon('arrow-up-right', 'icon icon-sm')) : null);
  }

  function timeline(stages) {
    const groups = [['learn', 'Learning'], ['profile', 'Profile updates'], ['apply', 'Applications'], ['research', 'Research'], ['brief', 'Daily briefing']];
    for (const stage of stages) { const key = stage.name.split(':')[0]; if (!groups.some(([name]) => name === key)) groups.push([key, stageName(key)]); }
    return h('div', { class: 'flow-groups' }, groups.map(([key, title]) => {
      const entries = stages.map((stage, index) => ({ ...stage, index })).filter(stage => stage.name.split(':')[0] === key);
      if (!entries.length) return null;
      const done = entries.filter(stage => (stage.state || stage.status) === 'done').length;
      return h('details', { class: 'flow-group', open: done < entries.length, dataset: { flowDetail: key } },
        h('summary', { dataset: { flowFocus: `group:${key}` } }, h('strong', { text: title }), h('span', { text: `${done} / ${entries.length}` }), h('span', { class: done === entries.length ? 'group-complete' : 'group-next', text: done === entries.length ? 'Complete' : 'View stages' })),
        h('ol', { class: 'plain-list flow-step-list' }, entries.map(stage => {
          const state = stage.state || stage.status;
          return h('li', { class: `flow-step step-${state}`, dataset: { stage: stage.name } },
            h('div', { class: 'flow-step-line' },
              h('span', { class: 'flow-step-number', 'aria-hidden': 'true' }, state === 'done' ? icon('check', 'icon icon-sm') : String(stage.index + 1).padStart(2, '0')),
              h('div', { class: 'flow-step-copy' }, h('strong', { text: stageName(stage.name) }), h('p', { text: `${stage.attempts || 0} attempts${timestamp(stage.finished_at || stage.started_at || stage.at) ? ' · ' + timestamp(stage.finished_at || stage.started_at || stage.at) : ''}` })),
              h('span', { class: 'flow-step-status', text: stage.queued && state === 'pending' ? 'Queued' : stateNames[state] || state })),
            stage.attention ? h('details', { class: 'flow-step-help', dataset: { flowDetail: `help:${stage.name}` } },
              h('summary', { dataset: { flowFocus: `help:${stage.name}` }, text: stage.attention.title || 'What needs attention?' }),
              fixInstructions(stage.attention, stage.last_error), h('div', { class: 'flow-recovery-actions' }, recoveryButton(stage.retry, stage.name), activityButton())) : null);
        })));
    }));
  }

  function paint() {
    if (!data) { progress.replaceChildren(loadingState('Reading workflow progress…')); return; }
    const signature = JSON.stringify(data);
    if (signature === lastSignature) return;
    lastSignature = signature;
    const open = new Map([...progress.querySelectorAll('details[data-flow-detail]')].map(node => [node.dataset.flowDetail, node.open]));
    const focus = progress.contains(document.activeElement) ? document.activeElement.dataset.flowFocus : null;
    const stages = data.stages || [];
    const summary = data.summary || { total: stages.length, completed: stages.filter(stage => stage.status === 'done').length, running: 0, attention: stages.filter(stage => stage.status === 'failed').length, pending: stages.filter(stage => stage.status === 'pending').length };
    const active = summary.active || summary.running > 0;
    const title = !summary.total ? 'Ready when you are.' : active ? 'Your workflow is running.' : summary.attention ? `${summary.attention} ${summary.attention === 1 ? 'step needs' : 'steps need'} attention.` : summary.completed === summary.total ? 'This workflow is complete.' : 'Continue where you left off.';
    const description = !summary.total ? 'Choose your stages in Configure a run to start a workflow.' : active ? summary.no_recent_update ? 'A running step has not saved a recent update. Check its guidance below and open Activity to see what it is waiting for.' : 'Progress updates automatically as each stage reports back.' : summary.attention ? 'Review the issue, fix it, then retry the stage or resume unfinished work.' : summary.completed === summary.total ? 'Every saved stage is complete. Start a new date when you’re ready.' : 'Completed stages are saved. Resume runs only unfinished stages.';
    const hero = h('section', { class: 'flow-status-card', 'aria-label': 'Workflow status' },
      h('div', { class: 'flow-status-heading' }, avatar(28, 'flow-status-art'), h('div', {}, h('p', { class: 'eyebrow', text: `WORKFLOW · ${data.date}` }), h('h2', { text: title }), h('p', { text: description }))),
      h('div', { class: 'flow-counts' }, [['Completed', summary.completed], ['Running', summary.running], ['Needs attention', summary.attention], ['Not started', summary.pending]].map(([label, value]) => h('div', {}, h('strong', { text: String(value || 0) }), h('span', { text: label })))),
      h('div', { class: 'flow-status-actions' }, recoveryButton(data.resume), activityButton(), h('span', { text: data.resume?.reason || (data.resume?.settings_source === 'defaults' ? 'This checkpoint has no saved run settings. Resume uses current configured defaults.' : 'Completed stages stay saved.') })));
    const latest = data.latest_error;
    const latestStage = latest && stages.find(stage => stage.name === latest.stage);
    const errorPanel = latest ? panel(latest.resolved_at ? 'Last error · resolved' : 'Latest error', { cls: 'flow-latest-error', sub: `${latest.stage === 'workflow' ? 'Workflow' : stageName(latest.stage)}${timestamp(latest.at) ? ' · ' + timestamp(latest.at) : ''}` },
      h('h3', { text: latest.resolved_at ? 'This issue was resolved by a later successful run.' : latest.attention?.title || 'Review this step before continuing.' }),
      fixInstructions(latest.resolved_at ? null : latest.attention, latest),
      !latest.resolved_at ? h('div', { class: 'flow-recovery-actions' }, latestStage ? recoveryButton(latestStage.retry, latestStage.name) : null, activityButton()) : null) : null;
    progress.replaceChildren(hero, ...(errorPanel ? [errorPanel] : []), panel('Workflow stages', { sub: `Saved progress for ${data.date}. Each stage can be retried after its issue is fixed.` }, stages.length ? timeline(stages) : empty('No stages have been recorded for this date.')));
    for (const node of progress.querySelectorAll('details[data-flow-detail]')) if (open.has(node.dataset.flowDetail)) node.open = open.get(node.dataset.flowDetail);
    if (focus) [...progress.querySelectorAll('[data-flow-focus]')].find(node => node.dataset.flowFocus === focus)?.focus({ preventScroll: true });
    savedDates.replaceChildren(...(data.available_dates || []).filter(day => day !== selectedDate).slice(0, 6).map(day => h('button', { class: 'flow-date-link', type: 'button', text: day, onclick: () => changeDate(day) })));
    updateActions();
  }

  const configuration = panel('Configure a run', { cls: 'flow-config', sub: 'For new work or a deliberate rerun. Resume uses recorded settings when available.' },
    field('Stages to run', selectInput('pipeline', 'group', choices([['', 'All stages'], ['profile', 'All profile updates'], ['apply', 'All applications'], ['brief', 'All daily briefing agents'], ['research', 'All research'], ...stageChoices]), '')),
    toggle('pipeline', 'dry_run', 'Practice run', 'Browser steps use dry-run mode. Learning and research can still use your AI CLI. Practice runs do not save checkpoint progress.'),
    h('details', { class: 'flow-advanced' }, h('summary', { text: 'Advanced settings' }),
      field('AI CLI', selectInput('pipeline', 'cli', choices([['', 'Use configured CLI'], ['both', 'Claude & Kiro'], ['claude', 'Claude'], ['kiro', 'Kiro']]), '')),
      field('Research agents', textInput('pipeline', 'agents', { type: 'number', min: 1, max: 8, placeholder: 'Use configured count' })),
      field('Skip stages', selectInput('pipeline', 'skip', choices([['', 'Do not skip'], ['profile', 'Profile updates'], ['apply', 'Applications'], ['brief', 'Daily briefing'], ['research', 'Research'], ['learn', 'Learning']]), '')),
      field('Bots at once', textInput('pipeline', 'bots', { type: 'number', min: 1, max: 6, placeholder: 'One after another' })),
      toggle('pipeline', 'containers', 'Use separate containers', 'Requires Docker and a signed-in browser for each site.'),
      toggle('pipeline', 'redo', 'Rerun selected completed stages', 'Completed stages in the selected group will run again.'),
      toggle('pipeline', 'fresh', 'Reset this date’s checkpoint', 'Clears this date’s progress before running. Use Resume to keep completed stages.')),
    previewBox('pipeline'), runButton('pipeline', 'Run configured flow', { confirm: () => S.forms.pipeline.dry_run ? null : liveRunConfirm(S.forms.pipeline.fresh ? `Reset saved progress for ${selectedDate} and run again. Completed stages can repeat, including applications and profile updates.` : `Run selected stages for ${selectedDate}, including live applications and profile updates.`) }));
  const diagnosticButtons = h('div', { class: 'flow-diagnostic-buttons' });
  const diagnostics = panel('Review & diagnose', { cls: 'flow-diagnostics' }, h('p', { class: 'muted', text: 'Review detailed activity or check generated learning and research files.' }),
    activityButton(), diagnosticButtons);
  function drawDiagnostics() {
    diagnosticButtons.replaceChildren(quickButton('pipeline', 'Check status', { command: 'status', date: selectedDate }), quickButton('pipeline', 'Validate material', { command: 'check', date: selectedDate }));
  }
  drawDiagnostics();
  const page = h('div', { class: 'page flows-page' },
    h('header', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'YOUR WORKFLOW' }), h('h1', { text: 'Flows' }), h('p', { class: 'lead', text: 'Track each step, fix issues and continue from saved progress.' })), refresh),
    h('section', { class: 'flow-date-bar', 'aria-label': 'Workflow date' }, field('Workflow date', datePicker), h('div', { class: 'flow-date-copy' }, h('p', { text: 'Progress, retries and new runs use this date.' }), freshness), savedDates),
    feedback, h('div', { class: 'flow-workspace' }, progress, h('aside', { class: 'flow-sidebar', 'aria-label': 'Workflow controls' }, configuration, diagnostics)));
  paint();
  queueMicrotask(() => { if (current()) { refreshProgress(); updateRunButtons(); } });
  return page;
}
