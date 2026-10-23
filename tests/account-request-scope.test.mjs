import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import { api, accountRequestSignal, invalidateAccountRequests } from '../app/js/api.js';
import { queryClient, queryKey } from '../app/js/query-client.js';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
let browser;
// Detached old queries can settle after removal; keep their GC timers out of the
// Node process while retaining the production request/cache behavior under test.
queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity } });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function reply(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => value };
}
beforeEach(() => {
  browser = Object.assign(new EventTarget(), {
    location: { origin: 'http://127.0.0.1:8100' }, __orbitInitialRequests: new Map(),
  });
  globalThis.window = browser;
  globalThis.document = { cookie: 'morrow_csrf=synthetic-csrf' };
  invalidateAccountRequests();
});
afterEach(() => invalidateAccountRequests());
after(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});

test('late private file response cannot resolve after account reset, even if transport ignores abort', async () => {
  const transport = deferred();
  let fetchSignal;
  const online = [];
  globalThis.fetch = (_path, options) => { fetchSignal = options.signal; return transport.promise; };
  const oldScope = accountRequestSignal();
  const oldRequest = api('/api/file?name=profile', undefined, { onOnline: value => online.push(value) });
  const rejected = assert.rejects(oldRequest, { name: 'AbortError' });
  invalidateAccountRequests();
  assert.ok(oldScope.aborted && fetchSignal.aborted);
  assert.notEqual(accountRequestSignal(), oldScope);
  assert.equal(accountRequestSignal().aborted, false);
  transport.resolve(reply({ text: 'Alice private profile' }));
  await rejected;
  assert.deepEqual(online, []);
  globalThis.fetch = async () => reply({ text: 'Bob private profile' });
  assert.deepEqual(await api('/api/file?name=profile'), { text: 'Bob private profile' });
});

test('response JSON still being parsed cannot expire the newly opened account', async () => {
  const parsed = deferred(), parsing = deferred();
  const online = [];
  let expired = 0;
  browser.addEventListener('account-expired', () => { expired += 1; });
  globalThis.fetch = async () => ({ ok: false, status: 401, json: () => { parsing.resolve(); return parsed.promise; } });
  const request = api('/api/file?name=profile', undefined, { onOnline: value => online.push(value) });
  const rejected = assert.rejects(request, { name: 'AbortError' });
  await parsing.promise;
  invalidateAccountRequests();
  parsed.resolve({ error: 'Previous session expired' });
  await rejected;
  assert.equal(expired, 0);
  assert.deepEqual(online, []);
});

test('late cached query cannot overwrite a new account query using the same URL', async () => {
  const oldTransport = deferred();
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? oldTransport.promise : reply({ owner: 'Bob' });
  const oldRequest = api('/api/overview');
  const rejected = assert.rejects(oldRequest, { name: 'AbortError' });
  invalidateAccountRequests();
  assert.deepEqual(await api('/api/overview'), { owner: 'Bob' });
  oldTransport.resolve(reply({ owner: 'Alice' }));
  await rejected;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(queryClient.getQueryData(queryKey('/api/overview')), { owner: 'Bob' });
  assert.equal(calls, 2);
});

test('cancelled POST cannot invalidate or populate the new account cache', async () => {
  const mutation = deferred();
  let options;
  globalThis.fetch = (_path, requestOptions) => { options = requestOptions; return mutation.promise; };
  const oldRequest = api('/api/file', { name: 'profile', text: 'Alice update', revision: '1' });
  const rejected = assert.rejects(oldRequest, { name: 'AbortError' });
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['X-CSRF-Token'], 'synthetic-csrf');
  invalidateAccountRequests();
  const key = queryKey('/api/overview');
  queryClient.setQueryData(key, { owner: 'Bob' });
  assert.ok(options.signal.aborted);
  mutation.resolve(reply({ ok: true, revision: '2' }));
  await rejected;
  assert.deepEqual(queryClient.getQueryData(key), { owner: 'Bob' });
  assert.equal(queryClient.getQueryState(key).isInvalidated, false);
});

test('preloaded responses from an earlier workspace are discarded before authentication boot', async () => {
  browser.__orbitInitialRequests.set('/api/meta', Promise.resolve(reply({ owner: 'Alice' })));
  invalidateAccountRequests();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return reply({ owner: 'Bob' }); };
  assert.deepEqual(await api('/api/meta'), { owner: 'Bob' });
  assert.equal(calls, 1);
});

test('a reset during fresh-cache invalidation prevents a new fetch under the old scope', async () => {
  const invalidating = deferred();
  const originalInvalidate = queryClient.invalidateQueries;
  let calls = 0;
  queryClient.invalidateQueries = () => invalidating.promise;
  globalThis.fetch = async () => { calls += 1; return reply({ owner: 'Wrong account' }); };
  try {
    const oldRequest = api('/api/overview', undefined, { fresh: true });
    const rejected = assert.rejects(oldRequest, { name: 'AbortError' });
    invalidateAccountRequests();
    invalidating.resolve();
    await rejected;
    assert.equal(calls, 0);
  } finally {
    queryClient.invalidateQueries = originalInvalidate;
  }
});

test('network rejection from an abandoned account does not mark the current workspace offline', async () => {
  const transport = deferred(), online = [];
  globalThis.fetch = () => transport.promise;
  const oldRequest = api('/api/status', undefined, { onOnline: value => online.push(value) });
  const rejected = assert.rejects(oldRequest, { name: 'AbortError' });
  invalidateAccountRequests();
  transport.reject(new TypeError('Connection lost'));
  await rejected;
  assert.deepEqual(online, []);
});

test('current-account unauthorized response still emits the expected expiration event', async () => {
  let expired = 0;
  browser.addEventListener('account-expired', () => { expired += 1; });
  globalThis.fetch = async () => reply({ detail: 'Sign in first' }, 401);
  await assert.rejects(api('/api/file?name=profile'), { name: 'ApiError', status: 401 });
  assert.equal(expired, 1);
});

test('an explicitly cancelled cached request is not retried', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new DOMException('Cancelled', 'AbortError'); };
  await assert.rejects(api('/api/overview'), { name: 'AbortError' });
  assert.equal(calls, 1);
});
