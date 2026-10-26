import { h } from '../dom.js';
import { S, hooks } from '../state.js';
import { SECTIONS, routeHref, parseHash } from '../router.js';
import { navigationGroups, routeLabel, routeAccess } from '../access-policy.js';
import { availableLearningSections } from '../learning-sections.js';
import { navigationArt } from './navigation-art.js';
import { buildBreadcrumbs } from './breadcrumbs.js';

const sectionDescriptions = {
  overview: 'Your career at a glance', bots: 'Choose your specialists', pipeline: 'Build and follow a workflow',
  todo: 'Questions and next steps', records: 'Find applications and opportunities', learning: 'Practice, read, and keep growing',
  data: 'Your saved workspace files', analytics: 'Explore your application results', reports: 'Read your daily summaries',
  files: 'Your profile, resume, and answers', connections: 'Manage connected platforms', setup: 'Make Morrow work for you',
};
let installed = false;

export function openWorkspaceSearch() {
  if (document.querySelector('dialog[open], .workspace-search-dialog')) return;
  const previous = document.activeElement;
  let navigated = false, active = 0;
  const routes = navigationGroups(S, { includeBotControls: true }).flatMap(([, names]) => names);
  const items = [...new Set(routes)].map(key => {
    const section = SECTIONS.find(([name]) => name === key);
    return { key, title: routeLabel(key, S) || section[1], description: sectionDescriptions[key] || 'Open workspace tool', href: routeHref(key) };
  });
  if (routes.includes('learning')) items.push(...availableLearningSections().filter(section => section.key !== 'today').map(section => ({
    key: 'learning', learningSection: section.key, title: section.label, description: 'Learning · ' + section.description, href: section.path,
  })));
  const dialog = h('dialog', { class: 'workspace-search-dialog', 'aria-labelledby': 'workspace-search-title' });
  const results = h('div', { class: 'workspace-search-results', id: 'workspace-search-results' });
  const status = h('p', { class: 'workspace-search-status', role: 'status' });
  const selectionStatus = h('span', { class: 'visually-hidden', role: 'status' });
  const input = h('input', { type: 'search', placeholder: 'Where would you like to go?', 'aria-label': 'Search workspace', autocomplete: 'off' });
  const dismiss = () => dialog.close();
  function highlight(index) {
    const links = [...results.querySelectorAll('a')];
    active = Math.max(0, Math.min(index, links.length - 1));
    links.forEach((link, i) => link.classList.toggle('is-active', i === active));
    links[active]?.scrollIntoView({ block: 'nearest' });
    selectionStatus.textContent = links[active]?.textContent || '';
  }
  function draw() {
    const query = input.value.trim().toLowerCase();
    const matches = items.filter(item => (item.title + ' ' + item.description).toLowerCase().includes(query));
    const options = matches.slice(0, 12);
    if (query && ['allowed', 'runtime'].includes(routeAccess('records', S).kind)) options.push({
      title: `Search applications for “${input.value.trim()}”`, description: 'Search your saved application records',
      key: 'records', href: '#/records', search: input.value.trim(),
    });
    results.replaceChildren(...options.map(item => h('a', { class: 'workspace-search-result', href: item.href, onclick: () => {
      if (item.search) { S.pendingRecordQuery = item.search; if (location.hash === item.href) hooks.requestRender?.(true); }
      navigated = true; dismiss();
    } }, navigationArt(item.key, 'workspace-result-art', item.learningSection),
    h('span', {}, h('strong', { text: item.title }), h('small', { text: item.description })))));
    if (!options.length) results.append(h('p', { class: 'workspace-search-empty', text: 'No matching pages. Try “learning”, “profile”, or “applications”.' }));
    status.textContent = query ? `${options.length} ${options.length === 1 ? 'result' : 'results'}` : 'QUICK NAVIGATION';
    highlight(0);
  }
  input.addEventListener('input', draw);
  input.addEventListener('keydown', event => {
    // Search inputs otherwise consume the first Escape to clear their value.
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); highlight(active + (event.key === 'ArrowDown' ? 1 : -1)); }
    if (event.key === 'Enter') { event.preventDefault(); results.querySelectorAll('a')[active]?.click(); }
  });
  dialog.append(h('div', { class: 'workspace-search-heading' }, h('h2', { id: 'workspace-search-title', text: 'Find your next step' }),
    h('button', { type: 'button', class: 'btn workspace-search-close', 'aria-label': 'Close workspace search', text: 'Close', onclick: dismiss })),
  h('div', { class: 'workspace-search-input' }, navigationArt('search', 'workspace-search-art'), input), status, results, selectionStatus,
  h('div', { class: 'workspace-search-foot' }, h('span', { text: '↑ ↓ to explore · Enter to open' }), h('span', {}, h('kbd', { text: 'Esc' }), ' to close')));
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
  } });
  dialog.addEventListener('close', () => { dialog.remove(); if (!navigated) (previous?.isConnected ? previous : document.querySelector('.workspace-search-trigger'))?.focus({ preventScroll: true }); });
  document.body.append(dialog); draw(); dialog.showModal(); input.focus();
}

