import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFirebaseFlows, normalizeFirebaseActionLink } from '../app/js/firebase-auth.js';

const options = { provider: 'firebase', firebase: { apiKey: 'public-test-key', authDomain: 'test.firebaseapp.com', projectId: 'test', appId: 'test-app' }, csrf_token: 'old-challenge' };
const values = { name: 'Jamie Chen', email: 'jamie@example.com', password: 'Only-a-test-passphrase!' };
function harness({ verified = true, sdkChanges = {}, transport } = {}) {
  const calls = [], scope = new AbortController();
  const user = { emailVerified: verified, getIdToken: async force => { calls.push(['token', force]); return 'signed-token-fixture'; } };
  const credential = { user };
  const record = name => async (...args) => { calls.push([name, ...args]); };
  const sdk = {
    signInWithEmailAndPassword: async (...args) => { calls.push(['password', ...args]); return credential; },
    createUserWithEmailAndPassword: async (...args) => { calls.push(['register', ...args]); return credential; },
    updateProfile: record('profile'), sendEmailVerification: record('verify-email'), sendPasswordResetEmail: record('reset-email'),
    applyActionCode: record('apply-code'), verifyPasswordResetCode: record('check-reset'), confirmPasswordReset: record('confirm-reset'),
    signOut: record('sign-out'), signInWithPopup: async () => { calls.push(['popup']); return credential; },
    GoogleAuthProvider: class { setCustomParameters(value) { calls.push(['google-parameters', value]); } },
    ...sdkChanges,
  };
  const fetcher = transport || (async (path, request) => {
    calls.push(['fetch', path, request]);
    return { ok: true, status: 200, json: async () => path.endsWith('/options') ? { ...options, csrf_token: 'fresh-challenge' } : { authenticated: true } };
  });
  const flow = createFirebaseFlows({ loadClient: async () => ({ auth: 'memory-only-auth', sdk }), fetcher, getScope: () => scope.signal, origin: () => 'https://morrow.example' });
  return { ...flow, calls, scope };
}

