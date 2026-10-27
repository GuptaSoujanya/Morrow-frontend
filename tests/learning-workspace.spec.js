import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const idle = { epoch: 'learning-workspace', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(run => {
    window.EventSource = class extends EventTarget {
      constructor() { super(); this.timer = setTimeout(() => this.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(run) })), 0); }
      close() { clearTimeout(this.timer); }
    };
  }, idle);
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

test('paper bookmarks persist in the correct collection and notes can be edited', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/learning/discover?tab=papers');
  await expect(page.locator('.learn-resource-card')).toHaveCount(2);
  const paper = page.locator('.learn-resource-card').first();
  await paper.getByRole('button', { name: 'Bookmark Evaluating retrieval systems (2026)', exact: true }).click();
  await expect(paper.getByRole('button', { name: 'Remove bookmark for Evaluating retrieval systems (2026)' })).toBeEnabled();
  await page.goto('/#/learning/bookmarks?kind=paper');
  await expect(page.locator('.learn-resource-card').filter({ hasText: 'Evaluating retrieval systems' })).toHaveCount(1);
  await page.reload();
  await page.getByRole('link', { name: 'Add note for Evaluating retrieval systems (2026)' }).click();
  await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toHaveValue('Evaluating retrieval systems (2026)');
  await page.getByRole('textbox', { name: 'Note content' }).fill('Compare the baseline before trusting the result.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page).toHaveURL(/notes\?id=/);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveValue('Compare the baseline before trusting the result.');
  await page.getByRole('textbox', { name: 'Note content' }).fill('Also check the dataset and evaluation limits.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your note is saved.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveValue('Also check the dataset and evaluation limits.');
  expect(errors).toEqual([]);
});

test('repository links validate, save, filter, and remove', async ({ page }) => {
  await page.goto('/#/learning/bookmarks?kind=repo&add=1');
  await page.getByRole('textbox', { name: 'Bookmark title' }).fill('A useful agent repository');
  await page.getByRole('textbox', { name: 'Bookmark link' }).fill('https://example.org/not-github');
  await page.getByRole('button', { name: 'Save bookmark' }).click();
  await expect(page.locator('.learn-feedback')).toContainText('GitHub repository link');
  await expect(page.getByRole('textbox', { name: 'Bookmark title' })).toHaveValue('A useful agent repository');
  await page.getByRole('textbox', { name: 'Bookmark link' }).fill('https://github.com/example/agent');
  await page.getByRole('button', { name: 'Save bookmark' }).click();
  const card = page.locator('.learn-resource-card').filter({ hasText: 'A useful agent repository' });
  await expect(card).toBeVisible();
  await page.reload();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Remove bookmark for A useful agent repository' }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(card).toHaveCount(0);
});

test('DSA bookmarks reopen the exact question', async ({ page }) => {
  await page.goto('/#/learning/dsa?step=practice');
  const question = page.locator('.daily-question');
  await expect(question).toBeVisible();
  const title = await question.locator(':scope > h3').textContent();
  await question.getByRole('button', { name: 'Bookmark ' + title, exact: true }).click();
  await expect(question.getByRole('button', { name: 'Remove bookmark for ' + title })).toBeEnabled();
  await page.goto('/#/learning/bookmarks?kind=dsa');
  await page.locator('.learn-resource-card').getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.locator('.code-workspace')).toBeVisible();
});

test('note drafts survive refresh and navigation, failed saves preserve content', async ({ page }) => {
  await page.goto('/#/learning/notes?new=1');
  await page.getByRole('textbox', { name: 'Note title', exact: true }).fill('Draft to retain');
  await page.getByRole('textbox', { name: 'Note content' }).fill('This should survive a failed save.');
  await page.getByRole('button', { name: 'Refresh learning' }).click();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveValue('This should survive a failed save.');
  await page.evaluate(() => { location.hash = '#/learning/bookmarks'; });
  await expect(page.getByRole('heading', { name: 'Bookmarks', exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/learning/notes?new=1'; });
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveValue('This should survive a failed save.');
  await page.route('**/api/learning/collection', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { error: 'Storage is temporarily unavailable.' } }) : route.fallback());
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.locator('.learn-feedback')).toContainText('Storage is temporarily unavailable');
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveValue('This should survive a failed save.');
});

