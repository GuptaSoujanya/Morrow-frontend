import { h } from '../dom.js';
import { icon } from '../icons.js';
import { enhanceLessonCode } from './lesson-code-tools.js';
import { trackLessonSections } from './lesson-section-tracker.js';
import { enhanceLearningDiagrams, whenLearningDiagramsReady } from './learning-diagrams.js';
import { scrollToElement } from '../scroll-position.js';

const SUBJECTS = [
  { key: 'ai', metadata: 'ai_ml', label: 'AI & ML', match: /^(ML \/ GenAI|AI and machine learning|AI & machine learning)/i },
  { key: 'systems', metadata: 'system_design', label: 'System design', match: /^System [Dd]esign/ },
  { key: 'build', metadata: 'full_stack', label: 'Full-stack', match: /^Full-stack/i },
  { key: 'dsa', metadata: 'dsa', label: 'DSA practice', match: /^DSA:/i },
];
const CHAPTERS = [
  { key: 'project', label: 'Build & test', match: /^(Build and test|Try it yourself|Weekly project and mock interview)$/i },
  { key: 'dsa', label: 'DSA practice', match: /^DSA practice$/i },
  { key: 'interview', label: 'Interview & recall', match: /^(Interview and recall|Explain it back|Interview question bank|Recall)$/i },
  { key: 'review', label: 'Finish day', match: /^(Review and finish|Keep up with technology|Go deeper|Extra reading \(optional\))$/i },
];
const SECTIONS = [
  { key: 'understand', label: 'Learn & trace', heading: 'The idea', className: 'idea' },
  { key: 'example', label: 'Worked examples', heading: 'A small example', className: 'example' },
  { key: 'try', label: 'Build & test', heading: 'Your turn', className: 'task' },
  { key: 'interview', label: 'Interview practice', heading: 'Interview practice', className: 'interview' },
];
const plain = value => typeof value === 'string' ? value.trim() : '';

// Split only recognised semantic boundaries. Unknown content stays with its
// chapter, and documents without a course structure remain readable in full.
function lessonParts(reading) {
  const nodes = [...reading.childNodes], parts = [], intro = [];
  const subjects = new Set();
  let current;
  const getPart = spec => {
    let part = parts.find(value => value.key === spec.key);
    if (!part) { part = { ...spec, nodes: [] }; parts.push(part); }
    return part;
  };
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index], text = node.textContent.trim();
    const element = node.nodeType === Node.ELEMENT_NODE;
    const heading = element && /^H[1-6]$/.test(node.tagName);
    const next = nodes.slice(index + 1).find(item => item.nodeType === Node.ELEMENT_NODE);
    const strong = element && node.tagName === 'P' ? node.querySelector(':scope > strong')?.textContent.trim() : '';
    const bundled = heading && /^\d+\.\s/.test(text) && next?.textContent.startsWith('Subject: ');
    const subjectText = bundled ? next.textContent.slice('Subject: '.length).trim() : strong;
    const subject = SUBJECTS.find(item => item.match.test(subjectText || ''));
    if (subject && (bundled || !subjectText.startsWith('Subject:'))) {
      if (subjects.has(subject.key)) return { parts: [], intro: [] };
      subjects.add(subject.key);
      current = getPart({ ...subject, kind: 'subject' });
      const title = bundled ? node.cloneNode(true) : h('h2');
      title.textContent = bundled ? text.replace(/^\d+\.\s*/, '') : subjectText.replace(/^[^:]+:\s*/, '');
      current.topic = title.textContent;
      current.nodes.push(title);
      if (!bundled) {
        const remaining = node.cloneNode(true);
        remaining.querySelector(':scope > strong')?.remove();
        if (remaining.firstChild?.nodeType === Node.TEXT_NODE) remaining.firstChild.textContent = remaining.firstChild.textContent.replace(/^\s*\(\d+\s*min(?:utes)?\)\s*/i, '');
        if (remaining.textContent.trim()) current.nodes.push(remaining);
      }
      continue;
    }
    const subjectMarker = strong?.startsWith('Subject: ') && SUBJECTS.find(item => item.match.test(strong.slice('Subject: '.length)));
    if (subjectMarker && current?.key === subjectMarker.key) {
      const remaining = node.cloneNode(true);
      remaining.querySelector(':scope > strong')?.remove();
      if (current && remaining.textContent.trim()) current.nodes.push(remaining);
      continue;
    }
    const boundary = (heading && node.tagName === 'H2') || ['Recall', 'Go deeper'].includes(strong);
    const chapter = boundary && CHAPTERS.find(item => item.match.test(strong || text));
    const optional = element && node.tagName === 'DETAILS' && node.querySelector('summary')?.textContent.trim() === 'Extra reading (optional)';
    if (chapter || optional) current = getPart({ ...(chapter || CHAPTERS.at(-1)), kind: 'practice' });
    if (current) current.nodes.push(node.cloneNode(true));
    else if (text && !(heading && /^Day \d+\b/.test(text))) intro.push(node.cloneNode(true));
  }
  if (subjects.size < 3) return { parts: [], intro: [] };
  // Completion always has its own final destination, including older saved days.
  const finish = getPart({ ...CHAPTERS.at(-1), kind: 'practice' });
  parts.splice(parts.indexOf(finish), 1); parts.push(finish);
  return { parts, intro };
}