test('verified login exchanges only an ID token and fresh CSRF, then clears the Firebase client session', async () => {
  const h = harness();
  assert.deepEqual(await h.runFirebaseAuth(options, 'login', values), { authenticated: true });
  const requests = h.calls.filter(([name]) => name === 'fetch');
  assert.deepEqual(requests.map(row => row[1]), ['/api/v1/auth/options', '/api/v1/auth/firebase/session']);
  const request = requests[1][2];
  assert.deepEqual(JSON.parse(request.body), { id_token: 'signed-token-fixture' });
  assert.equal(request.headers['X-CSRF-Token'], 'fresh-challenge');
  assert.equal(request.credentials, 'same-origin');
  assert.equal(h.calls.at(-1)[0], 'sign-out');
});
test('unverified email never opens a PostgreSQL account session', async () => {
  const h = harness({ verified: false });
  await assert.rejects(h.runFirebaseAuth(options, 'login', values), /Verify your email/);
  assert.equal(h.calls.some(([name]) => name === 'fetch'), false);
  assert.equal(h.calls.at(-1)[0], 'sign-out');
});
test('signup sends verification and returns to login without granting access', async () => {
  const h = harness();
  assert.match((await h.runFirebaseAuth(options, 'signup', values)).message, /Check your email/);
  assert.deepEqual(h.calls.find(([name]) => name === 'verify-email')[2], { url: 'https://morrow.example/#/login', handleCodeInApp: false });
  assert.equal(h.calls.some(([name]) => name === 'fetch'), false);
});
test('signup duplicate response does not reveal whether an account exists', async () => {
  const h = harness({ sdkChanges: { createUserWithEmailAndPassword: async () => { throw { code: 'auth/email-already-in-use' }; } } });
  assert.match((await h.runFirebaseAuth(options, 'signup', values)).message, /If this email is eligible/);
});
test('password recovery has the same result for existing and unknown emails', async () => {
  const known = harness(), unknown = harness({ sdkChanges: { sendPasswordResetEmail: async () => { throw { code: 'auth/user-not-found' }; } } });
  assert.deepEqual(await known.runFirebaseAuth(options, 'forgot', values), await unknown.runFirebaseAuth(options, 'forgot', values));
});
test('verification resend authenticates the supplied password before sending mail', async () => {
  const h = harness({ verified: false });
  await h.runFirebaseAuth(options, 'resend', values);
  assert.deepEqual(h.calls.filter(([name]) => ['password', 'verify-email'].includes(name)).map(row => row[0]), ['password', 'verify-email']);
});
test('already verified users receive a verified state without another email', async () => {
  const h = harness();
  assert.equal((await h.runFirebaseAuth(options, 'resend', values)).verified, true);
  assert.equal(h.calls.some(([name]) => name === 'verify-email'), false);
});
test('Google selection uses the same verified cookie exchange', async () => {
  const h = harness();
  assert.deepEqual(await h.runFirebaseAuth(options, 'google'), { authenticated: true });
  assert.deepEqual(h.calls.find(([name]) => name === 'google-parameters')[1], { prompt: 'select_account' });
  assert.equal(h.calls.some(([name]) => name === 'popup'), true);
});
test('expired email actions show a useful error and do not grant a session', async () => {
  const h = harness({ sdkChanges: { applyActionCode: async () => { throw { code: 'auth/expired-action-code' }; } } });
  await assert.rejects(h.runFirebaseAuth(options, 'verify', {}, new URLSearchParams({ oobCode: 'expired' })), /expired.*Request a new one/);
  assert.equal(h.calls.some(([name]) => name === 'fetch'), false);
});
test('password reset validates its code and keeps the new password out of backend requests', async () => {
  const h = harness();
  await h.runFirebaseAuth(options, 'reset', values, new URLSearchParams({ oobCode: 'reset-fixture' }));
  assert.deepEqual(h.calls.filter(([name]) => ['check-reset', 'confirm-reset'].includes(name)).map(row => row[0]), ['check-reset', 'confirm-reset']);
  assert.equal(h.calls.some(([name]) => name === 'fetch'), false);
  await assert.rejects(h.runFirebaseAuth(options, 'reset', { password: 'short' }), /between 12 and 128/);
});
test('a stale auth operation cannot exchange credentials after the account changes', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = harness({ sdkChanges: { signInWithEmailAndPassword: () => pending } });
  const operation = h.runFirebaseAuth(options, 'login', values);
  await new Promise(done => setImmediate(done));
  h.scope.abort(); resolve({ user: { emailVerified: true } });
  await assert.rejects(operation, { name: 'AbortError' });
  assert.equal(h.calls.some(([name]) => name === 'fetch'), false);
  assert.equal(h.calls.at(-1)[0], 'sign-out');
});
test('changed Firebase project settings prevent an exchange with the wrong backend', async () => {
  let requests = 0;
  const h = harness({ transport: async () => { requests++; return { ok: true, json: async () => ({ ...options, firebase: { ...options.firebase, projectId: 'other' }, csrf_token: 'fresh' }) }; } });
  await assert.rejects(h.runFirebaseAuth(options, 'login', values), /Sign-in settings changed/);
  assert.equal(requests, 1);
});
test('custom email actions remove URL tokens from query strings and never follow arbitrary return URLs', () => {
  const previousLocation = globalThis.location, previousHistory = globalThis.history;
  let replacement;
  try {
    globalThis.location = { pathname: '/', search: '?mode=resetPassword&oobCode=one-time&continueUrl=https://untrusted.example&apiKey=untrusted-key' };
    globalThis.history = { replaceState: (...args) => { replacement = args[2]; } };
    normalizeFirebaseActionLink();
    assert.equal(replacement, '/#/reset?oobCode=one-time');
  } finally { globalThis.location = previousLocation; globalThis.history = previousHistory; }
});
