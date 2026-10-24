import test from 'node:test';
import assert from 'node:assert/strict';
import {activityRuns, activityState, readableActivity, activityDescription} from '../app/js/components/activity-format.js';

test('successful individual steps never decide whether a run completed', () => {
  for (const line of ['Login completed.', 'Applied! Total: 12', 'all done', '✓ Learning — done (12s)', '0 errors, 2 failed attempts']) assert.equal(readableActivity(line), null, line);
  const saved = readableActivity('[agent research] wrote /tmp/research.md');
  assert.equal(saved.title, 'Progress saved');
  assert.match(saved.detail, /may still be in progress/);
  assert.equal(activityState({status: 'running', exit: 0}), 'Running');
  assert.match(activityDescription({status: 'failed'}, saved), /could not finish/);
});

test('actionable failures survive logger prefixes and avoid exposing stack traces in summaries', () => {
  assert.equal(readableActivity('2026-10-24 14:05:13,250 WARNING Sign-in required.').title, 'Sign-in required.');
  assert.equal(readableActivity('[12:02:00] ERROR Connection refused').title, 'A service could not be reached');
  assert.equal(readableActivity('TimeoutError: navigation exceeded 30000ms').title, 'A step took too long');
  assert.equal(readableActivity('Traceback (most recent call last):').title, 'A step needs attention');
  assert.equal(readableActivity('  File "/private/credentials.py", line 17'), null);
  assert.equal(readableActivity('API_KEY is not configured').title, 'Check your connection settings');
  assert.equal(readableActivity('Results saved to /tmp/private-output.json').title, 'Progress saved');
});

test('legacy and concurrent snapshots have separate, metadata-based outcomes', () => {
  assert.deepEqual(activityRuns({running: false}), []);
  const [old] = activityRuns({running: false, last: {label: 'Learning', exit: 2, stopped: false}});
  assert.equal(old.id, 'legacy');
  assert.equal(activityState(old), 'Needs attention');
  const runs = activityRuns({running: true, runs: [
    {id: 'a', label: 'Research', running: true},
    {id: 'b', label: 'Learning', running: false, exit: 0},
    {id: 'c', label: 'Jobs', running: false, exit: 130, stopped: true},
  ]});
  assert.deepEqual(runs.map(activityState), ['Running', 'Completed', 'Stopped']);
  assert.match(activityDescription(runs[2]), /stopped/);
});
