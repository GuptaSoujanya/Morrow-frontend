import { h } from '../dom.js';
import { safeReading } from '../views/learning-library.js';

export function coursePracticeTabs(selected = 'roadmap') {
  return h('nav', { class: 'learn-tabs interview-course-tabs', 'aria-label': 'Course views' },
    h('a', { href: '#/learning/weekly', text: '90-day roadmap', 'aria-current': selected === 'roadmap' ? 'page' : null }),
    h('a', { href: '#/learning/weekly?view=questions', text: 'Interview questions', 'aria-current': selected === 'questions' ? 'page' : null }));
}

export function renderInterviewBank(data) {
  const filters = data.query || {};
  const route = (page = 1) => '#/learning/weekly?' + new URLSearchParams(
    Object.entries({ view: 'questions', ...filters, page }).filter(([, value]) => value !== null && value !== ''));
  const search = h('input', { type: 'search', class: 'input', name: 'q', value: filters.q || '', maxLength: 160,
    placeholder: 'Try “cache”, “leakage” or “testing”' });
  const track = h('select', { class: 'input', name: 'track' },
    h('option', { value: '', text: 'All subjects' }),
    data.tracks.map(item => h('option', { value: item.key, text: `${item.title} (${item.count})`, selected: filters.track === item.key })));
  const week = h('select', { class: 'input', name: 'week' },
    h('option', { value: '', text: 'All weeks' }),
    Array.from({ length: 13 }, (_, index) => h('option', { value: index + 1, text: `Week ${index + 1}`, selected: filters.week === index + 1 })));
  const form = h('form', { class: 'interview-filters', role: 'search', 'aria-label': 'Find interview questions', onsubmit: event => {
    event.preventDefault();
    location.hash = '#/learning/weekly?' + new URLSearchParams(Object.entries({
      view: 'questions', q: search.value.trim(), track: track.value, week: week.value,
    }).filter(([, value]) => value));
  } }, h('label', { class: 'interview-search' }, 'Search questions', search),
  h('label', {}, 'Subject', track), h('label', {}, 'Course week', week),
  h('button', { class: 'btn btn-primary', type: 'submit', text: 'Find questions' }));
  const cards = data.items.map(item => h('article', { class: 'interview-question', 'data-interview-question': item.id },
    h('div', { class: 'interview-question-meta' }, h('span', { text: item.track_title }),
      h('span', { text: `Day ${item.day} · ${item.level}` })),
    h('h3', { text: item.question }), h('p', { class: 'interview-topic', text: item.topic }),
    h('details', { class: 'interview-answer' }, h('summary', { text: 'Show answer guide' }), safeReading(item.answer_html)),
    h('div', { class: 'interview-follow-up' }, h('h4', { text: 'Follow-up question' }), h('p', { text: item.follow_up }),
      h('details', { class: 'interview-answer' }, h('summary', { text: 'Show follow-up answer' }), safeReading(item.follow_up_answer_html))),
    h('a', { class: 'text-link interview-lesson-link', href: item.route, text: `Study the full lesson · Day ${item.day} →` })));
  return h('section', { class: 'interview-bank' }, coursePracticeTabs('questions'),
    h('header', { class: 'interview-bank-head' },
      h('h2', { class: 'visually-hidden', text: 'Your interview question bank' }),
      h('p', {}, h('strong', { text: `${data.bank_total} questions` }), ' with answer guides and follow-ups.'),
      h('p', { class: 'muted', text: 'Choose a topic. Say your answer before opening the guide.' })),
    form, h('div', { class: 'interview-results' },
      h('p', { role: 'status', text: `${data.total} questions found · Page ${data.page} of ${data.pages}` }),
      filters.q || filters.track || filters.week ? h('a', { href: '#/learning/weekly?view=questions', text: 'Clear filters' }) : null),
    h('div', { class: 'interview-question-list' }, cards.length ? cards : h('p', { class: 'empty-state', text: 'No questions match. Try a shorter search or choose all subjects.' })),
    h('nav', { class: 'interview-pagination', 'aria-label': 'Interview question pages' },
      data.page > 1 ? h('a', { class: 'btn', href: route(data.page - 1), text: 'Previous page' }) : null,
      data.page < data.pages ? h('a', { class: 'btn', href: route(data.page + 1), text: 'Next page' }) : null),
    h('details', { class: 'interview-sources' }, h('summary', { text: 'Sources for further study' }),
      h('p', { text: 'Use these official guides and original papers to explore the ideas behind the course.' }),
      h('ul', {}, data.sources.map(source => h('li', {}, h('a', {
        href: source.url, target: '_blank', rel: 'noopener noreferrer', text: source.title }))))));
}
