import { h } from '../dom.js';

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

export function lessonReader({ reading, onChange = () => {} }) {
  const { parts, intro, bundledFormat } = lessonParts(reading);
  if (!parts.length) { onChange({ last: true, all: true }); return reading; }
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const requested = query.get('part');
  let all = requested === 'all';
  let selected = Math.max(0, parts.findIndex(part => part.key === requested));
  const root = h('div', { class: 'lesson-reader' });
  const panel = h('div', { class: 'lesson-panel', tabIndex: -1, role: 'region', 'aria-label': 'Current lesson part' });
  const position = h('span', { class: 'lesson-position', 'aria-live': 'polite' });
  const buttons = [];
  const navContent = h('div', { class: 'lesson-nav-inner' },
    h('p', { class: 'lesson-nav-label', text: 'IN THIS LESSON' }),
    h('ol', {}, parts.map((part, index) => {
      const button = h('button', { type: 'button', 'data-step-control': '', 'data-lesson-part': part.key,
        onclick: () => show(index, false, true) },
        h('span', { class: 'lesson-part-number', 'aria-hidden': 'true', text: String(index + 1).padStart(2, '0') }),
        h('span', { class: 'lesson-part-label', text: part.label }));
      buttons.push(button);
      return h('li', {}, button);
    })),
    h('p', { class: 'lesson-nav-help', text: 'Take your time. You can return to any part.' }));
  const nav = h('nav', { class: 'lesson-part-nav', 'aria-label': 'Lesson parts' }, navContent);
  const previous = h('button', { type: 'button', class: 'btn lesson-previous', 'data-step-control': '', text: 'Back', onclick: () => show(selected - 1, false, true) });
  const next = h('button', { type: 'button', class: 'btn btn-primary lesson-next', 'data-step-control': '', onclick: () => show(selected + 1, false, true) });
  const mode = h('button', { type: 'button', class: 'text-link lesson-mode', 'data-step-control': '', onclick: () => show(selected, !all, true) });
  const pager = h('div', { class: 'lesson-pager' }, previous, next);
  const views = parts.map(part => highlightSteps(h('div', { class: 'daily-prose lesson-prose' }, part.nodes.map(node => node.cloneNode(true)))));
  if (intro.length) {
    const introduction = h('div', { class: 'daily-prose lesson-introduction' }, intro);
    if (bundledFormat) navContent.append(h('details', { class: 'lesson-help' }, h('summary', { text: 'How to study' }), introduction));
    else views[0].prepend(h('section', { class: 'lesson-recap', 'aria-label': 'Before you start' }, introduction));
  }
  const full = reading.cloneNode(true);
  root.append(h('div', { class: 'lesson-reader-bar' }, position, mode),
    h('div', { class: 'lesson-reader-layout' }, nav, h('div', { class: 'lesson-main' }, panel, pager)));
  // Cloned safe content has no original event listeners. Keep in-document links
  // inside the reader and reveal the destination part before scrolling to it.
  root.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href^="#"]');
    const href = anchor?.getAttribute('href');
    if (!href || href.startsWith('#/')) return;
    event.preventDefault();
    if (href === '#') return;
    let fragment = href.slice(1);
    try { fragment = decodeURIComponent(fragment); } catch { /* Keep malformed text literal. */ }
    const selector = `#${CSS.escape(fragment)}, #${CSS.escape('reading-' + fragment)}`;
    const destination = views.findIndex(view => view.querySelector(selector));
    if (!all && destination >= 0) show(destination, false, true);
    else if (destination < 0 && full.querySelector(selector)) show(selected, true, true);
    panel.querySelector(selector)?.scrollIntoView({ block: 'start' });
  });
  function show(index, showAll = false, userAction = false) {
    selected = Math.max(0, Math.min(index, parts.length - 1)); all = showAll;
    const part = parts[selected];
    buttons.forEach((button, i) => {
      if (!all && i === selected) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    const prose = all ? full : views[selected];
    panel.replaceChildren(prose);
    panel.setAttribute('aria-label', all ? 'Full lesson' : part.label + ' lesson');
    position.textContent = all ? 'All lesson parts' : `Part ${selected + 1} of ${parts.length} · ${part.label}`;
    mode.textContent = all ? 'Read one part at a time' : 'Read all parts';
    mode.setAttribute('aria-pressed', String(all));
    previous.hidden = all || selected === 0;
    next.hidden = all || selected === parts.length - 1;
    next.textContent = selected < parts.length - 1 ? `Next: ${parts[selected + 1].label}` : '';
    pager.hidden = all || (previous.hidden && next.hidden);
    root.classList.toggle('lesson-show-all', all);
    onChange({ last: selected === parts.length - 1, all });
    if (userAction) {
      const params = new URLSearchParams(location.hash.split('?')[1] || '');
      params.set('part', all ? 'all' : part.key);
      history.replaceState(history.state, '', location.hash.split('?')[0] + '?' + params);
      panel.focus({ preventScroll: true });
      const top = root.getBoundingClientRect().top;
      if (top < 90 || top > window.innerHeight / 2) root.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
  show(selected, all);
  return root;
}
