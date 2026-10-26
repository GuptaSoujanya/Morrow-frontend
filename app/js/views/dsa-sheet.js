import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api, accountRequestSignal } from '../api.js';
import { loadingState, errorState, empty } from '../components/panel.js';
import { codeEditor } from '../components/code-editor.js';
import { DSA_PRACTICE_PATH } from '../learning-sections.js';

const states = { todo: 'Not started', attempted: 'Attempted', solved: 'Solved' };
const draftMemory = new WeakMap();

function reading(html) {
  const allowed = new Set(['p', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'a']);
  function copy(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    let tag = node.tagName.toLowerCase();
    if (!allowed.has(tag)) return document.createTextNode(node.textContent);
    if (tag === 'h1' || tag === 'h2') tag = 'h3';
    const props = {};
    if (tag === 'a' && /^https?:\/\//.test(node.getAttribute('href') || '')) Object.assign(props, { href: node.getAttribute('href'), target: '_blank', rel: 'noopener noreferrer' });
    return h(tag, props, [...node.childNodes].map(copy));
  }
  return h('div', { class: 'daily-prose' }, [...new DOMParser().parseFromString(html || '', 'text/html').body.childNodes].map(copy));
}

export function renderDsaSheet(arg = 'sheet') {
  const scope = accountRequestSignal(), route = location.hash.split('?')[0];
  if (!draftMemory.has(scope)) draftMemory.set(scope, new Map());
  const drafts = draftMemory.get(scope);
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const root = h('div', { class: 'dsa-sheet' }, loadingState('Opening your practice sheet…'));
  const problemId = arg.startsWith('problem/') ? arg.slice(8) : '';
  let data, request = 0, controller, pending = 0, dirty = false, disposed = false;
  let coding;
  let search = query.get('q') || '', filter = Object.hasOwn(states, query.get('status')) ? query.get('status') : 'all';
  let open = new Set(), initialized = false;
  const suffix = () => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (filter !== 'all') params.set('status', filter);
    return params.size ? '?' + params : '';
  };
  const href = id => '#/learning/dsa/problem/' + encodeURIComponent(id) + suffix();
  const rememberFilters = () => history.replaceState(history.state, '', '#/learning/dsa/sheet' + suffix());
  const current = () => !disposed && !scope.aborted && root.isConnected && location.hash.split('?')[0] === route;
  const feedback = h('div', { class: 'dsa-sheet-feedback', role: 'status' });
  async function load() {
    if (!current() || pending || dirty || coding?.hasDraft()) return;
    const ticket = ++request; controller?.abort(); controller = new AbortController();
    try {
      const result = await api(problemId ? '/api/learning/dsa/problem?id=' + encodeURIComponent(problemId) : '/api/learning/dsa/sheet', undefined, { signal: controller.signal });
      if (!current() || ticket !== request || pending || dirty || coding?.hasDraft()) return;
      data = result; feedback.replaceChildren(); draw();
    } catch (error) { if (current() && error.name !== 'AbortError' && ticket === request) root.replaceChildren(errorState(error.message, load)); }
  }
  async function save(body, success) {
    if (pending || !current()) return;
    controller?.abort(); ++request; ++pending;
    root.querySelectorAll('[data-sheet-save], .dsa-notes-actions select').forEach(el => { el.disabled = true; });
    const notes = root.querySelector('.dsa-notes');
    if (notes) notes.readOnly = true;
    feedback.replaceChildren(h('p', { class: 'muted', text: 'Saving progress…' }));
    try {
      const saved = await api('/api/learning/dsa/problem', body);
      if (!current()) return;
      success(saved); dirty = false;
      feedback.replaceChildren(h('p', { class: 'dsa-saved', text: 'Your practice progress is saved.' }));
    } catch (error) { if (current() && error.name !== 'AbortError') feedback.replaceChildren(h('p', { role: 'alert', text: `${error.message} Your notes are still here. Use Save progress to retry.` })); }
    finally {
      --pending;
      if (current()) {
        root.querySelectorAll('[data-sheet-save], .dsa-notes-actions select').forEach(el => { el.disabled = pending > 0; });
        if (notes) notes.readOnly = false;
      }
    }
  }
  function draw() {
    if (!current()) return;
    if (problemId) return drawProblem();
    if (!initialized && data.groups.length) { open.add(data.groups[0].id); initialized = true; }
    const summary = h('div', { class: 'dsa-sheet-summary' },
      h('div', {}, h('strong', { text: `${data.solved} / ${data.total}` }), h('span', { text: 'problems solved' })),
      h('div', {}, h('strong', { text: data.attempted }), h('span', { text: 'attempted' })),
      h('div', {}, h('strong', { text: data.groups.length }), h('span', { text: 'topic groups' })),
      h('progress', { value: data.solved, max: data.total || 1, 'aria-label': 'Practice sheet completion' }));
    const problems = data.groups.flatMap(group => group.problems);
    const next = problems.find(problem => problem.status === 'attempted') || problems.find(problem => problem.status === 'todo') || problems[0];
    const quickStart = next ? h('section', { class: 'dsa-quick-start', 'aria-label': 'Continue coding' },
      h('div', {}, h('p', { class: 'eyebrow', text: next.status === 'solved' ? 'READY FOR REVISION' : 'YOUR NEXT QUESTION' }),
        h('h2', { text: next.title }), h('p', { text: 'Open the question and editor together. Your saved code will be waiting.' })),
      h('div', { class: 'dsa-quick-actions' }, h('a', { class: 'btn btn-primary', href: href(next.id), text: next.status === 'attempted' ? 'Continue coding' : 'Start coding' }),
        h('a', { class: 'text-link', href: DSA_PRACTICE_PATH, text: 'Today’s question →' }))) : null;
    const list = h('div', { class: 'dsa-topic-list' });
    const searchInput = h('input', { type: 'search', class: 'input', value: search, placeholder: 'Find a problem or topic', 'aria-label': 'Search DSA problems', oninput: event => { search = event.target.value; rememberFilters(); drawList(); } });
    const select = h('select', { class: 'input', 'aria-label': 'Problem status', onchange: event => { filter = event.target.value; rememberFilters(); drawList(); } },
      [['all', 'All problems'], ...Object.entries(states)].map(([value, label]) => h('option', { value, selected: value === filter, text: label })));
    function drawList() {
      const term = search.trim().toLowerCase(); let found = 0;
      list.replaceChildren(...data.groups.map(group => {
        const problems = group.problems.filter(problem => (filter === 'all' || problem.status === filter) && (!term || `${group.title} ${problem.title}`.toLowerCase().includes(term)));
        if (!problems.length) return null;
        found += problems.length;
        const details = h('details', { class: 'dsa-topic', open: Boolean(term || filter !== 'all' || open.has(group.id)), ontoggle: event => { if (!term && filter === 'all') { if (event.target.open) open.add(group.id); else open.delete(group.id); } } },
          h('summary', {}, h('span', { class: 'dsa-topic-number', text: String(group.number).padStart(2, '0') }), h('strong', { text: group.title }), h('span', { class: 'dsa-topic-count', text: `${group.completed} / ${group.total}` }), icon('chevron-down', 'icon icon-sm')),
          h('ul', { class: 'plain-list dsa-problem-list' }, problems.map(problem => h('li', {},
            h('a', { href: href(problem.id), class: 'dsa-problem-link' }, h('strong', { text: problem.title }), h('span', { text: problem.level })),
            h('span', { class: 'dsa-problem-status is-' + problem.status, text: states[problem.status] }),
            h('a', { class: 'btn', href: href(problem.id), 'aria-label': `Open ${problem.title}`, text: 'Open' }, icon('chevron-right', 'icon icon-sm'))))));
        return details;
      }).filter(Boolean));
      if (!found) list.append(empty('No problems match your filters. Try a different topic or status.'));
    }
    root.replaceChildren(quickStart, h('p', { class: 'dsa-sheet-intro', text: 'Choose any question below, or continue straight into your next problem.' }), summary,
      h('div', { class: 'dsa-sheet-tools' }, searchInput, select), feedback, list,
      h('p', { class: 'learning-library-note' }, 'These questions come from your bundled course. Stages describe their order within each chapter. ',
        h('a', { href: 'https://takeuforward.org/prep-hub/strivers-a2z-dsa-sheet', target: '_blank', rel: 'noopener noreferrer', text: 'Explore Striver’s A2Z sheet ↗' })));
    drawList();
  }
  function drawProblem() {
    coding ||= codeEditor({ key: 'dsa/' + problemId, showProblemTitle: false, compact: true, onSubmitted: result => {
      if (!current()) return;
      if (result.passed === result.total) data.status = 'solved';
      else if (data.status === 'todo') data.status = 'attempted';
      const currentBadge = root.querySelector('.daily-workspace-head .dsa-problem-status');
      if (currentBadge) { currentBadge.className = 'dsa-problem-status is-' + data.status; currentBadge.textContent = states[data.status]; }
      const currentStatus = root.querySelector('.dsa-notes-actions select');
      if (currentStatus) currentStatus.value = data.status;
    } });
    const badge = h('span', { class: 'dsa-problem-status is-' + data.status, text: states[data.status] });
    const remembered = drafts.get(problemId);
    const notes = h('textarea', { class: 'textarea dsa-notes', rows: 7, maxLength: 20000, value: remembered?.notes ?? data.notes ?? '', placeholder: 'Write your approach, complexity, edge cases, or code…', 'aria-label': 'Your approach and notes' });
    const status = h('select', { class: 'input', 'aria-label': 'Your problem status' }, Object.entries(states).map(([value, label]) => h('option', { value, selected: value === (remembered?.status || data.status), text: label })));
    const changed = () => {
      dirty = true; ++request; controller?.abort();
      drafts.set(problemId, { notes: notes.value, status: status.value });
      feedback.replaceChildren(h('p', { class: 'muted', text: 'Unsaved changes · use Save progress to keep them after closing the app.' }));
    };
    notes.addEventListener('input', changed); status.addEventListener('change', changed);
    if (remembered) changed();
    const button = h('button', { class: 'btn btn-primary', type: 'button', 'data-sheet-save': '', text: 'Save progress', onclick: () => {
      if (pending) return;
      button.disabled = true;
      save({ id: problemId, status: status.value, notes: notes.value }, saved => {
        drafts.delete(problemId); data = saved; badge.className = 'dsa-problem-status is-' + saved.status; badge.textContent = states[saved.status];
      });
    } });
    root.replaceChildren(h('a', { class: 'back-link daily-task-back', href: '#/learning/dsa/sheet' + suffix(), text: '← Back to practice sheet' }),
      h('article', { class: 'daily-workspace dsa-problem-workspace' },
        h('header', { class: 'daily-workspace-head' }, h('div', {}, h('p', { class: 'eyebrow', text: data.level }), h('h2', { text: data.title })), badge),
        h('div', { class: 'daily-reading' }, reading(data.prompt_html), coding,
          h('details', { class: 'daily-solution' }, h('summary', { text: 'Review the approach & solution' }), reading(data.solution_html)),
          h('section', { class: 'dsa-work-notes' }, h('h3', { text: 'Approach & notes' }), h('p', { class: 'learning-library-note', text: 'Keep your reasoning and complexity notes here. Passing the full test suite marks the problem solved.' }), notes,
            h('div', { class: 'dsa-notes-actions' }, status, button), feedback))));
  }
  root.refresh = load;
  root.dispose = () => { disposed = true; controller?.abort(); coding?.dispose(); };
  queueMicrotask(load);
  return root;
}
