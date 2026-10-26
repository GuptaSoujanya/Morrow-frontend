import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { empty, errorState, loadingState } from '../components/panel.js';
import { pagination } from '../components/pagination.js';
import { selectControl } from '../components/controls.js';
import { avatar } from '../components/identity.js';
import { navigationArt } from '../components/navigation-art.js';
import { readQuery, withQuery, choice, pageNumber } from '../url-state.js';
import { fetchButton } from './research-desk.js';
import { updateRunButtons } from '../forms.js';

const CATEGORIES = ['Briefing', 'Learning', 'Resume research', 'Email drafts'];
const dateLabel = value => {
  const date = new Date(value?.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const readerHref = (id, from = 'library', filters = {}) => withQuery(`learning/read/${encodeURIComponent(id)}`, { ...filters, from });
const courseHref = route => `${S.meta?.course || '/course/'}#/${route}`;
const hasModule = name => S.accountMode === 'local' && S.legacyAccess || S.user?.role === 'admin' || S.user?.modules?.includes(name);

function heading(description, tools) {
  return h('div', { class: 'learning-library-heading' }, h('p', { text: description }), tools);
}

function completionPill(read) {
  return h('span', { class: `learning-library-status${read ? ' is-complete' : ''}` }, read ? icon('check', 'icon icon-sm') : null, read ? 'Complete' : 'To read');
}

function documentRow(item, { from = 'library', filters = {}, number, next = false } = {}) {
  const art = { Briefing: 29, Learning: 25, 'Resume research': 47, 'Email drafts': 43 }[item.category] ?? 25;
  return h('li', { class: 'learning-library-row' },
    h('a', { class: 'learning-library-document', href: readerHref(item.id, from, filters) },
      number ? h('span', { class: 'learning-library-number', text: String(number).padStart(2, '0'), 'aria-hidden': 'true' }) : avatar(art, 'learning-library-row-art'),
      h('div', { class: 'learning-library-copy' }, h('strong', { text: item.title }),
        h('span', { class: 'learning-library-meta' }, next ? h('span', { class: 'learning-library-next', text: 'Next topic' }) : h('span', { text: item.category || 'Learning' }),
          item.updated_at ? h('time', { dateTime: item.updated_at, text: dateLabel(item.updated_at) }) : null)),
      completionPill(item.read)));
}

// Capturing the account signal and checking attachment keeps old responses out of
// a replacement route or account, including transports that finish after abort.
function requestView(label, render) {
  const scope = accountRequestSignal();
  const route = location.hash.split('?')[0];
  const root = h('div', { class: 'learning-library-body' });
  const content = h('div', {}, loadingState(label));
  const feedback = h('div', { class: 'learning-library-feedback' });
  root.append(feedback, content);
  let ticket = 0, committed = 0, mutations = 0, refreshing = false, refreshQueued = false, mutationFailed = false, readController;
  const current = () => !scope.aborted && root.isConnected && location.hash.split('?')[0] === route;
  function beginMutation() {
    if (!current()) return null;
    // A GET started before this save cannot replace its controls or its result.
    // The last committed body's callbacks remain current until a new body lands.
    if (!mutations) mutationFailed = false;
    refreshQueued ||= refreshing;
    readController?.abort(); readController = null;
    refreshing = false; ++ticket; ++mutations;
    root.setAttribute('aria-busy', 'true');
    let released = false;
    return (saved = true) => {
      if (released) return;
      mutationFailed ||= !saved;
      released = true; --mutations;
      if (!current()) return;
      root.setAttribute('aria-busy', String(mutations > 0 || refreshing));
      if (!mutations && refreshQueued) {
        refreshQueued = false;
        // Keep a failed save's inline error visible until an explicit retry or
        // later refresh, rather than immediately replacing it with a fresh GET.
        if (!mutationFailed) queueMicrotask(load);
      }
    };
  }
  async function load() {
    if (!current()) return;
    if (mutations) { refreshQueued = true; return; }
    const request = ++ticket;
    readController?.abort();
    const controller = new AbortController();
    readController = controller;
    refreshing = true;
    root.setAttribute('aria-busy', 'true');
    try {
      const children = await render({ current: () => current() && (request === ticket || request === committed), load, beginMutation, signal: controller.signal });
      if (!current() || request !== ticket) return;
      committed = request;
      feedback.replaceChildren();
      content.replaceChildren(...(Array.isArray(children) ? children : [children]).filter(Boolean));
      updateRunButtons();
    } catch (error) {
      if (!current() || request !== ticket || error.name === 'AbortError') return;
      feedback.replaceChildren(errorState(error.message, load));
      if (content.querySelector('.state-loading')) content.replaceChildren();
    } finally {
      if (current() && request === ticket) { readController = null; refreshing = false; root.setAttribute('aria-busy', String(mutations > 0)); }
    }
  }
  root.refresh = load;
  queueMicrotask(load);
  return root;
}

function resumeView() {
  return requestView('Opening your resume topics…', async ({ current, load, signal }) => {
    const data = await api('/api/research/learning', undefined, { signal });
    if (!current()) return [];
    const resume = data.resume || { topics: [], index: null };
    const topics = resume.topics || [];
    const read = topics.filter(item => item.read).length;
    const next = topics.find(item => !item.read);
    return [
      heading('Learn the tools, systems and projects from your resume. Pick up your next unfinished topic.',
        S.legacyAccess && hasModule('automations') ? fetchButton('Update resume library', 'research:resume', data.date, load) : null),
      topics.length ? h('section', { class: 'learning-library-continue' },
        h('div', {}, h('p', { class: 'eyebrow', text: next ? 'YOUR NEXT UNFINISHED TOPIC' : 'ALL SAVED TOPICS COMPLETE' }),
          h('h2', { text: next?.title || 'You have explored every saved resume topic.' }),
          h('p', { text: next?.excerpt || (next ? 'Read the explanation, connect it to your experience, and practice explaining it aloud.' : 'Revisit a topic to prepare for your next interview, or update your library when your resume changes.') }),
          next ? h('a', { class: 'btn btn-primary', href: readerHref(next.id, 'resume'), text: 'Continue resume learning' }) : null),
        h('div', { class: 'learning-library-summary' }, h('strong', { text: `${read} / ${topics.length}` }), h('span', { text: 'topics complete' }),
          h('progress', { max: topics.length, value: read, 'aria-label': 'Resume topics completed' }))) : null,
      h('section', { class: 'learning-library-section' },
        h('div', { class: 'learning-library-section-head' }, h('h2', { text: 'Your saved topics' }),
          resume.index ? h('a', { class: 'text-link', href: readerHref(resume.index.id, 'resume'), text: 'Open resume overview →' }) : null),
        topics.length ? h('ol', { class: 'plain-list learning-library-list' }, topics.map((item, i) => documentRow(item, { from: 'resume', number: i + 1, next: item === next })))
          : empty('No resume topics are saved yet. Update your resume library to prepare learning material from your saved resume.')),
      h('p', { class: 'learning-library-note', text: 'Mark a topic complete after reading. It contributes to the same daily progress and streak as your other learning.' }),
    ];
  });
}

function coursesView() {
  return requestView('Opening your course library…', async ({ current, beginMutation, signal }) => {
    const course = await api('/api/course', undefined, { signal });
    if (!current()) return [];
    S.course = course;
    const tracks = course.tracks || [];
    const query = readQuery();
    const active = tracks.find(track => track.name === query.get('track')) || tracks.find(track => track.modules.some(module => module.today)) || tracks[0];
    const layout = h('div', { class: 'learning-library-courses' });
    const content = h('div', { class: 'learning-library-course-content' });
    const nav = h('nav', { class: 'learning-library-tracks', 'aria-label': 'Course tracks' });
    const trackSelect = selectControl({ label: 'Course track', value: active?.name || '', options: tracks.map(track => ({ value: track.name, label: track.name })), onChange: value => {
      if (current()) location.hash = withQuery('learning/courses', { track: value });
    } });
    trackSelect.controlElement.id = 'learning-course-track';
    const trackPicker = h('div', { class: 'learning-library-track-picker' },
      h('span', { text: 'Course track' }), trackSelect);
    const total = h('p', { class: 'learning-library-note' });
    function drawCounts() {
      if (!current()) return;
      const all = tracks.flatMap(track => track.modules);
      const read = all.filter(module => module.read).length;
      course.read = read;
      total.textContent = `${read} of ${all.length} lessons complete · Counts toward your daily streak`;
      nav.replaceChildren(...tracks.map(track => h('a', {
        href: withQuery('learning/courses', { track: track.name }), 'aria-current': track === active ? 'page' : null,
        dataset: { focusKey: `course-track:${track.name}` },
      }, h('strong', { text: track.name }), h('span', { text: `${track.modules.filter(module => module.read).length} / ${track.modules.length} complete` }))));
      trackSelect.value = active?.name || '';
    }
    if (!active) return [heading('Explore the complete curriculum at your own pace.'), empty('No course lessons are available yet.')];
    function lessonRow(module, index) {
      const feedback = h('p', { class: 'field-error', role: 'status', hidden: true });
      const check = h('input', { type: 'checkbox', checked: module.read, 'aria-label': `Mark ${module.title} complete`, onchange: async () => {
        if (!current() || !check.isConnected) return;
        const finishMutation = beginMutation();
        if (!finishMutation) return;
        let saved = false;
        const wanted = check.checked;
        check.disabled = true;
        feedback.hidden = true;
        try {
          const result = await api('/api/course/read', { path: module.path, read: wanted });
          if (!current()) return;
          saved = true;
          module.read = typeof result.read === 'boolean' ? result.read : wanted;
          check.checked = module.read;
          S.course = course;
          drawCounts();
          status.textContent = module.read ? 'Complete' : 'Mark complete';
        } catch (error) {
          if (!current() || error.name === 'AbortError') return;
          check.checked = module.read;
          feedback.textContent = `Progress could not be saved. ${error.message}`;
          feedback.hidden = false;
        } finally {
          if (current()) check.disabled = false;
          finishMutation(saved);
        }
      } });
      const status = h('span', { text: module.read ? 'Complete' : 'Mark complete' });
      return h('li', { class: 'learning-library-lesson' }, h('span', { class: 'learning-library-number', text: String(index + 1).padStart(2, '0'), 'aria-hidden': 'true' }),
        h('div', { class: 'learning-library-copy' }, h('a', { href: courseHref(module.route), target: '_blank', rel: 'noopener noreferrer' }, module.title, icon('arrow-up-right', 'icon icon-sm')),
          module.today ? h('span', { class: 'learning-library-meta', text: 'Your current course lesson' }) : null, feedback),
        h('label', { class: 'learning-library-course-check' }, check, status));
    }
    content.append(h('div', { class: 'learning-library-section-head' }, h('h2', { text: active.name }), h('span', { class: 'muted small', text: `${active.modules.length} lessons` })),
      h('ol', { class: 'plain-list learning-library-list' }, active.modules.map(lessonRow)));
    drawCounts();
    layout.append(nav, trackPicker, content);
    return [heading('Choose a track and work through its lessons at your own pace.'), total, layout];
  });
}

function libraryView() {
  const scope = accountRequestSignal();
  const route = location.hash.split('?')[0];
  const query = readQuery();
  const filters = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(query.get('date') || '') ? query.get('date') : '',
    category: choice(query.get('category'), ['', ...CATEGORIES], ''), q: query.get('q') || '',
    page: pageNumber(query.get('page')), size: choice(Number(query.get('size')), [12, 24, 48], 12),
  };
  const root = h('div', { class: 'learning-library-body' });
  const list = h('div', { class: 'research-results' }, loadingState('Opening your saved library…'));
  const feedback = h('div');
  const paging = h('div');
  const count = h('p', { class: 'learning-library-note', role: 'status' });
  const archive = h('div');
  const categories = h('div', { class: 'learning-library-filters', role: 'group', 'aria-label': 'Document categories' });
  let request = 0, timer, controller;
  const current = () => !scope.aborted && root.isConnected && location.hash.split('?')[0] === route;
  function saveQuery() {
    if (!current()) return;
    const href = withQuery('learning/library', filters);
    if (location.hash !== href) history.replaceState(null, '', href);
  }
  const search = h('input', {
    class: 'input', type: 'search', value: filters.q, placeholder: 'Search titles and saved notes', 'aria-label': 'Search saved library',
    oninput: event => {
      filters.q = event.target.value; filters.page = 1;
      clearTimeout(timer); timer = setTimeout(() => { if (current()) load(); }, 250);
    },
  });
  async function load() {
    if (!current()) return;
    const ticket = ++request;
    controller?.abort(); controller = new AbortController();
    saveQuery(); list.setAttribute('aria-busy', 'true');
    [...categories.children].forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === filters.category)));
    archive.replaceChildren(...(filters.date ? [h('div', { class: 'learning-library-archive' },
      h('span', { text: `Saved daily research · ${dateLabel(filters.date)}` }),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Show all dates', onclick: () => { filters.date = ''; filters.page = 1; load(); } }))] : []));
    try {
      const data = await api('/api/library?' + new URLSearchParams(filters), undefined, { signal: controller.signal });
      if (!current() || ticket !== request) return;
      filters.page = data.page; saveQuery(); feedback.replaceChildren();
      count.textContent = `${data.total} saved document${data.total === 1 ? '' : 's'}${filters.q || filters.category || filters.date ? ' match your filters' : ''}`;
      list.replaceChildren(data.items.length
        ? h('ul', { class: 'plain-list learning-library-list' }, data.items.map(item => documentRow(item, { filters })))
        : empty(filters.q || filters.category || filters.date ? 'No saved documents match these filters.' : 'Your saved papers, daily notes and weekly plans will appear here.',
          filters.q || filters.category || filters.date ? h('button', { class: 'btn', type: 'button', text: 'Clear filters', onclick: () => {
            Object.assign(filters, { q: '', category: '', date: '', page: 1 }); search.value = ''; load();
          } }) : h('a', { class: 'btn', href: '#/learning', text: 'Go to today’s priorities' })));
      paging.replaceChildren(data.total ? pagination({ ...data, label: 'Saved library', onPage: page => { filters.page = page; return load(); }, onSize: size => { filters.size = size; filters.page = 1; return load(); } }) : h('span'));
    } catch (error) {
      if (!current() || ticket !== request || error.name === 'AbortError') return;
      feedback.replaceChildren(errorState(error.message, load));
      if (list.querySelector('.state-loading')) list.replaceChildren();
    } finally {
      if (current() && ticket === request) list.setAttribute('aria-busy', 'false');
    }
  }
  ['', ...CATEGORIES].forEach(category => categories.append(h('button', {
    class: 'learning-library-filter', type: 'button', dataset: { category }, 'aria-pressed': String(category === filters.category),
    text: category === 'Resume research' ? 'Resume topics' : category || 'All documents', onclick: () => { filters.category = category; filters.page = 1; load(); },
  })));
  root.append(heading('Find your saved papers, daily briefings, resume topics and learning plans.'), archive,
    h('section', { class: 'learning-library-section' }, h('div', { class: 'learning-library-search' }, navigationArt('search', 'learning-library-search-art'), search), categories, count, feedback, list, paging));
  root.refresh = load;
  queueMicrotask(load);
  return root;
}

function safeReading(html, title) {
  const allowed = new Set(['p', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 's', 'a']);
  function copy(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    let tag = node.tagName.toLowerCase();
    if (!allowed.has(tag)) return document.createTextNode(node.textContent);
    if (tag === 'h1') tag = 'h2';
    const props = {};
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) Object.assign(props, { href, target: '_blank', rel: 'noopener noreferrer' });
      else if (/^(?:\/#\/research\/|#\/research\/)/.test(href)) props.href = href.replace(/^\/?#\/research\//, '#/learning/read/');
      else if (/^\/course\//.test(href)) Object.assign(props, { href, target: '_blank', rel: 'noopener noreferrer' });
      else if (/^(?:#\/|\/#\/)/.test(href)) props.href = href;
      else if (/^#[^/]/.test(href)) {
        props.href = href;
        props.onclick = event => {
          event.preventDefault();
          let fragment = href.slice(1);
          try { fragment = decodeURIComponent(fragment); } catch { /* Retain malformed fragments as literal text. */ }
          reading.querySelector(`[id="reading-${CSS.escape(fragment)}"]`)?.scrollIntoView({ block: 'start' });
        };
      }
    }
    if (/^h[2-6]$/.test(tag)) props.id = `reading-${node.textContent.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}`;
    return h(tag, props, [...node.childNodes].map(copy));
  }
  const parsed = new DOMParser().parseFromString(html || '', 'text/html').body;
  const first = parsed.firstElementChild;
  if (first?.tagName === 'H1' && first.textContent.trim() === title) first.remove();
  const reading = h('div', { class: 'daily-prose learning-saved-prose' }, [...parsed.childNodes].map(copy));
  return reading;
}

function readView(id) {
  return requestView('Opening your reading…', async ({ current, beginMutation, signal }) => {
    const data = await api('/api/document?id=' + encodeURIComponent(id), undefined, { signal });
    if (!current()) return [];
    const canMark = hasModule('learning');
    const feedback = h('p', { class: 'learning-library-note', role: 'status', text: !canMark ? 'You can read this document. Saving reading progress requires access to learning.' : data.read ? 'Complete. Your progress is saved.' : 'Read the material, then mark it complete to record your progress.' });
    const toggle = h('button', { class: 'btn' + (data.read ? '' : ' btn-primary'), type: 'button', disabled: !canMark, text: data.read ? 'Reopen reading' : 'Mark complete', onclick: async () => {
      if (!canMark) return;
      if (!current() || !toggle.isConnected) return;
      const finishMutation = beginMutation();
      if (!finishMutation) return;
      let saved = false;
      const wanted = !data.read;
      toggle.disabled = true; toggle.textContent = 'Saving…'; feedback.classList.remove('field-error'); feedback.textContent = 'Saving your progress…';
      try {
        const result = await api('/api/research/read', { id, read: wanted });
        if (!current()) return;
        saved = true;
        data.read = typeof result.read === 'boolean' ? result.read : wanted;
        feedback.textContent = data.read ? 'Complete. Your progress is saved and your daily activity is updated.' : 'Reading reopened. Your saved progress is updated.';
      } catch (error) {
        if (!current() || error.name === 'AbortError') return;
        feedback.classList.add('field-error'); feedback.textContent = `Progress could not be saved. ${error.message} Please try again.`;
      } finally {
        if (current()) {
          toggle.disabled = false; toggle.textContent = data.read ? 'Reopen reading' : 'Mark complete'; toggle.classList.toggle('btn-primary', !data.read);
          status.replaceChildren(completionPill(data.read));
        }
        finishMutation(saved);
      }
    } });
    const status = h('span', {}, completionPill(data.read));
    return [h('article', { class: 'learning-library-reading' },
        h('header', { class: 'learning-library-reading-head' }, h('div', {}, h('p', { class: 'eyebrow', text: data.day ? `LEARNING DAY ${data.day} OF 90` : data.category || 'SAVED READING' }), h('h2', { text: data.title || 'Saved reading' })), status),
        safeReading(data.html, data.title),
        h('footer', { class: 'learning-library-reading-footer' }, feedback, toggle)),
      h('a', { class: 'learning-library-back', href: '#/learning', text: 'Continue today’s priorities →' })];
  });
}

function historyView() {
  const query = readQuery();
  let page = pageNumber(query.get('page'));
  function itemRow(item, imported = false) {
    const href = item.id.startsWith('code/dsa/') ? '#/learning/dsa/problem/' + encodeURIComponent(item.id.slice(9)) : item.id.startsWith('practice/') ? '#/learning/practice/paper/' + encodeURIComponent(item.id.slice(9)) : item.kind === 'dsa' ? '#/learning/dsa' : item.kind === 'course'
      ? courseHref(item.id.replace(/README\.md$/, '').replace(/\.md$/, '')) : readerHref(item.id, 'progress', { page });
    const at = item.at || item.completed_at;
    const stamp = at && !Number.isNaN(new Date(at).getTime()) ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    return h('li', { class: 'learning-library-history-row' },
      h('span', { class: 'learning-library-history-dot' + (item.action === 'reopened' ? ' is-reopened' : ''), 'aria-hidden': 'true' }),
      h('div', { class: 'learning-library-copy' }, h('a', { href, text: item.title || item.id }),
        h('span', { class: 'learning-library-meta', text: `${item.id.startsWith('code/') ? 'Tested solution' : item.id.startsWith('practice/') ? 'Practice paper' : item.kind === 'dsa' ? 'DSA practice' : item.kind === 'course' ? 'Course lesson' : 'Saved reading'} · ${item.action === 'reopened' ? 'Reopened' : 'Completed'}` })),
      imported || !stamp ? h('span', { class: 'learning-library-history-time', text: 'Date not recorded' }) : h('time', { class: 'learning-library-history-time', dateTime: at, text: stamp }));
  }
  return requestView('Opening your learning history…', async ({ current, load, signal }) => {
    const data = await api('/api/research/learning?' + new URLSearchParams({ page }), undefined, { signal });
    if (!current()) return [];
    const history = data.history || { items: [], page: 1, pages: 1, total: 0, size: 15 };
    page = history.page;
    const imported = [...(data.imported || []), ...(data.legacy_plan_days || []).map(day => ({ id: `plan/day-${day}`, title: `Learning day ${day}`, kind: 'research' }))];
    return [h('section', { class: 'learning-library-section learning-library-history' },
      h('div', { class: 'learning-library-section-head' }, h('div', {}, h('h2', { text: 'Learning history' }), h('p', { class: 'learning-library-note', text: 'Your completed and reopened reading, courses and DSA practice.' }))),
      history.items.length ? h('ul', { class: 'plain-list' }, history.items.map(item => itemRow(item))) : empty('Your completed learning will appear here. Start with today’s priorities.'),
      history.pages > 1 ? pagination({ ...history, label: 'Learning history', onPage: selected => {
        page = selected;
        if (current()) historyWriteQuery(page);
        return load();
      } }) : null),
      imported.length ? h('details', { class: 'learning-library-imports' },
        h('summary', { text: `Earlier progress · ${imported.length} saved completion${imported.length === 1 ? '' : 's'}` }),
        h('p', { class: 'learning-library-note', text: 'These completions were preserved from your previous progress files. Their original dates were not recorded, so they do not add activity to the calendar.' }),
        h('ul', { class: 'plain-list' }, imported.map(item => itemRow(item, true)))) : null];
  });
}

function historyWriteQuery(page) {
  const query = readQuery(); query.set('page', page);
  history.replaceState(null, '', withQuery('learning/progress', Object.fromEntries(query)));
}

/** Body-only views: the caller provides each page title and Learning navigation. */
export function renderLearningLibrary(kind, arg = '') {
  if (kind === 'resume') return resumeView();
  if (kind === 'courses') return coursesView();
  if (kind === 'read') return readView(arg);
  if (kind === 'history') return historyView();
  return libraryView();
}
