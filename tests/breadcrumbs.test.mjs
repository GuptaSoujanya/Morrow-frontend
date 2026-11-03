import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBreadcrumbs } from '../app/js/components/breadcrumbs.js';
import { parseHash } from '../app/js/router.js';

const trail = (hash, options = {}) => buildBreadcrumbs(parseHash(hash), { query: hash.split('?')[1] || '', ...options });
const labels = crumbs => crumbs.map(item => item.label);
const query = crumb => new URLSearchParams(crumb.href.split('?')[1] || '');

test('Home is the sole clickable Launchpad crumb, with a single current anchor', () => {
  assert.deepEqual(trail('#/overview'), [{ label: 'Home', href: '#/overview', current: true }]);
  for (const hash of ['#/bots', '#/learning', '#/files/answers', '#/boards/hirist/profile', '#/records/jobs/matched', '#/data/resumes']) {
    const crumbs = trail(hash);
    assert.equal(crumbs.filter(item => item.current).length, 1);
    assert.equal(crumbs.at(-1).current, true);
    for (const item of crumbs) assert.ok(item.href.startsWith('#/'));
  }
});

test('bot settings retain Bot Crew, tool and provider parent destinations', () => {
  const crumbs = trail('#/boards/hirist/profile');
  assert.deepEqual(labels(crumbs), ['Home', 'Bot Crew', 'Job boards', 'Hirist', 'Profile update']);
  assert.deepEqual(crumbs.map(item => parseHash(item.href)), [
    { name: 'overview', arg: '' }, { name: 'bots', arg: '' }, { name: 'boards', arg: '' },
    { name: 'boards', arg: 'hirist' }, { name: 'boards', arg: 'hirist/profile' },
  ]);
  for (const key of ['naukri', 'sites', 'profile', 'linkedin', 'linkedin-profile', 'resume', 'outreach']) assert.equal(trail('#/' + key)[1].href, '#/bots');
});

test('reader parent restores its actual library origin filters and document title', () => {
  const crumbs = trail('#/learning/read/research%2Fnotes%2Fhash%20maps.md?from=library&q=hash+maps&category=DSA&page=3&size=24&date=2026-10-26&return=https://bad.example', { documentTitle: 'Hash maps & collisions' });
  assert.deepEqual(labels(crumbs), ['Home', 'Learning', 'Saved library', 'Hash maps & collisions']);
  assert.deepEqual(Object.fromEntries(query(crumbs[2])), { q: 'hash maps', category: 'DSA', page: '3', size: '24', date: '2026-10-26' });
  assert.equal(parseHash(crumbs[2].href).arg, 'library');
  assert.equal(parseHash(crumbs[3].href).arg, 'read/research/notes/hash maps.md');
  assert.equal(query(crumbs[3]).get('from'), 'library');
  assert.equal(query(crumbs[3]).has('return'), false);
});

test('reader return source is allowlisted and today does not duplicate Learning', () => {
  const bad = trail('#/learning/read/lesson.md?from=javascript:alert(1)&redirect=//bad.example');
  assert.deepEqual(labels(bad), ['Home', 'Learning', 'Lesson']);
  assert.equal(query(bad.at(-1)).get('from'), 'today');
  const resume = trail('#/learning/read/research/resume-learning/index.md');
  assert.equal(resume[2].href, '#/learning/resume');
  const progress = trail('#/learning/read/topic.md?from=progress&page=4');
  assert.equal(progress[2].href, '#/learning/progress?page=4');
  assert.equal(trail('#/learning/read/topic.md?from=practice')[2].href, '#/learning/practice');
});

test('practice paper, course track and DSA problem retain every navigable ancestor', () => {
  assert.deepEqual(labels(trail('#/learning/practice/paper/paper-42', { paperTitle: 'Weekly review' })), ['Home', 'Learning', 'Practice & exams', 'Weekly review']);
  const dsa = trail('#/learning/dsa/problem/two-sum?q=arrays&status=todo', { problemTitle: 'Two sum' });
  assert.deepEqual(labels(dsa), ['Home', 'Learning', 'DSA practice', 'Practice sheet', 'Two sum']);
  assert.equal(dsa[3].href, '#/learning/dsa/sheet?q=arrays&status=todo');
  const courses = trail('#/learning/courses?track=Backend+%26+APIs');
  assert.deepEqual(labels(courses), ['Home', 'Learning', 'Reference chapters', 'Backend & APIs']);
  assert.equal(courses[2].href, '#/learning/courses');
});

test('files reflect the actual selected editor and unavailable advanced tabs fall back', () => {
  assert.deepEqual(labels(trail('#/files/answers')), ['Home', 'My profile & files', 'Screening answers']);
  assert.equal(trail('#/files').at(-1).href, '#/files/profile');
  assert.equal(trail('#/files/env', { legacyAccess: false }).at(-1).href, '#/files/profile');
  assert.equal(trail('#/files/unknown').at(-1).href, '#/files/profile');
});