test('reading each paper updates its individual progress and the header without awarding early completion', async ({ page, request }) => {
  const before = await (await request.get('/api/learning/overview')).json();
  const dates = await (await request.get('/api/learning/discovery')).json();
  await page.goto('/#/learning/discover?tab=papers&date=' + dates.dates.at(-1));
  await page.getByRole('button', { name: 'Mark as read: Comparing experiments (2026)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen Comparing experiments (2026)', exact: true })).toBeEnabled();
  const partial = await (await request.get('/api/learning/overview')).json();
  expect(partial.tracks.find(track => track.key === 'papers').completed).toBe(1);
  expect(partial.today_completed).toBe(before.today_completed);
  await page.getByRole('button', { name: 'Mark as read: Auditing agent decisions (2026)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen Auditing agent decisions (2026)', exact: true })).toBeEnabled();
  await page.goto('/#/learning/progress');
  await expect(page.locator('[data-progress-area="papers"] progress')).toHaveAttribute('value', '2');
  await expect(page.locator('.learn-progress-tracks')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Milestones and badges' })).toBeVisible();
  await expect(page.locator('.learn-header-context')).not.toContainText('completed today');
  expect((await (await request.get('/api/learning/overview')).json()).today_completed).toBe(before.today_completed + 1);
  await page.goto('/#/learning');
  await expect(page.locator('.daily-momentum, .learning-scoreboard, .learning-badges')).toHaveCount(0);
  // Leave this archive unread for the existing research-practice fixture, which
  // intentionally chooses its next unread briefing later in the same server.
  const archived = await (await request.get('/api/learning/discovery?date=' + dates.dates.at(-1))).json();
  for (const item of archived.sections[0].items) {
    expect((await request.post('/api/learning/collection', { data: { action: 'reading', id: item.id, date: archived.date, read: false } })).ok()).toBe(true);
  }
});

