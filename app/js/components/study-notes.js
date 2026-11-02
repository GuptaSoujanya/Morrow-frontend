import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';
import { S } from '../state.js';

const stores = new WeakMap();
const PREFIX = 'morrow.study-notes.v1:';
const KINDS = new Set(['paper', 'dsa', 'repo', 'resource']);
let nextId = 0;

function owner() {
  if (S.accountMode === 'local') return 'local';
  if (S.accountMode === 'accounts' && ['string', 'number'].includes(typeof S.user?.id) && String(S.user.id)) return 'account:' + S.user.id;
  return null;
}

function canonicalUrl(value, sourceId) {
  const raw = value || '#/learning/read/' + encodeURIComponent(sourceId);
  if (typeof raw !== 'string' || raw.length > 2048 || /[\s\\\u0000-\u001f]/.test(raw)) throw new Error('Choose a valid note source.');
  if (raw.startsWith('#/learning/')) {
    let [path, search = ''] = raw.split('?');
    if (path.startsWith('#/learning/read/')) {
      try { path = '#/learning/read/' + encodeURIComponent(decodeURIComponent(path.slice('#/learning/read/'.length))); } catch { /* Keep literal malformed escapes for a stable comparison. */ }
    }
    const query = new URLSearchParams(search);
    for (const key of ['from', 'part', 'stage']) query.delete(key);
    query.sort();
    return path + (query.size ? '?' + query : '');
  }
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Choose a valid note source.');
  return url.href;
}

function note(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 300
      || typeof value.body !== 'string' || value.body.length > 50000
      || typeof value.url !== 'string' || value.url.length > 2048 || !KINDS.has(value.kind)) return null;
  const result = { title: value.title, body: value.body, kind: value.kind, url: value.url };
  if (value.id !== undefined) {
    if (typeof value.id !== 'string' || !/^[a-f0-9]{32}$/.test(value.id)
        || !Number.isInteger(value.revision) || value.revision < 1) return null;
    Object.assign(result, { id: value.id, revision: value.revision });
  } else if (typeof value.creation_token === 'string' && /^[a-f0-9]{32}$/.test(value.creation_token)) {
    result.creation_token = value.creation_token;
  }
  if (typeof value.updated_at === 'string') result.updated_at = value.updated_at;
  return result;
}

function token() { return crypto.randomUUID().replaceAll('-', ''); }

function storeFor(scope, namespace) {
  if (!stores.has(scope)) stores.set(scope, { owner: namespace, entries: new Map() });
  const store = stores.get(scope);
  return store.owner === namespace ? store : null;
}

function remember(entry) {
  if (entry.scope.aborted || owner() !== entry.owner) return;
  try {
    if (entry.dirty) {
      globalThis.sessionStorage.setItem(entry.storageKey, JSON.stringify({ version: 1, sourceUrl: entry.sourceUrl,
        editor: entry.editor, baseBody: entry.baseBody, dirty: true }));
    } else globalThis.sessionStorage.removeItem(entry.storageKey);
    entry.persisted = true;
  } catch { entry.persisted = false; }
}

function announce(entry) { for (const update of entry.listeners) update(); }

function matchesSource(saved, sourceUrl) {
  try { return canonicalUrl(saved.url) === sourceUrl; } catch { return false; }
}

function adopt(entry, saved) {
  entry.editor = saved;
  entry.baseBody = saved.body;
  entry.dirty = false;
  entry.conflict = null;
  entry.error = '';
  entry.message = 'Saved note loaded.';
  remember(entry);
}

function reconcile(entry, saved, byId) {
  if (!entry.dirty) {
    if (saved) adopt(entry, saved);
    else if (entry.editor.id) {
      entry.editor = { title: entry.title, body: '', kind: entry.kind, url: entry.sourceUrl, creation_token: token() };
      entry.baseBody = '';
      entry.message = 'Start a note for this lesson.';
    }
    return;
  }
  if (saved && saved.body === entry.editor.body.trim()) { adopt(entry, saved); return; }
  if (entry.editor.id) {
    if (!byId) entry.conflict = { latest: null, message: 'The saved note was removed. Your draft is still here.' };
    else if (byId.revision !== entry.editor.revision) entry.conflict = { latest: byId, message: 'This note changed in another window. Your draft is still here.' };
    else entry.conflict = null;
  } else if (saved) {
    entry.conflict = { latest: saved, message: 'A saved note already exists for this lesson. Your draft is still here.' };
  } else entry.conflict = null;
  remember(entry);
}

