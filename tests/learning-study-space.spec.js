import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const idle = { epoch: 'learning-study-space', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const courseSource = day => '#/learning/read/' + encodeURIComponent(`interview/day-${day}`);
const notes = page => page.locator('.study-notes');
const body = page => notes(page).getByRole('textbox', { name: 'Notes for this lesson', exact: true });
const save = page => notes(page).getByRole('button', { name: 'Save note', exact: true });
const status = page => notes(page).locator('.study-notes-status');

async function openNotes(page) {
  const panel = notes(page).locator('.study-notes-panel');
  await expect(panel).toBeVisible();
  if (!await panel.evaluate(element => element.open)) await panel.locator(':scope > summary').click();
  await expect(body(page)).toBeVisible();
  await expect(body(page)).toBeEnabled();
}

async function openCourse(page, day, query = '') {
  await page.goto('/' + courseSource(day) + query);
  await expect(page.locator('.lesson-stage-prose')).toBeVisible();
  await openNotes(page);
}

async function collection(request) {
  const response = await request.get('/api/learning/collection');
  expect(response.ok()).toBe(true);
  return response.json();
}

async function savedFor(request, source) {
  return (await collection(request)).notes.filter(note => note.url === source);
}

async function noPageOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

async function wideStudySpace(page) {
  const layout = await page.locator('.learning-study-layout').boundingBox();
  const material = await page.locator('.learning-study-content').boundingBox();
  const aside = await notes(page).boundingBox();
  const width = page.viewportSize().width;
  expect(layout.width).toBeGreaterThanOrEqual(width * .88);
  expect(material.width).toBeGreaterThanOrEqual(width * .58);
  expect(aside.width).toBeGreaterThanOrEqual(260);
  expect(material.x + material.width).toBeLessThanOrEqual(aside.x - 8);
  expect(aside.x + aside.width).toBeLessThanOrEqual(width);
  await noPageOverflow(page);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(run => {
    window.EventSource = class extends EventTarget {
      constructor() { super(); this.timer = setTimeout(() => this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(run) })), 0); }
      close() { clearTimeout(this.timer); }
    };
  }, idle);
  // Learning requests use the isolated preview's actual temporary storage.
  // Other workspace actions cannot start a job or change a real account.
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/learning/') || ['/api/research/learning', '/api/library', '/api/document', '/api/course'].includes(path)) return route.continue();
    if (route.request().method() !== 'GET') return route.fulfill({ status: 403, json: { error: 'Fixture prohibits non-learning changes.' } });
    const data = {
      '/api/session': { mode: 'local', legacy_access: true, user: null },
      '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
      '/api/status': { name: 'Learner', greeting: 'Hello', date: '2026-10-27', date_long: '27 October 2026', run: idle,
        questions: [], facts: [], sites: [], study: { today: null, read: 0, total: 0 }, report: { ready: false, days: [] } },
      '/api/run': idle, '/api/bots': { bots: [], run: idle },
      '/api/overview': { days: 14, first: null, start: '2026-10-13', end: '2026-10-27', recent: [], boards: [], workspace: { research_count: 0, learning_done: 0 } },
    };
    return route.fulfill({ json: data[path] || {} });
  });
});

test('quick notes load, save and update the same source note in the existing library', async ({ page, request }) => {
  const source = courseSource(61), writes = [];
  page.on('request', req => { if (req.method() === 'POST') writes.push({ path: new URL(req.url()).pathname, data: req.postDataJSON() }); });
  await openCourse(page, 61);
  await expect(body(page)).toHaveValue('');
  await body(page).fill('Start with the decision, then explain the evidence and the trade-off.');
  expect(writes).toEqual([]);
  await save(page).click();
  await expect(status(page)).toHaveText(/^Saved\b/i);
  let saved = await savedFor(request, source);
  expect(saved).toHaveLength(1);
  const identifier = saved[0].id;
  expect(saved[0]).toMatchObject({ body: 'Start with the decision, then explain the evidence and the trade-off.', revision: 1, kind: 'resource' });
  await page.reload();
  await openNotes(page);
  await expect(body(page)).toHaveValue(saved[0].body);
  await body(page).fill('State the decision. Measure the baseline. Explain one failure case.');
  await save(page).click();
  await expect(status(page)).toHaveText(/^Saved\b/i);
  saved = await savedFor(request, source);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ id: identifier, revision: 2, body: 'State the decision. Measure the baseline. Explain one failure case.' });
  expect(writes.map(write => write.path)).toEqual(['/api/learning/collection', '/api/learning/collection']);
  expect(writes[0].data.creation_token).toMatch(/^[a-f0-9]{32}$/);
  expect(writes[1].data).toMatchObject({ id: identifier, revision: 1, action: 'note' });
  await notes(page).getByRole('link', { name: 'All notes', exact: true }).click();
  await expect(page.locator('.learn-note-list')).toContainText(saved[0].body.slice(0, 90));
  await page.goto('/#/learning/notes?id=' + identifier);
  await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toHaveValue(saved[0].body);
});

