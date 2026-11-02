import { h } from '../dom.js';
import { enhanceLearningDiagrams } from './learning-diagrams.js';

const SUBJECTS = [
  { key: 'ai', label: 'AI & ML', match: /^(ML \/ GenAI|AI and machine learning|AI & machine learning)/i },
  { key: 'systems', label: 'System design', match: /^System [Dd]esign/ },
  { key: 'build', label: 'Full-stack', match: /^Full-stack/i },
  { key: 'dsa', label: 'DSA', match: /^DSA:/i },
];

// Work only with the semantic DOM produced by the existing safe reader. No raw
// HTML is inserted, and a document without the known course shape stays intact.
function lessonParts(reading) {
  const nodes = [...reading.childNodes], parts = [], intro = [];
  let current, bundledFormat = false;
  const finish = { key: 'review', label: 'Review', nodes: [] };
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const text = node.textContent.trim();
    const next = nodes.slice(index + 1).find(item => item.nodeType === Node.ELEMENT_NODE);
    const isHeading = node.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(node.tagName);
    const subjectLine = node.nodeType === Node.ELEMENT_NODE && node.tagName === 'P'
      ? node.querySelector(':scope > strong')?.textContent.trim() : '';
    const bundled = isHeading && /^\d+\.\s/.test(text) && next?.textContent.startsWith('Subject: ');
    const subjectText = bundled ? next.textContent.slice('Subject: '.length).trim() : subjectLine;
    const subject = SUBJECTS.find(item => item.match.test(subjectText || ''));
    if (subject && (bundled || !subjectText.startsWith('Subject:'))) {
      bundledFormat ||= bundled;
      current = { key: subject.key, label: subject.label, nodes: [] };
      parts.push(current);
      const heading = bundled ? node.cloneNode(true) : h('h2');
      heading.textContent = bundled ? text.replace(/^\d+\.\s*/, '') : subjectText.replace(/^[^:]+:\s*/, '');
      current.nodes.push(heading);
      if (!bundled) {
        const remaining = node.cloneNode(true);
        remaining.querySelector(':scope > strong')?.remove();
        if (remaining.firstChild?.nodeType === Node.TEXT_NODE) remaining.firstChild.textContent = remaining.firstChild.textContent.replace(/^\s*\(\d+\s*min(?:utes)?\)\s*/i, '');
        if (remaining.textContent.trim()) current.nodes.push(remaining);
      }
      continue;
    }
    if (subjectLine?.startsWith('Subject: ')) {
      const remaining = node.cloneNode(true);
      remaining.querySelector(':scope > strong')?.remove();
      if (current && remaining.textContent.trim()) current.nodes.push(remaining);
      continue;
    }
    if ((isHeading && /^(Try it yourself|DSA practice|Explain it back|Keep up with technology)$/i.test(text))
      || /^(Recall|Go deeper)$/.test(subjectLine || '')) current = finish;
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'DETAILS'
      && node.querySelector('summary')?.textContent.trim() === 'Extra reading (optional)') current = finish;
    if (current) current.nodes.push(node.cloneNode(true));
    else if (text && !(isHeading && /^Day \d+\b/.test(text))) intro.push(node.cloneNode(true));
  }
  if (parts.length < 3 || new Set(parts.map(part => part.key)).size !== parts.length) return { parts: [], intro: [] };
  if (finish.nodes.length) parts.push(finish);
  return { parts, intro, bundledFormat };
}

function highlightSteps(prose) {
  const children = [...prose.childNodes];
  let block;
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE && /^H[3-6]$/.test(child.tagName)) {
      const key = { 'Words you need': 'words', 'The idea': 'idea', 'A small example': 'example', 'Your turn': 'task' }[child.textContent.trim()];
      block = key ? h('section', { class: `lesson-block lesson-${key}` }) : null;
      if (block) prose.insertBefore(block, child);
    } else if (child.nodeType === Node.ELEMENT_NODE && (child.tagName === 'DETAILS' || /^H[12]$/.test(child.tagName))) block = null;
    if (block) block.append(child);
  }
  return prose;
}

const STAGES = [
  { key: 'understand', label: 'Understand' },
  { key: 'example', label: 'See an example' },
  { key: 'try', label: 'Try it' },
  { key: 'interview', label: 'Interview' },
];

