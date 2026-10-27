import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';
import { S } from '../state.js';

export function learningHeader(view) {
  const scope = accountRequestSignal();
  const root = h('div', { class: 'learn-header-context', 'aria-label': 'Learning overview' });
  if (!S.legacyAccess && S.user?.role !== 'admin' && !S.user?.modules?.includes('learning')) return root;
  let disposed = false, ticket = 0;
  async function refresh() {
    const request = ++ticket;
    try {
      const data = await api('/api/learning/overview', undefined, { fresh: true });
      if (disposed || scope.aborted || !root.isConnected || request !== ticket) return;
      const focus = data.profile?.target_roles?.[0] || data.profile?.focus || data.profile?.skills?.slice(0, 2).join(' · ');
      const showPlan = data.generation_available !== false && data.profile?.resume_available && data.current_day;
      root.replaceChildren(...[
        focus ? h('span', { class: 'learn-header-focus', title: focus },
          h('span', { class: 'learn-header-label', text: 'Focus' }), h('strong', { text: focus })) : null,
        h('time', { dateTime: data.date, text: new Date(data.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) }),
        showPlan ? h('span', { class: 'learn-header-plan', text: `Day ${data.current_day} · Week ${data.current_week}` }) : null,
        h('a', { href: view === 'progress' ? '#/learning' : '#/learning/progress', text: view === 'progress' ? 'Back to learning →' : 'View progress →' })].filter(Boolean));
    } catch (error) {
      if (!disposed && !scope.aborted && root.isConnected && request === ticket && error.name !== 'AbortError') {
        root.replaceChildren(h('span', { text: 'Learning summary unavailable' }), h('button', { type: 'button', class: 'text-link', text: 'Retry summary', onclick: refresh }));
      }
    }
  }
  const changed = () => refresh();
  window.addEventListener('learning-updated', changed);
  root.refresh = refresh;
  root.dispose = () => { disposed = true; ++ticket; window.removeEventListener('learning-updated', changed); scope.removeEventListener('abort', root.dispose); };
  scope.addEventListener('abort', root.dispose, { once: true });
  queueMicrotask(refresh);
  return root;
}

export function learningProfileCard(profile) {
  if (!profile) return null;
  const focus = profile.target_roles?.[0] ? `Preparing for ${profile.target_roles[0]}`
    : profile.focus || profile.goal || profile.skills?.slice(0, 3).join(' · ');
  const guidance = profile.resume_available
    ? 'Add your skills and target role to personalize your learning.'
    : 'Add your resume to personalize your learning.';
  return h('section', { class: 'learn-profile-card learn-profile-compact', 'aria-label': 'Your learning focus' },
    h('div', { class: 'learn-profile-main' },
      h('p', { class: 'learn-profile-label', text: 'Your focus', title: profile.source_label || '' }),
      h('h2', { text: focus || guidance }),
      profile.skills?.length ? h('div', { class: 'learn-skill-chips', 'aria-label': 'Skills guiding your learning' },
        profile.skills.slice(0, 5).map(skill => h('span', { text: skill }))) : null),
    h('a', { class: 'text-link learn-profile-edit', href: S.legacyAccess ? '#/setup' : '#/onboarding',
      text: profile.resume_available ? 'Edit focus →' : 'Add resume →' }));
}

export function individualProgress(data) {
  if (!data) return null;
  const metrics = [
    [data.total_completions, 'Activities logged'], [data.solved_problems, 'DSA problems solved'],
    [data.notes, 'Notes'], [data.bookmarks, 'Bookmarks'],
  ];
  const week = data.week || [];
  const maximum = Math.max(1, ...week.map(day => day.count));
  const weekCount = week.reduce((n, day) => n + day.count, 0);
  return h('div', { class: 'learn-progress-overview learn-progress-refined' },
    h('section', { class: 'learn-progress-intro', 'aria-label': 'Learning totals' },
      h('dl', { class: 'learn-progress-stats' }, metrics.map(([value, text]) => h('div', {},
        h('dt', { text }), h('dd', { text: value ?? 0 }))))),
    h('section', { class: 'learn-track-section', 'aria-label': 'Progress by learning area' },
      h('div', { class: 'learn-section-heading' }, h('h2', { text: 'Progress by area' }), h('span', { text: 'Completed / total' })),
      h('div', { class: 'learn-progress-tracks' }, data.tracks.map(track => h('a', { class: 'learn-progress-track learn-progress-row', href: track.route, 'data-progress-area': track.key },
        h('div', { class: 'learn-progress-area-label' }, h('h3', { text: track.title }),
          h('p', { text: track.total ? track.unit : 'No saved material yet' })),
        h('div', { class: 'learn-area-meter' },
          h('span', { class: 'learn-area-count' }, h('strong', { text: track.completed }), ` / ${track.total}`),
          h('progress', { value: track.completed, max: Math.max(1, track.total), 'aria-label': `${track.title}: ${track.completed} of ${track.total} ${track.unit}` })),
        h('span', { class: 'learn-area-status', text: track.total ? `${track.percent}%` : 'Not started' }),
        h('span', { class: 'learn-area-arrow', 'aria-hidden': 'true', text: '→' }))))),
    h('section', { class: 'learn-progress-week', 'aria-label': 'Weekly learning activity' },
      h('div', { class: 'learn-week-caption' }, h('h2', { text: 'Last 7 days' }),
        h('p', {}, h('strong', { text: weekCount }), ` ${weekCount === 1 ? 'activity' : 'activities'} logged`)),
      h('div', { class: 'learn-week-chart', role: 'list', 'aria-label': 'Activities logged each day' }, week.map(day => h('div', {
        class: 'learn-chart-day', role: 'listitem', 'aria-label': `${day.date}: ${day.count} activities logged` },
        h('strong', { text: day.count }), h('div', { class: 'learn-chart-column', 'aria-hidden': 'true' }, h('span', { style: { height: `${day.count / maximum * 100}%` } })),
        h('time', { dateTime: day.date, text: new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' }) }))))),
    data.course_tracks.length ? h('details', { class: 'learn-course-breakdown' }, h('summary', { text: 'Progress within each course' }),
      h('div', {}, data.course_tracks.map(track => h('a', { href: '#/learning/courses?track=' + encodeURIComponent(track.title) },
        h('strong', { text: track.title }), h('span', { text: `${track.completed} / ${track.total} lessons` }),
        h('progress', { value: track.completed, max: track.total || 1, 'aria-label': track.title + ' course progress' }))))) : null);
}

export function learningBadges(data) {
  return h('section', { class: 'learn-badge-section', 'aria-label': 'Milestones and badges' },
    h('div', { class: 'learn-section-heading' }, h('h2', { text: 'Milestones & badges' }), h('span', { text: `${data.badges.filter(badge => badge.earned_at).length} / ${data.badges.length} earned` })),
    h('p', { class: 'muted', text: 'Small milestones for showing up, practicing, and staying curious.' }),
    h('div', { class: 'learning-badges' }, data.badges.map(badge => h('article', { class: `learning-badge${badge.earned_at ? ' is-earned' : ''}`, 'aria-label': `${badge.name}: ${badge.earned_at ? 'earned' : 'in progress'}` },
      h('div', {}, h('h3', { text: badge.name }), h('p', { text: badge.description }),
        h('span', { class: 'learning-badge-status', text: badge.earned_at ? `Earned ${badge.earned_at}` : `${badge.progress} / ${badge.target}` }),
        h('progress', { value: badge.progress, max: badge.target, 'aria-label': badge.name + ' badge progress' }))))));
}
