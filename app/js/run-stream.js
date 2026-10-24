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
  let latest;
  const retiredEpochs = new Set();
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
  function deliver(snapshot, previousDelivery = delivery) {
    if (!snapshot || !Number.isSafeInteger(snapshot.next) || snapshot.next < 0 || !Array.isArray(snapshot.lines)) {
      throw new Error('Invalid activity update');
    }
    const cursor = getCursor(), epoch = snapshot.epoch || '', currentEpoch = latest?.epoch || cursor.epoch || '';
    if (epoch && retiredEpochs.has(epoch)) return false;
    const changedEpoch = !!(epoch && currentEpoch && epoch !== currentEpoch);
    const comparable = Number.isSafeInteger(snapshot.revision) && Number.isSafeInteger(latest?.revision);
    if (changedEpoch) {
      // Epochs are opaque. An old in-flight read cannot decide that a server
      // restart happened after a newer delivery from the current connection.
      if (previousDelivery !== delivery) return false;
    } else {
      if (snapshot.next < cursor.next || (comparable && snapshot.revision < latest.revision)) return false;
      // A newer revision may legitimately arrive over HTTP after an SSE frame.
      // Without a newer revision, the intervening delivery wins that race.
      if (previousDelivery !== delivery && (!comparable || snapshot.revision <= latest.revision)) return false;
    }
    if (onSnapshot(snapshot) === false) return false;
    if (changedEpoch) retiredEpochs.add(currentEpoch);
    latest = snapshot;
    running = !!snapshot.running;
    delivery += 1;
    return true;
  }
  function scheduleRead(delay) {
    clearTimer(pollTimer);
    if (active() && fallback) pollTimer = setTimer(read, delay);
  }
  function read(explicit = false) {
    if (!active() || (!explicit && !fallback)) return Promise.resolve();
    if (pendingRead) {
      // A command may have finished after this request was sent. Coalesce those
      // commands into one follow-up, never a second concurrent request.
      if (explicit && pendingRead.started) pendingRead.again = true;
      return pendingRead.promise;
    }
    clearTimer(pollTimer);
    const work = { controller: new AbortController(), started: false, again: false };
    pendingRead = work;
    // Assign before invoking the reader, including readers that throw synchronously.
    work.promise = Promise.resolve().then(async () => {
      do {
        if (!active()) return;
        work.again = false; work.started = true;
        const previousDelivery = delivery;
        try {
          const snapshot = await readSnapshot(getCursor(), { signal: work.controller.signal });
          if (!active()) return;
          // A later command made this read insufficient. Keep its previous
          // state private and deliver only the request sent after that command.
          if (work.again) continue;
          const accepted = deliver(snapshot, previousDelivery);
          if (accepted && fallback) state('fallback');
        } catch (error) {
          if (!active() || error.name === 'AbortError') return;
          if (error.status === 401 || error.status === 403) {
            close(); onAccessLost(error); return;
          }
          if (fallback || connection !== 'live') state('offline');
        } finally { work.started = false; }
      } while (work.again && active());
    }).finally(() => {
      if (pendingRead === work) pendingRead = null;
      scheduleRead(running ? activePollDelay : idlePollDelay);
    });
    return work.promise;
  }
  function useFallback() {
    fallback = true;
    read();
    if (EventSourceImpl && active()) retryTimer = setTimer(connect, probeDelay);
  }
  function failed(current) {
    if (!active() || (current && current !== source)) return;
    closeSource();
    clearTimer(retryTimer);
    failures += 1;
    if (!fallback) state('reconnecting');
    if (fallback || failures > reconnectDelays.length) {
      useFallback();
      return;
    }
    retryTimer = setTimer(connect, reconnectDelays[failures - 1]);
  }
  function connect() {
    if (!active()) return;
    clearTimer(retryTimer);
    closeSource();
    if (!EventSourceImpl) { if (!connection) state('connecting'); useFallback(); return; }
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
      try { if (!deliver(JSON.parse(event.data))) return; } catch { failed(current); return; }
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
    pendingRead?.controller.abort();
    signal?.removeEventListener('abort', close);
  }
  signal?.addEventListener('abort', close, { once: true });
  return {
    start() { if (!started && active()) { started = true; connect(); } },
    close,
    refresh() { return read(true); },
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
