import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';
import { icon } from '../icons.js';
import { errorState, loadingState } from '../components/panel.js';
import { hooks } from '../state.js';
import { codeEditor } from '../components/code-editor.js';

const kinds = { dsa: 'DSA practice', learning: 'Daily learning', research: 'Research review' };
const scopeMemory = new WeakMap();
const paperHref = id => `#/learning/practice/paper/${encodeURIComponent(id)}`;
const plain = value => typeof value === 'string' ? value : Array.isArray(value) ? value.join('\n') : '';
const dateLabel = value => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const running = group => ['running', 'queued', 'starting'].includes(group?.job?.status) || group?.status === 'generating';
const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const isCourseRoute = route => typeof route === 'string' && /^\/course\/#\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*(?:\.md)?\/?$/i.test(route);
const safeRoute = route => typeof route === 'string' && (/^#\/learning(?:\/|\?|$)/.test(route) || isCourseRoute(route)) ? route : '#/learning/library';

function sourceLinks(sources = []) {
  return h('ul', { class: 'practice-sources' }, sources.map(source => h('li', {},
    h('a', { href: safeRoute(source.route), text: source.title || source.id, ...(isCourseRoute(source.route) ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }),
    h('span', { class: source.read ? 'is-complete' : '', text: source.read ? 'Reviewed' : 'Still to review' }))));
}

/** Body-only view. The Learning shell supplies the page title and navigation. */
export function renderLearningPractice(arg = '') {
  const scope = accountRequestSignal();
  if (!scopeMemory.has(scope)) scopeMemory.set(scope, { autoDates: new Set(), papers: new Map() });
  const memory = scopeMemory.get(scope);
  const paperId = arg.startsWith('paper/') ? arg.slice(6) : '';
  const route = location.hash.split('?')[0];
  const lifetime = new AbortController();
  const root = h('div', { class: 'practice-workspace' });
  const codeWidgets = new Map();
  const feedback = h('div', { class: 'practice-feedback', 'aria-live': 'polite' });
  const content = h('div', {}, loadingState(paperId ? 'Opening your practice paper…' : 'Opening practice & exams…'));
  root.append(feedback, content);
  let state, paper, index = 0, ticket = 0, readController, pollTimer, dayTimer, startedUntil = 0;
  let disposed = false, pending = false, submitting = false, renderedPaper = false, drafts = new Map();
  let questionHost, progressText, submitButton, paperStatus, statusText, pager;
  const current = () => !disposed && !scope.aborted && root.isConnected && location.hash.split('?')[0] === route;
  const dirty = () => [...drafts.values()].some(draft => draft.value !== draft.saved || draft.pending);

  function dispose() {
    if (disposed) return;
    disposed = true; ++ticket; readController?.abort(); lifetime.abort();
    clearTimeout(pollTimer); clearInterval(dayTimer);
    drafts.forEach(draft => clearTimeout(draft.timer));
    codeWidgets.forEach(widget => widget.dispose());
    scope.removeEventListener('abort', dispose); window.removeEventListener('hashchange', leave);
    window.removeEventListener('beforeunload', beforeUnload);
  }
  const leave = () => { if (location.hash.split('?')[0] !== route) dispose(); };
  const beforeUnload = event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } };
  scope.addEventListener('abort', dispose, { once: true });
  window.addEventListener('hashchange', leave); window.addEventListener('beforeunload', beforeUnload);
  root.dispose = dispose;

  function message(text, error = false) {
    feedback.replaceChildren(text ? h('p', { class: error ? 'practice-message is-error' : 'practice-message', role: error ? 'alert' : 'status', text }) : h('span'));
  }
  function controls() {
    root.querySelectorAll('[data-practice-action]').forEach(button => { button.disabled = pending || button.dataset.practiceBlocked === 'true'; });
    root.querySelectorAll('.practice-answer').forEach(input => { input.readOnly = submitting || !!paper?.completed_at; });
    root.setAttribute('aria-busy', String(pending || submitting));
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!paperId && current() && (running(state?.daily) || running(state?.weekly) || Date.now() < startedUntil)) {
      pollTimer = setTimeout(() => { if (current() && !document.hidden) load(); else if (current()) schedulePoll(); }, 3000);
    }
  }
  async function load() {
    if (!current() || pending || submitting || paperId && [...drafts.values()].some(draft => draft.pending)) return;
    const request = ++ticket;
    readController?.abort(); readController = new AbortController();
    const signal = AbortSignal.any([readController.signal, lifetime.signal]);
    try {
      const result = await api(paperId ? '/api/learning/practice/paper?id=' + encodeURIComponent(paperId) : '/api/learning/practice', undefined, { signal, fresh: true });
      if (!current() || request !== ticket) return;
      if (feedback.querySelector('.state-error')) feedback.replaceChildren();
      if (paperId) {
        const incoming = result.paper || result;
        const changed = !paper || Boolean(paper.completed_at) !== Boolean(incoming.completed_at);
        paper = incoming;
        if (paper.completed_at && feedback.querySelector('.practice-message.is-error')) message('Paper submitted. Your saved answers and reference notes are available below.');
        const cached = memory.papers.get(paper.id) || new Map();
        memory.papers.set(paper.id, cached);
        for (const question of paper.questions || []) {
          const existing = drafts.get(question.id), saved = plain(question.answer);
          if (!existing) {
            const remembered = cached.get(question.id);
            const value = !paper.completed_at && remembered && remembered.value !== remembered.saved ? remembered.value : saved;
            const draft = { value, saved, error: '', pending: null, timer: null };
            drafts.set(question.id, draft); cached.set(question.id, draft);
          } else if (paper.completed_at || !existing.pending && existing.value === existing.saved) {
            existing.value = saved; existing.saved = saved;
          }
        }
        if (!renderedPaper || changed) drawPaper();
        else updateAnswerState();
      } else {
        state = result;
        if ([state.daily, state.weekly].some(group => ['completed', 'error'].includes(group?.job?.status)) && !running(state.daily) && !running(state.weekly)) startedUntil = 0;
        drawHub();
        if (state.settings?.automatic && state.configured && !running(state.daily) && state.daily?.automatic_ready !== false && !memory.autoDates.has(state.date)) {
          memory.autoDates.add(state.date);
          queueMicrotask(() => { if (current()) generate('daily', true); });
        }
      }
    } catch (error) {
      if (!current() || request !== ticket || error.name === 'AbortError') return;
      feedback.replaceChildren(errorState(error.message, load));
      if (!state && !paper) content.replaceChildren();
    } finally { if (current() && request === ticket) schedulePoll(); }
  }
  root.refresh = load;

  async function action(work) {
    if (!current() || pending) return;
    const triggerId = document.activeElement?.id;
    pending = true; ++ticket; readController?.abort(); controls();
    try { await work(); }
    catch (error) { if (current() && error.name !== 'AbortError') message(error.message, true); }
    finally { if (current()) {
      pending = false; controls(); schedulePoll();
      const trigger = triggerId && root.querySelector(`#${CSS.escape(triggerId)}`);
      if (trigger && !trigger.disabled && document.activeElement === document.body) trigger.focus({ preventScroll: true });
    } }
  }
  async function generate(mode, automatic = false, enable = false) {
    if (!current() || pending || !state?.configured) return;
    await action(async () => {
      if (enable) {
        await api('/api/learning/practice/settings', { automatic: true }, { signal: lifetime.signal });
        if (!current()) return;
        state.settings = { ...state.settings, automatic: true }; memory.autoDates.add(state.date);
      }
      const result = await api('/api/learning/practice/generate', { mode, automatic }, { signal: lifetime.signal });
      if (!current()) return;
      startedUntil = result.started ? Date.now() + 30_000 : 0;
      if (result.status && typeof result.status === 'object') { state = result.status; drawHub(); }
      message(result.started ? `${mode === 'weekly' ? 'Weekly exam' : 'Daily practice'} is being prepared. You can keep working while it runs.` : 'Checking your saved papers.');
      if (result.started) Promise.resolve(hooks.refreshStatus?.()).catch(error => {
        if (current()) message(`Practice started. Activity could not refresh yet. ${error.message}`, true);
      });
    });
    if (current()) load();
  }
  function paperCard(slot, mode) {
    const saved = slot.paper, done = Boolean(saved?.completed_at), sources = saved?.sources || [];
    const answered = saved?.questions?.filter(question => plain(question.answer).trim()).length || 0;
    const waiting = ['generating', 'running', 'pending'].includes(slot.status) && running(mode === 'weekly' ? state.weekly : state.daily);
    return h('article', { class: 'practice-paper-card', 'data-practice-kind': slot.kind, 'data-practice-mode': mode },
      h('div', { class: 'practice-card-top' }, h('span', { class: 'practice-kind', text: kinds[slot.kind] || slot.kind }),
        h('span', { class: `practice-status${done ? ' is-complete' : ''}`, text: done ? 'Complete' : saved ? answered ? 'In progress' : 'Ready' : waiting ? 'Preparing' : slot.status === 'error' ? 'Needs retry' : slot.status === 'blocked' ? 'Needs material' : 'Not prepared' })),
      h('h3', { text: saved?.title || (slot.kind === 'dsa' ? 'Solve and explain' : slot.kind === 'learning' ? 'Put your learning into practice' : 'Connect the research') }),
      h('p', { class: 'practice-card-description', text: saved?.goal || saved?.reason || slot.reason || 'Questions will be based on your available learning material.' }),
      saved ? h('div', { class: 'practice-card-meta' }, h('span', { text: `${answered} of ${saved.questions?.length || 0} answered` }),
        sources.some(source => !source.read) ? h('span', { text: 'Includes unfinished reading' }) : h('span', { text: `${sources.length} source${sources.length === 1 ? '' : 's'}` })) : null,
      saved ? h('a', { class: 'btn', href: paperHref(saved.id), text: done ? 'Review paper' : answered ? 'Continue paper' : 'Open paper', 'aria-label': `${done ? 'Review' : answered ? 'Continue' : 'Open'} paper: ${kinds[slot.kind] || slot.kind}${mode === 'weekly' ? ' weekly exam' : ''}` }, icon('arrow-up-right', 'icon icon-sm'))
        : slot.status === 'blocked' ? h('a', { class: 'text-link practice-material-link', href: slot.kind === 'dsa' ? '#/learning/dsa' : slot.kind === 'learning' ? '#/learning/plan' : '#/learning/library?category=Briefing',
          text: slot.kind === 'dsa' ? 'Open DSA learning →' : slot.kind === 'learning' ? 'Open daily learning →' : 'Find saved research →' }) : null);
  }
  function drawHub() {
    const focusId = content.contains(document.activeElement) ? document.activeElement.id : '';
    const openDetails = [...content.querySelectorAll('details[open]')].map(detail => detail.className);
    const groups = ['dsa', 'learning', 'research'];
    const daily = state.daily || {}, weekly = state.weekly || {};
    const dailySlots = groups.map(kind => daily.papers?.find(slot => slot.kind === kind) || { kind, status: 'pending' });
    const weeklySlots = groups.map(kind => weekly.papers?.find(slot => slot.kind === kind) || { kind, status: 'pending' });
    const hasDaily = dailySlots.some(slot => slot.paper), hasWeekly = weeklySlots.some(slot => slot.paper);
    const generating = running(daily), generatingWeekly = running(weekly);
    const dailyNeeds = daily.needs_generation ?? dailySlots.some(slot => !slot.paper);
    const weeklyNeeds = weekly.needs_generation ?? weeklySlots.some(slot => !slot.paper);
    const nextDaily = dailySlots.find(slot => slot.paper && !slot.paper.completed_at)?.paper || dailySlots.find(slot => slot.paper)?.paper;
    const nextWeekly = weeklySlots.find(slot => slot.paper && !slot.paper.completed_at)?.paper || weeklySlots.find(slot => slot.paper)?.paper;
    const automatic = h('input', { type: 'checkbox', id: 'practice-automatic', checked: !!state.settings?.automatic, 'aria-label': 'Prepare daily practice automatically', 'data-practice-action': true, onchange: event => {
      const wanted = event.target.checked;
      action(async () => {
        await api('/api/learning/practice/settings', { automatic: wanted }, { signal: lifetime.signal });
        if (current()) { state.settings = { ...state.settings, automatic: wanted }; message(wanted ? 'Daily AI practice is enabled.' : 'Automatic daily preparation is paused. Your papers remain saved.'); }
      }).then(() => { if (current()) { event.target.checked = !!state.settings?.automatic; load(); } });
    } });
    const start = !dailyNeeds && !nextDaily && !generating ? h('a', { class: 'btn', href: '#/learning', text: 'Open today’s learning' })
      : !dailyNeeds && nextDaily && !generating ? h('a', { class: 'btn btn-primary', href: paperHref(nextDaily.id), text: nextDaily.completed_at ? 'Review daily practice' : 'Continue daily practice' })
      : state.configured ? h('button', { class: 'btn btn-primary', id: 'practice-generate-daily', type: 'button', 'data-practice-action': true, 'data-practice-blocked': String(generating), disabled: generating,
      onclick: () => generate('daily', false, !hasDaily && !state.settings?.automatic), text: generating ? 'Preparing daily papers…' : hasDaily ? 'Prepare missing papers' : 'Start AI practice' })
      : h('a', { class: 'btn btn-primary', href: '#/connections', text: 'Set up AI connection' });
    const carry = state.next_day?.carry || [];
    content.replaceChildren(...[
      h('div', { class: 'practice-intro' }, h('p', { text: 'Apply what you learn with daily questions and a weekly exam. Your saved reading gives each paper its context.' }),
        h('span', { class: 'practice-provider', text: state.configured ? `${state.provider === 'claude' ? 'Claude' : state.provider === 'kiro' ? 'Kiro' : state.provider} CLI available` : 'AI connection needed' })),
      !state.configured ? h('div', { class: 'practice-connection-note' }, icon('info', 'icon icon-sm'), h('p', { text: 'Connect the AI CLI used by your research agents. Practice papers are created after that connection is available.' })) : null,
      h('section', { class: 'practice-section', 'aria-label': 'Daily practice papers' },
        h('header', { class: 'practice-section-head' }, h('div', {}, h('h2', { text: 'Daily practice' }), h('p', { text: `${dateLabel(state.date)} · Three focused papers from your learning material` })), start),
        generating ? h('p', { class: 'practice-run-state', role: 'status', text: 'Preparing your questions. This page updates automatically; run details are available in Activity.' }) : null,
        !dailyNeeds && !hasDaily && !generating ? h('p', { class: 'practice-weekly-note', text: 'Add learning material first. Each paper below explains what it needs.' }) : null,
        daily.job?.error ? h('p', { class: 'practice-message is-error', role: 'alert', text: plain(daily.job.error) }) : null,
        h('div', { class: 'practice-paper-grid' }, dailySlots.map(slot => paperCard(slot, 'daily'))),
        h('label', { class: 'practice-automatic' }, automatic, h('span', {}, h('strong', { text: 'Prepare daily practice automatically' }), h('small', { text: 'Prepare missing daily papers while Morrow is running, and catch up when you open it again. Unfinished papers stay in your next plan.' })))),
      h('section', { class: 'practice-section practice-weekly', 'aria-label': 'Weekly exam papers' },
        h('header', { class: 'practice-section-head' }, h('div', {}, h('h2', { text: 'Weekly exam' }), h('p', { text: weekly.window_start ? `${dateLabel(weekly.window_start)}–${dateLabel(weekly.window_end)} · Based on learning you completed this week` : 'Review the learning you completed this week.' })),
          !weeklyNeeds && !nextWeekly && !generatingWeekly ? h('a', { class: 'btn', href: '#/learning', text: 'Complete daily learning' })
            : !weeklyNeeds && nextWeekly && !generatingWeekly ? h('a', { class: 'btn', href: paperHref(nextWeekly.id), text: nextWeekly.completed_at ? 'Review weekly exam' : 'Continue weekly exam' })
            : state.configured ? h('button', { class: 'btn', id: 'practice-generate-weekly', type: 'button', 'data-practice-action': true, 'data-practice-blocked': String(generatingWeekly), disabled: generatingWeekly, onclick: () => generate('weekly'), text: generatingWeekly ? 'Preparing weekly exam…' : hasWeekly ? 'Prepare missing exam papers' : 'Prepare weekly exam' }) : null),
        h('p', { class: 'practice-weekly-note', text: 'Answer every question before submitting. Reference answers become available after submission.' }),
        weekly.job?.error ? h('p', { class: 'practice-message is-error', role: 'alert', text: plain(weekly.job.error) }) : null,
        hasWeekly || generatingWeekly || !weeklyNeeds ? h('div', { class: 'practice-paper-grid' }, weeklySlots.map(slot => paperCard(slot, 'weekly'))) : h('p', { class: 'practice-empty', text: 'Your weekly papers will appear here when prepared.' })),
      carry.length ? h('details', { class: 'practice-carry' }, h('summary', { text: `${carry.length} unfinished paper${carry.length === 1 ? '' : 's'} in your next plan` }),
        h('p', { text: state.next_day?.message || 'Keep building on your unfinished papers. Your saved answers remain available when you continue.' }),
        h('ul', { class: 'practice-sources' }, carry.map(item => h('li', {}, h('a', { href: paperHref(item.id), text: item.title }), h('span', { text: `${kinds[item.kind] || 'Practice'} · Unfinished` }))))) : null,
      state.archive?.length ? h('details', { class: 'practice-archive' }, h('summary', { text: `Saved papers · ${state.archive.length}` }), h('ul', {}, state.archive.map(item => h('li', {},
        h('a', { href: paperHref(item.paper_id || item.id), text: item.title }), h('span', { text: `${item.mode === 'weekly' ? 'Weekly exam' : 'Daily practice'} · ${dateLabel(item.created_at)}${item.completed_at ? ' · Complete' : ''}` }))))) : null].filter(Boolean));
    controls();
    content.querySelectorAll('details').forEach(detail => { if (openDetails.includes(detail.className)) detail.open = true; });
    if (focusId) content.querySelector(`#${CSS.escape(focusId)}`)?.focus({ preventScroll: true });
  }

  function updateAnswerState() {
    if (!paper || !current()) return;
    const questions = paper.questions || [], answered = questions.filter(question => drafts.get(question.id)?.value.trim()).length;
    if (progressText) progressText.textContent = `${answered} of ${questions.length} answered`;
    if (submitButton) {
      submitButton.disabled = submitting || !!paper.completed_at || answered !== questions.length || !questions.length;
      submitButton.textContent = paper.completed_at ? 'Paper submitted' : submitting ? 'Submitting…' : 'Submit paper';
    }
    if (paperStatus) paperStatus.textContent = paper.completed_at ? 'Complete · review your answers below' : 'Your answers save as you write';
    if (pager) [...pager.children].forEach((button, position) => {
      const question = questions[position], answered = !!drafts.get(question.id)?.value.trim();
      button.classList.toggle('is-answered', answered);
      button.setAttribute('aria-label', `Question ${position + 1}${answered ? ', answered' : ''}`);
    });
    const draft = drafts.get(questions[index]?.id);
    if (statusText && draft) {
      statusText.textContent = draft.error ? draft.error : draft.pending ? 'Saving answer…' : draft.value !== draft.saved ? 'Unsaved changes' : draft.saved ? 'Answer saved' : 'Start writing your answer';
      statusText.classList.toggle('is-error', !!draft.error);
    }
  }
  async function saveDraft(id) {
    const draft = drafts.get(id);
    if (!current() || !draft || paper.completed_at) return false;
    clearTimeout(draft.timer);
    if (draft.pending) { await draft.pending; return draft.value === draft.saved ? true : saveDraft(id); }
    if (draft.value === draft.saved) return true;
    // A read begun before an answer save must not replace the saved answer later.
    ++ticket; readController?.abort();
    const value = draft.value;
    draft.error = '';
    draft.pending = (async () => {
      try {
        await api('/api/learning/practice/answer', { paper_id: paper.id, question_id: id, answer: value }, { signal: lifetime.signal });
        draft.saved = value;
        if (current()) updateAnswerState();
        return true;
      } catch (error) {
        if (current() && error.name !== 'AbortError') draft.error = `Could not save. ${error.message}`;
        return false;
      } finally { draft.pending = null; if (current()) updateAnswerState(); }
    })();
    updateAnswerState();
    const saved = await draft.pending;
    if (saved && current() && draft.value !== draft.saved) return saveDraft(id);
    return saved;
  }
  async function submit() {
    if (!current() || submitting || paper.completed_at) return;
    submitting = true; updateAnswerState(); controls();
    try {
      const saved = await Promise.all((paper.questions || []).map(question => saveDraft(question.id)));
      if (!current()) return;
      if (saved.some(result => !result)) { message('Some answers could not be saved. Retry saving before submitting.', true); return; }
      if ([...drafts.values()].some(draft => !draft.value.trim())) return;
      await api('/api/learning/practice/answer', { paper_id: paper.id, completed: true }, { signal: lifetime.signal });
      if (!current()) return;
      message('Paper submitted. Compare your answers with the reference notes below.');
      window.dispatchEvent(new Event('learning-updated'));
    } catch (error) { if (current() && error.name !== 'AbortError') message(error.message, true); }
    finally { if (current()) { submitting = false; updateAnswerState(); controls(); load(); } }
  }
  function drawQuestion(focus = false) {
    const questions = paper.questions || [], question = questions[index];
    if (!question) { questionHost.replaceChildren(h('p', { text: 'This paper has no questions yet.' })); return; }
    const draft = drafts.get(question.id), answerId = `practice-answer-${index}`;
    if (paper.kind === 'dsa' && !codeWidgets.has(question.id)) {
      codeWidgets.set(question.id, codeEditor({ key: `practice/${paper.id}/${question.id}`, onSubmitted: result => {
        if (!current() || paper.completed_at) return;
        const saved = drafts.get(question.id);
        saved.value = `${result.language} solution\n\n${result.code}\n\nTests: ${result.passed}/${result.total}`;
        if (paper.questions[index]?.id === question.id) {
          const answer = questionHost.querySelector('.practice-answer');
          if (answer) answer.value = saved.value;
        }
        updateAnswerState(); saveDraft(question.id);
      } }));
    }
    const textarea = h('textarea', { id: answerId, class: `textarea practice-answer${paper.kind === 'dsa' ? ' is-code' : ''}`, rows: 9, maxLength: 20000, value: draft.value, readOnly: submitting || !!paper.completed_at,
      placeholder: paper.kind === 'dsa' ? 'Write your approach, code and complexity analysis…' : 'Explain your reasoning and connect it to the source material…',
      oninput: event => {
        draft.value = event.target.value; draft.error = ''; clearTimeout(draft.timer); updateAnswerState();
        draft.timer = setTimeout(() => saveDraft(question.id), 700);
      }, onblur: () => { if (draft.value !== draft.saved) saveDraft(question.id); },
      onkeydown: event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); saveDraft(question.id); } },
    });
    statusText = h('p', { class: 'practice-save-state', role: 'status', id: 'practice-save-status' });
    textarea.setAttribute('aria-describedby', 'practice-save-status');
    const reviewAvailable = paper.mode !== 'weekly' || !!paper.completed_at;
    const reference = reviewAvailable ? plain(question.reference_answer) : '', rubric = reviewAvailable && Array.isArray(question.rubric) ? question.rubric : [];
    const questionSources = (paper.sources || []).filter(source => (question.source_ids || []).includes(source.id));
    questionHost.replaceChildren(...[
      h('div', { class: 'practice-question-top' }, h('h3', { text: `Question ${index + 1}` }), h('span', { text: [question.difficulty, question.minutes ? `${question.minutes} min suggested` : ''].filter(Boolean).join(' · ') })),
      h('p', { class: 'practice-question-prompt', text: plain(question.prompt) }),
      paper.kind === 'dsa' ? codeWidgets.get(question.id) : null,
      question.hint ? h('details', { class: 'practice-hint' }, h('summary', { text: 'Show hint' }), h('p', { text: plain(question.hint) })) : null,
      h('label', { class: 'practice-answer-label', for: answerId, text: paper.completed_at ? 'Your submitted answer' : 'Your answer' }), textarea,
      h('div', { class: 'practice-answer-tools' }, statusText, !paper.completed_at ? h('button', { class: 'btn', type: 'button', onclick: () => saveDraft(question.id), text: 'Save answer' }) : null),
      paper.kind === 'dsa' ? h('p', { class: 'practice-code-note', text: 'Coding submissions save the tested solution here. Add your reasoning before submitting the paper. Coding points appear in Progress.' }) : null,
      reference || rubric.length ? h('details', { class: 'practice-reference', open: !!paper.completed_at }, h('summary', { text: 'Reference answer & review criteria' }),
        reference ? h('div', { class: 'practice-reference-answer', text: reference }) : null,
        rubric.length ? h('ul', {}, rubric.map(item => h('li', { text: plain(item) }))) : null,
        h('p', { class: 'practice-code-note', text: 'Use these notes to review your reasoning. No automatic score is assigned.' })) : null,
      questionSources.length ? h('details', { class: 'practice-question-sources' }, h('summary', { text: `Question sources · ${questionSources.length}` }), sourceLinks(questionSources)) : null,
      h('div', { class: 'practice-question-navigation' }, h('button', { class: 'btn', type: 'button', disabled: index === 0, onclick: () => { saveDraft(question.id); index--; drawQuestion(true); }, text: 'Previous question' }),
        index < questions.length - 1 ? h('button', { class: 'btn', type: 'button', onclick: () => { saveDraft(question.id); index++; drawQuestion(true); }, text: 'Next question' }) : h('span', { text: 'Last question' }))].filter(Boolean));
    [...pager.children].forEach((button, position) => button.setAttribute('aria-current', position === index ? 'step' : 'false'));
    updateAnswerState();
    if (focus) { const heading = questionHost.querySelector('h3'); heading.tabIndex = -1; heading.focus(); }
  }
  function drawPaper() {
    const questions = paper.questions || [];
    index = Math.min(index, Math.max(0, questions.length - 1));
    progressText = h('span', { class: 'practice-answer-count' });
    paperStatus = h('p', { class: 'practice-paper-status' });
    pager = h('nav', { class: 'practice-question-pager', 'aria-label': 'Practice questions' }, questions.map((question, position) => h('button', {
      type: 'button', text: String(position + 1), onclick: () => { const previous = questions[index]; if (previous) saveDraft(previous.id); index = position; drawQuestion(true); },
    })));
    questionHost = h('section', { class: 'practice-question', 'aria-label': 'Current practice question' });
    submitButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: submit });
    content.replaceChildren(...[h('a', { class: 'practice-back', href: '#/learning/practice', text: '← Back to practice & exams' }),
      h('header', { class: 'practice-paper-head' }, h('div', {}, h('p', { class: 'practice-kind', text: `${paper.mode === 'weekly' ? 'Weekly exam' : 'Daily practice'} · ${kinds[paper.kind] || 'Practice'}` }),
        h('h2', { text: paper.title }), paper.goal ? h('p', { text: plain(paper.goal) }) : null, paperStatus), progressText),
      paper.sources?.length ? h('details', { class: 'practice-paper-sources' }, h('summary', { text: `Based on ${paper.sources.length} learning source${paper.sources.length === 1 ? '' : 's'}` }),
        paper.reason ? h('p', { class: 'practice-source-reason' }, h('strong', { text: 'Why this paper' }), h('span', { text: plain(paper.reason) })) : null,
        sourceLinks(paper.sources)) : null,
      pager, questionHost,
      h('footer', { class: 'practice-submit' }, h('p', { text: paper.completed_at ? 'Your submitted paper is saved for review.' : paper.mode === 'weekly' ? 'Answer every question to submit and unlock the reference notes.' : 'Answer every question, then submit to save your completed paper.' }), submitButton)].filter(Boolean));
    renderedPaper = true; drawQuestion();
  }
  if (!paperId) dayTimer = setInterval(() => { if (current() && !document.hidden && state?.date !== localDate()) load(); }, 60_000);
  queueMicrotask(load);
  return root;
}
