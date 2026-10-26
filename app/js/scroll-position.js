const MAX_PAGES = 48;
const MAX_HOLD_MS = 30_000;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/** Filters and report dates belong to the page the reader is already using. */
export function routeScrollKey(route) {
  const name = String(route?.name || 'overview').split('?')[0];
  const arg = name === 'reports' ? '' : String(route?.arg || '').split('?')[0];
  return `${name}/${arg}`;
}

/** Call begin before rendering, then its callback after each DOM commit. */
export function createScrollMemory(content) {
  const doc = content.ownerDocument, win = doc.defaultView;
  const positions = new Map();
  let currentKey = null, pending = null;
  // Hash history otherwise restores against a temporary loading screen.
  if ('scrollRestoration' in win.history) win.history.scrollRestoration = 'manual';

  const read = () => ({ x: win.scrollX, y: win.scrollY, height: content.getBoundingClientRect().height });
  function remember(key, position) {
    positions.delete(key);
    positions.set(key, position);
    if (positions.size > MAX_PAGES) positions.delete(positions.keys().next().value);
  }

  function begin(route, { reset = false } = {}) {
    const key = routeScrollKey(route), before = read(), samePage = key === currentKey;
    if (currentKey && (!pending || pending.committed)) remember(currentKey, before);
    const target = reset ? { x: 0, y: 0, height: 0 }
      : samePage ? pending && !pending.committed ? pending.target : before
        : positions.get(key) || { x: 0, y: 0, height: 0 };
    const contentTop = content.getBoundingClientRect().top + before.y;
    pending?.release();
    currentKey = key;

    const originalMinHeight = content.style.getPropertyValue('min-height');
    const originalMinPriority = content.style.getPropertyPriority('min-height');
    const anchors = [content, doc.documentElement, doc.body].filter(Boolean).map(element => ({
      element, value: element.style.getPropertyValue('overflow-anchor'), priority: element.style.getPropertyPriority('overflow-anchor'),
    }));
    const task = { target, committed: false, yielded: false, release: null };
    pending = task;
    let frame = 0, timeout = 0, quietFrames = 0, expected = null, lastScroll = before;

    // Keep enough document height for the remembered viewport while a loader
    // temporarily replaces the page. Returning pages may be taller than this one.
    if (target.y > 0) {
      const height = Math.max(target.height, target.y + win.innerHeight - contentTop);
      content.style.setProperty('min-height', `${Math.ceil(height)}px`);
    }
    anchors.forEach(({ element }) => element.style.setProperty('overflow-anchor', 'none'));

    function restore() {
      if (task.yielded || pending !== task) return;
      if (Math.abs(win.scrollY - target.y) > .5 || Math.abs(win.scrollX - target.x) > .5) {
        win.scrollTo({ left: target.x, top: target.y, behavior: 'instant' });
        expected = { x: win.scrollX, y: win.scrollY };
        lastScroll = expected;
      }
    }
    function busy() {
      return [...content.querySelectorAll('.state-loading, [aria-busy="true"]')].some(node =>
        !node.closest('button, [role="button"]') && node.getClientRects().length > 0);
    }
    function release() {
      observer.disconnect();
      win.cancelAnimationFrame(frame);
      win.clearTimeout(timeout);
      win.removeEventListener('wheel', yieldToUser, true);
      win.removeEventListener('touchstart', yieldToUser, true);
      win.removeEventListener('keydown', yieldToUser, true);
      win.removeEventListener('scroll', onScroll, true);
      if (originalMinHeight) content.style.setProperty('min-height', originalMinHeight, originalMinPriority);
      else content.style.removeProperty('min-height');
      anchors.forEach(({ element, value, priority }) => {
        if (value) element.style.setProperty('overflow-anchor', value, priority);
        else element.style.removeProperty('overflow-anchor');
      });
      if (pending === task) pending = null;
    }
    task.release = release;
    function finish() {
      if (pending !== task) return;
      if (task.committed) restore();
      release();
      // Releasing the spacer lets the browser clamp genuinely shorter results.
      // Reading layout first makes the saved position reflect that final height.
      content.getBoundingClientRect();
      if (task.committed) remember(key, read());
    }
    function check() {
      frame = 0;
      if (pending !== task || !task.committed) return;
      if (busy()) { quietFrames = 0; return; }
      if (++quietFrames < 2) frame = win.requestAnimationFrame(check);
      else finish();
    }
    function scheduleCheck() {
      quietFrames = 0;
      win.cancelAnimationFrame(frame);
      frame = win.requestAnimationFrame(check);
    }
    function yieldToUser(event) {
      if (event.type === 'keydown' && (!SCROLL_KEYS.has(event.key) || event.target?.closest?.('input, textarea, select, [contenteditable="true"]'))) return;
      task.yielded = true;
      expected = null;
      // Keep the temporary height until loading ends, but never restore again.
    }
    function onScroll(event) {
      if (![win, doc, doc.documentElement, doc.body].includes(event.target)) return;
      const point = { x: win.scrollX, y: win.scrollY };
      const matches = other => other && Math.abs(point.x - other.x) < 1 && Math.abs(point.y - other.y) < 1;
      if (!matches(expected) && !matches(lastScroll)) task.yielded = true;
      expected = null;
      lastScroll = point;
    }
    const observer = new win.MutationObserver(() => {
      if (!task.committed) return;
      restore();
      scheduleCheck();
    });
    observer.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy', 'hidden'] });
    win.addEventListener('wheel', yieldToUser, { passive: true, capture: true });
    win.addEventListener('touchstart', yieldToUser, { passive: true, capture: true });
    win.addEventListener('keydown', yieldToUser, true);
    win.addEventListener('scroll', onScroll, { passive: true, capture: true });
    timeout = win.setTimeout(finish, MAX_HOLD_MS);

    return () => {
      if (pending !== task) return;
      task.committed = true;
      restore();
      scheduleCheck();
    };
  }

  function clear() {
    pending?.release();
    positions.clear();
    currentKey = null;
  }
  return { begin, clear };
}