test('new learning views fit desktop and mobile with accessible controls', async ({ page }) => {
  await mkdir('artifacts/learning-workspace', { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [route, selector] of [['weekly', '.learn-weeks'], ['discover?tab=papers', '.learn-resource-grid'], ['bookmarks?kind=repo&add=1', '.learn-link-form'], ['notes?new=1', '.learn-note-editor'], ['progress', '.learn-progress-tracks']]) {
      await page.goto('/#/learning/' + route);
      await expect(page.locator(selector)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const audit = await new AxeBuilder({ page }).include('.daily-page').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(audit.violations).toEqual([]);
      await page.screenshot({ path: `artifacts/learning-workspace/${route.split('?')[0]}-${width}.png`, fullPage: true, animations: 'disabled' });
    }
  }
});

test('curriculum shows selected resume evidence and reports partial loading failures', async ({ page }) => {
  await page.goto('/#/learning/weekly');
  await expect(page.getByRole('region', { name: 'Your learning focus' })).toContainText('Full-stack engineer');
  await expect(page.getByRole('region', { name: 'Your learning focus' })).toContainText('PostgreSQL');
  await expect(page.locator('.learn-header-context')).toContainText('Full-stack engineer');
  await page.route('**/api/research/learning', route => route.fulfill({ status: 503, json: { error: 'Resume library unavailable.' } }));
  await page.reload();
  await expect(page.locator('.learn-resume-inline')).toContainText('Resume topics could not be loaded.');
  await expect(page.getByRole('button', { name: 'Prepare resume topics', exact: true })).toHaveCount(0);
  await expect(page.locator('.learn-weeks')).toBeVisible();
});

test('a note saved while navigating clears the pending draft without creating duplicates', async ({ page, request }) => {
  let release, notify;
  const pending = new Promise(resolve => { notify = resolve; });
  const settled = new Promise(resolve => { release = resolve; });
  await page.route('**/api/learning/collection', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const response = await route.fetch();
    notify(); await settled;
    await route.fulfill({ response });
  });
  await page.goto('/#/learning/notes?new=1');
  await page.getByRole('textbox', { name: 'Note title', exact: true }).fill('Saved across navigation');
  await page.getByRole('textbox', { name: 'Note content' }).fill('Keep the result when I switch tabs.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await pending;
  await page.evaluate(() => { location.hash = '#/learning/bookmarks'; });
  await expect(page.getByRole('heading', { name: 'Bookmarks', exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/learning/notes?new=1'; });
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Note content' })).toBeDisabled();
  const responseReceived = page.waitForResponse(response => response.url().endsWith('/api/learning/collection') && response.request().method() === 'POST');
  release(); await responseReceived;
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveValue('');
  const notes = (await (await request.get('/api/learning/collection')).json()).notes;
  expect(notes.filter(note => note.title === 'Saved across navigation')).toHaveLength(1);
});

test('concurrent note edits can be preserved as a separate note', async ({ page, request }) => {
  const original = (await (await request.post('/api/learning/collection', { data: { action: 'note', title: 'Concurrent ideas', body: 'Original idea' } })).json()).note;
  await page.goto('/#/learning/notes?id=' + original.id);
  await page.getByRole('textbox', { name: 'Note content' }).fill('My version of the idea');
  expect((await request.post('/api/learning/collection', { data: { ...original, action: 'note', body: 'Another window’s version' } })).ok()).toBe(true);
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.locator('.learn-feedback')).toContainText('changed in another window');
  await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveValue('My version of the idea');
  await page.getByRole('button', { name: 'Save draft as a new note' }).click();
  await expect(page).not.toHaveURL(new RegExp(original.id));
  const notes = (await (await request.get('/api/learning/collection')).json()).notes.filter(note => note.title === 'Concurrent ideas');
  expect(notes.map(note => note.body).sort()).toEqual(['Another window’s version', 'My version of the idea'].sort());
});

test('bookmark fields stay stable while saving', async ({ page }) => {
  let release, notify;
  const pending = new Promise(resolve => { notify = resolve; });
  const settled = new Promise(resolve => { release = resolve; });
  await page.route('**/api/learning/collection', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    notify(); await settled; return route.continue();
  });
  await page.goto('/#/learning/bookmarks?kind=repo&add=1');
  await page.getByRole('textbox', { name: 'Bookmark title' }).fill('Pending repository');
  await page.getByRole('textbox', { name: 'Bookmark link' }).fill('https://github.com/example/pending');
  await page.getByRole('button', { name: 'Save bookmark' }).click(); await pending;
  await expect(page.getByRole('textbox', { name: 'Bookmark title' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Bookmark link' })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Bookmark category' })).toBeDisabled();
  release();
  await expect(page.locator('.learn-resource-card').filter({ hasText: 'Pending repository' })).toBeVisible();
});

test('account learning opens private views and does not request the owner’s learning runtime', async ({ page }) => {
  const runtimeCalls = [];
  const profile = { resume_available: true, source_label: 'Your account profile', target_roles: ['Platform engineer'], skills: ['Go', 'SQL'], guidance: 'Your selected resume is ready for a connected learning workflow.' };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (/^\/api\/learning\/(daily|dsa|code|practice)/.test(path)) runtimeCalls.push(path);
    const data = {
      '/api/session': { mode: 'accounts', legacy_access: false, user: { id: 'private-learner', email: 'learner@example.test', role: 'user', modules: ['profile', 'learning', 'research'] } },
      '/api/learning/collection': { notes: [], bookmarks: [] },
      '/api/course': { tracks: [], read: 0, total: 0, today: null },
      '/api/learning/curriculum': { weeks: [], profile, generation_available: false, generation_message: 'Learning generation is not connected to this account yet.' },
      '/api/research/learning': { resume: { topics: [] } },
      '/api/learning/discovery': { date: '2026-10-27', dates: [], sections: [{ key: 'papers', title: 'Research papers', group: 'brief:papers', available: false, items: [] }], generation_available: false, generation_message: 'Learning generation is not connected to this account yet.' },
      '/api/learning/overview': { date: '2026-10-27', profile, current_day: 1, current_week: 1, today_completed: 0, tracks: [], course_tracks: [], week: [], notes: 0, bookmarks: 0, total_completions: 0, solved_problems: 0, generation_available: false },
    };
    return Object.hasOwn(data, path) ? route.fulfill({ json: data[path] }) : route.fallback();
  });
  await page.goto('/#/learning/weekly');
  await expect(page.getByRole('region', { name: 'Your learning focus' })).toContainText('Platform engineer');
  await expect(page.getByRole('link', { name: 'Edit focus' })).toHaveAttribute('href', '#/onboarding');
  await expect(page.getByRole('button', { name: 'Prepare this week' })).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/learning/discover'; });
  await expect(page.locator('.learn-source-note')).toContainText('not connected to this account');
  await expect(page.getByRole('button', { name: 'Find today’s discoveries' })).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/learning/notes'; });
  await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/learning/progress'; });
  await expect(page.locator('.learn-progress-overview')).toBeVisible();
  await expect(page.locator('.learn-header-context')).toContainText('Platform engineer');
  await expect(page.locator('.learn-header-context')).not.toContainText('Day 1');
  expect(runtimeCalls).toEqual([]);
});

