import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api, accountRequestSignal } from '../api.js';
import { S } from '../state.js';
import { routeAccess } from '../access-policy.js';
import { loadingState, errorState } from '../components/panel.js';
import { activityView } from '../components/learning-progress.js';
import { navigationArt } from '../components/navigation-art.js';
import { parseRoute } from '../router.js';
import { learningSection, renderLearningSwitcher } from '../learning-sections.js';
import { fetchButton } from './research-desk.js';
import { renderLearningLibrary } from './learning-library.js';
import { renderDsaSheet } from './dsa-sheet.js';
import { renderLearningPractice } from './learning-practice.js';
import { codeEditor } from '../components/code-editor.js';
import { scoreProgress } from '../components/score-progress.js';
import { setConsoleSize } from '../components/console.js';
import { updateRunButtons } from '../forms.js';
import { renderLearningWorkspace } from './learning-workspace.js';
import { learningSave } from '../components/learning-save.js';
import { learningHeader, individualProgress, learningBadges } from '../components/learning-overview.js';
import { learningFeed } from '../components/learning-feed.js';
import { lessonReader } from '../components/lesson-reader.js';
import { enhanceLearningDiagrams } from '../components/learning-diagrams.js';
import { buildBreadcrumbs } from '../components/breadcrumbs.js';
import { studyNotes } from '../components/study-notes.js';

