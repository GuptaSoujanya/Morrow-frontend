import { h } from '../dom.js';
import { icon } from '../icons.js';

const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const shortDate = date => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const count = value => Number(value || 0).toLocaleString();
const route = value => typeof value === 'string' && /^#\/learning(?:\/|\?|$)/.test(value) ? value : '#/learning/dsa/sheet';

/** Server-verified scoring. Reading activity and XP are shown separately by the caller. */
export function scoreProgress(data) {
  if (!data?.today || !data?.totals || !Array.isArray(data.days)) {
    return h('p', { class: 'code-score-error', role: 'alert', text: 'Coding progress could not load. Refresh to try again.' });
  }
  const today = data.today, totals = data.totals, days = data.days, badges = data.badges || [];
  const ratio = today.max_score ? Math.min(100, Math.max(0, today.score / today.max_score * 100)) : 0;
  const chartMax = Math.max(100, ...days.map(day => day.score));
  const chart = h('div', { class: 'code-score-chart-scroll', tabIndex: 0, 'aria-label': 'Fourteen-day score chart. Scroll horizontally to see earlier days.' });
  const bars = h('div', { class: 'code-score-chart-bars', role: 'group', 'aria-label': 'Choose a scoring day. Use left and right arrow keys to change days.' });
  const details = h('div', { class: 'code-score-day', 'aria-live': 'polite' });
  const buttons = [];
  let selected = Math.max(0, days.length - 1);
  function keepSelectedVisible() {
    const button = buttons[selected];
    if (!chart.isConnected || !button) return;
    const viewport = chart.getBoundingClientRect(), bar = button.getBoundingClientRect();
    if (bar.left < viewport.left) chart.scrollLeft -= viewport.left - bar.left + 3;
    else if (bar.right > viewport.right) chart.scrollLeft += bar.right - viewport.right + 3;
  }

  function select(index, focus = false) {
    if (!days.length) return;
    selected = Math.min(days.length - 1, Math.max(0, index));
    const day = days[selected];
    buttons.forEach((button, position) => {
      button.tabIndex = position === selected ? 0 : -1;
      button.setAttribute('aria-pressed', String(position === selected));
    });
    details.replaceChildren(h('div', {}, h('strong', { text: dateLabel(day.date) }),
      h('span', { text: day.attempts ? `${count(day.attempts)} submission${day.attempts === 1 ? '' : 's'} across ${count(day.problems)} problem${day.problems === 1 ? '' : 's'}` : 'No code submissions recorded' })),
      h('div', { class: 'code-score-day-result' }, h('strong', { text: `${count(day.score)} points` }),
        h('span', { text: `${count(day.passed)} / ${count(day.total)} tests passed · ${count(day.verified_solves)} verified solve${day.verified_solves === 1 ? '' : 's'}` })));
    if (focus) buttons[selected].focus({ preventScroll: true });
    keepSelectedVisible();
  }

  days.forEach((day, index) => {
    const dayNumber = new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric' });
    const button = h('button', { type: 'button', class: 'code-score-chart-day', tabIndex: -1, 'aria-pressed': 'false',
      'aria-label': `${day.score || '—'} ${dayNumber}. ${dateLabel(day.date)}: ${day.score} points, ${day.attempts} submissions, ${day.verified_solves} verified solves`,
      title: `${shortDate(day.date)} · ${day.score} points`, onclick: () => select(index), onkeydown: event => {
        const target = { ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: days.length - 1 }[event.key];
        if (target !== undefined) { event.preventDefault(); select(target, true); }
      } }, h('span', { class: 'code-score-chart-value', text: day.score || '—', 'aria-hidden': 'true' }), ' ',
      h('span', { class: 'code-score-chart-track', 'aria-hidden': 'true' }, h('span', { class: `code-score-chart-fill${day.verified_solves ? ' has-solve' : ''}`, style: { height: `${day.score / chartMax * 100}%` } })),
      h('span', { class: 'code-score-chart-date', text: new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric' }), 'aria-hidden': 'true' }));
    buttons.push(button); bars.append(button);
  });
  chart.append(bars);
  select(selected);

  const table = h('details', { class: 'code-score-table-details' }, h('summary', { text: 'View daily scoring data' }),
    h('div', { class: 'code-score-table-scroll', tabIndex: 0, 'aria-label': 'Daily scoring data table' },
      h('table', {}, h('caption', { text: 'Verified code submissions over the last 14 days' }),
        h('thead', {}, h('tr', {}, ['Date', 'Score', 'Submissions', 'Tests passed', 'Verified solves'].map(text => h('th', { scope: 'col', text })))),
        h('tbody', {}, days.map(day => h('tr', {}, h('th', { scope: 'row', text: shortDate(day.date) }), h('td', { text: `${day.score} / ${day.max_score}` }),
          h('td', { text: day.attempts }), h('td', { text: `${day.passed} / ${day.total}` }), h('td', { text: day.verified_solves })))))));

  const root = h('section', { class: 'code-scores', 'aria-label': 'Verified coding progress' },
    h('header', { class: 'code-score-heading' }, h('div', {}, h('p', { class: 'eyebrow', text: 'PRACTICE RESULTS' }), h('h2', { text: 'Your coding progress' }),
      h('p', { text: totals.attempts ? 'Track the code you submitted and the tests it passed.' : 'Submit a solution to start your score, trend and verified-solve milestones.' })),
      h('a', { class: 'btn', href: '#/learning/dsa/sheet', text: 'Open practice sheet' }, icon('arrow-up-right', 'icon icon-sm'))),
    h('div', { class: 'code-score-overview' },
      h('div', { class: 'code-score-today' },
        h('div', { class: 'code-score-ring', role: 'img', 'aria-label': `Today’s coding score: ${today.score} out of ${today.max_score} possible points across ${today.problems} submitted problems.`, style: `--score-ratio: ${ratio}%` },
          h('div', { 'aria-hidden': 'true' }, h('strong', { text: count(today.score) }), h('span', { text: today.max_score ? `of ${count(today.max_score)} points` : 'points' }))),
        h('div', {}, h('h3', { text: 'Today’s score' }), h('p', { text: today.attempts ? `${count(today.problems)} problem${today.problems === 1 ? '' : 's'} submitted today` : 'Your first submission starts here' }),
          h('span', { class: 'code-score-score-note', text: 'Best result per problem · up to 100 points each' }))),
      h('dl', { class: 'code-score-metrics' },
        metric('Submissions today', today.attempts, `${count(today.passed)} / ${count(today.total)} tests passed`),
        metric('Test pass rate', `${today.pass_rate}%`, 'Across today’s submissions'),
        metric('Verified solves', totals.verified_solves, 'Distinct problems · all time'),
        metric('Submission streak', `${data.current_streak} day${data.current_streak === 1 ? '' : 's'}`, `Best: ${data.best_streak} days`))),
    h('section', { class: 'code-score-trend', 'aria-label': 'Daily code score trend' },
      h('div', { class: 'code-score-section-head' }, h('h3', { text: 'Daily score' }), h('span', { text: `${shortDate(data.start)} – ${shortDate(data.date)}` })),
      chart, details, table),
    h('section', { class: 'code-score-milestones', 'aria-label': 'Verified code milestones' },
      h('div', { class: 'code-score-section-head' }, h('h3', { text: 'Coding milestones' }), h('span', { text: `${badges.filter(badge => badge.earned_at).length} / ${badges.length} earned` })),
      h('div', { class: 'code-score-badges' }, badges.map(badge => h('article', { class: `code-score-badge${badge.earned_at ? ' is-earned' : ''}`, 'aria-label': `${badge.name}: ${badge.earned_at ? 'earned' : 'in progress'}` },
        h('span', { class: 'code-score-badge-icon', 'aria-hidden': 'true' }, icon(badge.earned_at ? 'award' : 'lock', 'icon')),
        h('h4', { text: badge.name }), h('p', { text: badge.description }),
        h('span', { class: 'code-score-badge-state', text: badge.earned_at ? `Earned ${shortDate(badge.earned_at.slice(0, 10))}` : `${badge.progress} / ${badge.target}` }),
        h('progress', { max: badge.target, value: badge.progress, 'aria-label': `${badge.name} progress` }))))),
    h('details', { class: 'code-score-history' }, h('summary', {}, h('strong', { text: 'Recent submissions' }), h('span', { text: `${count(totals.attempts)} total` })),
      data.history?.length ? h('ol', { class: 'code-score-history-list' }, data.history.map(item => h('li', {},
        h('div', { class: 'code-score-history-copy' }, h('a', { href: route(item.route), text: item.title }),
          h('span', {}, `${item.language} · `, h('time', { dateTime: item.at, text: new Date(item.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }))),
        h('div', { class: `code-score-history-result${item.verified ? ' is-verified' : ''}` }, h('strong', { text: `${item.passed} / ${item.total} tests passed` }),
          h('span', { text: `${item.score} / 100 · ${item.improvement ? `+${item.improvement} points` : 'Best score unchanged'}` }))))) : h('p', { class: 'code-score-empty', text: 'Your submitted results will appear here. Running code without submitting does not add a score.' })),
    h('p', { class: 'code-score-footnote', text: 'Daily points use the best submitted result for each problem. Repeating the same or a lower result adds no points. Verified solves pass every test; practice runs and drafts do not earn points.' }));
  const resize = new ResizeObserver(keepSelectedVisible);
  resize.observe(chart);
  root.dispose = () => resize.disconnect();
  queueMicrotask(keepSelectedVisible);
  return root;
}

function metric(label, value, note) {
  return h('div', {}, h('dt', { text: label }), h('dd', {}, typeof value === 'number' ? count(value) : value, h('span', { text: note })));
}
