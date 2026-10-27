import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';
import { empty, errorState, loadingState } from '../components/panel.js';
import { bookmarkKinds, learningSave } from '../components/learning-save.js';
import { fetchButton } from './research-desk.js';
import { updateRunButtons } from '../forms.js';
import { learningProfileCard, individualProgress, learningBadges } from '../components/learning-overview.js';
import { activityView } from '../components/learning-progress.js';
import { S } from '../state.js';

const drafts = new WeakMap();
const pendingSaves = new WeakMap();
const label = date => new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const link = (url, title, cls = 'text-link') => h('a', { href: url, class: cls, text: title,
  ...(url.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {}) });
const tabs = (items, selected, route, key) => h('nav', { class: 'learn-tabs', 'aria-label': key === 'kind' ? 'Bookmark categories' : 'Discovery categories' },
  items.map(([value, text]) => h('a', { href: `#/learning/${route}?${key}=${value}`, text, 'aria-current': selected === value ? 'page' : null })));

export function learningPaths() {
  return h('details', { class: 'learn-path-explorer', open: matchMedia('(min-width: 1101px)').matches },
    h('summary', { text: 'Explore your learning areas' }), h('section', { class: 'learn-paths', 'aria-label': 'Your learning paths' },
    [
      ['01', 'Build for your next role', 'System design, full stack & AI agents', 'weekly'],
      ['02', 'Discover what’s next', 'New technology & companies to explore', 'discover?tab=tech'],
      ['03', 'Learn, then solve', 'One DSA topic, examples & two questions', 'dsa'],
      ['04', 'Read two papers', 'New research, with AI as the priority', 'discover?tab=papers'],
      ['05', 'Explore GitHub', 'Useful repositories to try & save', 'discover?tab=repos'],
    ].map(([number, title, description, path]) => h('a', { class: 'learn-path', href: '#/learning/' + path },
      h('span', { class: 'learn-path-number', text: number }), h('strong', { text: title }), h('span', { text: description })))));
}

