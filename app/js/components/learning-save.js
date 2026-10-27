import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';

export const bookmarkKinds = { paper: 'Research papers', dsa: 'DSA questions', repo: 'GitHub repositories', resource: 'Other resources' };
export function noteHref(item) {
  return '#/learning/notes?' + new URLSearchParams({ new: '1', title: item.title, kind: item.kind || 'resource', url: item.url || '' });
}
function normalized(url) {
  return url.replace(/^https?:\/\/(?:www\.)?arxiv.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?\/?$/, 'https://arxiv.org/abs/$1')
    .replace(/^https?:\/\/(?:www\.)?github.com\/([^/?#]+\/[^/?#]+)\/?$/, (_, path) => 'https://github.com/' + path.replace(/\.git$/, '').toLowerCase());
}

export function learningSave(item, initial, onChange) {
  const scope = accountRequestSignal();
  let saved = initial, busy = false;
  const feedback = h('span', { class: 'learning-save-feedback', role: 'status' });
  const button = h('button', { class: 'btn btn-sm', type: 'button', disabled: initial === undefined });
  const root = h('div', { class: 'learning-save-actions' }, button,
    h('a', { class: 'text-link', href: noteHref(item), text: 'Add note', 'aria-label': 'Add note for ' + item.title }), feedback);
  const current = () => !scope.aborted && root.isConnected;
  function draw() {
    button.textContent = saved ? 'Remove bookmark' : 'Bookmark';
    button.setAttribute('aria-pressed', String(!!saved));
    button.setAttribute('aria-label', `${saved ? 'Remove bookmark for' : 'Bookmark'} ${item.title}`);
    button.disabled = busy;
  }
  async function load() {
    try {
      const data = await api('/api/learning/collection');
      if (!current()) return;
      saved = data.bookmarks.some(entry => entry.kind === item.kind && normalized(entry.url) === normalized(item.url));
      draw();
    } catch (error) {
      if (!current() || error.name === 'AbortError') return;
      feedback.textContent = 'Could not load bookmarks. Click to retry.';
      button.textContent = 'Retry bookmarks'; button.disabled = false;
    }
  }
  button.onclick = async () => {
    if (!current() || busy) return;
    if (saved === undefined) { button.disabled = true; await load(); return; }
    busy = true; button.disabled = true; feedback.textContent = '';
    try {
      const result = await api('/api/learning/collection', { action: 'bookmark', ...item, saved: !saved });
      if (!current()) return;
      saved = result.saved;
      feedback.textContent = saved ? 'Saved to ' + bookmarkKinds[item.kind].toLowerCase() + '.' : 'Bookmark removed.';
      onChange?.(saved);
    } catch (error) { if (current() && error.name !== 'AbortError') feedback.textContent = 'Could not save. ' + error.message; }
    finally { busy = false; if (current()) draw(); }
  };
  if (initial === undefined) { button.textContent = 'Loading bookmark…'; queueMicrotask(load); }
  else draw();
  return root;
}
