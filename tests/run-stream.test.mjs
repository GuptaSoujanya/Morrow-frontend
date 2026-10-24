import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRunStream, runLifecycleChanged } from '../app/js/run-stream.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  let now = 0, sequence = 0;
  const timers = new Map(), sources = [], snapshots = [], states = [], accessLost = [];
  const account = new AbortController();
  let cursor = { next: 0, epoch: '' };
  class Source extends EventTarget {
    constructor(url, options) { super(); this.url = url; this.options = options; this.closed = false; sources.push(this); }
    close() { this.closed = true; }
    emit(value) { const event = new Event('run'); event.data = JSON.stringify(value); this.dispatchEvent(event); }
    fail() { this.dispatchEvent(new Event('error')); }
  }
  const stream = createRunStream({
    signal: account.signal,
    EventSource: Source,
    setTimer: (callback, delay) => { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimer: id => timers.delete(id),
    getCursor: () => cursor,
    onSnapshot: value => { snapshots.push(value); cursor = { next: value.next, epoch: value.epoch }; },
    onState: value => states.push(value),
    onAccessLost: error => accessLost.push(error.status),
    readSnapshot: async () => ({ next: 0, lines: [], running: false, epoch: 'server-a' }),
    ...options,
  });
  async function advance(milliseconds) {
    const target = now + milliseconds;
    for (;;) {
      const pending = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!pending) break;
      now = pending[1].at; timers.delete(pending[0]); pending[1].callback(); await flush();
    }
    now = target;
    await flush();
  }
  return { stream, account, sources, snapshots, states, accessLost, timers, advance };
}

test('live updates replace polling and reconnect with the last delivered cursor', async () => {
  let reads = 0;
  const h = harness({ readSnapshot: async () => { reads += 1; } });
  h.stream.start(); h.stream.start();
  assert.equal(h.sources.length, 1);
  assert.equal(h.sources[0].url, '/api/events?after=0');
  assert.equal(h.sources[0].options.withCredentials, true);
  h.sources[0].emit({ next: 12, epoch: 'server-a', lines: [[11, 'Learning', 'job-1']], running: true });
  assert.equal(h.stream.state, 'live');
  await h.advance(10000);
  h.sources[0].emit({ next: 12, epoch: 'server-a', lines: [], running: true });
  assert.equal(reads, 0);
  h.sources[0].fail();
  assert.equal(h.sources[0].closed, true);
  assert.equal(h.stream.state, 'reconnecting');
  await h.advance(1000);
  assert.equal(h.sources[1].url, '/api/events?after=12&epoch=server-a');
  // A queued message on a replaced connection cannot reach the current workspace.
  h.sources[0].emit({ next: 99, epoch: 'server-a', lines: [[98, 'Stale']], running: true });
  assert.equal(h.snapshots.length, 2);
  h.stream.close();
  assert.equal(h.timers.size, 0);
});

test('account reset closes the source and discards late stream messages', async () => {
  const h = harness(); h.stream.start();
  h.account.abort();
  h.sources[0].emit({ next: 1, epoch: 'old-user', lines: [[0, 'Private data']], running: true });
  h.sources[0].fail();
  await h.advance(120000);
  assert.equal(h.sources[0].closed, true);
  assert.equal(h.sources.length, 1);
  assert.equal(h.snapshots.length, 0);
  assert.equal(h.timers.size, 0);
});

test('server-side access revocation closes immediately without reconnecting or retaining late messages', async () => {
  const h = harness(); h.stream.start();
  h.sources[0].dispatchEvent(new Event('access-revoked'));
  assert.deepEqual(h.accessLost, [403]);
  assert.equal(h.sources[0].closed, true);
  h.sources[0].emit({ next: 1, epoch: 'revoked', lines: [[0, 'Private']], running: true });
  await h.advance(120000);
  assert.equal(h.sources.length, 1);
  assert.equal(h.snapshots.length, 0);
  assert.equal(h.timers.size, 0);
});