function highlightSections(prose) {
  let block;
  for (const child of [...prose.childNodes]) {
    if (child.nodeType === Node.ELEMENT_NODE && /^H[23]$/.test(child.tagName)) {
      const section = SECTIONS.find(item => item.heading === child.textContent.trim());
      const key = child.textContent.trim() === 'Words you need' ? 'words' : section?.className;
      block = key ? h('section', { class: `lesson-block lesson-${key}`, ...(section ? { 'data-lesson-section': section.key } : {}) }) : null;
      if (section) child.textContent = section.label;
      if (block) prose.insertBefore(block, child);
    }
    if (block) block.append(child);
  }
  return prose;
}

function metadataFor(lesson, part) {
  const key = SUBJECTS.find(item => item.key === part.key)?.metadata;
  const item = Array.isArray(lesson?.learning_path) && lesson.learning_path.find(value => value?.key === key);
  if (item) return item;
  return part.key === 'project' ? { task: lesson?.deliverable } : {};
}

function focusBrief(metadata, label) {
  const goals = [['What you’ll learn', plain(metadata.outcome)], ['Why it matters at work', plain(metadata.job_use)], ['What you’ll make', plain(metadata.task)]]
    .filter(([, value]) => value);
  const entry = ([title, value]) => h('div', {}, h('dt', { text: title }), h('dd', { text: value }));
  return goals.length ? h('section', { class: 'lesson-focus', 'aria-label': label + ' learning goals' },
    h('dl', { class: 'lesson-focus-outcome' }, entry(goals[0])),
    goals.length > 1 ? h('details', { class: 'lesson-goal-details' },
      h('summary', {}, icon('pen', 'icon icon-sm'), h('span', { text: 'Your task & why it matters' }), icon('chevron-down', 'icon icon-sm')),
      h('dl', {}, goals.slice(1).map(entry))) : null) : null;
}

