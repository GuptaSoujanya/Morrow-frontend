import { createRunStream } from './run-stream.js';

/** Hidden tabs release their persistent socket, but still receive job updates
 * and answer notifications through the stream's single-flight JSON polling. */
export function createVisibleRunStream({ document: page = globalThis.document, ...options } = {}) {
  let transport, hidden, started = false, closed = false;
  const active = () => !closed && !options.signal?.aborted;

  function updateVisibility() {
    if (!started || !active()) return;
    const nextHidden = Boolean(page?.hidden);
    if (transport && hidden === nextHidden) return;
    // close() also aborts a pending snapshot and removes reconnect/watchdog
    // timers. A retired transport cannot deliver late results to this account.
    transport?.close();
    hidden = nextHidden;
    transport = createRunStream({
      ...options,
      ...(hidden ? { EventSource: null } : {}),
      onAccessLost: error => { close(); options.onAccessLost?.(error); },
    });
    // getCursor belongs to the workspace, so each replacement resumes at the
    // last accepted line and server epoch without replaying delivered updates.
    transport.start();
  }

  function close() {
    if (closed) return;
    closed = true;
    transport?.close();
    page?.removeEventListener('visibilitychange', updateVisibility);
    options.signal?.removeEventListener('abort', close);
  }

  if (active()) options.signal?.addEventListener('abort', close, { once: true });
  return {
    start() {
      if (started || !active()) return;
      started = true;
      page?.addEventListener('visibilitychange', updateVisibility);
      updateVisibility();
    },
    close,
    refresh() { return active() ? transport?.refresh() || Promise.resolve() : Promise.resolve(); },
    get state() { return transport?.state || ''; },
  };
}