export function renderLearningWorkspace(view) {
  const scope = accountRequestSignal(), route = location.hash;
  const query = new URLSearchParams(route.split('?')[1] || '');
  const root = h('div', { class: 'learn-workspace' }, loadingState('Opening your learning workspace…'));
  let disposed = false, ticket = 0, dirty = false, busy = false, data, editor, draftKey;
  const current = () => !disposed && !scope.aborted && root.isConnected && location.hash === route;
  const feedback = h('div', { class: 'learn-feedback', role: 'status' });
  if (!drafts.has(scope)) drafts.set(scope, new Map());
  const draftStore = drafts.get(scope);
  if (!pendingSaves.has(scope)) pendingSaves.set(scope, new Map());
  const pendingStore = pendingSaves.get(scope);

  async function load() {
    if (!current() || dirty || busy) return;
    const request = ++ticket;
    try {
      const path = view === 'weekly' ? '/api/learning/curriculum' : view === 'discover'
        ? '/api/learning/discovery' + (query.get('date') ? '?date=' + encodeURIComponent(query.get('date')) : '') : view === 'progress' ? '/api/learning/overview' : '/api/learning/collection';
      const result = await api(path, undefined, { fresh: true });
      if (view === 'weekly') {
        const [resume, course] = await Promise.allSettled([api('/api/research/learning'), S.legacyAccess ? api('/api/course') : Promise.resolve(null)]);
        result.resume = resume.status === 'fulfilled' ? resume.value.resume : null;
        result.resumeError = resume.status === 'rejected' ? resume.reason.message : '';
        result.course = course.status === 'fulfilled' ? course.value : null;
        result.courseError = course.status === 'rejected' ? course.reason.message : '';
      }
      if (!current() || request !== ticket || dirty || busy) return;
      data = result;
      root.replaceChildren(feedback);
      if (['notes', 'bookmarks'].includes(view)) root.append(h('nav', { class: 'learn-tabs', 'aria-label': 'Your learning library' },
        [['library', 'Saved material'], ['bookmarks', 'Bookmarks'], ['notes', 'My notes']].map(([key, text]) => h('a', { href: '#/learning/' + key, text, 'aria-current': key === view ? 'page' : null }))));
      if (view === 'weekly') drawWeekly();
      else if (view === 'discover') drawDiscovery();
      else if (view === 'bookmarks') drawBookmarks();
      else if (view === 'progress') {
        root.append(individualProgress(data));
        if (data.activity) root.append(h('p', { class: 'muted', text: data.activity.scope }), activityView(data.activity, { showAction: false, showBadges: false }), learningBadges(data.activity));
      } else drawNotes();
      updateRunButtons();
    } catch (error) { if (current() && request === ticket && error.name !== 'AbortError') root.replaceChildren(errorState(error.message, load)); }
  }

  function drawWeekly() {
    const active = data.weeks.find(week => week.number === data.current_week);
    if (data.generation_available === false) {
      root.append(learningProfileCard(data.profile), h('section', { class: 'learn-resume-inline' },
        h('h2', { text: 'Your learning workspace' }), h('p', { class: 'muted', text: data.generation_message }),
        h('div', { class: 'learn-actions' }, link('#/learning/library', 'Open your private library', 'btn btn-primary'), link('#/learning/notes', 'Capture a note'), link('#/learning/bookmarks', 'Saved bookmarks'))));
      return;
    }
    root.append(learningProfileCard(data.profile), h('section', { class: 'learn-intro' }, h('div', {},
      h('p', { class: 'eyebrow', text: 'YOUR RESUME → YOUR NEXT ROLE' }),
      h('h2', { text: 'A little every day. A stronger skill set every week.' }),
      h('p', { text: 'Your 90-day curriculum connects system design, full-stack development and AI agents to your resume and target roles. Study a daily lesson, then bring the week together with a practical project.' }),
      h('div', { class: 'learn-actions' }, link('#/learning/plan', 'Continue daily lesson', 'btn btn-primary'), link('#/learning/resume', 'Explore resume topics'), link('#/learning/courses', 'Browse courses'))),
      h('div', { class: 'learn-plan-count' }, h('strong', { text: `${data.completed} / ${data.total}` }), h('span', { text: 'learning days complete' }),
        h('progress', { max: data.total, value: data.completed, 'aria-label': 'Curriculum progress' }))),
      h('section', { class: 'learn-resume-inline', 'aria-label': 'Resume learning within your curriculum' },
        h('div', { class: 'learn-section-heading' }, h('div', {}, h('h2', { text: 'Learn from your own experience' }),
          h('p', { text: 'Your resume topics are part of this same curriculum. Understand the tools you list, explain your projects, and practice the gaps.' })),
          link('#/learning/resume', 'All resume topics →')),
        data.resumeError ? errorState('Resume topics could not be loaded. ' + data.resumeError, load) : data.resume?.topics?.length ? h('div', { class: 'learn-resume-topics' }, data.resume.topics.slice(0, 6).map(topic => h('a', {
          href: '#/learning/read/' + encodeURIComponent(topic.id) + '?from=weekly' }, h('strong', { text: topic.title }), h('span', { text: topic.read ? 'Complete · Review →' : topic.resume_status === 'unverified' ? 'Saved topic · Open →' : 'Read & practice →' }))))
          : h('div', { class: 'learn-actions' }, h('p', { class: 'muted', text: 'Prepare topics from your saved resume to start learning from your own projects and skills.' }),
              fetchButton('Prepare resume topics', 'research:resume', new Date().toLocaleDateString('en-CA'), load)),
        data.resume?.previous_topics?.length ? h('p', { class: 'muted' }, `${data.resume.previous_topics.length} topics from an earlier resume are kept in your library. `, link('#/learning/library', 'Open saved material')) : null,
        data.courseError ? errorState('Course tracks could not be loaded. ' + data.courseError, load) : data.course?.tracks?.length ? h('details', { class: 'learn-course-browser' }, h('summary', { text: 'Browse your course tracks' }),
          h('div', { class: 'learn-resume-topics' }, data.course.tracks.map(track => link('#/learning/courses?track=' + encodeURIComponent(track.name), track.name)))) : null),
      h('div', { class: 'learn-section-heading' }, h('h2', { text: 'Your weekly roadmap' }), h('span', { text: data.next_day ? `Week ${data.current_week} · Day ${data.next_day}` : 'Curriculum completed' })),
      h('p', { class: 'muted', text: 'Weeks become available as you prepare your learning material. Missed days stay in your queue.' }),
      h('div', { class: 'learn-weeks' }, data.weeks.map(week => h('details', { class: 'learn-week', open: week === active },
        h('summary', {}, h('span', { text: String(week.number).padStart(2, '0'), class: 'learn-path-number' }), h('strong', { text: week.title }),
          h('span', { text: `${week.completed} / ${week.days.length} complete` })),
        h('ol', { class: 'plain-list' }, week.days.map(day => h('li', {}, h('span', { class: 'learn-day-number', text: `Day ${day.day}` }),
          day.available ? h('div', {}, link(day.route, day.title), day.resume_status === 'previous' ? h('small', { class: 'learn-material-source', text: 'Prepared for an earlier resume' }) : day.resume_status === 'unverified' ? h('small', { class: 'learn-material-source', text: 'Saved lesson · resume source not recorded' }) : null) : h('span', { text: 'Material not prepared yet', class: 'muted' }),
          h('span', { class: day.read ? 'learn-complete' : 'muted', text: day.read ? 'Complete' : day.day === data.next_day ? 'Up next' : day.available ? 'Ready' : 'Upcoming' })))),
        week === active && week.days.some(day => !day.read && (!day.available || day.resume_status !== 'current')) ? fetchButton('Prepare this week', 'learn', new Date().toLocaleDateString('en-CA'), load) : null))));
  }

  function drawDiscovery() {
    const selected = data.sections.find(section => section.key === query.get('tab')) || data.sections[0];
    const descriptions = { papers: 'Two papers each day, prioritizing AI and connections to your resume. Read the original work, save useful ideas, and keep your own notes.',
      tech: 'Explore recent tools, releases and engineering ideas. Turn one useful discovery into something you try this week.',
      companies: 'Discover teams and roles that fit your experience. Read the evidence and visit their careers pages.',
      repos: 'Find active repositories related to your skills and AI interests. Save a project to revisit or add one you found yourself.' };
    const nav = tabs(data.sections.map(section => [section.key, section.title]), selected.key, 'discover', 'tab');
    // Retain the selected archive date when changing categories.
    if (query.get('date')) nav.querySelectorAll('a').forEach(a => { a.href += '&date=' + encodeURIComponent(data.date); });
    const date = h('input', { class: 'input', type: 'date', value: data.date, 'aria-label': 'Discovery date', onchange: () => {
      if (date.value) location.hash = '#/learning/discover?' + new URLSearchParams({ tab: selected.key, date: date.value });
    } });
    root.append(nav, h('div', { class: 'learn-section-heading' }, h('div', {}, h('p', { class: 'eyebrow', text: selected.key === 'papers' ? 'DAILY READING · AI FIRST' : 'EXPLORE & KEEP LEARNING' }),
      h('h2', { text: selected.title }), h('p', { text: descriptions[selected.key] })), h('label', { class: 'learn-date' }, 'Research date', date)),
      h('div', { class: 'learn-actions' }, data.generation_available === false ? null : fetchButton(selected.available ? 'Refresh discoveries' : 'Find today’s discoveries', selected.group, data.date, load, { existing: selected.available }),
        selected.document ? link('#/learning/read/' + encodeURIComponent(selected.document) + '?from=discover', 'Open full briefing') : null,
        selected.key === 'repos' ? link('#/learning/bookmarks?kind=repo&add=1', 'Save a repository link') : null),
      h('p', { class: 'learn-source-note', text: data.generation_available === false ? data.generation_message : selected.available ? `Saved research for ${label(data.date + 'T12:00:00')}. Original sources are linked below.` : `No research saved for ${label(data.date + 'T12:00:00')} yet. Find discoveries to search the web with your configured research agents.` }),
      selected.items.length ? h('div', { class: 'learn-resource-grid' }, selected.items.map((item, index) => h('article', { class: 'learn-resource-card' },
        h('p', { class: 'eyebrow', text: selected.key === 'papers' ? `PAPER ${index + 1} OF 2` : bookmarkKinds[item.kind] }),
        h('h3', {}, link(item.url, item.title, 'learn-resource-title')), h('p', { text: item.excerpt }),
        h('div', { class: 'learn-resource-bottom' }, link(item.url, selected.key === 'companies' ? 'Explore source ↗' : 'Open original ↗'),
          discoveryCompletion(item), learningSave(item)))))
        : empty(data.generation_available === false ? 'Save links and notes in your private library while learning generation is being connected.' : selected.available ? 'Open the full briefing to read this saved research. Individual discoveries appear when the briefing includes linked sections.' : 'Your discoveries will appear here after research finishes.'),
      data.dates.length ? h('details', { class: 'learn-archive' }, h('summary', { text: 'Earlier discoveries' }), h('div', { class: 'learn-actions' }, data.dates.slice(0, 30).map(day => link(`#/learning/discover?tab=${selected.key}&date=${day}`, label(day + 'T12:00:00'))))) : null);
  }

  function discoveryCompletion(item) {
    const status = h('span', { class: 'muted', role: 'status' });
    const button = h('button', { class: 'btn btn-sm', type: 'button', text: item.read ? 'Reopen' : 'Mark as read', 'aria-label': `${item.read ? 'Reopen' : 'Mark as read:'} ${item.title}` });
    button.onclick = async () => {
      if (busy || !current()) return;
      busy = true; ++ticket;
      button.disabled = true;
      try {
        const result = await api('/api/learning/collection', { action: 'reading', id: item.id, document: item.document, date: data.date, read: !item.read });
        if (!current()) return;
        item.read = result.read;
        button.textContent = item.read ? 'Reopen' : 'Mark as read';
        button.setAttribute('aria-label', `${item.read ? 'Reopen' : 'Mark as read:'} ${item.title}`);
        feedback.textContent = item.read ? 'Reading saved in Progress.' : 'Reading reopened.';
      } catch (error) { if (current() && error.name !== 'AbortError') feedback.textContent = error.message; }
      finally { busy = false; if (current()) { button.disabled = false; load(); } }
    };
    return h('div', { class: 'learn-reading-action' }, button, status);
  }

  function drawBookmarks() {
    const kind = Object.hasOwn(bookmarkKinds, query.get('kind')) ? query.get('kind') : 'all';
    const nav = tabs([['all', 'All bookmarks'], ...Object.entries(bookmarkKinds)], kind, 'bookmarks', 'kind');
    const results = h('div', { class: 'learn-resource-grid' });
    const count = h('p', { class: 'muted', role: 'status' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search your bookmarks', 'aria-label': 'Search bookmarks', oninput: drawList });
    function drawList() {
      const items = data.bookmarks.filter(item => (kind === 'all' || item.kind === kind) && (item.title + ' ' + item.url).toLowerCase().includes(search.value.toLowerCase()));
      count.textContent = `${items.length} saved ${items.length === 1 ? 'link' : 'links'}`;
      results.replaceChildren(...(items.length ? items.map(item => h('article', { class: 'learn-resource-card' },
        h('p', { class: 'eyebrow', text: bookmarkKinds[item.kind] }), h('h2', {}, link(item.url, item.title, 'learn-resource-title')),
        h('p', { class: 'learn-url', text: item.url }), learningSave(item, true, saved => {
          if (!saved) { data.bookmarks = data.bookmarks.filter(entry => entry.id !== item.id); drawList(); feedback.textContent = 'Bookmark removed.'; }
        }))) : [empty('No bookmarks here yet. Save a paper, DSA question or repository, or add a link below.')]));
    }
    const form = h('form', { class: 'learn-link-form' });
    const title = h('input', { class: 'input', required: true, maxLength: 300, placeholder: 'A name to remember', 'aria-label': 'Bookmark title' });
    const url = h('input', { class: 'input', required: true, maxLength: 2048, placeholder: kind === 'repo' ? 'https://github.com/owner/repository' : 'https://…', 'aria-label': 'Bookmark link' });
    const category = h('select', { class: 'input', 'aria-label': 'Bookmark category' }, Object.entries(bookmarkKinds).map(([value, text]) => h('option', { value, text, selected: value === (kind === 'all' ? 'resource' : kind) })));
    const save = h('button', { class: 'btn btn-primary', type: 'submit', text: 'Save bookmark' });
    form.append(h('label', {}, 'Title', title), h('label', {}, 'Link', url), h('label', {}, 'Collection', category), save);
    form.onsubmit = async event => {
      event.preventDefault(); if (busy || !current()) return;
      busy = true; ++ticket; feedback.textContent = '';
      form.querySelectorAll('input, select, button').forEach(el => { el.disabled = true; });
      try {
        await api('/api/learning/collection', { action: 'bookmark', saved: true, kind: category.value, title: title.value, url: url.value });
        if (!current()) return;
        feedback.textContent = 'Bookmark saved to ' + bookmarkKinds[category.value].toLowerCase() + '.';
        title.value = ''; url.value = ''; dirty = false;
      } catch (error) { if (current() && error.name !== 'AbortError') feedback.textContent = 'Could not save. ' + error.message; }
      finally { busy = false; if (current()) { form.querySelectorAll('input, select, button').forEach(el => { el.disabled = false; }); if (!dirty) load(); } }
    };
    form.oninput = () => { dirty = true; };
    root.append(h('p', { class: 'learn-description', text: 'Keep useful discoveries close. Papers, practice questions and repositories each have their own collection.' }), nav, search, count, results,
      h('details', { class: 'learn-add-link', open: query.get('add') === '1' }, h('summary', { text: 'Add a link to your library' }), form));
    drawList();
  }

  function drawNotes() {
    const selected = data.notes.find(note => note.id === query.get('id'));
    draftKey = query.get('id') || 'new:' + (query.get('url') || '');
    if (query.get('id') && !selected && !draftStore.has(draftKey)) {
      root.append(empty('This note is no longer available.'), link('#/learning/notes?new=1', 'Create a new note', 'btn'));
      return;
    }
    editor = draftStore.get(draftKey) || (selected ? { ...selected } : { title: query.get('title') || '', body: '', url: query.get('url') || '', kind: query.get('kind') || 'resource', creation_token: crypto.randomUUID().replaceAll('-', '') });
    dirty = draftStore.has(draftKey);
    if (!Object.hasOwn(bookmarkKinds, editor.kind)) editor.kind = 'resource';
    const list = h('div', { class: 'learn-note-list' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Find a note', 'aria-label': 'Search notes', oninput: drawList });
    function drawList() {
      const matching = data.notes.filter(note => (note.title + ' ' + note.body).toLowerCase().includes(search.value.toLowerCase()));
      list.replaceChildren(...(matching.length ? matching.map(note => h('a', { href: '#/learning/notes?id=' + note.id, class: 'learn-note-link', 'aria-current': note.id === editor.id ? 'page' : null },
        h('strong', { text: note.title }), h('span', { text: bookmarkKinds[note.kind] + ' · ' + label(note.updated_at) }), h('p', { text: note.body.slice(0, 90) || 'No text yet' }))) : [h('p', { class: 'muted', text: 'No notes saved yet. Capture your first idea here.' })]));
    }
    const title = h('input', { class: 'input', value: editor.title, required: true, maxLength: 300, 'aria-label': 'Note title', placeholder: 'Give this idea a title' });
    const category = h('select', { class: 'input', 'aria-label': 'Note category' }, Object.entries(bookmarkKinds).map(([value, text]) => h('option', { value, text, selected: editor.kind === value })));
    const source = h('input', { class: 'input', value: editor.url, maxLength: 2048, 'aria-label': 'Note source link', placeholder: 'Optional paper, question or repository link' });
    const body = h('textarea', { class: 'input learn-note-body', value: editor.body, maxLength: 50000, 'aria-label': 'Note content', placeholder: 'What did you learn?\n\nExplain the idea in your own words, add an example, and leave yourself a question to revisit.' });
    const save = h('button', { class: 'btn btn-primary', type: 'submit', text: 'Save note' });
    const status = h('span', { class: 'muted', role: 'status', text: dirty ? 'Unsaved draft restored' : editor.id ? 'Saved · ' + label(editor.updated_at) : 'New note' });
    const remove = h('button', { class: 'btn', type: 'button', text: 'Delete note', hidden: !editor.id });
    const copy = h('button', { class: 'btn', type: 'button', text: 'Save draft as a new note', hidden: true });
    const form = h('form', { class: 'learn-note-editor' }, h('div', { class: 'learn-section-heading' }, h('h2', { text: editor.id ? 'Your note' : 'Capture an idea' }), status),
      h('label', {}, 'Title', title), h('div', { class: 'learn-note-meta' }, h('label', {}, 'Collection', category), h('label', {}, 'Source link', source)),
      h('label', {}, 'Your notes', body), h('div', { class: 'learn-actions' }, save, remove, copy));
    let confirmDelete = false;
    function remember() {
      editor = { ...editor, title: title.value, kind: category.value, url: source.value, body: body.value };
      dirty = true; draftStore.set(draftKey, { ...editor }); status.textContent = 'Unsaved changes';
      confirmDelete = false; remove.textContent = 'Delete note';
    }
    form.oninput = remember;
    async function persist(action) {
      if (busy || pendingStore.has(draftKey) || !current()) return;
      busy = true; ++ticket;
      const savedKey = draftKey, submitted = { ...editor };
      let finish, outcome = '';
      pendingStore.set(savedKey, new Promise(resolve => { finish = resolve; }));
      form.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = true; });
      feedback.textContent = '';
      try {
        const result = await api('/api/learning/collection', { ...submitted, action });
        if (scope.aborted) return;
        // The save can finish after navigation. Reconcile the shared draft even
        // when this view is gone, without erasing edits made in a newer view.
        const latest = draftStore.get(savedKey);
        if (!latest || JSON.stringify(latest) === JSON.stringify(submitted)) draftStore.delete(savedKey);
        else if (result.note) draftStore.set(savedKey, { ...latest, id: result.note.id, revision: result.note.revision });
        if (!current()) return;
        dirty = false;
        if (action === 'delete_note') { location.hash = '#/learning/notes'; return; }
        editor = result.note; status.textContent = 'Saved just now';
        feedback.textContent = 'Your note is saved.';
        if (query.get('id') !== editor.id) location.hash = '#/learning/notes?id=' + editor.id;
      } catch (error) { outcome = error.name === 'AbortError' ? '' : 'Could not save. ' + error.message; if (current() && error.name !== 'AbortError') {
        feedback.textContent = 'Could not save. ' + error.message;
        copy.hidden = !editor.id && !error.message.toLowerCase().includes('already saved');
      } }
      finally {
        pendingStore.delete(savedKey); finish(outcome);
        busy = false; if (current()) { form.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = false; }); if (!dirty) load(); }
      }
    }
    form.onsubmit = event => { event.preventDefault(); remember(); persist('note'); };
    copy.onclick = () => {
      remember();
      const { id, revision, created_at, updated_at, creation_token, ...content } = editor;
      editor = { ...content, creation_token: crypto.randomUUID().replaceAll('-', '') }; draftStore.set(draftKey, { ...editor });
      persist('note');
    };
    remove.onclick = () => {
      if (!confirmDelete) { confirmDelete = true; remove.textContent = 'Confirm delete'; return; }
      persist('delete_note');
    };
    root.append(h('p', { class: 'learn-description', text: 'Turn reading into understanding. Keep your own explanations, code ideas and questions beside the source.' }),
      h('div', { class: 'learn-notes-layout' }, h('aside', {}, link('#/learning/notes?new=1', 'New note', 'btn'), search, list), form));
    drawList();
    const pending = pendingStore.get(draftKey);
    if (pending) {
      form.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = true; });
      status.textContent = 'Your previous save is finishing…';
      pending.then(message => { if (current()) { feedback.textContent = message; dirty = false; load(); } });
    }
  }

  root.refresh = load;
  const beforeUnload = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  root.dispose = () => { disposed = true; ++ticket; window.removeEventListener('beforeunload', beforeUnload); scope.removeEventListener('abort', root.dispose); };
  scope.addEventListener('abort', root.dispose, { once: true });
  queueMicrotask(load);
  return root;
}
