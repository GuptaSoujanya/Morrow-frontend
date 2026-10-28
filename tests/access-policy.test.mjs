import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  routeAccess, navigationGroups, mobileRoutes, keyboardRoutes, preloadRoute, routeLabel,
} from '../app/js/access-policy.js';

const core = ['profile', 'applications', 'files'];
const free = { accountMode: 'accounts', legacyAccess: false, user: { id: 'free', role: 'user', modules: core } };
const allModules = [...core, 'automations', 'research', 'resumes', 'outreach', 'analytics', 'learning'];
const paid = { ...free, user: { id: 'paid', role: 'user', modules: allModules } };
const admin = { ...free, user: { id: 'admin', role: 'admin', modules: [] } };
const links = context => navigationGroups(context).flatMap(([, routes]) => routes);
const freeLinks = ['overview', 'records', 'data', 'files', 'connections', 'onboarding', 'plans', 'account'];
const runtime = ['bots', 'pipeline', 'todo', 'naukri', 'boards', 'sites', 'profile', 'linkedin', 'linkedin-profile', 'outreach', 'resume', 'study', 'reports'];

test('cold identity loading and account switches expose no navigation or private prefetches', () => {
  for (const context of [{}, { accountMode: null, legacyAccess: false }, { accountMode: null, user: admin.user, legacyAccess: true }]) {
    assert.deepEqual(links(context), []);
    assert.deepEqual(mobileRoutes(context), []);
    assert.deepEqual(keyboardRoutes(context), []);
    for (const route of ['overview', 'bots', 'records', 'files', 'admin']) {
      assert.equal(routeAccess(route, context).kind, 'loading');
      assert.equal(preloadRoute(route, context), null);
    }
  }
});

test('signed-out account mode never falls back to the local owner workspace', () => {
  const signedOut = { accountMode: 'accounts', user: null, legacyAccess: true };
  assert.deepEqual(links(signedOut), []);
  assert.equal(routeAccess('overview', signedOut).kind, 'login');
  assert.equal(routeAccess('admin', signedOut).kind, 'login');
  assert.equal(preloadRoute('overview', signedOut), null);
  assert.equal(routeAccess('login', signedOut).kind, 'allowed');
});

test('Free navigation stays identical on first load, account pages and reloads', () => {
  for (const name of ['overview', 'plans', 'account', 'files', 'bots']) {
    const context = { ...free, route: { name } };
    assert.deepEqual(links(context), freeLinks);
    assert.deepEqual(links(JSON.parse(JSON.stringify(context))), freeLinks);
    assert.deepEqual(mobileRoutes(context), ['overview', 'records', 'data', 'files']);
    assert.deepEqual(navigationGroups(context, { includeBotControls: true }).flatMap(([, routes]) => routes), freeLinks);
  }
  assert.equal(routeLabel('overview', free), 'Workspace');
});

test('Free route guards and preload decisions agree for every paid module and Action inbox', () => {
  for (const route of [...runtime, 'learning', 'research', 'analytics']) {
    assert.equal(routeAccess(route, free).kind, 'upgrade', route);
    assert.equal(preloadRoute(route, free), null, route);
  }
  assert.deepEqual(routeAccess('todo', free), { kind: 'upgrade', module: 'automations' });
  assert.equal(routeAccess('admin', free).kind, 'forbidden');
  assert.equal(preloadRoute('admin', free), null);
});

test('Free core content remains available and uses the private overview renderer', () => {
  for (const route of freeLinks) assert.equal(routeAccess(route, free).kind, 'allowed', route);
  assert.equal(preloadRoute('overview', free), 'tenant-overview');
  assert.equal(preloadRoute('records', free), 'records');
  assert.equal(preloadRoute('plans', free), null);
  assert.equal(preloadRoute('account', free), null);
});

test('a paid entitlement does not grant access to another account’s runtime', () => {
  for (const route of runtime) {
    assert.equal(routeAccess(route, paid).kind, 'runtime', route);
    assert.equal(preloadRoute(route, paid), null, route);
  }
  assert.ok(links(paid).includes('bots'));
  assert.ok(links(paid).includes('todo'));
  assert.ok(!links(paid).includes('admin'));
  assert.equal(routeAccess('research', paid).kind, 'allowed');
  assert.equal(preloadRoute('analytics', paid), 'tenant-overview');
});

test('administrator access covers every module but still respects workspace runtime ownership', () => {
  assert.ok(links(admin).includes('admin'));
  for (const route of runtime) assert.equal(routeAccess(route, admin).kind, 'runtime', route);
  for (const route of ['research', 'analytics', 'files', 'records', 'data']) {
    assert.equal(routeAccess(route, admin).kind, 'allowed', route);
  }
  const owner = { ...admin, legacyAccess: true };
  for (const route of runtime) assert.equal(routeAccess(route, owner).kind, 'allowed', route);
  assert.equal(preloadRoute('overview', owner), 'overview');
  assert.equal(preloadRoute('bots', owner), 'bots');
});

