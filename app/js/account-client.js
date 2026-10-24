import { accountRequestSignal, ApiError } from './api.js';
import { invalidateReads } from './query-client.js';

// Account documents and uploads share the same cancellation boundary as the workspace.
export async function accountRequest(path, { method = 'GET', body, binary = false } = {}) {
  const scope = accountRequestSignal();
  scope.throwIfAborted();
  let response;
  try {
    response = await fetch('/api/v1' + path, {
      method, credentials: 'same-origin', signal: AbortSignal.any([scope, AbortSignal.timeout(30000)]),
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' }),
        'X-CSRF-Token': document.cookie.split('; ').find(row => row.startsWith('morrow_csrf='))?.split('=').slice(1).join('=') || '',
      },
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
    });
  } catch (error) {
    scope.throwIfAborted();
    throw new ApiError(error.name === 'TimeoutError' ? 'The server did not confirm the result. Refresh saved setup before trying again.' : 'Could not reach the account service. Your changes are still here.', 0);
  }
  scope.throwIfAborted();
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  scope.throwIfAborted();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('account-expired'));
    const detail = data.detail;
    const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(item => item.msg).join('. ') : detail?.message || data.error || 'This request could not be completed.';
    throw new ApiError(message, response.status, data);
  }
  if (method !== 'GET') { await invalidateReads(); scope.throwIfAborted(); }
  return data;
}
