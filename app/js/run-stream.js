/** One account-scoped activity connection. Commands still use the normal JSON API. */
export function createRunStream({
  signal,
  readSnapshot,
  onSnapshot,
  onState = () => {},
  onAccessLost = () => {},
  getCursor = () => ({ next: 0, epoch: '' }),
  EventSource: EventSourceImpl = globalThis.EventSource,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  reconnectDelays = [1000, 2000, 5000],
  probeDelay = 30000,
  heartbeatTimeout = 25000,
  activePollDelay = 5000,
  idlePollDelay = 15000,
} = {}) {
  let source, retryTimer, pollTimer, watchdog, pendingRead;
  let stopped = false, started = false, fallback = false, failures = 0;
  let delivery = 0, running = false, connection = '';
  const active = () => !stopped && !signal?.aborted;
  function state(value) {
    if (!active() || connection === value) return;
    connection = value;
    onState(value);
  }
  function closeSource() {
    clearTimer(watchdog);
    const old = source;
    source = null;
    old?.close();
  }
  function deliver(snapshot) {
    if (!snapshot || !Number.isSafeInteger(snapshot.next) || snapshot.next < 0 || !Array.isArray(snapshot.lines)) {
      throw new Error('Invalid activity update');
    }
    running = !!snapshot.running;
    delivery += 1;
    onSnapshot(snapshot);
  }
  function scheduleRead(delay) {
    clearTimer(pollTimer);
    if (active() && fallback) pollTimer = setTimer(read, delay);
  }
  async function read() {
    if (!active() || !fallback) return;
    if (pendingRead) return pendingRead;
    clearTimer(pollTimer);
    const previousDelivery = delivery;
    // Assign before invoking the reader, including readers that throw synchronously.
    pendingRead = Promise.resolve().then(() => readSnapshot(getCursor())).then(snapshot => {
      if (!active() || !fallback || previousDelivery !== delivery) return;
      deliver(snapshot);
      state('fallback');
    }).catch(error => {
      if (!active() || error.name === 'AbortError') return;
      if (error.status === 401 || error.status === 403) {
        close();
        onAccessLost(error);
        return;
      }
      if (fallback) state('offline');
    }).finally(() => {
      pendingRead = null;
      scheduleRead(running ? activePollDelay : idlePollDelay);
    });
    return pendingRead;
  }
  function useFallback() {
    fallback = true;
    state('fallback');
    read();
    if (EventSourceImpl && active()) retryTimer = setTimer(connect, probeDelay);
  }
  function failed(current) {
    if (!active() || (current && current !== source)) return;
    closeSource();
    clearTimer(retryTimer);
    failures += 1;
    if (fallback || failures > reconnectDelays.length) {
      useFallback();
      return;
    }
    state('reconnecting');
    retryTimer = setTimer(connect, reconnectDelays[failures - 1]);
  }
  function connect() {
    if (!active()) return;
    clearTimer(retryTimer);
    closeSource();
    if (!EventSourceImpl) { useFallback(); return; }
    if (!fallback) state(failures ? 'reconnecting' : 'connecting');
    const cursor = getCursor();
    const query = new URLSearchParams({ after: String(cursor.next || 0) });
    if (cursor.epoch) query.set('epoch', cursor.epoch);
    let current;
    try {
      current = new EventSourceImpl(`/api/events?${query}`, { withCredentials: true });
      source = current;
    } catch { failed(); return; }
    const armWatchdog = () => {
      clearTimer(watchdog);
      watchdog = setTimer(() => failed(current), heartbeatTimeout);
    };
    armWatchdog();
    current.addEventListener('run', event => {
      if (!active() || source !== current) return;
      try { deliver(JSON.parse(event.data)); } catch { failed(current); return; }
      fallback = false;
      failures = 0;
      clearTimer(pollTimer);
      state('live');
      armWatchdog();
    });
    current.addEventListener('error', () => failed(current));
    current.addEventListener('access-revoked', () => {
      if (!active() || source !== current) return;
      close();
      onAccessLost(Object.assign(new Error('Your access to this activity changed.'), { status: 403 }));
    });
  }
  function close() {
    if (stopped) return;
    stopped = true;
    closeSource();
    clearTimer(retryTimer);
    clearTimer(pollTimer);
    signal?.removeEventListener('abort', close);
  }
  signal?.addEventListener('abort', close, { once: true });
  return {
    start() { if (!started && active()) { started = true; connect(); } },
    close,
    refresh() { return fallback ? read() : Promise.resolve(); },
    get state() { return connection; },
  };
}

/** A single agent finishing is a refresh boundary even if another is still running. */
export function runLifecycleChanged(previous, current) {
  if (!previous) return { changed: false, finished: false };
  if (Array.isArray(current.runs) && Array.isArray(previous.runs)) {
    const before = new Map(previous.runs.map(run => [run.id, run]));
    const finished = current.runs.some(run => !run.running &&
      (before.get(run.id)?.running || (!before.has(run.id) && run.finished)));
    const signature = snapshot => JSON.stringify(snapshot.runs.map(run => [run.id, run.status, run.running, run.stopping]));
    return { changed: signature(previous) !== signature(current), finished };
  }
  return {
    changed: previous.running !== current.running || previous.stopping !== current.stopping || previous.last?.finished !== current.last?.finished,
    finished: (previous.running && !current.running) || (!!current.last?.finished && previous.last?.finished !== current.last.finished),
  };
}