test('an unsaved lesson draft survives stage, subject, route, refresh and browser reload', async ({ page }) => {
  const writes = [];
  page.on('request', req => { if (req.method() === 'POST') writes.push(req.url()); });
  await openCourse(page, 63);
  const draft = 'My own example: the caller times out after the worker has committed.\nWhat makes the retry safe?';
  await body(page).fill(draft);
  await page.locator('[data-lesson-stage="example"]').click();
  await expect(page.locator('.lesson-stage-prose')).toHaveAttribute('data-current-lesson-stage', 'example');
  await expect(body(page)).toHaveValue(draft);
  await page.locator('.lesson-subject-menu > summary').click();
  await page.locator('[data-lesson-part="systems"]').click();
  await expect(body(page)).toHaveValue(draft);
  await page.getByRole('button', { name: 'Refresh learning', exact: true }).click();
  await expect(body(page)).toHaveValue(draft);
  await page.evaluate(() => { location.hash = '#/learning'; });
  await expect(page.locator('.daily-page')).toHaveAttribute('data-learning-view', 'today');
  await page.evaluate(source => { location.hash = source; }, courseSource(63));
  await openNotes(page);
  await expect(body(page)).toHaveValue(draft);
  await page.reload();
  await openNotes(page);
  await expect(body(page)).toHaveValue(draft);
  expect(writes).toEqual([]);
});

test('drafts stay attached to their course day or DSA topic', async ({ page }) => {
  await openCourse(page, 64);
  await body(page).fill('Only day 64: my rollout checklist.');
  await page.evaluate(source => { location.hash = source; }, courseSource(65));
  await openNotes(page);
  await expect(body(page)).toHaveValue('');
  await body(page).fill('Only day 65: my debugging questions.');
  await page.evaluate(() => { location.hash = '#/learning/dsa?step=concept'; });
  await expect(page.locator('[data-dsa-stage="concept"]')).toBeVisible();
  await openNotes(page);
  await expect(body(page)).toHaveValue('');
  await body(page).fill('DSA: state the invariant before writing the loop.');
  await page.getByRole('tab', { name: '02 Worked example', exact: true }).click();
  await expect(body(page)).toHaveValue('DSA: state the invariant before writing the loop.');
  await page.evaluate(source => { location.hash = source; }, courseSource(64));
  await openNotes(page);
  await expect(body(page)).toHaveValue('Only day 64: my rollout checklist.');
  await page.evaluate(source => { location.hash = source; }, courseSource(65));
  await openNotes(page);
  await expect(body(page)).toHaveValue('Only day 65: my debugging questions.');
  await page.evaluate(() => { location.hash = '#/learning/dsa?step=concept'; });
  await openNotes(page);
  await expect(body(page)).toHaveValue('DSA: state the invariant before writing the loop.');
});

test('a failed save retains the typed note through reload and can be retried', async ({ page, request }) => {
  let unavailable = true;
  await page.route('**/api/learning/collection', route => route.request().method() === 'POST' && unavailable
    ? route.fulfill({ status: 503, json: { error: 'Note storage is temporarily unavailable.' } }) : route.fallback());
  await openCourse(page, 66);
  const draft = 'Keep this exact explanation, including the failure case.';
  await body(page).fill(draft);
  await save(page).click();
  await expect(status(page)).toContainText('temporarily unavailable');
  await expect(body(page)).toHaveValue(draft);
  expect(await savedFor(request, courseSource(66))).toHaveLength(0);
  await page.reload();
  await openNotes(page);
  await expect(body(page)).toHaveValue(draft);
  unavailable = false;
  await save(page).click();
  await expect(status(page)).toHaveText(/^Saved\b/i);
  expect(await savedFor(request, courseSource(66))).toEqual([expect.objectContaining({ body: draft, revision: 1 })]);
});

