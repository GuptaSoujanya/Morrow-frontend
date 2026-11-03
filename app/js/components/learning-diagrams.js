import { h } from '../dom.js';

// Course HTML remains semantic, sanitized text. Only the exact fenced-code marker
// opts in to this renderer; Mermaid and its diagram chunks are loaded locally.
const CODE_SELECTOR = 'pre > code.language-mermaid';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SOURCE_LENGTH = 12000;
const MAX_SVG_LENGTH = 800000;
const pendingRoots = new WeakSet();
const listeningRoots = new WeakSet();
const figures = new WeakMap();
let library;
let renderQueue = Promise.resolve();
let sequence = 0;

const SVG_TAGS = new Set(['svg', 'g', 'defs', 'marker', 'path', 'rect', 'circle', 'ellipse',
  'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'clipPath']);
const GEOMETRY = new Set(['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'dx', 'dy', 'rotate', 'd', 'points', 'transform', 'viewBox',
  'preserveAspectRatio', 'textLength', 'lengthAdjust', 'markerWidth', 'markerHeight',
  'markerUnits', 'refX', 'refY', 'orient', 'clipPathUnits']);
const PRESENTATION = new Set(['fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'text-anchor',
  'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'font-size', 'font-weight',
  'font-style', 'letter-spacing', 'word-spacing', 'paint-order', 'vector-effect']);
const LOCAL_REFERENCES = new Set(['marker-start', 'marker-mid', 'marker-end', 'clip-path']);

function safePresentation(name, value) {
  if (!PRESENTATION.has(name) || value.length > 160) return false;
  // Presentation values cannot introduce a URL, CSS escape, variable, declaration
  // or HTML. Diagram colours, numbers and common SVG keywords remain usable.
  return /^[\w\s#.,%()+-]+$/.test(value)
    && !/url\s*\(|var\s*\(|attr\s*\(|expression\s*\(/i.test(value);
}

// Rebuild the returned SVG rather than trusting an HTML string. No style blocks,
// foreignObject, images, links, hrefs, event attributes or animation survive.
// IDs and internal marker references are remapped to this one diagram instance.
export function sanitizeDiagramSvg(markup, prefix) {
  if (typeof markup !== 'string' || markup.length > MAX_SVG_LENGTH) throw new Error('Invalid diagram output');
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const original = parsed.documentElement;
  if (parsed.querySelector('parsererror') || original.localName !== 'svg' || original.namespaceURI !== SVG_NS) throw new Error('Invalid diagram output');
  const elements = [original, ...original.querySelectorAll('*')];
  if (elements.length > 5000) throw new Error('Diagram too large');
  const ids = new Map();
  for (const node of elements) {
    if (SVG_TAGS.has(node.localName) && node.id && !ids.has(node.id)) ids.set(node.id, `${prefix}-part-${ids.size}`);
  }
  const copy = node => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE || node.namespaceURI !== SVG_NS || !SVG_TAGS.has(node.localName)) return null;
    const clean = document.createElementNS(SVG_NS, node.localName);
    for (const attr of node.attributes) {
      const { name, value } = attr;
      if (name === 'id' && ids.has(value)) clean.setAttribute('id', ids.get(value));
      else if (name === 'class') clean.setAttribute('class', value.split(/\s+/).filter(token => /^[a-zA-Z_][\w-]*$/.test(token)).join(' '));
      else if (GEOMETRY.has(name) && value.length < 100000 && !/[<>\\]|url\s*\(/i.test(value)) clean.setAttribute(name, value);
      else if (safePresentation(name, value)) clean.setAttribute(name, value);
      else if (LOCAL_REFERENCES.has(name)) {
        const target = value.match(/^url\(\s*["']?#([^\s"')]+)["']?\s*\)$/)?.[1];
        if (target && ids.has(target)) clean.setAttribute(name, `url(#${ids.get(target)})`);
      }
    }
    // Mermaid uses some inline presentation values for graph edges and classes.
    // Copy only safe visual declarations into SVG attributes, never raw CSS.
    if (node.style) for (const name of node.style) {
      const value = node.style.getPropertyValue(name).trim();
      if (safePresentation(name, value)) clean.setAttribute(name, value);
    }
    for (const child of node.childNodes) {
      const value = copy(child);
      if (value) clean.append(value);
    }
    return clean;
  };
  const svg = copy(original);
  const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0 || box[2] > 30000 || box[3] > 30000) throw new Error('Invalid diagram dimensions');
  svg.setAttribute('preserveAspectRatio', 'xMidYMin meet');
  svg.setAttribute('width', String(box[2]));
  svg.setAttribute('height', String(box[3]));
  svg.setAttribute('focusable', 'false');
  return { svg, width: box[2], height: box[3] };
}

function supportedSource(source) {
  if (!source.trim() || source.length > MAX_SOURCE_LENGTH || source.split('\n').length > 180) return false;
  // Configuration and interactive/asset syntax do not belong in a lesson graph.
  // Reject them before Mermaid touches a temporary DOM, not just after rendering.
  if (/^\s*---|%%\s*\{|@\{|@import|@font-face|url\s*\(|!\[/im.test(source)) return false;
  if (/(?:^|[;\n])\s*(?:click|link|links|style|classDef)\b/i.test(source)) return false;
  if (/\b(?:https?|data|javascript|vbscript|file|blob|ftp):/i.test(source)) return false;
  const withoutBreaks = source.replace(/<br\s*\/?>/gi, '');
  return !/<\s*\/?\s*[a-z][^>]*>/i.test(withoutBreaks);
}

function mermaid() {
  if (!library) library = import('mermaid').then(({ default: renderer }) => {
    renderer.initialize({
      startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
      layout: 'dagre', theme: 'base', fontFamily: 'Arial, sans-serif', fontSize: 16,
      suppressErrorRendering: true, logLevel: 'fatal', maxTextSize: MAX_SOURCE_LENGTH, maxEdges: 120,
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges',
        'suppressErrorRendering', 'htmlLabels', 'flowchart', 'themeCSS', 'dompurifyConfig', 'layout'],
      flowchart: { htmlLabels: false, useMaxWidth: false, wrappingWidth: 180 },
      sequence: { useMaxWidth: false, wrap: true },
      themeVariables: { primaryColor: '#f3eadb', primaryTextColor: '#382d23',
        primaryBorderColor: '#9b7955', lineColor: '#78634e', secondaryColor: '#edf0e5',
        tertiaryColor: '#fbf8f2', fontFamily: 'Arial, sans-serif' },
      dompurifyConfig: { FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'img', 'image', 'a', 'foreignObject'] },
    });
    return renderer;
  }).catch(error => { library = undefined; throw error; });
  return library;
}

function description(source, root) {
  const title = source.match(/^\s*accTitle\s*:\s*(.+)$/im)?.[1]?.trim();
  const detail = source.match(/^\s*accDescr\s*:\s*(.+)$/im)?.[1]?.trim()
    || source.match(/^\s*accDescr\s*\{([\s\S]*?)\}/im)?.[1]?.trim();
  let previous = root.previousElementSibling;
  while (previous && !/^H[2-6]$/.test(previous.tagName)) previous = previous.previousElementSibling;
  return { title: title || previous?.textContent?.trim() || 'Lesson diagram',
    detail: detail || 'Read the diagram source below for its steps and connections.' };
}

function prepare(pre) {
  const code = pre.querySelector(':scope > code.language-mermaid');
  const source = code.textContent;
  const id = `learning-diagram-${++sequence}`;
  const label = description(source, pre);
  const status = h('p', { class: 'learning-diagram-status', role: 'status', text: 'Drawing the diagram…' });
  const viewport = h('div', { class: 'learning-diagram-viewport', role: 'region',
    'aria-label': label.title, tabIndex: 0, hidden: true });
  const scrollHint = h('p', { id: `${id}-scroll-hint`, class: 'learning-diagram-scroll-hint', hidden: true,
    text: 'Scroll sideways or down to follow the flow. Use Fit diagram to see it all.' });
  const sourceDetails = h('details', { class: 'learning-diagram-source' },
    h('summary', { text: 'Read diagram source' }));
  const figure = h('figure', { class: 'learning-diagram', 'data-diagram-state': 'waiting', 'aria-labelledby': `${id}-caption` },
    h('figcaption', { id: `${id}-caption`, text: label.title }),
    h('p', { id: `${id}-description`, class: 'learning-diagram-description', text: label.detail }), status, scrollHint, viewport);
  const zoom = h('button', { type: 'button', class: 'learning-diagram-zoom', hidden: true,
    'aria-pressed': 'false', text: 'Enlarge diagram', onclick: () => {
      setZoom(state, figure.dataset.diagramZoom !== 'actual');
    } });
  figure.append(h('div', { class: 'learning-diagram-controls' }, zoom), sourceDetails);
  pre.replaceWith(figure);
  sourceDetails.append(pre);
  const state = { source, id, figure, viewport, sourceDetails, status, scrollHint, zoom, pending: false };
  figures.set(figure, state);
  return state;
}

function setZoom(state, enlarged) {
  state.figure.dataset.diagramZoom = enlarged ? 'actual' : 'fit';
  state.zoom.setAttribute('aria-pressed', String(enlarged));
  state.zoom.textContent = enlarged ? 'Fit diagram' : 'Enlarge diagram';
  state.scrollHint.hidden = !enlarged;
  if (enlarged) state.viewport.setAttribute('aria-describedby', state.scrollHint.id);
  else state.viewport.removeAttribute('aria-describedby');
  state.viewport.scrollTop = 0;
  state.viewport.scrollLeft = 0;
  // Begin at the first step when a wide top-to-bottom flow opens at readable
  // size. Otherwise the root can sit outside a phone's initial scroll window.
  const first = enlarged ? state.viewport.querySelector('.node, rect.actor') : null;
  if (first) {
    const box = first.getBoundingClientRect(), viewport = state.viewport.getBoundingClientRect();
    state.viewport.scrollLeft = Math.max(0, box.left + box.width / 2 - viewport.left - state.viewport.clientWidth / 2);
  }
}

function fallback(state) {
  state.figure.dataset.diagramState = 'fallback';
  state.status.textContent = 'This diagram could not be drawn. You can read its source below.';
  state.status.hidden = false;
  state.sourceDetails.open = true;
  state.zoom.hidden = true;
}

function draw(state) {
  if (state.pending || state.figure.dataset.diagramState === 'ready' || state.figure.dataset.diagramState === 'fallback') return;
  state.pending = true;
  state.figure.dataset.diagramState = 'loading';
  renderQueue = renderQueue.catch(() => {}).then(async () => {
    if (!state.figure.isConnected || !state.figure.getClientRects().length) {
      state.figure.dataset.diagramState = 'waiting';
      state.pending = false;
      return;
    }
    let staging;
    try {
      if (!supportedSource(state.source)) throw new Error('Unsupported diagram');
      const renderer = await mermaid();
      if (!state.figure.isConnected) { state.figure.dataset.diagramState = 'waiting'; return; }
      // A connected, off-screen container gives SVG text real measurements. It is
      // removed on success and failure; renderer-created nodes never become the
      // visible course graph. We intentionally never call bindFunctions.
      staging = h('div', { class: 'learning-diagram-staging', 'aria-hidden': 'true' });
      document.body.append(staging);
      const result = await renderer.render(`${state.id}-render`, state.source, staging);
      const { svg, width, height } = sanitizeDiagramSvg(result.svg, state.id);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-labelledby', `${state.id}-caption`);
      svg.setAttribute('aria-describedby', `${state.id}-description`);
      state.viewport.style.setProperty('--diagram-width', `${width}px`);
      state.viewport.style.setProperty('--diagram-height', `${height}px`);
      state.viewport.replaceChildren(svg);
      state.viewport.hidden = false;
      state.status.hidden = true;
      state.zoom.hidden = false;
      // Fitting a wide graph into a phone can turn 16px labels into 7px text.
      // Start at its readable size there, with an explicit way to see the whole
      // flow. Desktop starts fitted; the user's choice survives stage switches.
      setZoom(state, window.matchMedia('(max-width: 600px)').matches
        && width > state.viewport.clientWidth * 1.15);
      state.figure.dataset.diagramState = 'ready';
    } catch {
      fallback(state);
    } finally {
      staging?.remove();
      state.pending = false;
    }
  });
}

function scan(root) {
  if (!root.isConnected) return;
  // cloneNode copies generated markup but cannot copy listeners or WeakMap state.
  // Restore its original code and give this displayed clone its own safe SVG IDs.
  for (const figure of root.querySelectorAll('figure.learning-diagram')) {
    if (!figures.has(figure)) {
      const original = figure.querySelector('.learning-diagram-source pre');
      if (original) figure.replaceWith(original);
    }
  }
  for (const code of root.querySelectorAll(CODE_SELECTOR)) {
    if (code.closest('figure.learning-diagram') || !code.getClientRects().length) continue;
    draw(prepare(code.parentElement));
  }
  for (const figure of root.querySelectorAll('figure.learning-diagram')) {
    const state = figures.get(figure);
    if (state && figure.getClientRects().length) draw(state);
  }
}

/** Wait for visible diagrams before locating a reading destination beneath them. */
export function whenLearningDiagramsReady(root) {
  return new Promise(resolve => requestAnimationFrame(() => {
    scan(root);
    renderQueue.then(resolve, resolve);
  }));
}

/** Enhance sanitized lesson DOM once mounted, including a cloned reader stage. */
export function enhanceLearningDiagrams(root) {
  if (!root?.querySelectorAll) return root;
  if (!listeningRoots.has(root)) {
    listeningRoots.add(root);
    // Native details events do not bubble. Capture opening an answer or optional
    // reading section so its previously hidden diagrams can be measured then.
    root.addEventListener('toggle', () => enhanceLearningDiagrams(root), true);
  }
  if (!pendingRoots.has(root)) {
    pendingRoots.add(root);
    requestAnimationFrame(() => { pendingRoots.delete(root); scan(root); });
  }
  return root;
}