async function load(entry) {
  if (entry.scope.aborted || owner() !== entry.owner) return;
  if (entry.loading) return entry.loading;
  if (entry.saving) { await entry.saving; return; }
  entry.error = '';
  entry.message = 'Loading your saved note…';
  const task = (async () => {
    try {
      // The existing collection API has no source filter. Keep only this
      // source's matching note; unrelated notes never enter component state.
      const result = await api('/api/learning/collection', undefined, { fresh: true, signal: entry.scope });
      if (entry.scope.aborted || owner() !== entry.owner) return;
      if (!Array.isArray(result.notes)) throw new Error('The server did not return a valid notes collection.');
      const notes = result.notes;
      const candidate = entry.editor.id ? notes.find(item => item?.id === entry.editor.id) : null;
      const moved = candidate && !matchesSource(candidate, entry.sourceUrl);
      // An existing ID alone is insufficient: the source can be edited from
      // All notes. Never adopt or overwrite a note now attached elsewhere.
      const byId = candidate && !moved ? note(candidate) : null;
      const matching = notes.filter(item => matchesSource(item, entry.sourceUrl))
        .sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0));
      const saved = byId || matching.map(note).find(Boolean) || null;
      if ((candidate && !moved && !byId) || (matching.length && !saved)) throw new Error('This saved note could not be read safely.');
      entry.loaded = true;
      if (moved && entry.dirty) {
        entry.conflict = { latest: null, message: 'This note was moved to another source. Your draft is still here; save a separate note for this lesson.' };
        remember(entry);
      } else reconcile(entry, saved, byId);
      if (!entry.conflict) entry.message = entry.dirty ? 'Draft restored. Save it when you are ready.'
        : saved ? 'Saved note loaded.' : 'Start a note for this lesson.';
    } catch (error) {
      if (entry.scope.aborted || error.name === 'AbortError') return;
      entry.error = 'Could not load your saved note. Your draft is kept. ' + error.message;
      entry.loaded = false;
    } finally {
      entry.loading = null;
      announce(entry);
    }
  })();
  entry.loading = task;
  announce(entry);
  return task;
}

function isConflict(error) {
  return error.status === 409 || /changed in another window|no longer exists|already saved/i.test(error.message || '');
}

async function persist(entry, mode = 'save') {
  if (entry.scope.aborted || owner() !== entry.owner || entry.saving || entry.loading || !entry.loaded) return;
  if (entry.conflict && mode === 'save') return;
  if (!entry.editor.id && !entry.editor.body.trim()) return;
  if (mode === 'replace') {
    const latest = entry.conflict?.latest;
    if (!latest) return;
    entry.editor = { ...latest, body: entry.editor.body };
    entry.baseBody = latest.body;
  } else if (mode === 'copy') {
    entry.editor = { title: entry.title.slice(0, 293) + ' (copy)', kind: entry.kind, url: entry.sourceUrl,
      body: entry.editor.body, creation_token: token() };
    entry.baseBody = '';
  }
  entry.conflict = null;
  entry.error = '';
  entry.dirty = true;
  remember(entry);
  const submitted = { ...entry.editor };
  if (!submitted.id && !submitted.creation_token) {
    submitted.creation_token = token(); entry.editor.creation_token = submitted.creation_token; remember(entry);
  }
  let conflict = false;
  entry.message = 'Saving your note…';
  const task = (async () => {
    try {
      const result = await api('/api/learning/collection', { ...submitted, action: 'note' }, { signal: entry.scope });
      if (entry.scope.aborted || owner() !== entry.owner) return;
      const saved = note(result.note);
      if (!saved?.id) throw new Error('The server did not confirm a saved note.');
      // Reconcile shared scoped state after route cleanup too. A new instance
      // can be typing while this finishes; preserve those newer edits.
      const changed = entry.editor.body !== submitted.body;
      entry.editor = changed ? { ...saved, body: entry.editor.body } : saved;
      entry.baseBody = saved.body;
      entry.dirty = changed;
      entry.message = changed ? 'Saved. Your newer changes are kept as a draft.' : 'Saved to My notes.';
      remember(entry);
    } catch (error) {
      if (entry.scope.aborted || error.name === 'AbortError') return;
      entry.error = 'Could not save. Your draft is kept. ' + error.message;
      conflict = isConflict(error);
      if (conflict) entry.conflict = { latest: null, message: 'The saved note changed. Your draft is still here.' };
      remember(entry);
    } finally {
      entry.saving = null;
      announce(entry);
    }
    if (conflict && !entry.scope.aborted) await load(entry);
  })();
  entry.saving = task;
  announce(entry);
  return task;
}

