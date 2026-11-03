import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVisibleRunStream } from '../app/js/visible-run-stream.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const snapshot = (next, extra = {}) => ({ next, epoch: 'server-a', lines: [], running: false, ...extra });

function harness({ hidden = false, read } = {}) {
  const account = new AbortController(), page = new EventTarget();
  const sources = [], snapshots = [], timers = new Map();
  let cursor = { next: 0, epoch: '' }, now = 0, timerId = 0, reads = 0;
  page.hidden = hidden;
  class Source extends EventTarget {
    constructor(url) { super(); this.url = url; this.closed = false; sources.push(this); }
    close() { this.closed = true; }
    emit(value) { const event = new Event('run'); event.data = JSON.stringify(value); this.dispatchEvent(event); }
  }
  const stream = createVisibleRunStream({
    document: page, signal: account.signal, EventSource: Source,
    getCursor: () => cursor,
    onSnapshot: value => { snapshots.push(value); cursor = { next: value.next, epoch: value.epoch }; },
    readSnapshot: (position, options) => { reads += 1; return read ? read(position, options) : Promise.resolve(snapshot(position.next + 1)); },
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimer: id => timers.delete(id),
  });
  return {
    stream, account, sources, snapshots, timers, get reads() { return reads; },
    visibility(value) { page.hidden = value; page.dispatchEvent(new Event('visibilitychange')); },
    async advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
      }
      now = target; await flush();
    },
  };
}

test('hidden tabs release SSE, keep job notifications, and resume from their accepted cursor', async () => {
  const notification = { id: 'answer-1', kind: 'answer_saved' };
  const h = harness({ read: async cursor => snapshot(cursor.next + 1, { notifications: [notification] }) });
  h.stream.start(); h.stream.start();
  assert.equal(h.sources.length, 1);
  h.sources[0].emit(snapshot(7, { running: true }));
  h.visibility(true); await flush();
  assert.equal(h.sources[0].closed, true);
  assert.equal(h.stream.state, 'fallback');
  assert.equal(h.snapshots.at(-1).running, false);
  assert.deepEqual(h.snapshots.at(-1).notifications, [notification]);
  const accepted = h.snapshots.length;
  h.sources[0].emit(snapshot(999));
  assert.equal(h.snapshots.length, accepted);
  await h.advance(35000);
  assert.equal(h.sources.length, 1, 'hidden polling must never probe a persistent connection');
  const cursor = h.snapshots.at(-1).next;
  h.visibility(false); h.visibility(false);
  assert.equal(h.sources.length, 2);
  assert.equal(h.sources[1].url, `/api/events?after=${cursor}&epoch=server-a`);
  h.sources[1].emit(snapshot(cursor));
  const reads = h.reads;
  await h.advance(10000);
  assert.equal(h.reads, reads, 'visible live updates replace hidden polling');
  h.stream.close();
});

test('a workspace opened in a hidden tab never reserves a streaming socket', async () => {
  const h = harness({ hidden: true });
  h.stream.start(); await flush();
  await h.advance(31000);
  assert.equal(h.sources.length, 0);
  assert.ok(h.reads >= 2);
  h.visibility(false);
  assert.equal(h.sources.length, 1);
  assert.match(h.sources[0].url, /epoch=server-a/);
  h.stream.close();
});

test('hidden refreshes are single-flight and a command queues only one fresh follow-up', async () => {
  const pending = [];
  const h = harness({ hidden: true, read: () => new Promise(resolve => pending.push(resolve)) });
  h.stream.start(); await flush();
  const first = h.stream.refresh(), second = h.stream.refresh();
  assert.equal(h.reads, 1);
  pending[0](snapshot(1)); await flush();
  assert.equal(h.reads, 2);
  assert.equal(h.snapshots.length, 0, 'a pre-command response must not replace a newer job state');
  pending[1](snapshot(2)); await Promise.all([first, second]);
  assert.equal(h.snapshots.length, 1);
  assert.equal(h.snapshots[0].next, 2);
  h.stream.close();
});

test('returning to the tab aborts an old poll and ignores its late response', async () => {
  let resolve, signal;
  const h = harness({ hidden: true, read: (_cursor, options) => {
    signal = options.signal; return new Promise(done => { resolve = done; });
  } });
  h.stream.start(); await flush();
  h.visibility(false);
  assert.equal(signal.aborted, true);
  h.sources[0].emit(snapshot(10));
  resolve(snapshot(99)); await flush();
  assert.deepEqual(h.snapshots.map(value => value.next), [10]);
  h.stream.close();
});

test('account abort and page cleanup stop polls, listeners, and late delivery', async () => {
  for (const end of ['abort', 'close']) {
    let resolve, signal;
    const h = harness({ hidden: true, read: (_cursor, options) => {
      signal = options.signal; return new Promise(done => { resolve = done; });
    } });
    h.stream.start(); await flush();
    if (end === 'abort') h.account.abort(); else h.stream.close();
    assert.equal(signal.aborted, true);
    resolve(snapshot(88)); await flush();
    h.visibility(false); h.visibility(true); h.stream.start();
    await h.stream.refresh(); await h.advance(60000);
    assert.equal(h.snapshots.length, 0);
    assert.equal(h.sources.length, 0);
    assert.equal(h.reads, 1);
    assert.equal(h.timers.size, 0);
  }
});