test('unavailable push falls back to single-flight reads and discards responses after account reset', async () => {
  const response = deferred(); let reads = 0;
  const h = harness({ EventSource: null, readSnapshot: () => { reads += 1; return response.promise; } });
  h.stream.start();
  const one = h.stream.refresh(), two = h.stream.refresh();
  await flush();
  assert.equal(reads, 1);
  h.account.abort();
  response.resolve({ next: 3, epoch: 'old-user', lines: [[2, 'Private']], running: true });
  await Promise.all([one, two]);
  await h.advance(120000);
  assert.equal(h.snapshots.length, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(reads, 1);
});

test('bounded reconnects enter fallback, then recover without accepting an older polling response', async () => {
  const response = deferred(); let reads = 0;
  const h = harness({ readSnapshot: () => { reads += 1; return response.promise; } });
  h.stream.start();
  for (const delay of [1000, 2000, 5000]) { h.sources.at(-1).fail(); await h.advance(delay); }
  h.sources.at(-1).fail(); await flush();
  assert.equal(h.stream.state, 'reconnecting');
  assert.equal(reads, 1);
  await h.advance(30000);
  h.sources.at(-1).emit({ next: 20, epoch: 'server-b', lines: [[19, 'Current']], running: true });
  assert.equal(h.stream.state, 'live');
  response.resolve({ next: 10, epoch: 'server-a', lines: [[9, 'Old polling data']], running: true });
  await flush();
  assert.equal(h.snapshots.length, 1);
  assert.equal(h.snapshots[0].epoch, 'server-b');
  await h.advance(10000);
  assert.equal(reads, 1);
  h.stream.close();
});

test('silent streams reconnect after the heartbeat deadline', async () => {
  const h = harness(); h.stream.start();
  h.sources[0].emit({ next: 1, epoch: 'server-a', lines: [], running: false });
  await h.advance(25000);
  assert.equal(h.stream.state, 'reconnecting');
  assert.equal(h.sources[0].closed, true);
  await h.advance(1000);
  assert.equal(h.sources.length, 2);
  h.stream.close();
});

test('fallback distinguishes a lost server from lost access and stops unauthorized reads', async () => {
  let reads = 0;
  const h = harness({ EventSource: null, readSnapshot: async () => {
    reads += 1;
    if (reads === 1) throw new TypeError('Disconnected');
    throw Object.assign(new Error('Access changed'), { status: 403 });
  } });
  h.stream.start(); await flush();
  assert.equal(h.stream.state, 'offline');
  await h.advance(15000);
  assert.deepEqual(h.accessLost, [403]);
  await h.advance(60000);
  assert.equal(reads, 2);
  assert.equal(h.timers.size, 0);
});

test('an individual completion refreshes data while another agent remains running', () => {
  const previous = { running: true, runs: [
    { id: 'learn', status: 'running', running: true },
    { id: 'research', status: 'running', running: true },
  ] };
  const current = { running: true, runs: [
    { id: 'learn', status: 'completed', running: false, finished: '2026-10-24T18:00:00' },
    { id: 'research', status: 'running', running: true },
  ] };
  assert.deepEqual(runLifecycleChanged(previous, current), { changed: true, finished: true });
  assert.deepEqual(runLifecycleChanged(current, { ...current, seconds: 8 }), { changed: false, finished: false });
});

test('a fast run observed only after completion still invalidates its output views', () => {
  assert.deepEqual(runLifecycleChanged({ runs: [] }, { runs: [
    { id: 'brief', status: 'completed', running: false, finished: '2026-10-24T18:00:00' },
  ] }), { changed: true, finished: true });
});

const runSnapshot = (revision, status = 'running', extra = {}) => ({
  next: 5, epoch: 'server-a', revision, lines: [], running: status === 'running',
  runs: [{ id: 'agent-a', action: 'naukri', label: 'Naukri', status, running: status === 'running' }],
  ...extra,
});

test('explicit refresh observes a stopped agent while SSE is live and ignores its older buffered running frame', async () => {
  const cursors = [];
  const h = harness({ readSnapshot: async cursor => { cursors.push(cursor); return runSnapshot(2, 'stopped'); } });
  h.stream.start(); h.sources[0].emit(runSnapshot(1));
  await h.stream.refresh();
  assert.deepEqual(cursors, [{ next: 5, epoch: 'server-a' }]);
  assert.equal(h.snapshots.at(-1).runs[0].status, 'stopped');
  assert.equal(h.stream.state, 'live');
  h.sources[0].emit(runSnapshot(1));
  assert.equal(h.snapshots.length, 2);
  assert.equal(h.snapshots.at(-1).runs[0].status, 'stopped');
  await h.advance(10000);
  assert.equal(cursors.length, 1);
  h.stream.close();
});

test('explicit refresh works while connecting or reconnecting without claiming that push is live', async () => {
  let revision = 1;
  const h = harness({ readSnapshot: async () => runSnapshot(revision++, 'failed') });
  h.stream.start();
  await h.stream.refresh();
  assert.equal(h.snapshots.at(-1).runs[0].status, 'failed');
  assert.equal(h.stream.state, 'connecting');
  h.sources[0].emit(runSnapshot(1, 'failed'));
  h.sources[0].fail();
  await h.stream.refresh();
  assert.equal(h.snapshots.at(-1).revision, 2);
  assert.equal(h.stream.state, 'reconnecting');
  assert.equal(h.states.at(-1), 'reconnecting');
  h.stream.close();
});

test('commands arriving during an older read share one follow-up and wait for that fresh result', async () => {
  const responses = [deferred(), deferred()], cursors = [];
  let reads = 0, inFlight = 0, maxInFlight = 0, done = false;
  const h = harness({ EventSource: null, readSnapshot: cursor => {
    cursors.push(cursor); inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    return responses[reads++].promise.finally(() => { inFlight -= 1; });
  } });
  h.stream.start(); await flush();
  assert.equal(h.stream.state, 'connecting');
  const first = h.stream.refresh(), second = h.stream.refresh();
  first.then(() => { done = true; });
  assert.equal(reads, 1);
  responses[0].resolve(runSnapshot(1)); await flush();
  assert.equal(reads, 2);
  assert.equal(done, false);
  assert.equal(maxInFlight, 1);
  assert.equal(h.snapshots.length, 0);
  assert.equal(h.stream.state, 'connecting');
  assert.deepEqual(cursors, [{ next: 0, epoch: '' }, { next: 0, epoch: '' }]);
  responses[1].resolve(runSnapshot(2, 'stopped'));
  await Promise.all([first, second]);
  assert.equal(h.snapshots.at(-1).runs[0].status, 'stopped');
  assert.equal(h.stream.state, 'fallback');
  h.stream.close();
});

test('a newer HTTP revision can follow SSE but an older HTTP revision cannot resurrect a run', async () => {
  const responses = [deferred(), deferred()]; let reads = 0;
  const h = harness({ readSnapshot: () => responses[reads++].promise });
  h.stream.start(); h.sources[0].emit(runSnapshot(1));
  const newer = h.stream.refresh(); await flush();
  h.sources[0].emit(runSnapshot(2));
  responses[0].resolve(runSnapshot(3, 'stopped')); await newer;
  assert.equal(h.snapshots.at(-1).runs[0].status, 'stopped');
  const older = h.stream.refresh(); await flush();
  h.sources[0].emit(runSnapshot(5, 'failed'));
  responses[1].resolve(runSnapshot(4)); await older;
  assert.equal(h.snapshots.at(-1).revision, 5);
  assert.equal(h.snapshots.at(-1).runs[0].status, 'failed');
  h.stream.close();
});

test('snapshot ordering protects both log cursors and retired server epochs', async () => {
  const h = harness({ readSnapshot: async () => runSnapshot(1, 'stopped', { epoch: 'server-b', next: 0, reset: true }) });
  h.stream.start(); h.sources[0].emit(runSnapshot(1));
  h.sources[0].emit(runSnapshot(2, 'failed', { next: 4 }));
  assert.equal(h.snapshots.length, 1);
  await h.stream.refresh();
  assert.equal(h.snapshots.at(-1).epoch, 'server-b');
  h.sources[0].emit(runSnapshot(999));
  assert.equal(h.snapshots.length, 2);
  assert.equal(h.snapshots.at(-1).runs[0].status, 'stopped');
  h.stream.close();
});

test('close and account reset abort an explicit read and discard late results or queued refreshes', async () => {
  for (const end of ['close', 'account']) {
    const response = deferred(); let requestSignal, reads = 0;
    const h = harness({ readSnapshot: (_cursor, { signal }) => { requestSignal = signal; reads += 1; return response.promise; } });
    h.stream.start(); h.sources[0].emit(runSnapshot(1));
    const first = h.stream.refresh(); await flush();
    const queued = h.stream.refresh();
    if (end === 'close') h.stream.close(); else h.account.abort();
    assert.equal(requestSignal.aborted, true);
    response.resolve(runSnapshot(2, 'stopped')); await Promise.all([first, queued]);
    await h.advance(60000);
    assert.equal(reads, 1);
    assert.equal(h.snapshots.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('fallback does not call old running metadata current until a snapshot succeeds', async () => {
  const response = deferred();
  const h = harness({ reconnectDelays: [], readSnapshot: () => response.promise });
  h.stream.start(); h.sources[0].emit(runSnapshot(1)); h.sources[0].fail(); await flush();
  assert.equal(h.stream.state, 'reconnecting');
  assert.equal(h.states.includes('fallback'), false);
  response.resolve(runSnapshot(2, 'failed')); await flush();
  assert.equal(h.snapshots.at(-1).runs[0].status, 'failed');
  assert.equal(h.stream.state, 'fallback');
  h.stream.close();
});
