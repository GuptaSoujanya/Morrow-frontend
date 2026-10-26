/** Keep keyboard position when an async redraw replaces the focused control. */
export function createFocusRestorer(content) {
  let cancel = () => {};
  const clear = () => cancel();
  function prepare(key, selection) {
    clear();
    if (!key) return () => {};
    let active = true, observing = false;
    const lifecycle = new AbortController();
    const observer = new MutationObserver(restore);
    const timeout = setTimeout(stop, 30_000);
    function stop() {
      active = false;
      observer.disconnect();
      lifecycle.abort();
      clearTimeout(timeout);
    }
    function restore() {
      if (!active) return;
      const target = [...content.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === key);
      if (target && !target.disabled && target.getClientRects().length) {
        stop();
        target.focus({ preventScroll: true });
        if (selection && target.setSelectionRange) target.setSelectionRange(...selection);
      } else if (!observing) {
        observing = true;
        observer.observe(content, { childList: true, subtree: true });
      }
    }
    // A later action belongs to the user; don't pull focus back from it.
    for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      document.addEventListener(event, stop, { capture: true, passive: true, signal: lifecycle.signal });
    }
    document.addEventListener('focusin', event => {
      if (event.target !== document.body && event.target !== content) stop();
    }, { capture: true, signal: lifecycle.signal });
    cancel = stop;
    return restore;
  }
  return { prepare, clear };
}
