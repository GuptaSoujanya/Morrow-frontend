import { h } from './dom.js';
import { S } from './state.js';
import { routeAccess } from './access-policy.js';
import { selectControl } from './components/controls.js';

export const DSA_PRACTICE_PATH = '#/learning/dsa?step=practice';
export const LEARNING_SECTIONS = [
  { key: 'today', label: 'Today', path: '#/learning', icon: 'sun', title: 'Today’s learning', description: 'Your daily practice, reading, and career research in one place.' },
  { key: 'dsa', label: 'DSA practice', path: DSA_PRACTICE_PATH, icon: 'code', title: 'DSA practice', description: 'Open today’s question and code editor directly.' },
  { key: 'practice', label: 'Practice & exams', path: '#/learning/practice', icon: 'pen', title: 'Practice & exams', description: 'AI papers shaped by your saved learning and progress.' },
  { key: 'resume', label: 'Resume topics', path: '#/learning/resume', icon: 'person', title: 'Resume topics', description: 'Study topics selected from your résumé and career goals.' },
  { key: 'courses', label: 'Courses', path: '#/learning/courses', icon: 'book', title: 'Courses', description: 'Build your skills with a complete, structured curriculum.' },
  { key: 'library', label: 'Saved library', path: '#/learning/library', icon: 'folder', title: 'Saved library', description: 'Find your saved papers, notes, news, and learning material.' },
  { key: 'progress', label: 'Progress', path: '#/learning/progress', icon: 'chart', title: 'Your progress', description: 'See your learning history, streaks, and milestones.' },
];

export function learningSection(arg = '', query) {
  const part = String(arg).split('/')[0];
  let key = part || 'today';
  if (part === 'plan') key = 'today';
  if (part === 'read') {
    const params = query ?? new URLSearchParams(typeof window === 'undefined' ? '' : window.location.hash.split('?')[1] || '');
    const origin = params.get('from');
    key = LEARNING_SECTIONS.some(section => section.key === origin) ? origin : 'library';
  }
  return LEARNING_SECTIONS.find(section => section.key === key) || LEARNING_SECTIONS[0];
}

export function availableLearningSections(context = S) {
  return LEARNING_SECTIONS.filter(section => routeAccess({ name: 'learning', arg: section.key === 'today' ? '' : section.key }, context).kind === 'allowed');
}

export function currentLearningSection(arg = '', context = S) {
  const available = availableLearningSections(context);
  const current = learningSection(arg);
  return available.find(section => section.key === current.key)
    || available.find(section => section.key === 'library')
    || available[0];
}

export function renderLearningSwitcher(arg = '') {
  const sections = availableLearningSections();
  if (!sections.length) return null;
  const current = currentLearningSection(arg);
  const select = selectControl({ label: 'Learning section', value: current.path,
    options: sections.map(section => ({ value: section.path, label: section.label })),
    onChange: value => { window.location.hash = value; },
  });
  select.controlElement.classList.add('learning-section-select');
  return h('div', { class: 'learning-switcher' },
    h('span', { text: 'Learning section' }),
    select,
  );
}
