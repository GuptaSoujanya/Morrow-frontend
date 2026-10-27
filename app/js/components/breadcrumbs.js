import { SECTIONS, routeHref } from '../router.js';

const labels = Object.fromEntries(SECTIONS.map(([key, label]) => [key, label]));
const botRoutes = new Set(['naukri', 'boards', 'sites', 'profile', 'linkedin', 'linkedin-profile', 'outreach', 'resume']);
const learning = { weekly: 'Your curriculum', discover: 'Discover', bookmarks: 'Bookmarks', notes: 'My notes', practice: 'Practice & exams', resume: 'Resume topics', courses: 'Courses', library: 'Saved library', progress: 'Progress', plan: 'Daily learning', dsa: 'DSA practice' };
const files = { profile: 'Your profile', answers: 'Screening answers', automation_answers: 'Agent answer sheet', company_sites: 'Company follow-ups', env: 'Settings' };
const boards = { naukri: 'Naukri', hirist: 'Hirist', instahyre: 'Instahyre', cutshort: 'Cutshort', wellfound: 'Wellfound', external: 'Company site' };
const outcomes = { submitted: 'Confirmed submissions', matched: 'Above match threshold', not_attempted: 'Not attempted' };
const flowGroups = { learn: 'Learning', brief: 'Daily briefing', research: 'Research', apply: 'Applications', profile: 'Profile updates' };
const libraryFilters = ['q', 'category', 'page', 'size', 'date'];
const recordFilters = ['kind', 'outcome', 'days', 'board', 'q', 'sort', 'page', 'size'];
const dataCategories = ['Research', 'Reports', 'Profile', 'Resumes', 'Automation', 'Drafts'];
const text = value => String(value || '').replace(/\s+/g, ' ').trim();
const humanize = value => text(value).replace(/\.md$/i, '').replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase());
function pick(query, keys) {
  return new URLSearchParams(keys.filter(key => query.get(key)).map(key => [key, query.get(key)]));
}
function href(name, arg = '', query = new URLSearchParams()) {
  return routeHref(name, arg) + (query.size ? '?' + query : '');
}
function dayLabel(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return humanize(day);
  const date = new Date(day + 'T12:00:00Z');
  return Number.isNaN(date.valueOf()) ? day : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Pure route hierarchy. Source filters are allowlisted, never interpreted as a return URL.
 * Every item, including the current page, has an internal destination. */
export function buildBreadcrumbs(route = { name: 'overview', arg: '' }, options = {}) {
  const { name, arg = '' } = route;
  const query = new URLSearchParams(options.query || '');
  const crumbs = [{ label: 'Home', href: '#/overview' }];
  const add = (label, target) => crumbs.push({ label: text(label), href: target });
  if (name === 'overview') return crumbs.map(item => ({ ...item, current: true }));
  if (!labels[name]) {
    // Keep an unknown current location inside the hash router; its only ancestor is Home.
    add('Page not found', '#/' + String(arg || 'not-found').split('/').map(encodeURIComponent).join('/'));
  } else {
    if (botRoutes.has(name)) add('Bot Crew', '#/bots');
    add(labels[name], routeHref(name));
    if (name === 'learning') {
      const [part, ...rest] = arg.split('/');
      if (part === 'read' && rest.length) {
        const id = rest.join('/');
        const fallback = id.startsWith('research/resume-learning/') ? 'resume' : 'today';
        const from = ['resume', 'library', 'progress', 'today', 'practice', 'weekly', 'discover'].includes(query.get('from')) ? query.get('from') : fallback;
        const filters = pick(query, libraryFilters);
        if (from !== 'today') add(learning[from], href('learning', from, ['library', 'progress'].includes(from) ? filters : new URLSearchParams()));
        filters.set('from', from);
        add(options.documentTitle || humanize(rest.at(-1)) || 'Saved reading', href('learning', arg, filters));
      } else if (learning[part]) {
        const sectionQuery = pick(query, ['library', 'progress'].includes(part) ? libraryFilters : part === 'courses' ? ['track'] : part === 'dsa' ? ['q', 'status'] : []);
        add(learning[part], href('learning', part));
        if (part === 'practice' && rest[0] === 'paper' && rest[1]) {
          add(options.paperTitle || 'Practice paper', href('learning', arg));
        } else if (part === 'dsa' && ['sheet', 'problem'].includes(rest[0])) {
          add('Practice sheet', href('learning', 'dsa/sheet', sectionQuery));
          if (rest[0] === 'problem' && rest[1]) add(options.problemTitle || humanize(rest.slice(1).join('/')) || 'DSA problem', href('learning', arg, sectionQuery));
        } else if (part === 'courses' && query.get('track')) {
          add(query.get('track'), href('learning', 'courses', sectionQuery));
        } else crumbs.at(-1).href = href('learning', part, sectionQuery);
      }
    } else if (name === 'boards') {
      const [board, mode] = arg.split('/');
      if (boards[board] && !['naukri', 'external'].includes(board)) {
        add(boards[board], routeHref(name, board));
        if (mode === 'profile') add('Profile update', routeHref(name, board + '/profile'));
      }
    } else if (name === 'files') {
      const key = Object.hasOwn(files, arg) && (options.legacyAccess !== false || !['env', 'automation_answers'].includes(arg)) ? arg : 'profile';
      add(files[key], routeHref(name, key));
    } else if (name === 'records') {
      const [legacyKind, legacyOutcome, legacyDays] = arg.split('/');
      const filters = pick(query, recordFilters);
      const kind = (query.get('kind') || legacyKind) === 'jobs' ? 'jobs' : 'applications';
      const outcome = query.get('outcome') || legacyOutcome || 'all';
      filters.set('kind', kind);
      filters.set('outcome', outcome);
      if (!filters.has('days') && ['0', '7', '14', '30'].includes(legacyDays)) filters.set('days', legacyDays);
      const parent = new URLSearchParams(filters);
      parent.delete('outcome'); parent.delete('page'); parent.delete('board');
      if (kind === 'jobs') add('Discovered jobs', href(name, '', parent));
      const board = query.get('board');
      if (boards[board]) { parent.set('board', board); add(boards[board], href(name, '', parent)); }
      if (outcome !== 'all') add(outcomes[outcome] || humanize(outcome), href(name, '', filters));
      else crumbs.at(-1).href = href(name, '', filters);
    } else if (name === 'reports' && arg) {
      add(dayLabel(arg), routeHref(name, arg));
    } else if (name === 'data') {
      const filters = pick(query, ['category', 'q', 'page', 'size']);
      const category = query.get('category') || (arg === 'resumes' ? 'Resumes' : '');
      if (dataCategories.includes(category)) {
        filters.set('category', category);
        add(category, href(name, '', filters));
      } else { filters.delete('category'); crumbs.at(-1).href = href(name, '', filters); }
    } else if (name === 'pipeline' && arg) {
      // Named stage IDs are accepted by the flow view, in addition to these groups.
      add(flowGroups[arg] || humanize(arg.replaceAll(':', ' / ')), href(name, arg, pick(query, ['date'])));
    }
  }
  return crumbs.map((item, index) => ({ ...item, current: index === crumbs.length - 1 }));
}