export function renderWorkspaceHeader() {
  const header = document.getElementById('workspace-header');
  if (!header) return;
  const groups = navigationGroups(S);
  if (!groups.length) { document.querySelector('.workspace-search-dialog')?.close(); header.replaceChildren(); delete header.dataset.signature; return; }
  if (!installed) {
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey && !document.body.matches('.auth-screen,.auth-pending')) {
        event.preventDefault(); openWorkspaceSearch();
      }
    });
    // Saved reading titles arrive asynchronously, and filter controls update history
    // without a hashchange. Refresh just this small header when their content changes.
    let queued = false;
    const refresh = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; renderWorkspaceHeader(); });
    };
    const content = document.getElementById('content');
    if (content) new MutationObserver(refresh).observe(content, { childList: true, subtree: true, characterData: true });
    window.addEventListener('hashchange', refresh);
    window.addEventListener('popstate', refresh);
    installed = true;
  }
  const crumbs = buildBreadcrumbs(parseHash(location.hash), {
    query: location.hash.split('?')[1] || '', legacyAccess: S.legacyAccess,
    documentTitle: document.querySelector('#content .learning-library-reading-head h2')?.textContent,
    paperTitle: document.querySelector('#content .practice-paper-head h2')?.textContent,
    problemTitle: document.querySelector('#content .dsa-sheet .daily-workspace-head h2')?.textContent,
  });
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  const signature = JSON.stringify([crumbs, shortcut]);
  if (header.dataset.signature === signature) return;
  header.dataset.signature = signature;
  const previous = header.contains(document.activeElement) ? document.activeElement : null;
  const wasSearch = previous?.classList.contains('workspace-search-trigger');
  const wasCurrent = previous?.getAttribute('aria-current') === 'page';
  header.replaceChildren(
    h('nav', { class: 'workspace-breadcrumb', 'aria-label': 'Breadcrumb' },
      h('ol', { class: 'workspace-breadcrumb-list' }, crumbs.map((crumb, index) => h('li', {},
        index ? h('span', { class: 'breadcrumb-separator', text: '/', 'aria-hidden': 'true' }) : null,
        h('a', { href: crumb.href, text: crumb.label, class: crumb.current ? 'workspace-breadcrumb-current' : null, 'aria-current': crumb.current ? 'page' : null }))))),
    h('button', { class: 'workspace-search-trigger', type: 'button', 'aria-label': `Search ${shortcut}: your workspace`, 'aria-keyshortcuts': 'Meta+K Control+K', onclick: openWorkspaceSearch },
      navigationArt('search', 'workspace-search-art'), h('span', { text: 'Search' }), h('kbd', { text: shortcut, 'aria-hidden': 'true' })));
  if (previous) {
    const replacement = wasSearch ? header.querySelector('.workspace-search-trigger')
      : wasCurrent ? header.querySelector('[aria-current="page"]')
      : [...header.querySelectorAll('a')].find(link => link.getAttribute('href') === previous.getAttribute('href'));
    replacement?.focus({ preventScroll: true });
  }
}
