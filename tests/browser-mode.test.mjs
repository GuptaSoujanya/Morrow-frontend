import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BROWSER_MODES, browserRunOptions } from '../app/js/browser-mode.js';

const browserActions = ['naukri', 'boards', 'profile', 'external', 'linkedin', 'linkedin_profile', 'cold_email', 'resume', 'assist', 'pipeline'];

test('automation exposes normal Chrome and an optional background mode', () => {
  assert.deepEqual(BROWSER_MODES, [
    { value: 'visible', label: 'Normal Chrome window' },
    { value: 'background', label: 'Background — no browser window' },
  ]);
});

test('every browser-backed workflow defaults to visible Chrome without changing its other options', () => {
  for (const action of browserActions) {
    const options = Object.freeze({ dry_run: false, limit: 7, group: 'learn' });
    assert.deepEqual(browserRunOptions(action, options), { ...options, browser_mode: 'visible' }, action);
    assert.deepEqual(browserRunOptions(action), { browser_mode: 'visible' }, `${action} with omitted options`);
    assert.equal(Object.hasOwn(options, 'browser_mode'), false, `${action} leaves source options untouched`);
  }
});

test('legacy explicit headless preferences remain meaningful without mutation', () => {
  for (const action of browserActions) {
    for (const headless of [true, false]) {
      const options = Object.freeze({ headless, limit: 5 });
      assert.deepEqual(browserRunOptions(action, options), { limit: 5, browser_mode: headless ? 'background' : 'visible' }, `${action}, headless=${headless}`);
      assert.equal(options.headless, headless);
    }
  }
});

test('explicit mode overrides stale headless values without mutation', () => {
  for (const action of browserActions) {
    for (const [mode, stale] of [['visible', true], ['background', false]]) {
      const source = Object.freeze({ browser_mode: mode, headless: stale, dry_run: false });
      assert.deepEqual(browserRunOptions(action, source), { browser_mode: mode, dry_run: false }, `${action}, mode=${mode}`);
      assert.equal(source.browser_mode, mode);
      assert.equal(source.headless, stale);
    }
  }
});

test('nonbrowser actions preserve all supplied options and return a separate object', () => {
  for (const action of ['report', 'course', 'data', 'unknown']) {
    const source = Object.freeze({ day: '2026-10-24', headless: false, browser_mode: 'visible' });
    const copy = browserRunOptions(action, source);
    assert.deepEqual(copy, source, action);
    assert.notEqual(copy, source, action);
    copy.day = '2026-10-25';
    assert.equal(source.day, '2026-10-24');
    assert.deepEqual(browserRunOptions(action), {});
  }
});
