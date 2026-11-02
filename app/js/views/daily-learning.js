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

let disposeCurrent;
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Both reading sources use semantic elements only, without executable HTML or URLs.
function prose(html) {
  const allowed = new Set(['p', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 's', 'a', 'details', 'summary']);
  function copy(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    let tag = node.tagName.toLowerCase();
    if (!allowed.has(tag)) return document.createTextNode(node.textContent);
    if (tag === 'h1') tag = 'h2';
    const props = {};
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      if (/^(#|\/#\/)/.test(href)) props.href = href;
      else if (/^(https?:\/\/|\/course\/)/.test(href)) Object.assign(props, { href, target: '_blank', rel: 'noopener noreferrer' });
    }
    return h(tag, props, [...node.childNodes].map(copy));
  }
  return h('div', { class: 'daily-prose' }, [...new DOMParser().parseFromString(html || '', 'text/html').body.childNodes].map(copy));
}

export function renderDailyLearning(arg = '') {
  disposeCurrent?.();
  const [part, ...rest] = arg.split('/');
  const view = ['plan', 'dsa', 'practice', 'progress', 'resume', 'courses', 'library', 'read', 'weekly', 'discover', 'bookmarks', 'notes'].includes(part) ? part : 'today';
  const workspaceView = ['weekly', 'discover', 'bookmarks', 'notes'].includes(view) || view === 'progress' && !S.legacyAccess;
  const sheetView = view === 'dsa' && ['sheet', 'problem'].includes(rest[0]);
  const secondary = ['resume', 'courses', 'library', 'read', 'practice'].includes(view) || sheetView || workspaceView;
  const section = learningSection(arg);
  let secondaryBody;
  const scope = accountRequestSignal();
  const headerContext = learningHeader(view);
  const content = h('div', { class: 'daily-content' }, loadingState('Opening your daily learning…'));
  const feedback = h('div', { class: 'daily-feedback', 'aria-live': 'polite', tabIndex: -1 });
  const refreshButton = h('button', { class: 'btn daily-refresh', type: 'button', onclick: () => { headerContext.refresh?.(); secondary ? secondaryBody?.refresh() : load(); }, 'aria-label': 'Refresh learning', text: 'Refresh' });
  const pageTitle = sheetView ? rest[0] === 'problem' ? 'DSA problem' : 'DSA practice sheet' : { plan: 'Daily learning', dsa: 'DSA practice', read: 'Reading' }[view] || section.title;
  const dsaNav = view === 'dsa' ? h('nav', { class: 'dsa-local-nav', 'aria-label': 'DSA practice views' },
    h('a', { href: '#/learning/dsa', 'aria-current': !sheetView ? 'page' : null }, navigationArt('learning', 'learning-tab-art', 'today'), 'Daily lesson'),
    h('a', { href: '#/learning/dsa/sheet', 'aria-current': sheetView ? 'page' : null }, navigationArt('learning', 'learning-tab-art', 'practice'), 'Practice sheet'),
    routeAccess({ name: 'learning', arg: 'practice' }, S).kind === 'allowed' ? h('a', { href: '#/learning/practice' }, navigationArt('learning', 'learning-tab-art', 'courses'), 'Practice & exams') : null) : null;
  const focusedReading = view === 'plan' || view === 'read';
  const page = h('div', { class: `page page-wide daily-page${focusedReading ? ' daily-focus-page' : ''}`, 'data-learning-view': view },
    h('header', { class: 'page-head daily-head' }, h('div', {},
      h('p', { class: 'learning-studio-label', text: focusedReading ? 'ONE IDEA AT A TIME' : 'YOUR LEARNING SPACE' }),
      h('h1', { text: pageTitle }), view === 'today' ? h('p', { class: 'lead', text: 'Build skills for your next role, one day at a time.' }) : null),
      h('div', { class: 'daily-head-tools' }, refreshButton)),
    focusedReading ? null : headerContext, renderLearningSwitcher(arg), dsaNav, feedback, content);
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
  let errors = {}, step = 'concept', problemIndex = 0, opened = [];
  const current = () => !disposed && !scope.aborted && page.isConnected;
  function capture() { opened = [...content.querySelectorAll('details[open][data-disclosure]')].map(el => el.dataset.disclosure); }
  function dispose() {
    disposed = true; loadController?.abort(); clearInterval(dayTimer);
    headerContext.dispose?.();
    codeWidgets.forEach(widget => widget.dispose());
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
    if (busy || loading || !current()) return;
    const ticket = ++request;
    loadController = new AbortController(); loading = true; updateControls();
    const results = await Promise.allSettled(['/api/learning/daily', '/api/learning/dsa', '/api/learning/activity', ...(view === 'progress' ? ['/api/learning/code/progress', '/api/learning/overview'] : [])]
      .map(path => api(path, undefined, { signal: loadController.signal })));
    if (!current() || ticket !== request) return;
    capture(); errors = {};
    const previousDsaDate = dsa?.date;
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
      const query = new URLSearchParams(location.hash.split('?')[1] || ''); query.delete('part');
      history.replaceState(history.state, '', location.hash.split('?')[0] + (query.size ? '?' + query : ''));
    }
    if (dsa && previousDsaDate !== dsa.date) {
      const requestedStep = new URLSearchParams(location.hash.split('?')[1] || '').get('step');
      opened = []; step = ['concept', 'example', 'practice'].includes(requestedStep) ? requestedStep : dsa.progress.read ? 'practice' : 'concept';
      problemIndex = Math.max(0, dsa.lesson.practice.findIndex(p => !dsa.progress.practiced.includes(p.id)));
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
        caption: plan?.available ? `Day ${plan.day} of ${plan.total} · ${plan.title}` : plan?.reason || 'Your course lesson could not load.', route: '#/learning/plan', group: hub && canGenerate ? 'learn' : null,
        action: plan?.read ? 'Review learning day' : 'Open learning day' },
      { key: 'dsa', label: 'DSA practice', title: dsa?.lesson.title || 'Today’s DSA topic', available: !!dsa, read: doneDsa,
        caption: dsa ? `${dsa.lesson.title} · ${dsa.lesson.practice.length} questions` : 'Lesson could not load.', route: '#/learning/dsa',
        action: doneDsa ? 'Review DSA practice' : 'Practice now' },
      ...readings.map(item => ({ ...item, label: item.title, title: item.preview?.[0] || item.title, caption: item.available ? item.key === 'companies' ? 'Review roles and career links' : 'Additional reading · separate from your course' : item.reason,
        action: item.key === 'companies' ? `${item.read ? 'Review' : 'Explore'} companies` : `${item.read ? 'Review' : 'Open'} ${item.title.toLowerCase()}` }))
    ];
    const session = tasks.filter(task => ['plan', 'dsa'].includes(task.key) && !task.finished);
    const completed = session.filter(task => task.available && task.read).length, total = session.length;
    const next = session.find(task => !task.read), sessionComplete = total > 0 && completed === total;
    const featureArt = h('div', { class: 'daily-feature-art', 'aria-hidden': 'true' },
      h('span', { class: 'daily-art-orbit' }),
      h('div', { class: 'daily-art-book daily-art-book-back' }),
      h('div', { class: 'daily-art-book daily-art-book-front' },
        h('span', { class: 'daily-art-edition', text: 'MORROW / LEARNING' }),
        h('span', { class: 'daily-art-symbol' }, icon(next?.key === 'dsa' ? 'code' : 'workflow')),
        h('span', { class: 'daily-art-book-title', text: next?.key === 'dsa' ? 'Think.\nTry.\nSolve.' : 'One idea.\nNew possibilities.' }),
        h('span', { class: 'daily-art-book-rule' }), h('span', { class: 'daily-art-book-foot', text: 'A LITTLE, EVERY DAY' })),
      h('span', { class: 'daily-art-spark' }, icon('sun')),
      h('span', { class: 'daily-art-code' }, icon('code')));
    const progress = h('section', { class: 'daily-agenda-summary', 'aria-label': 'Next learning task' },
      h('div', { class: 'daily-focus-copy' }, h('p', { class: 'eyebrow', text: next ? `NEXT · ${next.label}` : 'TODAY’S LEARNING' }),
        h('h2', { class: 'daily-focus-title', text: next ? next.title : 'You’ve finished today’s study.' }),
        h('p', { text: next ? next.key === 'plan' ? next.available ? 'One idea at a time. Read the example, try a small task, then check your answer.' : 'Prepare your next lesson to continue where you left off.'
          : 'Start with a small example. Then try the questions at your own pace.' : 'Your lesson and practice are saved. You can review them or explore something new below.' })),
      next ? next.available ? h('a', { class: 'btn btn-primary', href: next.route, text: next.key === 'plan' ? 'Continue lesson' : 'Start DSA lesson' }, icon('chevron-right', 'icon icon-sm'))
        : next.group ? fetchButton('Prepare next lesson', next.group, date, load) : h('button', { class: 'btn', type: 'button', text: 'Retry lesson', onclick: load })
        : h('a', { class: 'btn', href: '#/learning/weekly', text: 'View your course' }), featureArt);
    const metrics = h('section', { class: 'daily-session-progress', 'aria-label': 'Today’s progress' },
      h('div', { class: 'daily-progress-heading' }, h('span', { text: 'Today’s progress' }), icon('sun', 'icon icon-sm')),
      h('div', { class: 'daily-progress-ring', style: `--study-progress: ${Math.round(completed / Math.max(1, total) * 100)}%` },
        h('strong', { class: 'daily-session-count' }, h('span', { text: `${completed} / ${total}` }), h('span', { text: ' complete' }))),
      h('progress', { value: completed, max: Math.max(1, total), 'aria-label': 'Today’s completed priorities' }),
      h('p', { class: 'daily-progress-note', text: tasks[0].finished ? 'Your next chapter starts with practice.' : 'Small steps. Steady progress.' }),
      h('a', { class: 'daily-course-link', href: '#/learning/weekly', 'aria-label': 'See your 90-day course' }, 'See your 90-day course', icon('arrow-up-right', 'icon icon-sm')));
    function taskRow(task) {
      const core = ['plan', 'dsa'].includes(task.key);
      let action;
      if (task.finished) action = h('a', { class: 'btn', href: '#/learning/weekly', text: 'Revisit', 'aria-label': 'Revisit learning plan' });
      else if (task.available) action = h('a', { class: 'btn', href: task.route, 'aria-label': task.action, text: task.read ? 'Review' : task.key === 'companies' ? 'Explore' : task.key === 'dsa' ? 'Practice now' : 'Open' }, icon('chevron-right', 'icon icon-sm'));
      else if (task.group && canGenerate) {
        const label = task.key === 'plan' ? 'Prepare learning day' : `Prepare ${task.label.toLowerCase()}`;
        action = fetchButton(label, task.group, date, load);
        const button = action.querySelector('button'); button.textContent = 'Prepare'; button.setAttribute('aria-label', label);
      } else action = h('button', { class: 'btn', type: 'button', text: 'Retry', 'aria-label': 'Retry lesson', onclick: load });
      return h('li', { class: `daily-agenda-row${core ? ' daily-core-task' : ''}${task.read || task.finished ? ' is-complete' : ''}${!task.available && !task.finished ? ' is-unavailable' : ''}`, 'data-learning-task': task.key },
        h('span', { class: 'daily-agenda-number', 'aria-hidden': 'true' }, task.read || task.finished ? icon('check') : icon({ plan: 'book', dsa: 'code', papers: 'file', tech: 'globe', repos: 'workflow' }[task.key] || 'book')),
        h('div', { class: 'daily-agenda-copy' }, h('div', { class: 'daily-agenda-topline' },
          h('span', { class: 'daily-agenda-label', text: task.label }),
          h('span', { class: 'daily-agenda-state', text: task.finished ? '90 days completed' : task.read ? 'Completed' : task.available ? 'Ready' : 'Needs material' })),
          h('h3', { text: task.available || task.finished ? task.finished ? task.title : task.key === 'plan' ? 'Read today’s lesson' : task.key === 'dsa' ? 'Practise a coding problem' : task.title : task.key === 'dsa' ? 'Lesson unavailable' : task.title }),
          h('p', { text: task.available || task.finished ? task.caption : task.key === 'plan' ? 'Continue at your next unfinished course day.' : task.key === 'dsa' ? task.caption : 'Create a saved reading for today.' })),
        h('div', { class: 'daily-agenda-action' }, action));
    }
    const extras = ['papers', 'tech', 'repos', 'goal', 'design', 'companies'].map(key => tasks.find(task => task.key === key)).filter(task => task?.available);
    const discoveries = extras.filter(task => ['papers', 'tech', 'repos'].includes(task.key));
    const moreReading = extras.filter(task => !['papers', 'tech', 'repos'].includes(task.key));
    const agenda = h('div', { class: 'daily-agenda', 'aria-label': 'Daily learning checklist' },
      h('section', { class: 'daily-task-group daily-core-group' }, h('div', { class: 'daily-group-heading' }, h('h2', { text: 'Your study session' }), h('p', { text: tasks[0].finished ? 'Continue coding practice, or review your course.' : 'Two small steps for today.' })),
        h('ol', {}, tasks.filter(task => ['plan', 'dsa'].includes(task.key)).map(taskRow))),
      h('section', { class: 'daily-task-group daily-optional-group', 'aria-label': 'Additional learning' },
        h('div', { class: 'daily-group-heading' }, h('h2', { text: 'Explore something new' }), h('span', { class: 'daily-optional-label', text: 'Optional' })),
        h('p', { class: 'daily-discovery-intro', text: 'A paper, a useful project, or a little tech news.' }),
        discoveries.length ? h('ol', {}, discoveries.map(taskRow)) : h('p', { class: 'daily-discovery-empty', text: 'No new reading saved for today. Extra reading is optional.' }),
        h('div', { class: 'learn-actions daily-discovery-links' }, h('a', { class: 'text-link', href: '#/learning/discover?tab=papers', text: 'Research papers' }),
          h('a', { class: 'text-link', href: '#/learning/discover?tab=repos', text: 'GitHub projects' }), h('a', { class: 'text-link', href: '#/learning/discover?tab=tech', text: 'Tech news' })),
        moreReading.length ? h('details', { class: 'daily-more-reading', 'data-disclosure': 'more-reading', open: opened.includes('more-reading') },
          h('summary', { text: `More reading · ${moreReading.length}` }), h('ol', {}, moreReading.map(taskRow))) : null));
    const unprepared = tasks.filter(task => !['plan', 'dsa'].includes(task.key) && !task.available);
    const preparation = unprepared.length && canGenerate ? h('section', { class: 'daily-setup-card', 'aria-label': 'Prepare additional learning' },
      h('div', {}, h('h2', { text: 'Get fresh reading' }), h('p', { text: 'Save new papers, projects, and news when you are ready.' })),
      fetchButton('Prepare today’s research', 'brief', date, load),
      h('details', { class: 'daily-missing-material', 'data-disclosure': 'missing', open: opened.includes('missing') },
        h('summary', { text: `Choose individual topics · ${unprepared.length} not prepared` }), h('ol', {}, unprepared.map(taskRow)))) : null;
    const archive = hub?.briefing?.available_dates?.length ? h('details', { class: 'daily-archive', 'data-disclosure': 'archive', open: opened.includes('archive') },
      h('summary', { text: 'Saved briefings & research tools' }),
      h('p', { text: 'Today always uses today’s saved discoveries. Open an earlier briefing from the library.' }),
      h('div', { class: 'daily-library-links' }, hub.briefing.digest ? h('a', { href: '#/learning/read/' + encodeURIComponent(hub.briefing.digest.id) + '?from=today', text: 'Open today’s full briefing →' }) : null,
        h('a', { href: '#/learning/library?date=' + encodeURIComponent(hub.briefing.latest || date), text: 'Browse saved briefings →' })),
      canGenerate ? fetchButton('Refresh today’s research', 'brief', date, load, { existing: !!hub.briefing.digest }) : null) : null;
    return h('div', { class: 'daily-today-clear' },
      h('div', { class: 'daily-today-overview' }, progress, metrics),
      sessionComplete ? h('p', { class: 'daily-win', role: 'status' }, icon('check'), 'Today’s study session is complete. Your progress is saved.') : null,
      h('div', { class: 'daily-today-body' }, warning('plan'), warning('dsa'), agenda,
        h('div', { class: 'daily-support-options' }, preparation, feedPanel,
          h('details', { class: 'daily-tools', 'data-disclosure': 'tools', open: opened.includes('tools') },
            h('summary', { text: 'Notes and more' }),
            h('nav', { class: 'daily-quick-library', 'aria-label': 'Learning tools' },
              h('a', { href: '#/learning/notes?new=1', text: 'Write a note' }), h('a', { href: '#/learning/bookmarks', text: 'Your bookmarks' }),
              S.legacyAccess ? h('button', { type: 'button', class: 'text-link', text: 'Research activity', 'aria-controls': 'activity-content', onclick: () => setConsoleSize('normal') }) : null), archive))));
  }

  function planView() {
    if (!hub) return warning('plan');
    const plan = hub.plan;
    if (!plan.available) return h('section', { class: 'daily-empty' }, icon('book'), h('h2', { text: plan.completed === 90 ? 'You’ve finished your 90-day course' : 'Your course lesson is not ready yet' }),
      h('p', { text: plan.reason }), plan.completed === 90 || !S.legacyAccess || hub.generation_available === false ? null : fetchButton('Prepare learning day', 'learn', localDay(), load), h('a', { class: 'btn', href: '#/learning/weekly', text: 'View the course roadmap' }), h('a', { class: 'btn', href: '#/learning/dsa', text: 'Practice DSA today' }), warning('plan'));
    const completion = h('footer', { class: 'daily-workspace-footer course-completion' },
      h('p', { text: plan.read ? 'Saved. Your next course day will appear tomorrow.' : 'Finished the examples and small tasks? Save this day when you are ready.' }),
      h('button', { class: 'btn btn-primary', type: 'button', 'data-save-control': '', 'data-blocked': String(plan.read), 'data-learning-focus': 'plan-complete', onclick: () => save('plan'), text: plan.read ? 'Learning day completed' : 'Complete learning day' }));
    const reader = lessonReader({ reading: prose(plan.content_html), onChange: ({ last, all }) => { completion.hidden = !last && !all; } });
    return h('section', { class: 'daily-workspace course-reading' }, warning('plan'),
      h('header', { class: 'daily-workspace-head' }, h('div', {}, h('p', { class: 'eyebrow', text: `INTERVIEW COURSE · DAY ${plan.day} OF ${plan.total}` }), h('h2', { text: plan.title })), status(plan.read)),
      h('p', { class: 'daily-lesson-source' }, h('strong', { text: 'Very simple English. ' }),
        'One idea, one example, one small task. Take it at your own pace.'),
      h('article', { class: 'daily-reading', 'aria-label': 'Today’s learning material' }, reader), completion,
      plan.read ? h('a', { class: 'daily-next-action text-link', href: '#/learning/dsa', text: 'Continue with DSA practice →' }) : null);
  }
  function chooseStep(next) {
    capture(); step = next;
    const query = new URLSearchParams(location.hash.split('?')[1] || ''); query.set('step', next);
    history.replaceState(history.state, '', location.hash.split('?')[0] + '?' + query);
    draw(); content.querySelector('.daily-step-content')?.focus({ preventScroll: true });
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
    const ready = progress.read && practiced === lesson.practice.length;
    const tabs = [['concept', '01', 'Learn'], ['example', '02', 'Worked example'], ['practice', '03', 'Practice']];
    let body;
    if (step === 'concept') body = h('div', {}, prose(lesson.concept_html), h('div', { class: 'daily-step-next' }, h('button', { class: 'btn btn-primary', type: 'button', 'data-step-control': '', onclick: () => chooseStep('example'), text: 'Continue to worked example' })));
    if (step === 'example') body = h('article', { class: 'daily-example' }, h('p', { class: 'eyebrow', text: 'WORKED EXAMPLE' }),
      lesson.simple_example_html ? prose(lesson.simple_example_html) : null,
      h('details', { class: 'daily-solution', 'data-disclosure': 'example-detail', open: opened.includes('example-detail') },
        h('summary', { text: 'See the full coding example: ' + lesson.example.title }),
        prose(lesson.example.prompt_html), prose(lesson.example.solution_html),
        dsa.execution_available === false ? null : lessonEditor(lesson, lesson.example)),
      checkpoint('I read the topic and understand the worked example', progress.read, 'read'),
      h('div', { class: 'daily-step-next' }, h('button', { class: 'btn btn-primary', type: 'button', 'data-step-control': '', onclick: () => chooseStep('practice'), text: 'Continue to practice' })));
    if (step === 'practice') {
      problemIndex = Math.min(problemIndex, lesson.practice.length - 1);
      const problem = lesson.practice[problemIndex];
      body = h('div', {}, h('p', { class: 'daily-practice-note', text: 'First, work out the example on paper. Say each step in your own words. '
        + (dsa.execution_available === false ? 'Then try writing the code in your own code editor. ' : 'Then write and run your code below. ')
        + 'Open the solution if you need help.' }),
        h('div', { class: 'daily-problem-tabs', role: 'group', 'aria-label': 'Practice questions' }, lesson.practice.map((p, i) => h('button', { class: 'daily-problem-tab', type: 'button', 'aria-pressed': i === problemIndex, 'data-step-control': '',
          onclick: () => { capture(); problemIndex = i; draw(); content.querySelector('.daily-question')?.focus({ preventScroll: true }); } }, progress.practiced.includes(p.id) ? icon('check', 'icon icon-sm') : null, `Question ${i + 1}`))),
        h('article', { class: 'daily-question', tabIndex: -1 }, h('h3', { text: problem.title }),
          learningSave({ kind: 'dsa', title: problem.title, url: '#/learning/dsa/problem/' + encodeURIComponent(lesson.course_route.replace(/^02-dsa\//, '') + '/problem-' + problem.id) }), prose(problem.prompt_html),
          lessonEditor(lesson, problem),
          h('details', { class: 'daily-solution', 'data-disclosure': `solution-${problem.id}`, open: opened.includes(`solution-${problem.id}`) }, h('summary', { text: 'Reveal approach & Python solution' }), prose(problem.solution_html)),
          checkpoint(`I practiced ${problem.title}`, progress.practiced.includes(problem.id), 'practice', problem.id)),
        problemIndex < lesson.practice.length - 1 ? h('div', { class: 'daily-step-next' }, h('button', { class: 'btn', type: 'button', 'data-step-control': '', onclick: () => { capture(); problemIndex++; draw(); content.querySelector('.daily-question')?.focus({ preventScroll: true }); }, text: 'Next practice question' })) : null);
    }
    return h('div', {}, h('section', { class: 'daily-workspace' }, warning('dsa'),
      h('header', { class: 'daily-workspace-head' }, h('div', {}, h('p', { class: 'eyebrow', text: `${dsa.revision ? 'REVISION' : `DSA · TOPIC ${lesson.number} OF ${lesson.total}`} · ${lesson.minutes} MIN · +50 XP` }), h('h2', { text: lesson.title })), status(complete, progress.read || practiced > 0)),
      h('div', { class: 'daily-steps', role: 'tablist', 'aria-label': 'DSA lesson steps' }, tabs.map(([key, number, label], i) => h('button', {
        id: `step-${key}`, class: 'daily-step', role: 'tab', type: 'button', 'aria-selected': step === key, 'aria-controls': 'dsa-step-panel', tabIndex: step === key ? 0 : -1, 'data-step-control': '',
        onclick: () => chooseStep(key), onkeydown: event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (i + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3; chooseStep(tabs[next][0]); content.querySelector(`#step-${tabs[next][0]}`)?.focus({ preventScroll: true });
        } } }, h('span', { text: number }), label))),
      h('div', { class: 'daily-step-content', role: 'tabpanel', id: 'dsa-step-panel', 'aria-labelledby': `step-${step}`, tabIndex: -1 }, body),
      h('footer', { class: 'daily-workspace-footer' }, h('div', {}, h('strong', { text: complete ? 'Today’s DSA is complete' : `${Number(progress.read) + practiced} of ${1 + lesson.practice.length} checkpoints complete` }),
        h('p', { text: complete ? 'Saved. Your next topic opens tomorrow.' : `${progress.read ? 'Reading complete' : 'Confirm the reading after the worked example'} · ${practiced}/${lesson.practice.length} questions practiced` })),
        h('button', { class: 'btn btn-primary', type: 'button', 'data-save-control': '', 'data-blocked': String(complete || !ready), 'data-learning-focus': 'complete', onclick: () => save('dsa', { task: 'complete', done: true }), text: complete ? 'DSA completed today' : 'Complete DSA topic' }))),
      h('details', { class: 'daily-roadmap', 'data-disclosure': 'roadmap', open: opened.includes('roadmap') }, h('summary', {}, h('span', { text: 'Your DSA path' }), h('span', { text: `${dsa.completed_topics} / ${lesson.total} topics complete` })),
        h('p', { text: 'One topic per day. Miss a day and your unfinished topic will wait for you.' }),
        h('ol', {}, dsa.topics.map(topic => h('li', { class: topic.today ? 'is-current' : '', 'aria-current': topic.today ? 'step' : null }, h('span', { text: String(topic.number).padStart(2, '0') }), h('span', { text: topic.title }),
          h('span', { text: topic.today ? 'Today' : topic.completed ? 'Done' : 'Upcoming' }))))),
      S.legacyAccess ? h('a', { class: 'daily-next-action text-link', href: '/course/#/' + lesson.course_route, target: '_blank', rel: 'noopener noreferrer', text: 'Open the full course chapter →' }) : null);
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