test('retrying an unconfirmed note creation does not create a duplicate', async ({ page, request }) => {
  let first = true;
  await page.route('**/api/learning/collection', async route => {
    if (route.request().method() !== 'POST' || !first) return route.fallback();
    first = false;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    return route.fulfill({ status: 503, json: { error: 'The save response was interrupted. Try again.' } });
  });
  await page.goto('/#/learning/notes?new=1');
  await page.getByRole('textbox', { name: 'Note title', exact: true }).fill('One saved idea despite retries');
  await page.getByRole('textbox', { name: 'Note content' }).fill('A retry should preserve one note.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.locator('.learn-feedback')).toContainText('save response was interrupted');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page).toHaveURL(/learning\/notes\?id=/);
  const notes = (await (await request.get('/api/learning/collection')).json()).notes;
  expect(notes.filter(note => note.title === 'One saved idea despite retries')).toHaveLength(1);
});

test('Today puts the next lesson and study list ahead of optional discoveries', async ({ page, request }) => {
  const daily = await (await request.get('/api/learning/daily')).json();
  daily.plan.read = false;
  await page.route('**/api/learning/daily', route => route.fulfill({ json: daily }));
  await mkdir('artifacts/learning-clarity', { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/learning');
    await expect(page.getByRole('link', { name: 'Continue lesson', exact: true })).toBeVisible();
    await expect(page.locator('.learn-path-explorer')).toHaveCount(0);
    await expect(page.locator('.daily-task-group').first().locator('[data-learning-task]')).toHaveCount(3);
    await expect(page.locator('.daily-optional-group [data-learning-task]')).toHaveCount(5);
    await expect(page.getByRole('link', { name: 'Write a note', exact: true })).toHaveAttribute('href', '#/learning/notes?new=1');
    await expect(page.locator('.learn-header-context')).not.toContainText('completed today');
    await expect(page.locator('.activity-launch')).not.toBeVisible();
    const firstTask = await page.locator('.daily-agenda [data-learning-task]').first().boundingBox();
    expect(firstTask.y).toBeLessThan(width < 500 ? 650 : width < 1100 ? 620 : 490);
    const buttonFont = await page.getByRole('link', { name: 'Continue lesson', exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(buttonFont).toBeGreaterThanOrEqual(14);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const audit = await new AxeBuilder({ page }).include('.daily-page').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({ path: `artifacts/learning-clarity/today-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Research activity', exact: true }).click();
  await expect(page.locator('.activity-sheet')).toBeVisible();
});

test('an empty Today groups missing material into one setup section', async ({ page, request }) => {
  const daily = await (await request.get('/api/learning/daily')).json();
  daily.plan = { ...daily.plan, available: false, read: false, completed: 0 };
  daily.readings = daily.readings.map(item => ({ ...item, available: false, read: false }));
  daily.briefing = { available_dates: [] };
  await page.route('**/api/learning/daily', route => route.fulfill({ json: daily }));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/#/learning');
  await expect(page.locator('.daily-agenda [data-learning-task]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Prepare today’s research', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Set up my learning plan', exact: true })).toBeVisible();
  await expect(page.locator('.daily-missing-material')).not.toHaveAttribute('open', '');
  await expect(page.locator('.daily-missing-material')).toContainText('7 not prepared');
  await expect(page.locator('[data-learning-task="plan"]')).not.toBeVisible();
  await page.screenshot({ path: 'artifacts/learning-clarity/today-empty-390.png', fullPage: true, animations: 'disabled' });
  await page.getByText('Choose individual topics · 7 not prepared', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Prepare learning day', exact: true })).toBeVisible();
  const audit = await new AxeBuilder({ page }).include('.daily-page').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
});