function guidedSubject(prose) {
  const nodes = [...prose.childNodes];
  const blocks = ['words', 'idea', 'example', 'task'].map(key =>
    nodes.filter(node => node.nodeType === Node.ELEMENT_NODE && node.classList.contains('lesson-' + key)));
  // Unknown or incomplete lesson shapes remain readable as a single subject.
  // Never guess where a teaching step ends or discard unrecognised content.
  if (blocks.some(matches => matches.length !== 1)) return null;
  const [words, idea, example, task] = blocks.map(matches => matches[0]);
  const [wordIndex, ideaIndex, exampleIndex, taskIndex] = [words, idea, example, task].map(node => nodes.indexOf(node));
  if (!(wordIndex < ideaIndex && ideaIndex < exampleIndex && exampleIndex < taskIndex)) return null;
  const answerIndex = nodes.findIndex((node, index) => index > taskIndex && node.nodeType === Node.ELEMENT_NODE
    && node.tagName === 'DETAILS' && node.querySelector('summary')?.textContent.trim() === 'Check your answer');
  if (answerIndex < 0) return null;
  const title = nodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === 'H2');
  if (!title) return null;
  const interviewIndex = nodes.findIndex(node => node.nodeType === Node.ELEMENT_NODE
    && node.tagName === 'H3' && node.textContent.trim() === 'Interview practice');
  const interviewStart = interviewIndex > answerIndex ? interviewIndex : nodes.length;
  const makeStage = (content, stage) => h('div', {
    class: 'daily-prose lesson-prose lesson-stage-prose', 'data-current-lesson-stage': stage,
  }, content.map(node => node.cloneNode(true)));
  const views = [
    makeStage(nodes.slice(0, exampleIndex).filter(node => node !== words), 'understand'),
    makeStage([title, ...nodes.slice(exampleIndex, taskIndex)], 'example'),
    makeStage([title, ...nodes.slice(taskIndex, interviewStart)], 'try'),
  ];
  if (interviewStart < nodes.length) views.push(makeStage([title, ...nodes.slice(interviewStart)], 'interview'));
  const glossary = h('details', { class: 'lesson-word-help' },
    h('summary', { text: 'Help with words' }),
    h('div', { class: 'lesson-word-definitions' }, [...words.childNodes].map(node => node.cloneNode(true))));
  return { views, glossary, selected: 0 };
}

