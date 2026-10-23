/** Same-origin requests, scoped to the currently open account workspace. */
import { sentence } from './format.js';
import { queryClient, queryKey, invalidateReads } from './query-client.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let accountController = new AbortController();

/** Long-lived view work can capture this signal and discard results after a switch. */
export function accountRequestSignal() {
  return accountController.signal;
}

/** Run before clearing account state. Old responses must never repopulate that state. */
export function invalidateAccountRequests() {
  const previous = accountController;
  accountController = new AbortController();
  previous.abort(new DOMException('The account workspace changed.', 'AbortError'));
  window.__orbitInitialRequests?.clear();
  queryClient.clear();
}

function assertCurrent(scope) {
  scope.throwIfAborted();
}

/** GET when body is omitted, POST JSON otherwise. All delivery and callbacks are
 * checked after asynchronous boundaries, even when a transport ignores abort. */
async function request(path, body, { onOnline, signal, scope = accountRequestSignal() } = {}) {
  assertCurrent(scope);
  const options = {
    signal: AbortSignal.any([scope, signal, AbortSignal.timeout(20_000)].filter(Boolean)),
  };
  if (body !== undefined) Object.assign(options, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': document.cookie.split('; ').find(row => row.startsWith('morrow_csrf='))?.split('=').slice(1).join('=') || '',
    },
    body: JSON.stringify(body),
  });
  let reply;
  try {
    const initial = body === undefined && window.__orbitInitialRequests?.get(path);
    if (initial) window.__orbitInitialRequests.delete(path);
    reply = await (initial || fetch(path, options));
    assertCurrent(scope);
  } catch (error) {
    assertCurrent(scope);
    if (error.name === 'AbortError') throw error;
    if (error.name === 'TimeoutError') throw new ApiError(body === undefined
      ? 'The server is taking too long. Try again.'
      : 'The server did not confirm the result. Check Activity or reload the saved file before retrying.', 0);
    onOnline?.(false);
    throw new ApiError('Can’t reach the site’s server.', 0);
  }
  const data = await reply.json().catch(() => ({}));
  assertCurrent(scope);
  onOnline?.(true);
  if (!reply.ok) {
    if (reply.status === 401 && path !== '/api/session') window.dispatchEvent(new Event('account-expired'));
    throw new ApiError(sentence(data.error || (typeof data.detail === 'string' ? data.detail : '') || `${reply.status} ${reply.statusText}`), reply.status);
  }
  return data;
}

export async function api(path, body, { onOnline, fresh = false } = {}) {
  const scope = accountRequestSignal();
  if (body !== undefined) {
    const data = await request(path, body, { onOnline, scope });
    assertCurrent(scope);
    if (new URL(path, window.location.origin).pathname !== '/api/preview') await invalidateReads();
    assertCurrent(scope);
    return data;
  }
  const url = new URL(path, window.location.origin);
  // Live controls and editable source files must never be served from stale memory.
  if (['/api/session', '/api/run', '/api/status', '/api/file'].includes(url.pathname)) {
    const data = await request(path, undefined, { onOnline, scope });
    assertCurrent(scope);
    return data;
  }
  const key = queryKey(path);
  if (fresh) await queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' });
  assertCurrent(scope);
  let data;
  try {
    data = await queryClient.fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => request(path, undefined, { signal, onOnline, scope }),
      staleTime: url.pathname === '/api/meta' ? 300_000 : 30_000,
      retry: (count, error) => !scope.aborted && error.name !== 'AbortError' && count < 1 && (!error.status || error.status >= 500),
    });
  } catch (error) {
    // QueryClient cancellation uses its own error type; callers receive the same
    // AbortError as direct fetches when an account workspace was invalidated.
    assertCurrent(scope);
    throw error;
  }
  assertCurrent(scope);
  onOnline?.(true);
  return data;
}
