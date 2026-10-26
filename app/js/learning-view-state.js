/** Small, account-scoped learning preferences. Never store code or answer content. */
import { S } from './state.js';

const scopes = new WeakMap();
const PREFIX = 'morrow.learning-view.v1:';
const languages = new Set(['python', 'javascript', 'cpp']);
const steps = new Set(['concept', 'example', 'practice']);

function owner() {
  if (S.accountMode === 'local') return 'local';
  if (S.accountMode === 'accounts' && ['string', 'number'].includes(typeof S.user?.id) && String(S.user.id)) {
    return 'account:' + S.user.id;
  }
  return null;
}

function state(scope) {
  if (!scope || typeof scope !== 'object' || scope.aborted) return null;
  const namespace = owner();
  if (!namespace) return null;
  if (!scopes.has(scope)) scopes.set(scope, { owner: namespace, values: new Map() });
  const value = scopes.get(scope);
  return value.owner === namespace ? value : null;
}

function normalize(key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (key === 'dsa') {
    if (Object.keys(value).some(field => !['topic', 'step', 'problem'].includes(field))
        || typeof value.topic !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value.topic)
        || !steps.has(value.step)) return null;
    if (value.problem !== undefined && (typeof value.problem !== 'string' || !/^[1-9][0-9]{0,3}$/.test(value.problem))) return null;
    return { topic: value.topic, step: value.step, ...(value.problem !== undefined ? { problem: value.problem } : {}) };
  }
  if (typeof key === 'string' && /^language:dsa\/[a-z0-9-]{1,100}\/problem-[1-9][0-9]{0,3}$/.test(key)) {
    return Object.keys(value).length === 1 && languages.has(value.language) ? { language: value.language } : null;
  }
  return null;
}

function storageKey(namespace, key) {
  return PREFIX + encodeURIComponent(namespace) + ':' + encodeURIComponent(key);
}

/** Return a fresh validated preference object, or null when none is available. */
export function readLearningView(scope, key) {
  const session = state(scope);
  if (!session || typeof key !== 'string' || key.length > 180) return null;
  // A quota failure may reject writes while still allowing an older stored value
  // to be read. Keep this session's latest selection authoritative in that case.
  const remembered = session.values.get(key);
  if (remembered) return { ...remembered };
  try {
    const text = globalThis.localStorage?.getItem(storageKey(session.owner, key));
    if (text && text.length <= 1_000) {
      const stored = JSON.parse(text);
      const value = stored?.version === 1 ? normalize(key, stored.value) : null;
      if (value) session.values.set(key, value);
    }
  } catch { /* Private mode or unavailable storage: keep this account's memory fallback. */ }
  const value = session.values.get(key);
  return value ? { ...value } : null;
}

/** Save only recognised UI selections; storage denial still preserves this scope. */
export function writeLearningView(scope, key, value) {
  const session = state(scope), normalized = normalize(key, value);
  if (!session || !normalized) return false;
  session.values.set(key, normalized);
  try {
    globalThis.localStorage?.setItem(storageKey(session.owner, key), JSON.stringify({ version: 1, value: normalized }));
  } catch { /* Preference persistence must never block the coding workspace. */ }
  return true;
}