export function lessonReader({ reading, onChange = () => {} }) {
  const { parts, intro, bundledFormat } = lessonParts(reading);
  if (!parts.length) { onChange({ last: true, all: true }); return enhanceLearningDiagrams(reading); }
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  let all = query.get('part') === 'all';
  let selected = Math.max(0, parts.findIndex(part => part.key === query.get('part')));
  const root = h('div', { class: 'lesson-reader' });
  const panel = h('div', { class: 'lesson-panel', tabIndex: -1, role: 'region', 'aria-label': 'Current lesson part' });
  const position = h('span', { class: 'lesson-position', 'aria-live': 'polite' });
  const subjectTitle = h('span', { class: 'lesson-subject-title' });
  const subjectCount = h('span', { class: 'lesson-subject-count' });
  const buttons = [];
  const navContent = h('div', { class: 'lesson-nav-inner' },
    h('p', { class: 'lesson-nav-label', text: 'Choose a subject' }),
    h('ol', {}, parts.map((part, index) => {
      const button = h('button', { type: 'button', 'data-step-control': '', 'data-lesson-part': part.key,
        onclick: () => { subjectMenu.open = false; show(index, false, true); } },
        h('span', { class: 'lesson-part-number', 'aria-hidden': 'true', text: String(index + 1).padStart(2, '0') }),
        h('span', { class: 'lesson-part-label', text: part.label }));
      buttons.push(button);
      return h('li', {}, button);
    })));
  const nav = h('nav', { class: 'lesson-part-nav', 'aria-label': 'Lesson parts' }, navContent);
  const subjectMenu = h('details', { class: 'lesson-subject-menu' },
    h('summary', {}, h('span', {}, subjectTitle, subjectCount), h('span', { class: 'lesson-subject-change', text: 'Change subject' })), nav);
  const previous = h('button', { type: 'button', class: 'btn lesson-previous', 'data-step-control': '', text: 'Back', onclick: () => move(-1) });
  const next = h('button', { type: 'button', class: 'btn btn-primary lesson-next', 'data-step-control': '', onclick: () => move(1) });
  const mode = h('button', { type: 'button', class: 'text-link lesson-mode', 'data-step-control': '', onclick: () => show(selected, !all, true) });
  const pager = h('div', { class: 'lesson-pager' }, previous, position, next);
  const stageButtons = STAGES.map((stage, index) => h('button', {
    type: 'button', 'data-step-control': '', 'data-lesson-stage': stage.key,
    onclick: () => show(selected, false, true, index),
  }, h('span', { class: 'lesson-stage-number', 'aria-hidden': 'true', text: String(index + 1) }), stage.label));
  const stageNav = h('nav', { class: 'lesson-stage-nav', 'aria-label': 'Lesson steps' }, stageButtons);
  const views = parts.map(part => highlightSteps(h('div', { class: 'daily-prose lesson-prose' }, part.nodes.map(node => node.cloneNode(true)))));
  if (intro.length) {
    const introduction = h('div', { class: 'daily-prose lesson-introduction' }, intro);
    if (bundledFormat) navContent.append(h('details', { class: 'lesson-help' }, h('summary', { text: 'How to study' }), introduction));
    else views[0].prepend(h('section', { class: 'lesson-recap', 'aria-label': 'Before you start' }, introduction));
  }
  const guided = views.map((view, index) => parts[index].key === 'review' ? null : guidedSubject(view));
  if (guided[selected]) guided[selected].selected = Math.max(0, Math.min(guided[selected].views.length - 1,
    STAGES.findIndex(stage => stage.key === query.get('stage'))));
  const full = reading.cloneNode(true);
  root.append(h('div', { class: 'lesson-reader-bar' }, subjectMenu, mode),
    h('div', { class: 'lesson-reader-layout' }, h('div', { class: 'lesson-main' }, stageNav, panel, pager)));
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && subjectMenu.open) {
      subjectMenu.open = false; subjectMenu.querySelector('summary').focus();
    }
  });
  // Cloned safe content has no original event listeners. Reveal both the subject
  // and the teaching step that contains an in-document link's destination.
  root.addEventListener('click', event => {
    if (subjectMenu.open && !subjectMenu.contains(event.target)) subjectMenu.open = false;
    const anchor = event.target.closest?.('a[href^="#"]');
    const href = anchor?.getAttribute('href');
    if (!href || href.startsWith('#/')) return;
    event.preventDefault();
    if (href === '#') return;
    let fragment = href.slice(1);
    try { fragment = decodeURIComponent(fragment); } catch { /* Keep malformed text literal. */ }
    const selector = `#${CSS.escape(fragment)}, #${CSS.escape('reading-' + fragment)}`;
    const destination = views.findIndex(view => view.querySelector(selector));
    if (!all && destination >= 0) {
      const subject = guided[destination];
      const step = subject?.views.findIndex(view => view.querySelector(selector));
      show(destination, false, true, step >= 0 ? step : undefined);
      if (subject?.glossary.querySelector(selector)) subject.glossary.open = true;
    } else if (destination < 0 && full.querySelector(selector)) show(selected, true, true);
    const target = panel.querySelector(selector);
    for (let parent = target?.parentElement; parent && parent !== panel; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    target?.scrollIntoView({ block: 'start' });
  });
  function move(direction) {
    const subject = guided[selected];
    if (subject && subject.selected + direction >= 0 && subject.selected + direction < subject.views.length) {
      show(selected, false, true, subject.selected + direction);
    } else {
      const destination = selected + direction;
      show(destination, false, true, direction > 0 ? 0 : guided[destination] ? guided[destination].views.length - 1 : 0);
    }
  }
  function show(index, showAll = false, userAction = false, requestedStage) {
    selected = Math.max(0, Math.min(index, parts.length - 1)); all = showAll;
    const part = parts[selected], subject = guided[selected];
    if (subject && Number.isInteger(requestedStage)) subject.selected = Math.max(0, Math.min(requestedStage, subject.views.length - 1));
    const step = subject?.selected || 0;
    buttons.forEach((button, i) => {
      if (!all && i === selected) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    stageButtons.forEach((button, i) => {
      button.hidden = !subject || i >= subject.views.length;
      if (i === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    stageNav.hidden = all || !subject;
    stageNav.classList.toggle('has-interview', subject?.views.length === 4);
    const prose = all ? full : subject ? subject.views[step] : views[selected];
    if (!all && subject) {
      const firstBlock = prose.querySelector(':scope > .lesson-block') || prose.querySelector(':scope > h3');
      prose.insertBefore(subject.glossary, firstBlock);
    }
    panel.replaceChildren(prose);
    enhanceLearningDiagrams(prose);
    panel.setAttribute('aria-label', all ? 'Full lesson' : part.label + ' lesson');
    subjectTitle.textContent = all ? 'Full lesson' : part.label;
    subjectCount.textContent = all ? `${parts.length} subjects` : `Subject ${selected + 1} of ${parts.length}`;
    subjectMenu.hidden = all;
    mode.textContent = all ? 'Read one part at a time' : 'Read all parts';
    mode.setAttribute('aria-pressed', String(all));
    position.textContent = all ? '' : subject ? `Step ${step + 1} of ${subject.views.length}` : part.key === 'review' ? 'Review your learning' : '';
    previous.hidden = all || (selected === 0 && step === 0);
    next.hidden = all || (selected === parts.length - 1 && (!subject || step === subject.views.length - 1));
    next.textContent = subject && step < subject.views.length - 1
      ? ['See an example', 'Try it yourself', 'Practise for interviews'][step]
      : selected < parts.length - 1 ? `Next: ${parts[selected + 1].label}` : '';
    pager.hidden = all || (previous.hidden && next.hidden);
    root.classList.toggle('lesson-show-all', all);
    root.classList.toggle('lesson-guided', Boolean(subject) && !all);
    onChange({ last: part.key === 'review', all });
    if (userAction) {
      const params = new URLSearchParams(location.hash.split('?')[1] || '');
      params.set('part', all ? 'all' : part.key);
      if (!all && subject) params.set('stage', STAGES[step].key);
      else params.delete('stage');
      history.replaceState(history.state, '', location.hash.split('?')[0] + '?' + params);
      panel.focus({ preventScroll: true });
      const top = root.getBoundingClientRect().top;
      if (top < 90 || top > window.innerHeight / 2) root.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
  show(selected, all);
  return root;
}