test('retrying after the save response is lost creates only one quick note', async ({ page, request }) => {
  let interrupt = true;
  const tokens = [];
  await page.route('**/api/learning/collection', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    tokens.push(route.request().postDataJSON().creation_token);
    if (!interrupt) return route.fallback();
    interrupt = false;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    return route.fulfill({ status: 503, json: { error: 'The save response was interrupted. Try again.' } });
  });
  await openCourse(page, 67);
  await body(page).fill('One note, even when I do not receive the first save response.');
  await save(page).click();
  await expect(status(page)).toContainText('save response was interrupted');
  await save(page).click();
  await expect(status(page)).toHaveText(/^Saved\b/i);
  expect(await savedFor(request, courseSource(67))).toHaveLength(1);
  expect(tokens).toHaveLength(2);
  expect(tokens[0]).toBe(tokens[1]);
});

test('a concurrent edit preserves both the saved version and the typed quick-note draft', async ({ page, request }) => {
  const response = await request.post('/api/learning/collection', { data: { action: 'note', title: 'Day 62 reasoning',
    body: 'Original explanation.', url: courseSource(62), kind: 'resource' } });
  expect(response.ok()).toBe(true);
  const original = (await response.json()).note;
  await openCourse(page, 62);
  await expect(body(page)).toHaveValue(original.body);
  await body(page).fill('My new reasoning must not be lost.');
  const concurrent = await request.post('/api/learning/collection', { data: { ...original, action: 'note', body: 'A newer version saved in another window.' } });
  expect(concurrent.ok()).toBe(true);
  await save(page).click();
  await expect(status(page)).toContainText('changed in another window');
  await expect(body(page)).toHaveValue('My new reasoning must not be lost.');
  expect(await savedFor(request, courseSource(62))).toEqual([expect.objectContaining({ id: original.id, revision: 2, body: 'A newer version saved in another window.' })]);
  await page.reload();
  await openNotes(page);
  await expect(body(page)).toHaveValue('My new reasoning must not be lost.');
});

test('switching accounts in the same tab never restores another account’s notes or drafts', async ({ page }) => {
  let account = 'alice';
  const writes = [], loaded = [];
  const saved = who => ({ id: (who === 'alice' ? 'a' : 'b').repeat(32), title: `${who} private note`, body: `${who} saved explanation`,
    kind: 'resource', url: courseSource(68), revision: 1, created_at: '2026-10-27T10:00:00Z', updated_at: '2026-10-27T10:00:00Z' });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { mode: 'accounts', legacy_access: false,
      user: { id: account, email: `${account}@example.test`, role: 'user', modules: ['learning'] } } });
    if (path === '/api/learning/collection') {
      if (route.request().method() !== 'GET') {
        writes.push({ account, data: route.request().postDataJSON() });
        return route.fulfill({ status: 403, json: { error: 'This account isolation test does not save.' } });
      }
      loaded.push(account);
      return route.fulfill({ json: { notes: [saved(account)], bookmarks: [] } });
    }
    return route.fallback();
  });
  await openCourse(page, 68);
  await expect(body(page)).toHaveValue('alice saved explanation');
  await body(page).fill('Alice private unsaved reasoning.');
  account = 'bob';
  await page.reload();
  await openNotes(page);
  await expect(body(page)).toHaveValue('bob saved explanation');
  await expect(notes(page)).not.toContainText('Alice private');
  await body(page).fill('Bob private unsaved reasoning.');
  account = 'alice';
  await page.reload();
  await openNotes(page);
  await expect(body(page)).toHaveValue('Alice private unsaved reasoning.');
  account = 'bob';
  await page.reload();
  await openNotes(page);
  await expect(body(page)).toHaveValue('Bob private unsaved reasoning.');
  expect(loaded).toContain('alice');
  expect(loaded).toContain('bob');
  expect(writes).toEqual([]);
});

