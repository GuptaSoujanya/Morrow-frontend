const REVEAL_SELECTOR = '[data-learning-reveal]';

/** Gentle entrances on native scroll. Content is always readable without motion. */
export function setupLearningMotion(root) {
  const win = root?.ownerDocument?.defaultView;
  if (!win?.IntersectionObserver || !win.MutationObserver) return () => {};
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const seen = new WeakSet(), seenKeys = new Set(), observed = new Set(), animations = new Map();
  let disposed = false;

  function reveal(element) {
    observer.unobserve(element); observed.delete(element);
    if (disposed || !root.contains(element) || seen.has(element)) return;
    seen.add(element);
    const key = element.getAttribute('data-learning-reveal');
    if (key && seenKeys.has(key)) return;
    if (key) seenKeys.add(key);
    if (reducedMotion.matches || typeof element.animate !== 'function') return;
    const animation = element.animate([
      { opacity: .45, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' });
    animations.set(element, animation);
    const finished = () => { if (animations.get(element) === animation) animations.delete(element); };
    animation.addEventListener('finish', finished, { once: true });
    animation.addEventListener('cancel', finished, { once: true });
  }
  const observer = new win.IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) reveal(entry.target); });
  }, { threshold: 0, rootMargin: '0px 0px -24px 0px' });

  function observe(element) {
    if (seen.has(element) || observed.has(element) || !root.contains(element)) return;
    const key = element.getAttribute('data-learning-reveal');
    if (key && seenKeys.has(key)) { seen.add(element); return; }
    observed.add(element); observer.observe(element);
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(REVEAL_SELECTOR)) observe(node);
    node.querySelectorAll(REVEAL_SELECTOR).forEach(observe);
  }
  const mutations = new win.MutationObserver(records => {
    for (const record of records) record.addedNodes.forEach(scan);
    for (const element of observed) {
      if (!root.contains(element)) { observer.unobserve(element); observed.delete(element); }
    }
    for (const [element, animation] of animations) {
      if (!root.contains(element)) animation.cancel();
    }
  });
  function cancelAnimations() { for (const animation of animations.values()) animation.cancel(); }
  const preferenceChanged = () => { if (reducedMotion.matches) cancelAnimations(); };
  reducedMotion.addEventListener('change', preferenceChanged);
  mutations.observe(root, { childList: true, subtree: true });
  scan(root);

  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect(); mutations.disconnect(); observed.clear();
    reducedMotion.removeEventListener('change', preferenceChanged);
    cancelAnimations(); animations.clear(); seenKeys.clear();
  };
}
