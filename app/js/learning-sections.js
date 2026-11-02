import { h } from './dom.js';
import { S } from './state.js';
import { routeAccess } from './access-policy.js';

export const DSA_PRACTICE_PATH = '#/learning/dsa?step=practice';
export const LEARNING_SECTIONS = [
  { key: 'today', label: 'Today', path: '#/learning', icon: 'sun', title: 'Today’s learning', description: 'Continue your interview course, practice DSA, and explore today’s discoveries.' },
  { key: 'weekly', label: '90-day course', path: '#/learning/weekly', icon: 'calendar', title: '90-day interview course', description: 'One shared path through AI, machine learning, system design, full-stack development, and DSA.' },
  { key: 'dsa', label: 'DSA practice', path: '#/learning/dsa', icon: 'code', title: 'DSA practice', description: 'Learn the idea, follow an example, then try a question.' },
  { key: 'discover', label: 'Discover', path: '#/learning/discover', icon: 'globe', title: 'Discover', description: 'Keep up with research papers, tech news, and GitHub projects alongside your course.' },
  { key: 'practice', label: 'Practice & exams', path: '#/learning/practice', icon: 'pen', title: 'Practice & exams', description: 'AI papers shaped by your saved learning and progress.' },
  { key: 'resume', label: 'Resume topics', path: '#/learning/resume', icon: 'person', title: 'Resume topics', description: 'Study topics selected from your résumé and career goals.' },
  { key: 'courses', label: 'Courses', path: '#/learning/courses', icon: 'book', title: 'Courses', description: 'Build your skills with a complete, structured curriculum.' },
  { key: 'library', label: 'Saved library', path: '#/learning/library', icon: 'folder', title: 'Saved library', description: 'Find your saved papers, notes, news, and learning material.' },
  { key: 'bookmarks', label: 'Bookmarks', path: '#/learning/bookmarks', icon: 'book', title: 'Bookmarks', description: 'Papers, DSA questions and GitHub repositories, organized for later.' },
  { key: 'notes', label: 'My notes', path: '#/learning/notes', icon: 'pen', title: 'My notes', description: 'Your ideas, explanations and questions, saved beside their sources.' },
  { key: 'progress', label: 'Progress', path: '#/learning/progress', icon: 'chart', title: 'Your progress', description: 'See your learning history, streaks, and milestones.' },
];
const PARENTS = { resume: 'weekly', courses: 'weekly', practice: 'dsa', bookmarks: 'library', notes: 'library' };

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
  return LEARNING_SECTIONS.filter(section => !PARENTS[section.key] && routeAccess({ name: 'learning', arg: section.key === 'today' ? '' : section.key }, context).kind === 'allowed');
}

export function currentLearningSection(arg = '', context = S) {
  const available = availableLearningSections(context);
  const current = learningSection(arg);
  return available.find(section => section.key === (PARENTS[current.key] || current.key))
    || available.find(section => section.key === 'library')
    || available[0];
}

export function renderLearningSwitcher(arg = '') {
  const sections = availableLearningSections();
  if (!sections.length) return null;
  const current = currentLearningSection(arg);
  return h('nav', { class: 'learning-section-nav', 'aria-label': 'Learning sections' },
    sections.map(section => h('a', { href: section.path, text: section.label,
      'aria-current': section.key === current.key ? 'page' : null })));
}