test('disabled browser storage still keeps a draft while moving between learning pages', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('Storage is disabled.', 'SecurityError'); } });
  });
  await openCourse(page, 69);
  await body(page).fill('Keep my draft in this tab when browser storage is unavailable.');
  await page.evaluate(() => { location.hash = '#/learning'; });
  await expect(page.locator('.daily-page')).toHaveAttribute('data-learning-view', 'today');
  await page.evaluate(source => { location.hash = source; }, courseSource(69));
  await openNotes(page);
  await expect(body(page)).toHaveValue('Keep my draft in this tab when browser storage is unavailable.');
});

test('desktop reading and quick notes use the available width without hiding navigation controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openCourse(page, 1);
  await wideStudySpace(page);
  await expect(body(page)).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Show navigation', exact: true })).toBeVisible();
  await expect(page.locator('#nav')).toBeHidden();
  await body(page).fill('My interview checklist\n\n1. Explain the goal.\n2. Show one real example.\n3. Name a failure and how to test it.');
  const audit = await new AxeBuilder({ page }).include('.study-notes').analyze();
  expect(audit.violations).toEqual([]);
  await mkdir('artifacts/learning-study-space', { recursive: true });
  await page.screenshot({ path: 'artifacts/learning-study-space/reader-desktop-1440.png' });
});

test('the DSA editor fits beside quick notes and both remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/learning/dsa?step=practice');
  await expect(page.locator('.code-workspace .cm-editor')).toBeVisible();
  await openNotes(page);
  await body(page).fill('Before coding: what does the set contain after each iteration?');
  await wideStudySpace(page);
  const editor = page.getByRole('textbox', { name: 'Python code editor', exact: true });
  const editorBounds = await page.locator('.code-editor-host').boundingBox();
  const materialBounds = await page.locator('.learning-study-content').boundingBox();
  expect(editorBounds.width).toBeGreaterThanOrEqual(500);
  expect(editorBounds.x + editorBounds.width).toBeLessThanOrEqual(materialBounds.x + materialBounds.width);
  await editor.click();
  await expect(editor).toBeFocused();
  await expect(body(page)).toHaveValue('Before coding: what does the set contain after each iteration?');
  await page.locator('.code-workspace').scrollIntoViewIfNeeded();
  await expect(body(page)).toBeInViewport();
  await noPageOverflow(page);
  await mkdir('artifacts/learning-study-space', { recursive: true });
  await page.screenshot({ path: 'artifacts/learning-study-space/dsa-desktop-1440.png' });
});

test('phone readers can open, type and restore quick notes without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/' + courseSource(1));
  await expect(page.locator('.lesson-stage-prose')).toBeVisible();
  const panel = notes(page).locator('.study-notes-panel');
  await expect(panel).not.toHaveAttribute('open', '');
  const summary = panel.locator(':scope > summary');
  await expect(summary).toBeInViewport();
  expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(body(page)).toBeVisible();
  await body(page).fill('My phone note: explain the example in my own words.');
  await expect(save(page)).toBeVisible();
  await noPageOverflow(page);
  const audit = await new AxeBuilder({ page }).include('.study-notes').analyze();
  expect(audit.violations).toEqual([]);
  await mkdir('artifacts/learning-study-space', { recursive: true });
  await notes(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/learning-study-space/notes-mobile-390.png' });
  await summary.click();
  await page.locator('[data-lesson-stage="example"]').click();
  await openNotes(page);
  await expect(body(page)).toHaveValue('My phone note: explain the example in my own words.');
  await page.reload();
  await openNotes(page);
  await expect(body(page)).toHaveValue('My phone note: explain the example in my own words.');
  await noPageOverflow(page);
});

test('phone DSA practice keeps notes and the coding editor inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/learning/dsa?step=practice');
  await expect(page.locator('.code-workspace .cm-editor')).toBeVisible();
  await openNotes(page);
  await body(page).fill('DSA on my phone: check the empty input and duplicates.');
  await noPageOverflow(page);
  await notes(page).locator('.study-notes-panel > summary').click();
  const editor = page.locator('.code-editor-host');
  await editor.scrollIntoViewIfNeeded();
  const bounds = await editor.boundingBox();
  expect(bounds.width).toBeGreaterThanOrEqual(260);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.getByRole('textbox', { name: 'Python code editor', exact: true }).click();
  await noPageOverflow(page);
  await openNotes(page);
  await expect(body(page)).toHaveValue('DSA on my phone: check the empty input and duplicates.');
});