let disposeCurrent;
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Both reading sources use semantic elements only, without executable HTML or URLs.
function prose(html) {
  const allowed = new Set(['p', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 's', 'a', 'details', 'summary']);
  function copy(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    let tag = node.tagName.toLowerCase();
    if (!allowed.has(tag)) return document.createTextNode(node.textContent);
    if (tag === 'h1') tag = 'h2';
    const props = {};
    if (tag === 'code' && node.classList.contains('language-mermaid')) props.class = 'language-mermaid';
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      if (/^(#|\/#\/)/.test(href)) props.href = href;
      else if (/^(https?:\/\/|\/course\/)/.test(href)) Object.assign(props, { href, target: '_blank', rel: 'noopener noreferrer' });
    }
    return h(tag, props, [...node.childNodes].map(copy));
  }
  return enhanceLearningDiagrams(h('div', { class: 'daily-prose' }, [...new DOMParser().parseFromString(html || '', 'text/html').body.childNodes].map(copy)));
}

export function renderDailyLearning(arg = '') {
  disposeCurrent?.();
  const [part, ...rest] = arg.split('/');
  const view = ['plan', 'dsa', 'practice', 'progress', 'resume', 'courses', 'library', 'read', 'weekly', 'discover', 'bookmarks', 'notes'].includes(part) ? part : 'today';
  const workspaceView = ['weekly', 'discover', 'bookmarks', 'notes'].includes(view) || view === 'progress' && !S.legacyAccess;
  const sheetView = view === 'dsa' && ['sheet', 'problem'].includes(rest[0]);
  const secondary = ['resume', 'courses', 'library', 'read', 'practice'].includes(view) || sheetView || workspaceView;
  const focusedReading = view === 'plan' || view === 'read' || view === 'dsa' && !sheetView;
  const questionBank = view === 'weekly' && new URLSearchParams(location.hash.split('?')[1] || '').get('view') === 'questions';
  const readingParent = view === 'read' ? buildBreadcrumbs({ name: 'learning', arg },
    { query: location.hash.split('?')[1] || '' }).at(-2) : null;
  const section = learningSection(arg);
  let secondaryBody;
  const scope = accountRequestSignal();
  const headerContext = focusedReading || view === 'today' || questionBank ? {} : learningHeader(view);
  const content = h('div', { class: 'daily-content' }, loadingState('Opening your daily learning…'));
  const feedback = h('div', { class: 'daily-feedback', 'aria-live': 'polite', tabIndex: -1 });
  const refreshButton = h('button', { class: 'btn daily-refresh', type: 'button', onclick: () => { headerContext.refresh?.(); secondary ? secondaryBody?.refresh() : load(); }, 'aria-label': 'Refresh learning', text: 'Refresh' });
  const pageTitle = questionBank ? 'Interview questions' : sheetView ? rest[0] === 'problem' ? 'DSA problem' : 'DSA practice sheet' : { plan: 'Daily learning', dsa: 'DSA practice', read: 'Reading' }[view] || section.title;
  const dsaNav = view === 'dsa' ? h('nav', { class: 'dsa-local-nav', 'aria-label': 'DSA practice views' },
    h('a', { href: '#/learning/dsa', 'aria-current': !sheetView ? 'page' : null }, navigationArt('learning', 'learning-tab-art', 'today'), 'Daily lesson'),
    h('a', { href: '#/learning/dsa/sheet', 'aria-current': sheetView ? 'page' : null }, navigationArt('learning', 'learning-tab-art', 'practice'), 'Practice sheet'),
    routeAccess({ name: 'learning', arg: 'practice' }, S).kind === 'allowed' ? h('a', { href: '#/learning/practice' }, navigationArt('learning', 'learning-tab-art', 'courses'), 'Practice & exams') : null) : null;
  const focusToggle = focusedReading ? h('button', { type: 'button', class: 'btn learning-focus-toggle',
    'aria-pressed': 'false', text: 'Show navigation', onclick: () => {
      const focused = page.classList.toggle('learning-study-mode');
      focusToggle.textContent = focused ? 'Show navigation' : 'Hide navigation';
      focusToggle.setAttribute('aria-pressed', String(!focused));
    } }) : null;
  const page = h('div', { class: `page page-wide daily-page${focusedReading ? ' daily-focus-page learning-study-mode' : ''}`, 'data-learning-view': view },
    h('header', { class: 'page-head daily-head' }, h('div', {},
      focusedReading ? h('a', { class: 'learning-exit', href: readingParent?.href || '#/learning', text: `← ${readingParent?.label || 'Learning'}` }) : null,
      h('h1', { text: pageTitle })),
      h('div', { class: 'daily-head-tools' }, focusToggle, refreshButton)),
    focusedReading || view === 'today' || questionBank ? null : headerContext, renderLearningSwitcher(arg), dsaNav, feedback, content);
  if (secondary) {
    secondaryBody = workspaceView ? renderLearningWorkspace(view) : view === 'practice' ? renderLearningPractice(rest.join('/')) : sheetView ? renderDsaSheet(rest.join('/')) : renderLearningLibrary(view, rest.join('/'));
    content.replaceChildren(secondaryBody);
    const refresh = () => { if (!scope.aborted && page.isConnected) { headerContext.refresh?.(); secondaryBody.refresh(); } else cleanup(); };
    const visible = () => { if (!document.hidden) refresh(); };
    const leave = () => { if (parseRoute().name !== 'learning' || parseRoute().arg !== arg) cleanup(); };
    function cleanup() { headerContext.dispose?.(); secondaryBody?.dispose?.(); window.removeEventListener('learning-refresh', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); window.removeEventListener('hashchange', leave); scope.removeEventListener('abort', cleanup); }
    window.addEventListener('learning-refresh', refresh); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible); window.addEventListener('hashchange', leave); scope.addEventListener('abort', cleanup, { once: true });
    disposeCurrent = cleanup;
    return page;
  }
  let hub, dsa, activity, scores, overview, scorePanel, feedPanel, busy = false, loading = false, disposed = false, request = 0, loadController;
  const codeWidgets = new Map();
  const noteWidgets = new Map();
  let errors = {}, step = 'concept', problemIndex = 0, opened = [], dsaSelectionKey = '';
  const current = () => !disposed && !scope.aborted && page.isConnected;
  function capture() { opened = [...content.querySelectorAll('details[open][data-disclosure]')].map(el => el.dataset.disclosure); }
  function dispose() {
    disposed = true; loadController?.abort(); clearInterval(dayTimer);
    headerContext.dispose?.();
    codeWidgets.forEach(widget => widget.dispose());
    noteWidgets.forEach(widget => widget.dispose());
    scorePanel?.dispose();
    feedPanel?.dispose();
    document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onFocus);
    window.removeEventListener('hashchange', onRouteChange); scope.removeEventListener('abort', dispose);
    window.removeEventListener('learning-refresh', onFocus);
  }
  const onFocus = () => { if (current()) { headerContext.refresh?.(); load(); } else dispose(); };
  const onVisible = () => { if (!document.hidden) onFocus(); };
  const onRouteChange = () => { if (parseRoute().name !== 'learning' || parseRoute().arg !== arg) dispose(); };
  const dayTimer = setInterval(() => { if (!current()) return dispose(); if (!document.hidden && (hub?.date || dsa?.date) !== localDay()) { headerContext.refresh?.(); load(); } }, 60_000);
  disposeCurrent = dispose;
  scope.addEventListener('abort', dispose, { once: true }); document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onFocus); window.addEventListener('hashchange', onRouteChange);
  window.addEventListener('learning-refresh', onFocus);

  async function load() {
    if ([...codeWidgets.values()].some(widget => widget.isConnected && widget.hasDraft())) return;
    if ([...noteWidgets.values()].some(widget => widget.isConnected && (widget.hasDraft?.() || widget.contains(document.activeElement)))) return;
    if (busy || loading || !current()) return;
    const ticket = ++request;
    loadController = new AbortController(); loading = true; updateControls();
    const results = await Promise.allSettled(['/api/learning/daily', '/api/learning/dsa', '/api/learning/activity', ...(view === 'progress' ? ['/api/learning/code/progress', '/api/learning/overview'] : [])]
      .map(path => api(path, undefined, { signal: loadController.signal })));
    if (!current() || ticket !== request) return;
    capture(); errors = {};
    const previousLesson = hub?.plan?.id;
    const focusKey = document.activeElement?.dataset.learningFocus;
    const focusId = document.activeElement?.id;
    results.forEach((result, i) => {
      const key = ['plan', 'dsa', 'activity', 'scores', 'overview'][i];
      if (result.status === 'fulfilled') {
        if (i === 0) hub = result.value;
        if (i === 1) dsa = result.value;
        if (i === 2) { activity = result.value; S.learningActivity = activity; }
        if (i === 3) scores = result.value;
        if (i === 4) overview = result.value;
      } else if (result.reason.name !== 'AbortError') errors[key] = result.reason.message;
    });
    // A partial refresh must never leave yesterday's task beside today's task.
    const latestDate = [localDay(), hub?.date, dsa?.date].filter(Boolean).sort().at(-1);
    if (hub && hub.date < latestDate) { hub = null; errors.plan = 'A new day has started. Refresh to open today’s learning plan.'; }
    if (dsa && dsa.date < latestDate) { dsa = null; errors.dsa = 'A new day has started. Refresh to open today’s DSA topic.'; }
    if (!activity && dsa) activity = dsa.activity;
    if (view === 'plan' && previousLesson && hub?.plan?.id && hub.plan.id !== previousLesson) {
      const query = new URLSearchParams(location.hash.split('?')[1] || ''); query.delete('part'); query.delete('stage');
      history.replaceState(history.state, '', location.hash.split('?')[0] + (query.size ? '?' + query : ''));
    }
    if (dsa && dsaSelectionKey !== `${dsa.date}:${dsa.lesson.id}`) {
      const query = new URLSearchParams(location.hash.split('?')[1] || '');
      const changedTopic = Boolean(dsaSelectionKey);
      dsaSelectionKey = `${dsa.date}:${dsa.lesson.id}`;
      if (changedTopic) {
        query.delete('step'); query.delete('problem');
        history.replaceState(history.state, '', location.hash.split('?')[0] + (query.size ? '?' + query : ''));
      }
      const requestedStep = query.get('step');
      const practiceReady = dsa.progress.read && dsa.lesson.practice.length > 0
        && dsa.lesson.practice.every(problem => dsa.progress.practiced.includes(problem.id));
      opened = []; step = ['concept', 'example', 'practice', 'review'].includes(requestedStep)
        ? requestedStep : dsa.progress.completed_at || practiceReady ? 'review' : dsa.progress.read ? 'practice' : 'concept';
      const requestedProblem = dsa.lesson.practice.findIndex(p => String(p.id) === query.get('problem'));
      problemIndex = requestedProblem >= 0 ? requestedProblem : Math.max(0, dsa.lesson.practice.findIndex(p => !dsa.progress.practiced.includes(p.id)));
    }
    loading = false; feedback.replaceChildren(); draw();
    if (focusKey) content.querySelector(`[data-learning-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    else if (focusId) content.querySelector(`#${CSS.escape(focusId)}`)?.focus({ preventScroll: true });
  }
  async function save(kind, payload) {
    if (busy || !current()) return;
    const focusKey = document.activeElement?.dataset.learningFocus;
    busy = true; ++request; loadController?.abort(); loading = false; capture(); updateControls();
    feedback.replaceChildren(h('p', { class: 'daily-save-status', role: 'status', text: 'Saving progress…' }));
    try {
      if (kind === 'dsa') {
        const result = await api('/api/learning/dsa', { date: dsa.date, topic: dsa.lesson.id, ...payload });
        if (!current()) return;
        dsa = result; activity = dsa.activity; delete errors.dsa; delete errors.activity;
      } else {
        const result = await api('/api/research/read', { id: hub.plan.id, read: true });
        if (!current()) return;
        hub = { ...hub, plan: { ...hub.plan, read: result.read } };
        const refreshed = await Promise.allSettled(['/api/learning/daily', '/api/learning/activity'].map(path => api(path, undefined, { fresh: true })));
        if (!current()) return;
        refreshed.forEach((result, i) => {
          const key = i ? 'activity' : 'plan';
          if (result.status === 'fulfilled') { if (i) activity = result.value; else hub = result.value; delete errors[key]; }
          else errors[key] = 'Saved, but the latest summary could not refresh. ' + result.reason.message;
        });
      }
      if (!current()) return;
      S.learningActivity = activity; draw();
      feedback.replaceChildren(h('p', { class: 'daily-save-status', role: 'status', text: kind === 'plan'
        ? 'Learning day completed. Your progress is saved.' : payload.task === 'complete'
          ? 'DSA topic completed. Your progress and 50 XP are saved.' : 'Progress saved.' }));
    } catch (error) {
      if (current() && error.name !== 'AbortError') {
        draw(); feedback.replaceChildren(errorState('Progress was not confirmed. ' + error.message,
          error.status === 409 ? load : () => save(kind, payload)));
      }
    } finally {
      busy = false;
      if (current()) {
        updateControls();
        if (focusKey) {
          const control = content.querySelector(`[data-learning-focus="${CSS.escape(focusKey)}"]`);
          (control && !control.disabled ? control : feedback).focus({ preventScroll: true });
        }
      }
    }
  }
  function updateControls() {
    refreshButton.disabled = busy || loading;
    content.querySelectorAll('[data-save-control]').forEach(el => { el.disabled = busy || el.dataset.blocked === 'true'; });
    content.querySelectorAll('[data-step-control]').forEach(el => { el.disabled = busy; });
  }
  function warning(key) { return errors[key] ? errorState(errors[key], load) : null; }
  function status(done, started = false) { return h('span', { class: `daily-status${done ? ' is-complete' : ''}` }, icon(done ? 'check' : 'book', 'icon icon-sm'), done ? 'Complete' : started ? 'In progress' : 'Ready to start'); }
  function todayView() {
    const plan = hub?.plan, doneDsa = Boolean(dsa?.progress.completed_at), date = hub?.date || localDay();
    const readings = hub?.readings || [], canGenerate = S.legacyAccess && hub?.generation_available !== false;
    if (S.legacyAccess && feedPanel?.day !== date) {
      feedPanel?.dispose();
      feedPanel = learningFeed(date, load);
    }
    const tasks = [
      { key: 'plan', label: 'Course lesson', title: plan?.available ? plan.title : plan?.completed === 90 ? 'Your 90-day course is complete' : 'Your next course lesson', available: !!plan?.available, read: !!plan?.read, finished: !plan?.available && plan?.completed === 90,
        caption: plan?.available ? `Day ${plan.day} of ${plan.total} · ${plan.title}` : plan?.reason || 'Your course lesson could not load.', route: '#/learning/plan', group: hub && canGenerate ? 'learn' : null },
      { key: 'dsa', label: 'Coding practice', title: dsa?.lesson.title || 'Today’s DSA topic', available: !!dsa, read: doneDsa,
        caption: dsa ? `${dsa.lesson.title} · ${dsa.lesson.practice.length} questions` : 'Lesson could not load.', route: '#/learning/dsa' },
      ...readings.map(item => ({ ...item, label: item.title, title: item.preview?.[0] || item.title,
        caption: item.available ? item.key === 'companies' ? 'Review roles and career links' : 'Additional reading · separate from your course' : item.reason,
        action: item.key === 'companies' ? `${item.read ? 'Review' : 'Explore'} companies` : `${item.read ? 'Review' : 'Open'} ${item.title.toLowerCase()}` }))
    ];
    const core = tasks.filter(task => ['plan', 'dsa'].includes(task.key));
    const session = core.filter(task => !task.finished);
    const completed = session.filter(task => task.available && task.read).length, total = session.length;
    const next = session.find(task => !task.read), sessionComplete = total > 0 && completed === total;
    if (content.dataset.todayTaskDay !== date) {
      delete content.dataset.selectedTask;
      content.dataset.todayTaskDay = date;
    }
    let selected = core.find(task => task.key === content.dataset.selectedTask) || next || core[0];
    const preview = h('section', { class: 'daily-agenda-summary', id: 'daily-task-preview', 'aria-label': 'Selected learning task', 'aria-live': 'polite' });
    const queueButtons = new Map();
    function chooseTask(task, focus = false) {
      selected = task;
      content.dataset.selectedTask = task.key;
      queueButtons.forEach((button, key) => button.setAttribute('aria-pressed', String(key === task.key)));
      drawPreview();
      updateRunButtons();
      if (focus) queueButtons.get(task.key)?.focus({ preventScroll: true });
    }
    function topicOutline() {
      const safe = prose(plan?.content_html || ''), topics = [];
      const labels = [
        { pattern: /^(AI and machine learning|AI & machine learning|ML \/ GenAI)/i, label: 'AI & ML' },
        { pattern: /^System design/i, label: 'System design' },
        { pattern: /^Full-stack/i, label: 'Full-stack' },
        { pattern: /^DSA:/i, label: 'DSA' },
      ];
      for (const node of safe.children) {
        const subject = node.tagName === 'H2' && /^\d+\.\s/.test(node.textContent)
          && node.nextElementSibling?.textContent.startsWith('Subject: ')
          ? node.nextElementSibling.textContent.slice('Subject: '.length).trim() : '';
        const bold = node.tagName === 'P' ? node.querySelector(':scope > strong')?.textContent.trim() || '' : '';
        const match = labels.find(item => item.pattern.test(subject || bold));
        if (!match || topics.some(item => item.label === match.label)) continue;
        const title = subject ? node.textContent.replace(/^\d+\.\s*/, '') : bold.replace(/^[^:]+:\s*/, '');
        topics.push({ label: match.label, title });
      }
      return topics;
    }
    const topics = topicOutline();
    function drawPreview() {
      const task = selected;
      let action;
      if (task.finished) action = h('a', { class: 'btn btn-primary', href: '#/learning/weekly', text: 'Review your course' });
      else if (task.available) action = h('a', { class: 'btn btn-primary', href: task.route,
        text: task.key === 'plan' ? task.read ? 'Review lesson' : 'Continue lesson' : task.read ? 'Review DSA' : 'Start DSA lesson' }, icon('chevron-right', 'icon icon-sm'));
      else if (task.group) action = fetchButton('Prepare next lesson', task.group, date, load);
      else action = h('button', { class: 'btn btn-primary', type: 'button', text: 'Retry lesson', onclick: load });
      const explanation = task.finished ? 'All 90 course days are saved. You can revisit any lesson.'
        : !task.available ? task.key === 'plan' ? task.group ? 'Your lesson could not open. Try preparing it again; your saved progress is still here.' : 'Your lesson could not open. Try loading it again; your saved progress is still here.' : 'Your coding lesson could not open. Try loading it again.'
          : task.key === 'plan' ? 'Read the technical explanation, follow the system flow, then practise the implementation and interview questions.'
            : `Learn the idea, follow an example, then try ${dsa.lesson.practice.length} coding ${dsa.lesson.practice.length === 1 ? 'question' : 'questions'}.`;
      const outline = task.key === 'plan' ? topics : (dsa?.lesson.practice || []).map((problem, index) => ({ label: `Question ${index + 1}`, title: problem.title }));
      preview.replaceChildren(...[
        h('div', { class: 'daily-preview-topline' }, h('p', { class: 'eyebrow', text: task.key === 'plan' && plan?.day ? `DAY ${plan.day} OF ${plan.total} · COURSE LESSON` : task.key === 'dsa' ? 'TODAY’S CODING PRACTICE' : 'YOUR COURSE' }),
          h('span', { class: `daily-preview-state${task.read || task.finished ? ' is-complete' : ''}`, text: task.read || task.finished ? 'Completed' : task.key === next?.key ? 'Start here' : 'Ready when you are' })),
        h('div', { class: 'daily-focus-copy' }, h('h2', { class: 'daily-focus-title', text: task.title }), h('p', { text: explanation })),
        h('div', { class: 'daily-preview-action' }, action, task.available && !task.finished ? h('p', { text: task.key === 'plan' ? 'Learn → Work an example → Try it → Interview' : 'Understand → Example → Try it' }) : null),
        task.available && outline.length ? h('section', { class: 'daily-preview-outline', 'aria-label': task.key === 'plan' ? 'In this lesson' : 'Practice questions' },
          h('h3', { text: task.key === 'plan' ? 'In this lesson' : 'You’ll practise' }),
          h('ol', {}, outline.map(item => h('li', {}, h('span', { class: 'daily-outline-label', text: item.label }), h('span', { text: item.title }))))) : null,
        task.read ? h('p', { class: 'daily-preview-saved' }, icon('check', 'icon icon-sm'), task.key === 'plan' ? 'Saved. Your next course day opens tomorrow.' : 'Saved. Your next coding topic opens tomorrow.') : null].filter(Boolean));
    }
    const queue = h('section', { class: 'daily-task-group daily-core-group', 'aria-label': 'Your study session' },
      h('div', { class: 'daily-group-heading' }, h('h2', { text: 'Your study session' }), h('p', { text: 'Choose a task, then begin.' })),
      h('div', { class: 'daily-session-progress', 'aria-label': 'Today’s progress' },
        h('strong', { class: 'daily-session-count', text: `${completed} / ${total} complete` }),
        h('progress', { value: completed, max: Math.max(1, total), 'aria-label': 'Today’s completed priorities' })),
      h('ol', {}, core.map((task, index) => {
        const button = h('button', { class: 'daily-task-choice', type: 'button', 'aria-pressed': task.key === selected.key,
          'aria-controls': 'daily-task-preview', 'data-learning-focus': `select-${task.key}`, onclick: () => chooseTask(task),
          onkeydown: event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault(); chooseTask(core[(index + 1) % core.length], true);
          } } },
          h('span', { class: 'daily-agenda-number', 'aria-hidden': 'true' }, task.read || task.finished ? icon('check', 'icon icon-sm') : String(index + 1)),
          h('span', { class: 'daily-agenda-copy' }, h('strong', { text: task.label }),
            h('span', { class: 'daily-agenda-state', text: task.read || task.finished ? 'Completed' : !task.available ? 'Could not load' : task.key === next?.key ? 'Up next' : 'Ready' }),
            h('span', { class: 'daily-task-caption', text: task.caption })));
        queueButtons.set(task.key, button);
        return h('li', { class: `daily-agenda-row daily-core-task${task.read || task.finished ? ' is-complete' : ''}`, 'data-learning-task': task.key }, button);
      })),
      h('a', { class: 'daily-course-link', href: '#/learning/weekly', text: 'See your 90-day course', 'aria-label': 'See your 90-day course' }));
    drawPreview();
    function readingRow(task) {
      let action;
      if (task.available) action = h('a', { class: 'btn', href: task.route, 'aria-label': task.action, text: task.read ? 'Review' : task.key === 'companies' ? 'Explore' : 'Open' }, icon('chevron-right', 'icon icon-sm'));
      else if (task.group && canGenerate) {
        const label = `Prepare ${task.label.toLowerCase()}`;
        action = fetchButton(label, task.group, date, load);
        const button = action.querySelector('button'); button.textContent = 'Prepare'; button.setAttribute('aria-label', label);
      } else action = h('button', { class: 'btn', type: 'button', text: 'Retry', 'aria-label': 'Retry lesson', onclick: load });
      return h('li', { class: `daily-agenda-row${task.read ? ' is-complete' : ''}`, 'data-learning-task': task.key },
        h('div', { class: 'daily-agenda-copy' }, h('div', { class: 'daily-agenda-topline' }, h('span', { class: 'daily-agenda-label', text: task.label }),
          h('span', { class: 'daily-agenda-state', text: task.read ? 'Completed' : task.available ? 'Ready' : 'Needs material' })),
          h('h3', { text: task.title }), h('p', { text: task.caption })), h('div', { class: 'daily-agenda-action' }, action));
    }
    const extras = ['papers', 'tech', 'repos', 'goal', 'design', 'companies'].map(key => tasks.find(task => task.key === key)).filter(task => task?.available);
    const discoveries = extras.filter(task => ['papers', 'tech', 'repos'].includes(task.key));
    const moreReading = extras.filter(task => !['papers', 'tech', 'repos'].includes(task.key));
    const explore = h('details', { class: 'daily-explore daily-task-group daily-optional-group', 'data-disclosure': 'explore', open: opened.includes('explore') },
      h('summary', {}, h('span', {}, h('strong', { text: 'Explore after your session' }), h('small', { text: 'Papers, GitHub projects and tech news · optional' })), icon('chevron-down', 'icon icon-sm')),
      h('div', { class: 'daily-group-heading' }, h('h2', { text: 'Explore something new' })),
      discoveries.length ? h('ol', {}, discoveries.map(readingRow)) : h('p', { class: 'daily-discovery-empty', text: 'No new reading saved for today. Extra reading is optional.' }),
      h('div', { class: 'learn-actions daily-discovery-links' }, h('a', { class: 'text-link', href: '#/learning/discover?tab=papers', text: 'Research papers' }),
        h('a', { class: 'text-link', href: '#/learning/discover?tab=repos', text: 'GitHub projects' }), h('a', { class: 'text-link', href: '#/learning/discover?tab=tech', text: 'Tech news' })),
      moreReading.length ? h('details', { class: 'daily-more-reading', 'data-disclosure': 'more-reading', open: opened.includes('more-reading') },
        h('summary', { text: `More reading · ${moreReading.length}` }), h('ol', {}, moreReading.map(readingRow))) : null);
    const unprepared = tasks.filter(task => !['plan', 'dsa'].includes(task.key) && !task.available);
    const preparation = unprepared.length && canGenerate ? h('section', { class: 'daily-setup-card', 'aria-label': 'Prepare additional learning' },
      h('div', {}, h('h2', { text: 'Get fresh reading' }), h('p', { text: 'Save new papers, projects, and news when you are ready.' })),
      fetchButton('Prepare today’s research', 'brief', date, load),
      h('details', { class: 'daily-missing-material', 'data-disclosure': 'missing', open: opened.includes('missing') },
        h('summary', { text: `Choose individual topics · ${unprepared.length} not prepared` }), h('ol', {}, unprepared.map(readingRow)))) : null;
    const archive = hub?.briefing?.available_dates?.length ? h('details', { class: 'daily-archive', 'data-disclosure': 'archive', open: opened.includes('archive') },
      h('summary', { text: 'Saved briefings & research tools' }),
      h('p', { text: 'Today always uses today’s saved discoveries. Open an earlier briefing from the library.' }),
      h('div', { class: 'daily-library-links' }, hub.briefing.digest ? h('a', { href: '#/learning/read/' + encodeURIComponent(hub.briefing.digest.id) + '?from=today', text: 'Open today’s full briefing →' }) : null,
        h('a', { href: '#/learning/library?date=' + encodeURIComponent(hub.briefing.latest || date), text: 'Browse saved briefings →' })),
      canGenerate ? fetchButton('Refresh today’s research', 'brief', date, load, { existing: !!hub.briefing.digest }) : null) : null;
    const tools = h('details', { class: 'daily-support-options', 'data-disclosure': 'learning-tools', open: opened.includes('learning-tools') },
      h('summary', {}, h('span', {}, h('strong', { text: 'Learning tools' }), h('small', { text: 'Daily fetch, notes and saved reading' })), icon('chevron-down', 'icon icon-sm')),
      preparation, feedPanel,
      h('details', { class: 'daily-tools', 'data-disclosure': 'tools', open: opened.includes('tools') },
        h('summary', { text: 'Notes and more' }),
        h('nav', { class: 'daily-quick-library', 'aria-label': 'Learning tools' },
          h('a', { href: '#/learning/notes?new=1', text: 'Write a note' }), h('a', { href: '#/learning/bookmarks', text: 'Your bookmarks' }),
          S.legacyAccess ? h('button', { type: 'button', class: 'text-link', text: 'Research activity', 'aria-controls': 'activity-content', onclick: () => setConsoleSize('normal') }) : null), archive));
    return h('div', { class: 'daily-today-clear daily-study-workbench' }, warning('plan'), warning('dsa'),
      sessionComplete ? h('p', { class: 'daily-win', role: 'status' }, icon('check'), 'Today’s study session is complete. Your progress is saved. Choose a task to review it.') : null,
      h('div', { class: 'daily-agenda daily-today-overview' }, queue, preview),
      h('div', { class: 'daily-today-body' }, explore, tools));
  }

  function studyFrame(material, source) {
    if (!noteWidgets.has(source.sourceId)) noteWidgets.set(source.sourceId, studyNotes(source));
    return h('div', { class: 'learning-study-layout' }, noteWidgets.get(source.sourceId),
      h('div', { class: 'learning-study-content' }, material));
  }
  function planView() {
    if (!hub) return warning('plan');
    const plan = hub.plan;
    if (!plan.available) return h('section', { class: 'daily-empty' }, icon('book'), h('h2', { text: plan.completed === 90 ? 'You’ve finished your 90-day course' : 'Your course lesson is not ready yet' }),
      h('p', { text: plan.reason }), plan.completed === 90 || !S.legacyAccess || hub.generation_available === false ? null : fetchButton('Prepare learning day', 'learn', localDay(), load), h('a', { class: 'btn', href: '#/learning/weekly', text: 'View the course roadmap' }), h('a', { class: 'btn', href: '#/learning/dsa', text: 'Practice DSA today' }), warning('plan'));
    const completion = h('footer', { class: 'daily-workspace-footer course-completion' },
      h('p', { text: plan.read ? 'Saved. Your next course day will appear tomorrow.' : 'Finished the reading, engineering task and interview practice? Save this day when you are ready.' }),
      h('button', { class: 'btn btn-primary', type: 'button', 'data-save-control': '', 'data-blocked': String(plan.read), 'data-learning-focus': 'plan-complete', onclick: () => save('plan'), text: plan.read ? 'Learning day completed' : 'Complete learning day' }));
    const reader = lessonReader({ reading: prose(plan.content_html), onChange: ({ last, all }) => { completion.hidden = !last && !all; } });
    const material = h('section', { class: 'daily-workspace course-reading' }, warning('plan'),
      h('header', { class: 'daily-workspace-head' }, h('div', {}, h('p', { class: 'eyebrow', text: `INTERVIEW COURSE · DAY ${plan.day} OF ${plan.total}` }), h('h2', { text: plan.title })), status(plan.read)),
      h('p', { class: 'daily-lesson-source' }, h('strong', { text: 'Very simple English. ' }),
        'Learn the idea, work through real cases, and practise interview answers. Take it at your own pace.'),
      h('article', { class: 'daily-reading', 'aria-label': 'Today’s learning material' }, reader), completion,
      plan.read ? h('a', { class: 'daily-next-action text-link', href: '#/learning/dsa', text: 'Continue with DSA practice →' }) : null);
    return studyFrame(material, { sourceId: plan.id, sourceTitle: plan.title,
      category: 'resource', sourceUrl: '#/learning/read/' + encodeURIComponent(plan.id) });
  }
  function chooseStep(next) {
    if (busy || !current() || !['concept', 'example', 'practice', 'review'].includes(next)) return;
    capture(); step = next;
    const query = new URLSearchParams(location.hash.split('?')[1] || ''); query.set('step', next);
    const problem = dsa?.lesson.practice[problemIndex];
    if (problem) query.set('problem', String(problem.id));
    else query.delete('problem');
    history.replaceState(history.state, '', location.hash.split('?')[0] + '?' + query);
    draw(); content.querySelector('.daily-step-content')?.focus({ preventScroll: true });
    const workspace = content.querySelector('.dsa-learning-workspace');
    if (workspace && (workspace.getBoundingClientRect().top < 0 || workspace.getBoundingClientRect().top > window.innerHeight / 2)) {
      workspace.scrollIntoView({ block: 'start' });
    }
  }
  function chooseProblem(index) {
    if (busy || !current() || !Number.isInteger(index) || !dsa?.lesson.practice[index]) return;
    problemIndex = index; chooseStep('practice');
    content.querySelector('.daily-question')?.focus({ preventScroll: true });
  }
  function dsaReading(html, key) {
    const reading = prose(html);
    reading.classList.add('dsa-reading-prose');
    reading.querySelectorAll('details').forEach((details, index) => {
      details.dataset.disclosure = `${key}-${index}`;
      details.open = opened.includes(details.dataset.disclosure);
    });
    reading.querySelectorAll('pre, table').forEach((block, index) => {
      block.tabIndex = 0;
      if (block.tagName === 'PRE') block.setAttribute('role', 'region');
      block.setAttribute('aria-label', `${block.tagName === 'TABLE' ? 'Example table' : 'Code example'} ${index + 1}`);
    });
    return reading;
  }
  function checkpoint(label, checked, task, problem) {
    return h('label', { class: 'daily-check' }, h('input', { type: 'checkbox', checked, 'data-save-control': '', 'data-blocked': String(Boolean(dsa.progress.completed_at)),
      'data-learning-focus': problem ? `practice-${problem}` : 'read', onchange: event => save('dsa', { task, done: event.target.checked, ...(problem ? { problem } : {}) }) }), h('span', { text: label }));
  }
  function lessonEditor(lesson, problem) {
    if (dsa.execution_available === false) return null;
    const key = 'dsa/' + lesson.course_route.replace(/^02-dsa\//, '') + '/problem-' + problem.id;
    if (!codeWidgets.has(key)) codeWidgets.set(key, codeEditor({ key, showProblemTitle: false, compact: true, onSubmitted: () => { setTimeout(() => { if (current()) load(); }, 0); } }));
    return codeWidgets.get(key);
  }
  function dsaView() {
    if (!dsa) return warning('dsa');
    const { lesson, progress } = dsa, complete = Boolean(progress.completed_at);
    const practiced = lesson.practice.filter(p => progress.practiced.includes(p.id)).length;
    const checkpoints = Number(Boolean(progress.read)) + practiced;
    const ready = progress.read && lesson.practice.length > 0 && practiced === lesson.practice.length;
    const tabs = [['concept', '01', 'Learn'], ['example', '02', 'Worked example'], ['practice', '03', 'Practice'], ['review', '04', 'Review']];
    if (!tabs.some(([key]) => key === step)) step = 'concept';
    const stageIndex = tabs.findIndex(([key]) => key === step);
    const button = (label, next, primary = false) => h('button', {
      type: 'button', class: primary ? 'btn btn-primary' : 'btn', 'data-step-control': '',
      onclick: () => chooseStep(next), text: label,
    });
    const pager = (back, next, nextLabel) => h('nav', { class: 'dsa-stage-pager', 'aria-label': 'Continue your DSA lesson' },
      back ? button('Back to ' + tabs.find(([key]) => key === back)[2].toLowerCase(), back) : h('span'),
      h('span', { class: 'dsa-stage-position', text: `Step ${stageIndex + 1} of ${tabs.length}` }),
      next ? button(nextLabel, next, true) : null);
    const recap = (label, html, key) => html ? h('details', {
      class: 'dsa-recap', 'data-disclosure': key, open: opened.includes(key),
    }, h('summary', { text: label }), dsaReading(html, key + '-content')) : null;
    let body, completion;
    if (step === 'concept') {
      body = h('article', { class: 'dsa-stage dsa-concept' },
        h('header', { class: 'dsa-stage-heading' }, h('p', { class: 'eyebrow', text: '01 · UNDERSTAND THE PATTERN' }),
          h('h3', { text: 'Know when to use it and why it works' }),
          h('p', { text: 'Connect the problem clues to the approach. Follow the reasoning, then compare its time and memory costs.' })),
        dsaReading(lesson.advanced_concept_html || lesson.concept_html, 'concept'),
        lesson.advanced_concept_html ? recap('Need a quick recap of the basics?', lesson.concept_html, 'concept-recap') : null,
        pager(null, 'example', 'Continue to worked example'));
    }
    if (step === 'example') {
      body = h('article', { class: 'dsa-stage daily-example' },
        h('header', { class: 'dsa-stage-heading' }, h('p', { class: 'eyebrow', text: '02 · WORKED EXAMPLE' }),
          h('h3', { text: lesson.example.title }),
          h('p', { text: 'Trace the changing values before reading the code. At each step, explain what stays true and why the next move is safe.' })),
        dsaReading(lesson.example.prompt_html, 'example-prompt'),
        lesson.walkthrough_html ? dsaReading(lesson.walkthrough_html, 'example-walkthrough')
          : lesson.simple_example_html ? dsaReading(lesson.simple_example_html, 'example-simple') : null,
        h('details', { class: 'daily-solution dsa-example-code', 'data-disclosure': 'example-detail', open: opened.includes('example-detail') },
          h('summary', { text: 'See the full coding example: ' + lesson.example.title }),
          dsaReading(lesson.example.solution_html, 'example-solution'), lessonEditor(lesson, lesson.example)),
        lesson.walkthrough_html ? recap('Recap with a smaller example', lesson.simple_example_html, 'example-recap') : null,
        checkpoint('I read the topic and understand the worked example', progress.read, 'read'),
        pager('concept', 'practice', 'Continue to practice'));
    }
    if (step === 'practice') {
      problemIndex = Math.max(0, Math.min(problemIndex, lesson.practice.length - 1));
      const problem = lesson.practice[problemIndex];
      body = h('section', { class: 'dsa-stage dsa-practice-stage' },
        h('header', { class: 'dsa-stage-heading' }, h('p', { class: 'eyebrow', text: '03 · SOLVE IT YOURSELF' }),
          h('h3', { text: 'Turn the pattern into a working solution' }),
          h('p', { class: 'daily-practice-note', text: 'Explain a simple approach first. Improve it, state why it works, and test the edge cases. '
            + (dsa.execution_available === false ? 'Write and test your code in your own editor, then save your practice checkpoint here.' : 'Use the editor below. Run examples while working; submit your solution to check the full test suite.') })),
        h('div', { class: 'dsa-practice-heading' },
          h('p', { text: `${practiced} of ${lesson.practice.length} questions practiced` }),
          h('div', { class: 'daily-problem-tabs', role: 'group', 'aria-label': 'Practice questions' }, lesson.practice.map((p, i) => h('button', {
            class: 'daily-problem-tab', type: 'button', 'aria-pressed': i === problemIndex, 'data-step-control': '',
            title: p.title, onclick: () => chooseProblem(i),
          }, progress.practiced.includes(p.id) ? icon('check', 'icon icon-sm') : null, `Question ${i + 1}`)))),
        problem ? h('article', { class: 'daily-question', tabIndex: -1, 'aria-label': `Question ${problemIndex + 1}: ${problem.title}` },
          h('header', { class: 'dsa-question-heading' }, h('div', {},
            h('p', { class: 'eyebrow', text: `QUESTION ${problemIndex + 1} OF ${lesson.practice.length}` }), h('h3', { text: problem.title })),
            learningSave({ kind: 'dsa', title: problem.title, url: '#/learning/dsa/problem/' + encodeURIComponent(lesson.course_route.replace(/^02-dsa\//, '') + '/problem-' + problem.id) })),
          dsaReading(problem.prompt_html, `practice-${problem.id}-prompt`), lessonEditor(lesson, problem),
          h('details', { class: 'daily-solution', 'data-disclosure': `solution-${problem.id}`, open: opened.includes(`solution-${problem.id}`) },
            h('summary', { text: 'Reveal approach & Python solution' }), dsaReading(problem.solution_html, `practice-${problem.id}-solution`)),
          checkpoint(`I practiced ${problem.title}`, progress.practiced.includes(problem.id), 'practice', problem.id))
          : h('p', { class: 'dsa-stage-note', role: 'status', text: 'This lesson has no practice questions available. Refresh learning to try loading them again.' }),
        h('nav', { class: 'dsa-stage-pager', 'aria-label': 'Continue your DSA lesson' },
          problemIndex > 0 ? h('button', { type: 'button', class: 'btn', 'data-step-control': '', onclick: () => chooseProblem(problemIndex - 1), text: 'Previous question' })
            : button('Back to worked example', 'example'),
          h('span', { class: 'dsa-stage-position', text: 'Step 3 of 4' }),
          problemIndex < lesson.practice.length - 1 ? h('button', { class: 'btn btn-primary', type: 'button', 'data-step-control': '', onclick: () => chooseProblem(problemIndex + 1), text: 'Next practice question' })
            : button('Continue to review', 'review', true)));
    }
    if (step === 'review') {
      const check = (label, saved, action) => h('li', { class: saved ? 'is-saved' : '' },
        h('span', { class: 'dsa-review-check-state' }, icon(saved ? 'check' : 'chevron-right', 'icon icon-sm'), saved ? 'Saved' : 'To do'),
        h('span', { class: 'dsa-review-check-title', text: label }),
        h('button', { type: 'button', class: 'text-link', 'data-step-control': '', onclick: action, text: saved ? 'Revisit' : 'Go to step', 'aria-label': `${saved ? 'Revisit' : 'Go to'} ${label}` }));
      body = h('article', { class: 'dsa-stage dsa-review-stage' },
        h('header', { class: 'dsa-stage-heading' }, h('p', { class: 'eyebrow', text: '04 · EXPLAIN & REVIEW' }),
          h('h3', { text: 'Defend your approach' }),
          h('p', { text: 'Explain why the solution works, compare it with a simpler approach, and answer the changed constraint before opening the guide.' })),
        lesson.interview_html ? dsaReading(lesson.interview_html, 'interview') : h('ol', { class: 'dsa-review-prompts' },
          h('li', { text: 'Which clues in the question led you to this pattern?' }),
          h('li', { text: 'What stays true during the algorithm, and why does that prove the result?' }),
          h('li', { text: 'How do time and extra memory grow? Which edge case could break your first attempt?' })),
        h('section', { class: 'dsa-review-checkpoints', 'aria-labelledby': 'dsa-review-checkpoint-title' },
          h('h3', { id: 'dsa-review-checkpoint-title', text: 'Your saved checkpoints' }),
          h('p', { text: 'Your checkmarks save what you have read and practiced. Submitted code keeps its own test results.' }),
          h('ul', {}, check('Reading and worked example', progress.read, () => chooseStep('example')),
            lesson.practice.map((problem, index) => check(problem.title, progress.practiced.includes(problem.id), () => chooseProblem(index))))),
        pager('practice', null));
      completion = h('footer', { class: 'daily-workspace-footer dsa-completion' },
        h('div', {}, h('strong', { text: complete ? 'Today’s DSA is complete' : ready ? 'Ready to save this topic' : 'Finish the remaining checkpoints' }),
          h('p', { text: complete ? 'Your progress is saved. Your next topic opens tomorrow; you can revisit any step now.'
            : ready ? 'When you have finished reviewing, complete the topic to save today’s progress.'
              : 'Use the links above to confirm the reading and each practice question. Return here when you are ready.' })),
        h('button', { class: 'btn btn-primary', type: 'button', 'data-save-control': '', 'data-blocked': String(complete || !ready),
          disabled: complete || !ready, 'data-learning-focus': 'complete', onclick: () => save('dsa', { task: 'complete', done: true }),
          text: complete ? 'DSA completed today' : 'Complete DSA topic' }));
    }
    const material = h('div', { class: 'dsa-learning' }, h('section', { class: 'daily-workspace dsa-learning-workspace' }, warning('dsa'),
      h('header', { class: 'daily-workspace-head' }, h('div', {}, h('p', { class: 'eyebrow', text: dsa.revision ? 'DSA · REVISION' : `DSA · TOPIC ${lesson.number} OF ${lesson.total}` }),
        h('h2', { text: lesson.title })), status(complete, progress.read || practiced > 0)),
      h('div', { class: 'dsa-session-summary' }, h('p', { class: 'dsa-session-count', role: 'status', text: `${checkpoints} of ${1 + lesson.practice.length} checkpoints saved` }),
        h('p', { class: 'dsa-session-help', text: 'Learn the reasoning. Trace an example. Solve, then explain.' }),
        h('progress', { value: checkpoints, max: 1 + lesson.practice.length, 'aria-label': 'Saved DSA checkpoints' })),
      h('div', { class: 'daily-steps dsa-lesson-steps', role: 'tablist', 'aria-label': 'DSA lesson steps' }, tabs.map(([key, number, label], i) => h('button', {
        id: `step-${key}`, class: 'daily-step', role: 'tab', type: 'button', 'aria-selected': step === key, 'aria-controls': 'dsa-step-panel', tabIndex: step === key ? 0 : -1, 'data-step-control': '',
        onclick: () => chooseStep(key), onkeydown: event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          chooseStep(tabs[next][0]); content.querySelector(`#step-${tabs[next][0]}`)?.focus({ preventScroll: true });
        } },
      }, h('span', { text: number }), label))),
      h('div', { class: 'daily-step-content dsa-stage-panel', role: 'tabpanel', id: 'dsa-step-panel', 'aria-labelledby': `step-${step}`, tabIndex: -1, 'data-dsa-stage': step }, body), completion),
      h('details', { class: 'daily-roadmap', 'data-disclosure': 'roadmap', open: opened.includes('roadmap') }, h('summary', {}, h('span', { text: 'Your DSA path' }), h('span', { text: `${dsa.completed_topics} / ${lesson.total} topics complete` })),
        h('p', { text: 'One topic per day. Miss a day and your unfinished topic will wait for you.' }),
        h('ol', {}, dsa.topics.map(topic => h('li', { class: topic.today ? 'is-current' : '', 'aria-current': topic.today ? 'step' : null }, h('span', { text: String(topic.number).padStart(2, '0') }), h('span', { text: topic.title }),
          h('span', { text: topic.today ? 'Today' : topic.completed ? 'Done' : 'Upcoming' }))))),
      h('nav', { class: 'dsa-extra-links', 'aria-label': 'More DSA practice' }, h('a', { class: 'text-link', href: '#/learning/dsa/sheet', text: 'Open the full practice sheet →' }),
        S.legacyAccess ? h('a', { class: 'text-link', href: '/course/#/' + lesson.course_route, target: '_blank', rel: 'noopener noreferrer', text: 'Read the full course chapter ↗' }) : null));
    return studyFrame(material, { sourceId: 'dsa/topic/' + lesson.id, sourceTitle: lesson.title, category: 'dsa',
      sourceUrl: '#/learning/dsa/problem/' + encodeURIComponent(lesson.course_route.replace(/^02-dsa\//, '') + '/problem-' + lesson.example.id) });
  }
  function draw() {
    scorePanel?.dispose();
    scorePanel = view === 'progress' && scores ? scoreProgress(scores) : null;
    const node = view === 'today' ? todayView() : view === 'plan' ? planView() : view === 'dsa' ? dsaView()
      : h('div', {}, warning('overview'), individualProgress(overview), warning('activity'), activity ? activityView(activity, { showAction: false, showBadges: false }) : null,
          activity ? learningBadges(activity) : null, warning('scores'), scorePanel, renderLearningLibrary('history'));
    content.replaceChildren(h('div', {}, ['plan', 'dsa'].includes(view) ? h('a', { class: 'back-link daily-task-back', href: '#/learning', text: '← Back to today’s priorities' }) : null, node || errorState('Daily learning could not load.', load)));
    feedPanel?.refresh();
    updateControls(); updateRunButtons();
  }
  queueMicrotask(load);
  return page;
}