test('navigation recomputes on downgrade or user switch without retained paid links', () => {
  const current = structuredClone(paid);
  assert.ok(links(current).includes('bots'));
  current.user = structuredClone(free.user);
  assert.deepEqual(links(current), freeLinks);
  assert.equal(routeAccess('bots', current).kind, 'upgrade');
  current.user = null;
  assert.deepEqual(links(current), []);
  current.user = structuredClone(admin.user);
  assert.ok(links(current).includes('admin'));
  current.user = structuredClone(free.user);
  assert.deepEqual(links(current), freeLinks);
});

test('numeric shortcuts follow visible navigation and are inactive on authentication pages', () => {
  assert.deepEqual(keyboardRoutes(free), freeLinks);
  assert.equal(keyboardRoutes(free)[1], 'records');
  assert.deepEqual(keyboardRoutes({ ...free, route: { name: 'login' } }), []);
  assert.ok(!keyboardRoutes(free).some(route => runtime.includes(route)));
});

test('legacy access requires an explicit local server context and does not expose administrator routes', () => {
  const local = { accountMode: 'local', legacyAccess: true, user: null };
  assert.equal(routeAccess('bots', local).kind, 'allowed');
  assert.ok(links(local).includes('setup'));
  assert.ok(!links(local).includes('admin'));
  assert.ok(!links(local).includes('plans'));
  assert.equal(routeAccess('bots', { ...local, legacyAccess: false }).kind, 'forbidden');
});

test('free beta unlocks all workspace routes without an account or module grants', () => {
  const beta = { accountMode: 'local', legacyAccess: true, user: null };
  for (const route of [...runtime, 'learning', 'overview', 'research', 'analytics', 'records', 'files', 'data', 'setup', 'connections', 'onboarding']) {
    assert.equal(routeAccess(route, beta).kind, 'allowed', route);
    assert.equal(preloadRoute(route, beta), route, route);
  }
  for (const route of ['plans', 'account', 'admin', 'login', 'signup']) {
    assert.ok(!links(beta).includes(route), route);
  }
});

test('free beta redirects old account links without loading account screens', () => {
  const beta = { accountMode: 'local', legacyAccess: true, user: null };
  for (const name of ['login', 'signup', 'forgot', 'reset', 'verify', 'resend', 'plans', 'admin', 'account']) {
    assert.deepEqual(routeAccess(name, beta), { kind: 'redirect', route: ['account', 'onboarding'].includes(name)
      ? { name: 'files', arg: 'profile' } : { name: 'overview', arg: '' } });
    assert.equal(preloadRoute(name, beta), null);
  }
  // A stale account in memory cannot introduce a paid gate in beta mode.
  assert.equal(routeAccess('bots', { ...beta, user: free.user }).kind, 'allowed');
  assert.equal(routeAccess('login', {}).kind, 'loading');
  assert.equal(routeAccess('login', { accountMode: 'accounts', user: null }).kind, 'allowed');
});

test('missing permissions and unknown routes fail closed', () => {
  const incomplete = { ...free, user: { role: 'user' } };
  assert.equal(routeAccess('bots', incomplete).kind, 'upgrade');
  assert.equal(routeAccess('records', incomplete).kind, 'upgrade');
  assert.equal(routeAccess('unregistered-route', paid).kind, 'forbidden');
  assert.equal(preloadRoute('unregistered-route', admin), null);
  assert.equal(routeAccess({ name: 'files', arg: 'resume' }, { ...free, user: { role: 'user', modules: ['profile'] } }).kind, 'upgrade');
});

test('one Learning entry preserves private research access and protects shared runtime lessons', () => {
  const beta = { accountMode: 'local', legacyAccess: true, user: null };
  assert.deepEqual(mobileRoutes(beta), ['overview', 'learning', 'bots', 'todo']);
  for (const context of [beta, paid, admin]) {
    assert.equal(links(context).filter(name => name === 'learning').length, 1);
    assert.ok(!links(context).includes('research'));
    assert.ok(!links(context).includes('study'));
  }
  for (const context of [paid, admin]) {
    assert.deepEqual(routeAccess('learning', context), { kind: 'redirect', route: { name: 'learning', arg: 'library' } });
    for (const arg of ['library', 'read/daily/example.md', 'resume', 'weekly', 'discover', 'bookmarks', 'notes', 'progress']) {
      assert.equal(routeAccess({ name: 'learning', arg }, context).kind, 'allowed');
    }
    for (const arg of ['plan', 'dsa', 'courses']) {
      assert.equal(routeAccess({ name: 'learning', arg }, context).kind, 'runtime');
      assert.equal(preloadRoute({ name: 'learning', arg }, context), null);
    }
  }
  for (const arg of ['', 'library', 'read/daily/example.md', 'resume', 'plan', 'dsa', 'courses', 'progress', 'weekly', 'discover', 'bookmarks', 'notes']) {
    assert.equal(routeAccess({ name: 'learning', arg }, beta).kind, 'allowed');
    assert.equal(routeAccess({ name: 'learning', arg }, free).kind, 'upgrade');
  }
});
