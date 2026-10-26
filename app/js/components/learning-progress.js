import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api, accountRequestSignal } from '../api.js';
import { S } from '../state.js';
import { loadingState, errorState } from './panel.js';
import { dateControl } from './controls.js';

const dateLabel = day => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const activityHref = item => item.id.startsWith('code/dsa/') ? '#/learning/dsa/problem/' + encodeURIComponent(item.id.slice(9)) : item.id.startsWith('practice/') ? '#/learning/practice/paper/' + encodeURIComponent(item.id.slice(9)) : item.kind === 'dsa' ? '#/learning/dsa' : item.kind === 'course'
  ? '/course/#/' + item.id.replace(/README\.md$/, '').replace(/\.md$/, '') : '#/learning/read/' + encodeURIComponent(item.id) + '?from=progress';

function monthLabels(days) {
  const starts = [];
  days.forEach((day, index) => {
    if (index && day.date.slice(0, 7) === days[index - 1].date.slice(0, 7)) return;
    const column = Math.floor(index / 7);
    // A partial first month should not overlap the following month's label.
    if (starts.length && column - starts.at(-1).column < 3) starts.pop();
    starts.push({ column, date: day.date });
  });
  return h('div', { class: 'learning-months', 'aria-hidden': 'true', style: { gridTemplateColumns: `repeat(${Math.ceil(days.length / 7)}, var(--cell))` } },
    starts.map(month => h('span', { style: { gridColumn: String(month.column + 1) },
      text: new Date(`${month.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short' }) })));
}

export function activityView(data, { showBadges = true, compact = false, showAction = true } = {}) {
  const selection = h('div', { class: 'learning-day-detail', 'aria-live': 'polite' });
  const grid = h('div', { class: 'learning-calendar', role: 'group', 'aria-label': 'Learning activity by day. Use arrow keys to move between dates.' });
  const calendar = h('div', { class: 'learning-calendar-scroll' }, monthLabels(data.days), grid);
  const buttons = [];
  let selected = data.days.length - 1;
  function select(index, focus = false) {
    selected = Math.max(0, Math.min(data.days.length - 1, index));
    const day = data.days[selected];
    if (!day) return;
    buttons.forEach((button, i) => { button.tabIndex = i === selected ? 0 : -1; button.setAttribute('aria-pressed', String(i === selected)); });
    dateInput.value = day.date;
    selection.replaceChildren(h('div', { class: 'learning-day-heading' }, h('strong', { text: dateLabel(day.date) }), h('span', { text: `${day.count} ${day.count === 1 ? 'completion' : 'completions'}` })),
      day.items.length ? h('ul', {}, day.items.map(item => h('li', {}, h('a', { href: activityHref(item), text: item.title }), h('span', { text: `+${item.xp} XP` }))))
        : h('p', { text: day.date === data.date ? 'Finish any learning task to count today.' : 'No learning completions recorded on this day.' }));
    if (focus) {
      const button=buttons[selected];
      button.focus({ preventScroll: true });
      const cell=button.getBoundingClientRect(), bounds=calendar.getBoundingClientRect();
      if(cell.right>bounds.right)calendar.scrollLeft+=cell.right-bounds.right;
      else if(cell.left<bounds.left)calendar.scrollLeft-=bounds.left-cell.left;
    }
  }
  const dateInput = dateControl({ min: data.start, max: data.date, value: data.date, label: 'Inspect a learning date', buttonLabel: 'Choose learning date', commitOnly: true,
    marked: data.days.filter(day => day.count > 0).map(day => day.date), markedLabel: 'Learning completed',
    onChange: value => { const i = data.days.findIndex(day => day.date === value); if (i >= 0) select(i); } });
  for (let index = 0; index < data.days.length; index++) {
    const day = data.days[index];
    const label = `${dateLabel(day.date)}: ${day.count} learning ${day.count === 1 ? 'completion' : 'completions'}`;
    const button = h('button', { type: 'button', class: `learning-cell intensity-${day.level}${day.date === data.date ? ' is-today' : ''}`,
      title: label, 'aria-label': label, tabIndex: -1, 'aria-pressed': 'false',
      onclick: () => select(index), onkeydown: event => {
        const moves = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
        if (Object.hasOwn(moves, event.key)) { event.preventDefault(); select(index + moves[event.key], true); }
        if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); select(event.key === 'Home' ? 0 : data.days.length - 1, true); }
      } });
    buttons.push(button);
    grid.append(button);
  }
  select(selected);
  const badgeList = h('div', { class: 'learning-badges' }, data.badges.map(badge => h('article', {
    class: `learning-badge${badge.earned_at ? ' is-earned' : ''}`, 'aria-label': `${badge.name}: ${badge.earned_at ? 'earned' : 'in progress'}`,
  }, h('span', { class: 'learning-badge-mark', 'aria-hidden': 'true' }, icon('award')),
  h('div', {}, h('h3', { text: badge.name }), h('p', { text: badge.description }),
    h('span', { class: 'learning-badge-status', text: badge.earned_at ? `Earned ${dateLabel(badge.earned_at)}` : `${badge.progress} / ${badge.target} completed` })))));
  const root = h('section', { class: `learning-momentum${compact ? ' is-compact' : ''}`, 'aria-label': 'Learning momentum' },
    h('header', { class: 'learning-momentum-head' }, h('div', {},
      h('h2', { text: 'Your learning momentum' }), h('p', { text: data.today_count ? 'Today counts. Every completed task builds your habit.' : data.current_streak ? 'Complete a learning task today to keep your streak going.' : 'Your next streak starts with one completed task.' })),
    showAction ? h('a', { class: 'btn', href: '#/learning' }, 'Open Learning', icon('arrow-up-right', 'icon icon-sm')) : null),
    h('div', { class: 'learning-scoreboard' },
      h('div', { class: 'learning-streak' }, icon('flame'), h('strong', { text: data.current_streak }), h('span', { text: 'day streak' })),
      h('div', {}, h('strong', { text: data.best_streak }), h('span', { text: 'best streak' })),
      h('div', {}, h('strong', { text: data.active_days }), h('span', { text: 'active days · past year' })),
      h('div', { class: 'learning-xp' }, h('strong', { text: `Level ${data.level}` }), h('span', { text: `${data.xp} XP earned` }),
        h('progress', { value: data.level_progress, max: 100, 'aria-label': 'Progress to next learning level' }))),
    h('div', { class: 'learning-calendar-heading' }, h('h3', { text: 'Learning activity' }), h('span', { text: `${dateLabel(data.start)} – ${dateLabel(data.date)}` })),
    h('div', { class: 'learning-calendar-wrap' }, h('div', { class: 'learning-weekdays', 'aria-hidden': 'true' }, ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map(text => h('span', { text }))), calendar),
    h('div', { class: 'learning-calendar-footer' }, h('div', { class: 'learning-date-picker' }, h('span', { text: 'Explore a day' }), dateInput),
      h('div', { class: 'learning-legend', 'aria-label': 'Darker to brighter cells represent zero to four or more completions' }, 'Less', [0, 1, 2, 3, 4].map(level => h('span', { class: `intensity-${level}`, 'aria-hidden': 'true' })), 'More')),
    selection,
    showBadges ? h('details', { class: 'learning-rewards', open: !compact },
      h('summary', {}, h('strong', { text: 'Learning badges' }), h('span', { text: `${data.badges.filter(badge => badge.earned_at).length} of ${data.badges.length} earned` })), badgeList) : null,
    h('p', { class: 'learning-count-note', text: 'Learning plans, DSA, courses and research all count. Each completed item counts once a day, using this computer’s local date.' }));
  queueMicrotask(() => { calendar.scrollLeft = calendar.scrollWidth; });
  return root;
}

export function learningProgress({ compact = true } = {}) {
  const scope = accountRequestSignal();
  const root = h('div', { class: 'learning-widget' }, S.learningActivity ? activityView(S.learningActivity, { compact }) : loadingState('Opening your learning momentum…'));
  let ticket = 0;
  async function load() {
    const request = ++ticket;
    const revision = S.learningRevision || 0;
    try {
      const data = await api('/api/learning/activity', undefined, { fresh: true });
      if (scope.aborted || request !== ticket || revision !== (S.learningRevision || 0)) return;
      S.learningActivity = data;
      if (root.isConnected) root.replaceChildren(activityView(data, { compact }));
    } catch (error) {
      if (!scope.aborted && request === ticket && error.name !== 'AbortError' && root.isConnected) root.replaceChildren(
        ...(S.learningActivity ? [activityView(S.learningActivity, { compact })] : []), errorState('Learning progress could not refresh. ' + error.message, load));
    }
  }
  queueMicrotask(load);
  return root;
}