export function lessonReader({ reading, lesson, studyTools = null, onChange = () => {} }) {
  // Long code and tables scroll independently. Keyboard readers must be able
  // to reach those scroll areas in chapters, the full day and fallback content.
  for (const [selector, label] of [['pre', 'Code example'], ['table', 'Example table']]) {
    reading.querySelectorAll(selector).forEach((block, index) => {
      block.tabIndex = 0;
      if (!block.hasAttribute('aria-label')) block.setAttribute('aria-label', `${label} ${index + 1}`);
      if (selector === 'pre') block.setAttribute('role', 'region');
    });
  }
  const { parts, intro } = lessonParts(reading);
  if (!parts.length) { onChange({ last: true, all: true }); return enhanceLessonCode(enhanceLearningDiagrams(reading)); }
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  let all = query.get('part') === 'all';
  let selected = Math.max(0, parts.findIndex(part => part.key === query.get('part')));
  let selectedSection = SECTIONS.some(section => section.key === query.get('stage')) ? query.get('stage') : 'understand';
  const root = h('div', { class: 'lesson-reader lesson-course-reader' });
  const panel = h('div', { class: 'lesson-panel', tabIndex: -1, role: 'region', 'aria-label': 'Current lesson chapter' });
  let navigationController;
  const position = h('span', { class: 'lesson-position', 'aria-live': 'polite' });
  const full = reading.cloneNode(true);
  full.classList.add('lesson-prose');
  const readingMinutes = node => Math.max(1, Math.ceil(node.textContent.trim().split(/\s+/).filter(Boolean).length / 180));
  const fullReadingMinutes = readingMinutes(full);
  const chapters = parts.map(part => {
    const prose = highlightSections(h('div', { class: 'daily-prose lesson-prose lesson-stage-prose lesson-chapter-prose' }, part.nodes.map(node => node.cloneNode(true))));
    const metadata = metadataFor(lesson, part);
    part.topic ||= plain(metadata.topic);
    const heading = prose.querySelector(':scope > h2');
    const brief = focusBrief(metadata, part.label);
    if (brief) heading ? heading.after(brief) : prose.prepend(brief);
    const words = prose.querySelector(':scope > .lesson-words');
    if (words) {
      const glossary = h('details', { class: 'lesson-word-help' }, h('summary', { text: 'Help with words' }),
        h('div', { class: 'lesson-word-definitions' }, [...words.childNodes]));
      words.replaceWith(glossary);
    }
    if (part.key === 'review' && !prose.querySelector('h2')) prose.prepend(h('h2', { text: 'Review and finish' }));
    if (part.key === 'review') prose.append(h('p', { class: 'lesson-finish-guidance', text: 'Use the completion button below when you have finished today’s reading and practice. Opening a chapter does not mark it complete.' }));
    part.readingMinutes = readingMinutes(prose);
    return prose;
  });
  const buttons = parts.map((part, index) => h('button', {
    type: 'button', 'data-step-control': '', 'data-lesson-part': part.key,
    onclick: () => {
      const reveal = getComputedStyle(toolbar).position === 'sticky' && panel.getBoundingClientRect().top < 0;
      show(index, false, true, reveal);
      pathMenu.open = false;
      pathMenu.querySelector(':scope > summary').focus({ preventScroll: true });
    },
  }, h('span', { class: 'lesson-part-number', 'aria-hidden': 'true', text: String(index + 1).padStart(2, '0') }),
  h('span', { class: 'lesson-part-copy' }, h('span', { class: 'lesson-part-label', text: part.label }),
    part.topic && part.topic !== part.label ? h('span', { class: 'lesson-part-topic', text: part.topic }) : null)));
  const nav = h('nav', { class: 'lesson-part-nav', 'aria-label': 'Lesson contents' },
    h('ol', {}, buttons.map((button, index) => h('li', { class: parts[index].kind === 'subject' ? 'lesson-path-subject' : 'lesson-path-practice' }, button))));
  const pathPosition = h('span', { class: 'lesson-path-position' });
  const pathSubject = h('span', { class: 'lesson-path-subject-name' });
  const pathMenu = h('details', { class: 'lesson-path-menu' },
    h('summary', {}, h('span', {}, h('strong', { text: 'Chapters' }), pathSubject), pathPosition, icon('chevron-down', 'icon icon-sm')));
  const dayOverview = plain(lesson?.deliverable) || plain(lesson?.project)
    ? h('section', { class: 'lesson-day-overview', 'aria-label': 'Today’s learning goal' },
      plain(lesson.project) ? h('p', { class: 'lesson-project-context' }, h('strong', { text: 'Your project: ' }), plain(lesson.project)) : null,
      plain(lesson.deliverable) ? h('p', { class: 'lesson-day-output' }, h('strong', { text: 'Today’s output: ' }), plain(lesson.deliverable)) : null)
    : null;
  const introduction = intro.length ? h('details', { class: 'lesson-study-guide' },
    h('summary', { text: 'How to use this lesson' }),
    h('div', { class: 'daily-prose' }, intro)) : null;
  const mode = h('button', { type: 'button', class: 'text-link lesson-mode', 'data-step-control': '', onclick: () => show(selected, !all, true) });
  const chapterPosition = h('p', { class: 'lesson-chapter-position' });
  const readingTime = h('span', { class: 'lesson-reading-time' });
  const stageButtons = SECTIONS.map(section => h('button', { type: 'button', 'data-step-control': '', 'data-lesson-stage': section.key,
    'aria-label': section.label, onclick: () => jumpTo(section.key, true) },
    h('span', { class: 'lesson-section-long', 'aria-hidden': 'true', text: section.label }),
    h('span', { class: 'lesson-section-short', 'aria-hidden': 'true', text: { understand: 'Learn', example: 'Examples', try: 'Build', interview: 'Interview' }[section.key] })));
  const sectionNav = h('nav', { class: 'lesson-section-nav', 'aria-label': 'Jump to a section' }, stageButtons);
  const previous = h('button', { type: 'button', class: 'btn lesson-previous', 'data-step-control': '', onclick: () => show(selected - 1, false, true, true) });
  const next = h('button', { type: 'button', class: 'btn btn-primary lesson-next', 'data-step-control': '', onclick: () => show(selected + 1, false, true, true) });
  const pager = h('nav', { class: 'lesson-pager', 'aria-label': 'Continue the lesson' }, previous, position, next);
  const projectBrief = dayOverview ? h('details', { class: 'lesson-project-brief' },
    h('summary', {}, icon('code', 'icon icon-sm'), h('span', { text: 'Today’s project' }), icon('chevron-down', 'icon icon-sm')), dayOverview) : null;
  pathMenu.append(h('div', { class: 'lesson-menu-content' }, nav, projectBrief, introduction));
  const toolbar = h('div', { class: 'lesson-chapter-tools' },
    h('div', { class: 'lesson-reader-bar' }, pathMenu, sectionNav,
      h('div', { class: 'lesson-current-context' }, chapterPosition, studyTools ? null : readingTime), studyTools, mode));
  if (studyTools) {
    root.classList.add('lesson-with-study-tools');
    pathMenu.querySelector('.lesson-menu-content').append(h('div', { class: 'lesson-menu-estimate' }, readingTime));
  }
  root.append(h('div', { class: 'lesson-course-layout' },
    h('div', { class: 'lesson-reader-layout' },
      toolbar,
      h('div', { class: 'lesson-main' }, panel, pager))));
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && pathMenu.open) {
      event.preventDefault(); event.stopPropagation(); pathMenu.open = false;
      pathMenu.querySelector(':scope > summary').focus({ preventScroll: true });
    }
  });
  const sectionTracker = trackLessonSections({ root, panel, toolbar,
    onActive: key => {
      if (all || key === selectedSection) return;
      selectedSection = key;
      updateSection();
    },
  });
  root.dispose = () => { navigationController?.abort(); sectionTracker.dispose(); };

  function updateUrl() {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    params.set('part', all ? 'all' : parts[selected].key);
    if (!all && chapters[selected].querySelector(`[data-lesson-section="${selectedSection}"]`)) params.set('stage', selectedSection);
    else params.delete('stage');
    history.replaceState(history.state, '', location.hash.split('?')[0] + '?' + params);
  }
  async function focusTarget(target, userAction = false) {
    navigationController?.abort();
    if (!target) return;
    for (let parent = target.parentElement; parent && parent !== panel; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    const controller = new AbortController();
    navigationController = controller;
    // A late diagram or font must not pull a reader back after they have moved
    // on, typed a note, or chosen another chapter.
    for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
      window.addEventListener(name, () => controller.abort(), { capture: true, passive: true, signal: controller.signal });
    }
    await Promise.all([document.fonts?.ready, whenLearningDiagramsReady(panel)]);
    const cancelled = controller.signal.aborted;
    controller.abort();
    if (navigationController === controller) navigationController = null;
    if (cancelled || !root.isConnected || !panel.contains(target)) return;
    target.tabIndex = -1; target.focus({ preventScroll: true });
    scrollToElement(target, { smooth: userAction });
  }
  function updateSection() {
    stageButtons.forEach((button, index) => {
      const exists = !all && chapters[selected].querySelector(`[data-lesson-section="${SECTIONS[index].key}"]`);
      button.hidden = !exists;
      if (exists && selectedSection === SECTIONS[index].key) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    });
    sectionNav.hidden = all || stageButtons.every(button => button.hidden);
    if (all) full.removeAttribute('data-current-lesson-stage');
    else chapters[selected].dataset.currentLessonStage = selectedSection;
  }
  function jumpTo(key, userAction = false) {
    const target = chapters[selected].querySelector(`[data-lesson-section="${key}"]`);
    if (!target || all) return;
    selectedSection = key; updateSection();
    if (userAction) { updateUrl(); focusTarget(target.querySelector('h3') || target, true); }
  }
  function show(index, showAll = false, userAction = false, revealChapter = false) {
    navigationController?.abort();
    const nextIndex = Math.max(0, Math.min(index, parts.length - 1));
    if (userAction && selected === nextIndex && all === showAll) return;
    selected = nextIndex; all = showAll;
    if (userAction) selectedSection = 'understand';
    const part = parts[selected], prose = all ? full : chapters[selected];
    buttons.forEach((button, i) => {
      if (!all && i === selected) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    panel.replaceChildren(prose);
    enhanceLearningDiagrams(prose);
    enhanceLessonCode(prose);
    panel.setAttribute('aria-label', all ? 'Full lesson' : part.label + ' lesson');
    chapterPosition.textContent = all ? 'All chapters · read at your own pace' : `Chapter ${selected + 1} of ${parts.length} · ${part.label}`;
    pathPosition.textContent = all ? `${parts.length} chapters` : `${String(selected + 1).padStart(2, '0')} / ${String(parts.length).padStart(2, '0')}`;
    pathSubject.textContent = all ? 'Reading the full lesson' : part.label;
    readingTime.replaceChildren(icon('clock', 'icon icon-sm'), `About ${all ? fullReadingMinutes : part.readingMinutes} min reading`);
    mode.textContent = all ? 'Read one subject at a time' : 'Read all parts';
    mode.setAttribute('aria-pressed', String(all));
    if (introduction) introduction.hidden = all;
    position.textContent = all ? '' : `Chapter ${selected + 1} of ${parts.length}`;
    previous.hidden = all || selected === 0;
    next.hidden = all || selected === parts.length - 1;
    previous.textContent = selected > 0 ? `Back: ${parts[selected - 1].label}` : 'Back';
    next.textContent = selected < parts.length - 1 ? `Next: ${parts[selected + 1].label}` : 'Next';
    pager.hidden = all;
    root.classList.toggle('lesson-show-all', all);
    updateSection();
    sectionTracker.refresh();
    onChange({ last: !all && part.key === 'review', all, part: part.key, stage: selectedSection });
    if (userAction) {
      updateUrl();
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        prose.animate?.([{ opacity: .55 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
      }
      // Top selectors stay under the pointer. Only the bottom pager asks to
      // return to the start, unless a sticky chapter link was used mid-reading.
      if (revealChapter) focusTarget(prose.querySelector('h2') || panel, true);
    }
  }
  // In-document links can point into a different chapter or a closed answer.
  // Reveal the actual target without allowing a fragment to replace the route.
  root.addEventListener('click', event => {
    if (pathMenu.open && !pathMenu.contains(event.target)) pathMenu.open = false;
    const anchor = event.target.closest?.('a[href^="#"]');
    const href = anchor?.getAttribute('href');
    if (!href || href.startsWith('#/')) return;
    event.preventDefault();
    if (href === '#') return;
    let fragment = href.slice(1);
    try { fragment = decodeURIComponent(fragment); } catch { /* Keep malformed text literal. */ }
    const selector = `#${CSS.escape(fragment)}, #${CSS.escape('reading-' + fragment)}`;
    const destination = chapters.findIndex(chapter => chapter.querySelector(selector));
    if (!all && destination >= 0) show(destination, false, true);
    else if (destination < 0 && full.querySelector(selector)) show(selected, true, true);
    focusTarget(panel.querySelector(selector), true);
  });
  show(selected, all);
  if (!all && query.has('stage') && selectedSection !== 'understand') {
    const section = chapters[selected].querySelector(`[data-lesson-section="${selectedSection}"]`);
    focusTarget(section?.querySelector('h3') || section);
  }
  return root;
}
