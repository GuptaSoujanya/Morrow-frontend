import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, routeHref } from '../app/js/router.js';
import { routeAccess, preloadRoute } from '../app/js/access-policy.js';

test('empty and known routes keep their established destinations', () => {
  for (const hash of ['', '#', '#/', '#/?ignored=value', '#/today']) {
    assert.deepEqual(parseHash(hash), { name: 'overview', arg: '' });
  }
  assert.deepEqual(parseHash('#/plans?module=automations'), { name: 'plans', arg: '' });
  assert.deepEqual(parseHash('#/dsa'), { name: 'learning', arg: 'dsa' });
  assert.deepEqual(parseHash('#/learning/plan'), { name: 'learning', arg: 'plan' });
  assert.deepEqual(parseHash(routeHref('files', 'resume draft.md')), { name: 'files', arg: 'resume draft.md' });
});

test('unknown and malformed routes resolve to a missing page instead of the workspace', () => {
  assert.deepEqual(parseHash('#/missing/nested?secret=private'), { name: 'not-found', arg: 'missing/nested' });
  assert.deepEqual(parseHash('#/files/%E0%A4%A'), { name: 'not-found', arg: 'files/%E0%A4%A' });
  assert.deepEqual(parseHash('#/Overview'), { name: 'not-found', arg: 'Overview' });
  assert.equal(parseHash('#/' + 'x'.repeat(1000)).arg.length, 160);
});

test('old research and study links resolve inside the unified Learning workspace', () => {
  for (const [hash, arg] of [
    ['#/research', ''], ['#/research?view=today', ''],
    ['#/research?view=learning', 'plan'], ['#/research?view=resume', 'resume'],
    ['#/research?view=library&q=cache', 'library'], ['#/research?date=2026-10-26', 'library'],
    ['#/research?view=progress', 'progress'], ['#/study?track=system-design', 'courses'],
    ['#/research/daily%2F2026-10-26%2Fpapers.md?view=today', 'read/daily/2026-10-26/papers.md'],
  ]) assert.deepEqual(parseHash(hash), { name: 'learning', arg }, hash);
  const id = 'daily/2026-10-26/100% useful.md';
  assert.deepEqual(parseHash(routeHref('research', id)), { name: 'learning', arg: 'read/' + id });
  assert.deepEqual(parseHash(routeHref('learning', 'read/' + id)), { name: 'learning', arg: 'read/' + id });
  assert.equal(routeHref('study'), '#/learning/courses');
});

test('a missing route never preloads private workspace content for any identity', () => {
  const route = parseHash('#/does-not-exist');
  for (const context of [
    {},
    { accountMode: 'accounts', user: null },
    { accountMode: 'accounts', user: { role: 'user', modules: ['profile'] } },
    { accountMode: 'accounts', user: { role: 'admin' }, legacyAccess: true },
    { accountMode: 'local', legacyAccess: true },
  ]) {
    assert.deepEqual(routeAccess(route, context), { kind: 'not-found' });
    assert.equal(preloadRoute(route, context), null);
  }
});