test('record filter ancestors remove deeper scope while preserving date and search', () => {
  const crumbs = trail('#/records/jobs/matched/30?board=hirist&q=engineer&page=4&size=50');
  assert.deepEqual(labels(crumbs), ['Home', 'Applications', 'Discovered jobs', 'Hirist', 'Above match threshold']);
  assert.deepEqual(Object.fromEntries(query(crumbs[2])), { kind: 'jobs', days: '30', q: 'engineer', size: '50' });
  assert.equal(query(crumbs[3]).get('board'), 'hirist');
  assert.equal(query(crumbs[3]).has('outcome'), false);
  assert.equal(query(crumbs[3]).has('page'), false);
  assert.equal(query(crumbs.at(-1)).get('outcome'), 'matched');
  assert.equal(query(crumbs.at(-1)).get('page'), '4');
  assert.deepEqual(labels(trail('#/records?kind=jobs&outcome=matched&days=30&board=hirist&q=engineer')), labels(crumbs));
});

test('reports and Data drilldowns use supported parents', () => {
  const report = trail('#/reports/2026-10-26');
  assert.deepEqual(labels(report), ['Home', 'Reports', '26 Oct 2026']);
  assert.equal(report[1].href, '#/reports');
  const data = trail('#/data/resumes?q=backend&page=2');
  assert.deepEqual(labels(data), ['Home', 'Data hub', 'Resumes']);
  assert.equal(query(data.at(-1)).get('category'), 'Resumes');
  assert.equal(query(data.at(-1)).get('q'), 'backend');
  assert.deepEqual(labels(trail('#/data?category=not-a-category')), ['Home', 'Data hub']);
  assert.equal(trail('#/pipeline/learn?date=2026-10-26').at(-1).href, '#/pipeline/learn?date=2026-10-26');
});

test('legacy aliases resolve to canonical parents and unsafe labels stay plain data', () => {
  assert.deepEqual(labels(trail('#/study?track=Systems')), ['Home', 'Learning', 'Reference chapters', 'Systems']);
  const title = '<img src=x onerror=alert(1)>';
  const crumbs = trail('#/learning/read/notes.md?from=library', { documentTitle: title });
  assert.equal(crumbs.at(-1).label, title);
  assert.equal(crumbs.at(-1).href, '#/learning/read/notes.md?from=library');
  assert.equal(trail('#/unknown/path').at(-1).href, '#/unknown/path');
});

test('question bank readers return to the same subject, week and search page', () => {
  const crumbs = trail('#/learning/read/interview%2Fday-22?from=weekly&view=questions&track=ai_ml&week=4&q=forest&page=2&part=ai&stage=interview');
  assert.equal(crumbs.at(-2).label, 'Interview questions');
  assert.deepEqual(Object.fromEntries(query(crumbs.at(-2))), { view: 'questions', track: 'ai_ml', q: 'forest', week: '4', page: '2' });
  assert.equal(crumbs.at(-2).href.split('?')[0], '#/learning/weekly');
  assert.equal(query(crumbs.at(-2)).has('stage'), false);
  assert.deepEqual(Object.fromEntries(query(crumbs.at(-1))), {
    view: 'questions', track: 'ai_ml', q: 'forest', week: '4', page: '2', from: 'weekly', part: 'ai', stage: 'interview',
  });
});

test('question bank current breadcrumb retains the filtered collection', () => {
  const crumbs = trail('#/learning/weekly?view=questions&track=system_design&q=cache&week=2&page=2&return=https://bad.example');
  assert.deepEqual(labels(crumbs), ['Home', 'Learning', 'Interview questions']);
  assert.equal(crumbs.at(-1).href.split('?')[0], '#/learning/weekly');
  assert.deepEqual(Object.fromEntries(query(crumbs.at(-1))), {
    view: 'questions', track: 'system_design', q: 'cache', week: '2', page: '2',
  });
});

test('current course breadcrumb accepts only known subject and stage values', () => {
  const valid = trail('#/learning/read/interview%2Fday-12?from=today&part=systems&stage=interview');
  assert.deepEqual(Object.fromEntries(query(valid.at(-1))), { from: 'today', part: 'systems', stage: 'interview' });
  const invalid = trail('#/learning/read/interview%2Fday-12?from=weekly&view=questions&part=private&stage=unknown&redirect=https://bad.example');
  assert.deepEqual(Object.fromEntries(query(invalid.at(-1))), { view: 'questions', from: 'weekly' });
  const all = trail('#/learning/read/interview%2Fday-12?part=all&stage=interview');
  assert.deepEqual(Object.fromEntries(query(all.at(-1))), { from: 'weekly', part: 'all' });
  const ordinary = trail('#/learning/read/notes.md?part=systems&stage=interview');
  assert.deepEqual(Object.fromEntries(query(ordinary.at(-1))), { from: 'today' });
});

test('course chapter links return to the syllabus and retain build, DSA and finish destinations', () => {
  for (const part of ['project', 'dsa', 'interview', 'review']) {
    const crumbs = trail(`#/learning/read/interview%2Fday-1?part=${part}`);
    assert.equal(crumbs.at(-2).label, '90-day course');
    assert.equal(crumbs.at(-2).href, '#/learning/weekly');
    assert.deepEqual(Object.fromEntries(query(crumbs.at(-1))), { from: 'weekly', part });
  }
  const project = trail('#/learning/read/interview%2Fday-1?part=project&stage=example');
  assert.equal(query(project.at(-1)).has('stage'), false);
});