/** Quick notes for one canonical lesson source. Call dispose on route cleanup. */
export function studyNotes({ sourceId, sourceTitle, category = 'resource', sourceUrl } = {}) {
  if (typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 500) throw new Error('A lesson source is required for quick notes.');
  const scope = accountRequestSignal(), namespace = owner();
  const url = canonicalUrl(sourceUrl, sourceId);
  const kind = KINDS.has(String(category).toLowerCase()) ? String(category).toLowerCase() : 'resource';
  const title = ('Notes: ' + (String(sourceTitle || sourceId).trim() || sourceId)).slice(0, 300);
  const key = JSON.stringify([sourceId, url]);
  const storageKey = PREFIX + encodeURIComponent(namespace || 'unavailable') + ':' + encodeURIComponent(key);
  const store = namespace ? storeFor(scope, namespace) : null;
  let entry = store?.entries.get(key);
  if (!entry) {
    entry = { scope, owner: namespace, sourceUrl: url, title, kind, storageKey,
      editor: { title, body: '', kind, url, creation_token: token() }, baseBody: '',
      dirty: false, persisted: true, loaded: false, loading: null, saving: null,
      conflict: null, error: '', message: 'Loading your saved note…', listeners: new Set() };
    if (namespace && !scope.aborted) {
      try {
        const raw = globalThis.sessionStorage.getItem(storageKey);
        const saved = raw && raw.length <= 210000 ? JSON.parse(raw) : null;
        const restored = saved?.version === 1 && saved.sourceUrl === url && saved.dirty === true ? note(saved.editor) : null;
        if (restored && matchesSource(restored, url) && typeof saved.baseBody === 'string' && saved.baseBody.length <= 50000) {
          entry.editor = restored; entry.baseBody = saved.baseBody; entry.dirty = true;
          entry.message = 'Draft restored. Save it when you are ready.';
        }
      } catch { entry.persisted = false; }
      store?.entries.set(key, entry);
    }
  }
  const id = `study-notes-${++nextId}`;
  let disposed = false;
  const summaryState = h('span', { class: 'study-notes-summary-state', text: entry.dirty ? 'Draft' : 'Loading' });
  const textarea = h('textarea', { id: `${id}-body`, class: 'input study-notes-textarea', rows: 11,
    maxLength: 50000, value: entry.editor.body, placeholder: 'Write the idea in your own words. Add an example or a question to revisit.',
    'aria-describedby': `${id}-hint ${id}-status` });
  const hint = h('p', { id: `${id}-hint`, class: 'study-notes-hint' });
  const status = h('p', { id: `${id}-status`, class: 'study-notes-status', role: 'status', 'aria-live': 'polite' });
  const save = h('button', { type: 'submit', class: 'btn btn-primary study-notes-save', text: 'Save note' });
  const retry = h('button', { type: 'button', class: 'btn study-notes-retry', text: 'Retry loading', hidden: true });
  const copy = h('button', { type: 'button', class: 'btn study-notes-copy', text: 'Save as a separate note', hidden: true });
  const latest = h('textarea', { class: 'input study-notes-saved-version', readOnly: true, rows: 6, 'aria-label': 'Saved version' });
  const replace = h('button', { type: 'button', class: 'btn study-notes-replace', text: 'Replace saved version with my draft' });
  const comparison = h('details', { class: 'study-notes-conflict', hidden: true },
    h('summary', { text: 'Compare the saved version' }), latest,
    h('p', { text: 'This will replace the saved text with the draft above.' }), replace);
  const form = h('form', { class: 'study-notes-form' },
    h('p', { class: 'study-notes-context', text: String(sourceTitle || sourceId) }),
    h('label', { for: `${id}-body`, text: 'Notes for this lesson' }), textarea, hint, status, comparison,
    h('div', { class: 'study-notes-actions' }, save, retry, copy,
      h('a', { class: 'text-link study-notes-all', href: '#/learning/notes', text: 'All notes' })));
  const panel = h('details', { class: 'study-notes-panel', open: window.matchMedia('(min-width: 1120px)').matches },
    h('summary', {}, h('span', { class: 'study-notes-summary-label', text: 'Quick notes' }), summaryState), form);
  const root = h('aside', { class: 'study-notes', 'aria-label': 'Quick notes', 'data-note-source': sourceId }, panel);
  const current = () => !disposed && !scope.aborted && namespace !== null && owner() === namespace && root.isConnected;

  function draw() {
    if (!current()) return;
    if (textarea.value !== entry.editor.body) textarea.value = entry.editor.body;
    const pending = Boolean(entry.saving || entry.loading);
    save.disabled = pending || !entry.loaded || Boolean(entry.conflict) || !entry.dirty || (!entry.editor.id && !entry.editor.body.trim());
    save.textContent = entry.saving ? 'Saving…' : 'Save note';
    summaryState.textContent = entry.saving ? 'Saving' : entry.conflict ? 'Review draft' : entry.error ? 'Not saved'
      : entry.dirty ? 'Draft' : entry.loading ? 'Loading' : entry.editor.id ? 'Saved' : 'For this lesson';
    status.textContent = entry.error || entry.conflict?.message || entry.message;
    status.dataset.state = entry.error || entry.conflict ? 'error' : entry.dirty ? 'draft' : entry.editor.id ? 'saved' : 'empty';
    hint.textContent = entry.persisted
      ? 'Draft stays in this tab. Save to add it to My notes. Ctrl or ⌘ + Enter saves.'
      : 'Draft stays while this page is open. Save before reloading. Ctrl or ⌘ + Enter saves.';
    retry.hidden = !entry.error && !entry.conflict;
    retry.disabled = pending;
    retry.textContent = entry.loaded ? 'Check saved note' : 'Retry loading';
    copy.hidden = !entry.conflict;
    copy.disabled = pending || !entry.editor.body.trim();
    comparison.hidden = !entry.conflict?.latest;
    latest.value = entry.conflict?.latest?.body || '';
    replace.disabled = pending || !entry.conflict?.latest;
  }

  function edited() {
    if (!current()) return;
    entry.editor = { ...entry.editor, body: textarea.value };
    entry.dirty = textarea.value !== entry.baseBody || Boolean(entry.conflict);
    entry.message = entry.dirty ? 'Draft kept in this tab. Save when you are ready.' : entry.editor.id ? 'No unsaved changes.' : 'Start a note for this lesson.';
    if (!entry.conflict && entry.loaded) entry.error = '';
    remember(entry); announce(entry);
  }
  textarea.addEventListener('input', edited);
  textarea.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      if (current() && !save.disabled) persist(entry);
    }
  });
  form.addEventListener('submit', event => { event.preventDefault(); if (current() && !save.disabled) persist(entry); });
  retry.addEventListener('click', () => { if (current()) load(entry); });
  copy.addEventListener('click', () => { if (current()) persist(entry, 'copy'); });
  replace.addEventListener('click', () => { if (current()) persist(entry, 'replace'); });
  entry.listeners.add(draw);
  const beforeUnload = event => {
    if (current() && entry.dirty && !entry.persisted) { event.preventDefault(); event.returnValue = ''; }
  };
  const aborted = () => { textarea.value = ''; latest.value = ''; status.textContent = ''; root.dispose(); };
  window.addEventListener('beforeunload', beforeUnload);
  scope.addEventListener('abort', aborted, { once: true });
  root.hasDraft = () => !scope.aborted && namespace === owner() && Boolean(entry.dirty || entry.saving);
  root.refresh = () => { if (current()) return load(entry); };
  root.dispose = () => {
    if (disposed) return;
    disposed = true;
    entry.listeners.delete(draw);
    window.removeEventListener('beforeunload', beforeUnload);
    scope.removeEventListener('abort', aborted);
  };
  queueMicrotask(() => {
    if (disposed) return;
    if (!namespace || scope.aborted || owner() !== namespace) {
      textarea.disabled = true; save.disabled = true; status.textContent = 'Open your account to use notes.';
      summaryState.textContent = 'Unavailable'; return;
    }
    draw();
    // Async views may attach this node after this microtask. Loading is scoped
    // to the account, while draw() separately guards connected DOM updates.
    load(entry);
  });
  return root;
}
