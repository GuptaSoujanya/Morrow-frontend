import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyClock, formatStudyTime } from '../app/js/components/study-timer.js';

test('measures real elapsed time despite delayed interval callbacks and pauses', () => {
  let time = 0;
  const clock = createStudyClock({ date: '2026-11-03', now: () => time });
  clock.start(); time = 97_250;
  assert.equal(clock.read().elapsedMs, 97_250);
  clock.pause(); time += 30_000;
  assert.equal(clock.read().elapsedMs, 97_250);
  clock.start(); time += 12_400;
  assert.equal(clock.read().elapsedMs, 109_650);
});

test('reloading a checkpoint starts paused and excludes time between documents', () => {
  const clock = createStudyClock({ date: '2026-11-03', elapsedMs: 32_400, now: () => 900_000 });
  assert.deepEqual(clock.read(), { date: '2026-11-03', elapsedMs: 32_400, running: false });
  clock.start();
  assert.equal(clock.read().elapsedMs, 32_400);
});

test('midnight clears today and pauses without marking anything complete', () => {
  let time = 0;
  const clock = createStudyClock({ date: '2026-11-03', elapsedMs: 34_000, now: () => time });
  clock.start(); time = 500;
  assert.equal(clock.day('2026-11-03'), false);
  assert.equal(clock.read().elapsedMs, 34_500);
  assert.equal(clock.day('2026-11-04'), true);
  assert.deepEqual(clock.read(), { date: '2026-11-04', elapsedMs: 0, running: false });
});

test('repeated start does not lose elapsed time; resetting starts clean', () => {
  let time = 0;
  const clock = createStudyClock({ date: '2026-11-03', now: () => time });
  clock.start(); time = 15_000; clock.start(); time += 4_000;
  assert.equal(clock.read().elapsedMs, 19_000);
  clock.reset();
  assert.equal(clock.read().running, false);
  assert.equal(clock.read().elapsedMs, 0);
});

test('formats minutes and hours without wrapping long study sessions', () => {
  assert.equal(formatStudyTime(0), '00:00');
  assert.equal(formatStudyTime(65_999), '01:05');
  assert.equal(formatStudyTime(3_665_000), '01:01:05');
  assert.equal(formatStudyTime(NaN), '00:00');
  assert.equal(formatStudyTime(-1000), '00:00');
});
