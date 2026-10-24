import test from 'node:test';
import assert from 'node:assert/strict';
import {activityRuns, activityState, readableActivity, activityDescription, activityRecovery} from '../app/js/components/activity-format.js';

test('Naukri assistance preserves access denial and points to the active browser', () => {
  const denied = readableActivity('WARNING Naukri is blocking access to this browser. Finish sign-in in the open Chrome window. Waiting up to 5 minutes.');
  assert.equal(denied.title, 'Naukri denied browser access');
  assert.match(denied.detail, /Access Denied in Chrome/);
  assert.equal(denied.recovery, undefined);
  const waiting = readableActivity('WARNING Naukri loaded, but its sign-in status could not be verified. Finish sign-in in the open Chrome window. Waiting up to 5 minutes.');
  assert.equal(waiting.title, 'Naukri is waiting for you');
  assert.match(waiting.detail, /5 minutes/);
  assert.equal(waiting.recovery, undefined);
  assert.equal(readableActivity('INFO Naukri sign-in verified. Resuming this agent in the current Chrome window.').title, 'Naukri sign-in confirmed');
});

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

test('Naukri missing, reconnect and security-check logs produce truthful sign-in guidance', () => {
  const messages = [
    'Naukri is not connected in this automation browser. Open Connections → Naukri → Sign in, complete sign-in, check it, and close the browser before trying again.',
    'Naukri needs you to sign in again. Reconnect Naukri in Connections, check sign-in, and close the browser before trying again.',
    'Naukri needs a security check. Open Connections → Naukri → Sign in, complete the verification, check sign-in, and close the browser before trying again.',
    'Saved Naukri sign-in expired. Reconnect Naukri before trying again.',
  ];
  for (const message of messages) {
    for (const prefix of ['', '2026-10-24 12:00:00,001 ERROR ', '[agent apply] ']) {
      const event = readableActivity(prefix + message);
      assert.equal(event.kind, 'attention', message);
      assert.equal(event.title, 'Naukri sign-in needed', message);
      assert.equal(event.recovery, 'sign-in', message);
      assert.equal(event.provider, 'naukri', message);
      assert.match(event.detail, /Google and Naukri use separate sign-ins/);
      assert.doesNotMatch(event.detail, /expired|expired credentials|complete.*in the.*preview/i);
    }
  }
});

test('a retained Naukri auth failure keeps its fixed recovery route after generic terminal output', () => {
  const first = Object.freeze(readableActivity('Naukri is not connected in this automation browser.'));
  const events = Object.freeze([first, ...Array.from({length: 45}, (_, index) => Object.freeze(readableActivity(index % 2 ? 'ERROR The run could not finish.' : 'Results saved to /tmp/summary.json'))), readableActivity('× Naukri — failed (9s)')]);
  const recovery = activityRecovery({action: 'naukri', status: 'failed'}, events);
  assert.equal(recovery.provider, 'naukri');
  assert.equal(recovery.label, 'Connect Naukri');
  assert.equal(recovery.href, '#/connections/naukri');
  assert.match(recovery.detail, /sign in and check the connection/);
  assert.equal(events.length, 47);
  assert.equal(events[0], first);
});

test('Naukri recovery uses explicit provider evidence or Naukri action metadata, never another platform’s failure', () => {
  const generic = readableActivity('Sign-in required.');
  for (const action of ['naukri', 'profile']) assert.equal(activityRecovery({action, status: 'failed'}, [generic]).provider, 'naukri', action);
  for (const action of ['pipeline', 'boards', 'linkedin', 'cold_email']) assert.equal(activityRecovery({action, status: 'failed'}, [generic]), null, action);
  for (const provider of ['Google', 'Gmail', 'LinkedIn', 'Hirist', 'Instahyre', 'Cutshort', 'Wellfound', 'Kiro', 'Claude']) {
    const event = readableActivity(`${provider} session expired. Please sign in.`);
    assert.equal(activityRecovery({action: 'naukri', status: 'failed'}, [event]), null, provider);
  }
  const explicit = readableActivity('Naukri needs you to sign in again.');
  assert.equal(activityRecovery({action: 'pipeline', status: 'failed'}, [explicit]).provider, 'naukri');
  assert.equal(activityRecovery({action: 'naukri', status: 'failed'}, [readableActivity('Connection refused'), readableActivity('ERROR Could not finish')]), null);
});

test('completed or missing runs never offer an obsolete recovery action', () => {
  const events = [readableActivity('Saved Naukri sign-in expired.')];
  assert.equal(activityRecovery({action: 'naukri', status: 'completed'}, events), null);
  assert.equal(activityRecovery(null, events), null);
  assert.equal(activityRecovery({action: 'naukri', status: 'failed'}), null);
});
