import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BROWSER_MODES, browserRunOptions } from '../app/js/browser-mode.js';

const browserActions = ['naukri', 'boards', 'profile', 'external', 'linkedin', 'linkedin_profile', 'cold_email', 'resume', 'assist', 'pipeline'];

test('browser choices distinguish background execution from watching a Chrome window', () => {
  assert.deepEqual(BROWSER_MODES, [
    { value: 'background', label: 'Background — no browser window' },
    { value: 'visible', label: 'Visible — watch Chrome' },
  ]);
});

test('every browser-backed workflow defaults to background without changing its other options', () => {
  for (const action of browserActions) {
    const options = Object.freeze({ dry_run: false, limit: 7, group: 'learn' });
    assert.deepEqual(browserRunOptions(action, options), { ...options, browser_mode: 'background' }, action);
    assert.deepEqual(browserRunOptions(action), { browser_mode: 'background' }, `${action} with omitted options`);
    assert.equal(Object.hasOwn(options, 'browser_mode'), false, `${action} leaves source options untouched`);
  }
});

test('saved legacy headless choices remain effective and are replaced with one canonical browser mode', () => {
  for (const action of browserActions) {
    for (const [headless, expected] of [[true, 'background'], [false, 'visible']]) {
      const options = Object.freeze({ headless, limit: 5 });
      assert.deepEqual(browserRunOptions(action, options), { limit: 5, browser_mode: expected }, `${action}, headless=${headless}`);
      assert.equal(options.headless, headless);
    }
  }
});

test('an explicitly chosen browser mode wins over stale legacy settings', () => {
  for (const action of browserActions) {
    for (const [mode, stale] of [['visible', true], ['background', false]]) {
      const source = Object.freeze({ browser_mode: mode, headless: stale, dry_run: false });
      assert.deepEqual(browserRunOptions(action, source), { browser_mode: mode, dry_run: false }, `${action}, mode=${mode}`);
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
