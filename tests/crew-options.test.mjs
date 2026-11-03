import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crewRunSpec } from '../app/js/crew-options.js';

const naukri = { id: 'naukri', name: 'Naukri', action: 'naukri' };
const profile = { id: 'profile', name: 'Naukri profile', action: 'profile' };
const hirist = { id: 'hirist', name: 'Hirist', action: 'boards' };

test('crew runs preserve configured Naukri early-access filters and collection limit', () => {
  const forms = { naukri: {
    keywords: 'Platform engineer', location: 'Bengaluru', limit: '20',
    early_access: true, early_access_only: true, early_access_limit: '80',
    min_score: '70', max_days_old: '14', dry_run: true,
  } };
  const original = structuredClone(forms);
  const run = crewRunSpec(naukri, forms, 'background');
  assert.deepEqual(run.options, {
    keywords: 'Platform engineer', location: 'Bengaluru', limit: '20',
    early_access: true, early_access_only: true, early_access_limit: '80',
    min_score: '70', max_days_old: '14', dry_run: false, browser_mode: 'background',
  });
  assert.equal(run.ready, true);
  assert.deepEqual(forms, original, 'creating a live crew command must not overwrite the saved form');
});

test('a due-only profile run keeps its schedule condition and full-review choice', () => {
  assert.deepEqual(crewRunSpec(profile, { profile: { if_due: true, review: true, dry_run: true } }).options, {
    if_due: true, review: true, dry_run: false, browser_mode: 'visible',
  });
});

test('board application runs keep profile refresh without inheriting another selected board or mode', () => {
  const forms = { boards: { board: 'wellfound', mode: 'profile', limit: '12', update_profile: true, dry_run: true } };
  const run = crewRunSpec(hirist, forms);
  assert.deepEqual(run.options, {
    board: 'hirist', limit: '12', update_profile: true, dry_run: false, browser_mode: 'visible',
  });
  assert.equal(run.key, 'hirist');
  assert.equal(run.action, 'boards');
});

test('board profile cards retain their exact profile action with shared refresh settings', () => {
  const bot = { id: 'hirist_profile', board: 'hirist', name: 'Hirist profile', action: 'boards', mode: 'profile' };
  const run = crewRunSpec(bot, { boards: { board: 'wellfound', mode: 'apply', update_profile: true } });
  assert.equal(run.options.board, 'hirist');
  assert.equal(run.options.mode, 'profile');
  assert.equal(run.options.update_profile, true);
});

test('explicitly disabled configuration choices remain disabled in crew commands', () => {
  assert.deepEqual(crewRunSpec(naukri, { naukri: { early_access: false, early_access_only: false, early_access_limit: '' } }).options, {
    early_access: false, early_access_only: false, early_access_limit: '', dry_run: false, browser_mode: 'visible',
  });
  assert.equal(crewRunSpec(profile, { profile: { if_due: false } }).options.if_due, false);
  assert.equal(crewRunSpec(hirist, { boards: { update_profile: false } }).options.update_profile, false);
});

test('unconfigured crew runs keep existing defaults without adding optional flags', () => {
  assert.deepEqual(crewRunSpec(naukri).options, { dry_run: false, browser_mode: 'visible' });
  assert.deepEqual(crewRunSpec(profile).options, { dry_run: false, browser_mode: 'visible' });
  assert.deepEqual(crewRunSpec(hirist).options, { board: 'hirist', dry_run: false, browser_mode: 'visible' });
});
