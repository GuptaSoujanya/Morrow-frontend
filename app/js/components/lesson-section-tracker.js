const SECTION_SELECTOR = '[data-lesson-section]';
const SECTION_KEYS = new Set(['understand', 'example', 'try', 'interview']);

/** Follow reading position without changing navigation, focus or saved progress. */
export function trackLessonSections({ root, panel, toolbar, onActive }) {
  const win = root?.ownerDocument?.defaultView;
  if (!win?.IntersectionObserver || !win.ResizeObserver || !win.MutationObserver || !panel) {
    return { refresh() {}, dispose() {} };
  }
  let sections = [], bandObserver, viewportObserver, frame = 0, version = 0;
  let disposed = false, mounted = false, activeKey = null, bandSignature = '';

  function readingLine() {
    const height = Math.max(1, win.innerHeight);
    const heading = sections[0]?.querySelector('h3') || sections[0];
    // Match explicit section links, including the phone notes-bar clearance.
    let line = Math.max(16, heading ? parseFloat(win.getComputedStyle(heading).scrollMarginTop) || 0 : 0);
    if (toolbar?.isConnected && toolbar.getClientRects().length) {
      const style = win.getComputedStyle(toolbar);
      if (style.position === 'sticky') {
        // Before sticking, every chapter section is still below the toolbar.
        // Its eventual inset therefore works without a scroll event listener.
        line = Math.max(line, (parseFloat(style.top) || 0) + toolbar.getBoundingClientRect().height + 12);
      } else if (style.position === 'fixed') {
        line = Math.max(line, toolbar.getBoundingClientRect().bottom + 12);
      }
    }
    return Math.min(height - 1, Math.max(0, line));
  }

  function queueMeasure(expected = version) {
    if (disposed || expected !== version || frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      if (disposed || expected !== version || !root.isConnected) return;
      const line = readingLine();
      observeBand(line);
      const visible = sections.filter(section => panel.contains(section) && section.getClientRects().length);
      if (!visible.length) return;
      // Retain the preceding section through the gap before the next heading.
      let current = visible[0];
      for (const section of visible) {
        if (section.getBoundingClientRect().top <= line + 1) current = section;
        else break;
      }
      const key = current.dataset.lessonSection;
      if (key !== activeKey && expected === version) {
        activeKey = key;
        onActive?.(key);
      }
    });
  }

  function observeBand(line) {
    const height = Math.max(1, win.innerHeight);
    const signature = `${Math.round(line)}:${height}`;
    if (signature === bandSignature) return;
    bandSignature = signature;
    bandObserver?.disconnect();
    const expected = version;
    // A narrow reading line detects the start of each section, including when
    // a section is much taller than the viewport or follows an empty margin.
    bandObserver = new win.IntersectionObserver(() => queueMeasure(expected), {
      rootMargin: `-${Math.round(line)}px 0px -${Math.max(0, height - Math.round(line) - 2)}px 0px`,
      threshold: 0,
    });
    sections.forEach(section => bandObserver.observe(section));
  }

  const resizeObserver = new win.ResizeObserver(() => queueMeasure());
  function refresh() {
    if (disposed) return;
    ++version;
    win.cancelAnimationFrame(frame); frame = 0;
    bandObserver?.disconnect(); viewportObserver?.disconnect(); resizeObserver.disconnect();
    bandSignature = ''; activeKey = null;
    sections = root.classList.contains('lesson-show-all') ? [] : [...panel.querySelectorAll(SECTION_SELECTOR)]
      .filter(section => SECTION_KEYS.has(section.dataset.lessonSection));
    if (!root.isConnected) return;
    mounted = true;
    if (!sections.length) return;
    resizeObserver.observe(panel);
    if (toolbar) resizeObserver.observe(toolbar);
    sections.forEach(section => resizeObserver.observe(section));
    const expected = version;
    // Also notice a jump from before the lesson to beyond its end, where a
    // narrow line might otherwise miss every section between two frames.
    viewportObserver = new win.IntersectionObserver(() => queueMeasure(expected));
    viewportObserver.observe(panel);
    queueMeasure(expected);
  }

  const attachmentObserver = new win.MutationObserver(() => {
    if (disposed) return;
    if (!root.isConnected) { if (mounted) dispose(); }
    else if (!mounted) refresh();
  });
  attachmentObserver.observe(root.ownerDocument.documentElement, { childList: true, subtree: true });
  const resized = () => queueMeasure();
  win.addEventListener('resize', resized, { passive: true });
  root.ownerDocument.fonts?.ready.then(() => queueMeasure());

  function dispose() {
    if (disposed) return;
    disposed = true; ++version;
    win.cancelAnimationFrame(frame); frame = 0;
    bandObserver?.disconnect(); viewportObserver?.disconnect(); resizeObserver.disconnect();
    attachmentObserver.disconnect(); win.removeEventListener('resize', resized);
    sections = [];
  }
  refresh();
  return { refresh, dispose };
}
