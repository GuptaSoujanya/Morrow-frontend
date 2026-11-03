import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const idle = { epoch: 'learning-workspace', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };

async function revealControl(locator) {
  await expect(locator).toBeAttached();
  // Open real disclosure controls from the outside in, without changing page
  // state directly. Settings may sit below a closed secondary-tools section.
  const closedParents = locator.locator('xpath=ancestor::details[not(@open)]');
  while (await closedParents.count()) await closedParents.first().locator(':scope > summary').click();
}

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

test('interview bank filters real questions, hides answers and returns to the same search from a lesson', async ({ page, request }) => {
  const bank = await (await request.get('/api/learning/interview-bank')).json();
  const writes = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await page.goto('/#/learning/weekly?view=questions');
  await expect(page.getByRole('heading', { name: 'Interview questions', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('.interview-question')).toHaveCount(12);
  const first = page.locator('.interview-question').first();
  await expect(first.locator('.interview-answer').first()).not.toHaveAttribute('open', '');
  await first.getByText('Show answer guide', { exact: true }).click();
  await expect(first.locator('.daily-prose').first()).toBeVisible();
  await page.getByRole('link', { name: 'Next page', exact: true }).click();
  await expect(page.locator('.interview-results')).toContainText(`Page 2 of ${bank.pages}`);
  await page.getByRole('combobox', { name: 'Subject', exact: true }).selectOption('ai_ml');
  await page.getByRole('combobox', { name: 'Course week', exact: true }).selectOption('3');
  await page.getByLabel('Search questions', { exact: true }).fill('regression');
  await page.getByRole('button', { name: 'Find questions' }).click();
  await expect(page.locator('.interview-results')).toContainText('Page 1');
  await expect(page.locator('.interview-question').first()).toContainText('AI & ML');
  const filteredUrl = page.url();
  await page.locator('.interview-lesson-link').first().click();
  await expect(page.locator('.lesson-stage-prose')).toHaveAttribute('data-current-lesson-stage', 'interview');
  await expect(page.getByRole('link', { name: '← Interview questions', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← Interview questions', exact: true }).click();
  await expect(page.getByLabel('Search questions', { exact: true })).toHaveValue('regression');
  const previousQuery = new URLSearchParams(new URL(filteredUrl).hash.split('?')[1]);
  const restoredQuery = new URLSearchParams(new URL(page.url()).hash.split('?')[1]);
  for (const key of ['view', 'track', 'week', 'q']) expect(restoredQuery.get(key)).toBe(previousQuery.get(key));
  await page.getByLabel('Search questions', { exact: true }).fill('unlikelytermxyz');
  await page.getByRole('button', { name: 'Find questions' }).click();
  await expect(page.getByText('No questions match. Try a shorter search or choose all subjects.')).toBeVisible();
  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(page.locator('.interview-question')).toHaveCount(12);
  expect(writes).toEqual([]);
});

test('interview cases and the question bank are readable and accessible on phones and desktop', async ({ page }) => {
  await mkdir('artifacts/interview-course', { recursive: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['learning/weekly?view=questions', 'learning/read/interview%2Fday-1?part=ai&stage=interview']) {
      await page.goto('/#/' + route);
      await expect(page.locator(route.includes('weekly') ? '.interview-question' : '.lesson-stage-prose').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const audit = await new AxeBuilder({ page }).include('.daily-content').analyze();
      expect(audit.violations).toEqual([]);
      await page.screenshot({ path: `artifacts/interview-course/${route.includes('weekly') ? 'bank' : 'lesson'}-${width}.png`, fullPage: !route.includes('weekly') });
    }
  }
});

test('interview bank load failure has a retry without recording any progress', async ({ page }) => {
  let fail = true;
  await page.route('**/api/learning/interview-bank*', route => {
    if (fail) return route.fulfill({ status: 503, json: { error: 'Question bank is temporarily unavailable.' } });
    return route.continue();
  });
  await page.goto('/#/learning/weekly?view=questions');
  await expect(page.locator('.daily-content').getByRole('alert')).toContainText('Question bank is temporarily unavailable.');
  fail = false;
  await page.locator('.daily-content').getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.interview-question')).toHaveCount(12);
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
  const title = await question.locator('.dsa-question-heading h3').textContent();
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
  test.setTimeout(75_000);
  await mkdir('artifacts/learning-workspace', { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [route, selector] of [['weekly', '.course-week-list'], ['discover?tab=papers', '.learn-resource-grid'], ['bookmarks?kind=repo&add=1', '.learn-link-form'], ['notes?new=1', '.learn-note-editor'], ['progress', '.learn-progress-tracks']]) {
      await page.goto('/#/learning/' + route);
      await expect(page.locator(selector)).toBeVisible();
      await expect(page.locator('.daily-page').getByText(/^(null|undefined)$/, { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const audit = await new AxeBuilder({ page }).include('.daily-page').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(audit.violations).toEqual([]);
      await page.screenshot({ path: `artifacts/learning-workspace/${route.split('?')[0]}-${width}.png`, fullPage: true, animations: 'disabled' });
    }
  }
});

test('the shared course explains four subjects and a concrete output without depending on a resume library', async ({ page }) => {
  const resumeCalls = [];
  await page.route('**/api/research/learning', route => {
    resumeCalls.push(route.request().url());
    return route.fulfill({ status: 503, json: { error: 'Resume library unavailable.' } });
  });
  await page.goto('/#/learning/weekly');
  await expect(page.getByRole('heading', { name: '90-day interview course', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your next course lesson', exact: true })).toContainText('four subjects');
  await expect(page.locator('.course-today-outline li')).toHaveCount(4);
  await expect(page.locator('.course-today-outline')).toContainText('AI & machine learning');
  await expect(page.locator('.course-today-outline')).toContainText('Full-stack development');
  await expect(page.getByRole('region', { name: 'What to finish today', exact: true })).toBeVisible();
  await expect(page.locator('[data-course-skill]')).toHaveCount(4);
  await expect(page.locator('.learn-header-context')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Course phases', exact: true }).getByRole('button')).toHaveCount(4);
  await expect(page.locator('.course-start')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare resume topics', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(resumeCalls).toEqual([]);
  await page.locator('.course-start').click();
  await expect(page.locator('.learning-library-reading .lesson-course-reader')).toBeVisible();
  const menu = page.locator('.lesson-path-menu');
  if (!await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
  await page.locator('.lesson-project-brief > summary').click();
  await expect(page.getByRole('region', { name: 'Today’s learning goal', exact: true })).toBeVisible();
});

for (const width of [1440, 390]) test(`a fresh learner can follow Day 1, keep notes and complete only by choice at ${width}px`, async ({ page, request }) => {
  const baseline = await (await request.get('/api/learning/curriculum')).json();
  const original = await (await request.get('/api/document?id=interview%2Fday-1')).json();
  const fresh = structuredClone(baseline);
  fresh.completed = 0; fresh.next_day = 1; fresh.current_week = 1;
  for (const week of fresh.weeks) {
    week.completed = 0;
    for (const day of week.days) day.read = false;
  }
  const writes = [];
  let completed = false;
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON();
      writes.push({ path: url.pathname, data });
      if (url.pathname === '/api/research/read' && data.id === 'interview/day-1' && data.read === true) {
        completed = true;
        return route.fulfill({ json: { read: true } });
      }
      return route.fulfill({ status: 403, json: { error: 'Course journey writes stay inside this browser fixture.' } });
    }
    if (url.pathname === '/api/learning/curriculum') return route.fulfill({ json: { ...fresh, completed: completed ? 1 : 0 } });
    if (url.pathname === '/api/document' && url.searchParams.get('id') === 'interview/day-1')
      return route.fulfill({ json: { ...original, read: completed } });
    return route.fallback();
  });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/#/learning/weekly');
  await expect(page.locator('.course-hub-progress')).toContainText('0 of 90 days complete');
  await expect(page.locator('.course-today-outline li')).toHaveCount(4);
  await page.getByRole('link', { name: 'Start Day 1 →', exact: true }).click();
  const menu = page.locator('.lesson-path-menu');
  if (!await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
  const contents = page.locator('.lesson-part-nav');
  await expect(contents).toBeVisible();
  await page.locator('.lesson-project-brief > summary').click();
  await expect(page.getByRole('region', { name: 'Today’s learning goal', exact: true })).toBeVisible();
  const chapter = page.locator('.lesson-chapter-prose');
  await expect(chapter.locator('.lesson-focus')).toContainText('Why it matters at work');
  await expect(chapter.locator('.lesson-example')).toBeVisible();
  await expect(chapter.locator('.lesson-task')).toBeVisible();
  const notes = page.locator('.study-notes-panel');
  if (!await notes.evaluate(element => element.open)) await notes.locator(':scope > summary').click();
  const draft = page.getByRole('textbox', { name: 'Notes for this lesson', exact: true });
  await draft.fill('Day 1: explain the prediction, trace the request, test the boundary.');
  if (width < 1120) await notes.locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Next: System design', exact: true }).click();
  await expect(page.getByRole('region', { name: 'System design lesson', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back: AI & ML', exact: true }).click();
  await expect(contents.locator('[data-lesson-part="ai"]')).toHaveAttribute('aria-current', 'step');
  for (const key of ['build', 'project', 'dsa']) {
    if (!await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
    await contents.locator(`[data-lesson-part="${key}"]`).click();
    await expect(contents.locator(`[data-lesson-part="${key}"]`)).toHaveAttribute('aria-current', 'step');
    await expect(chapter).not.toBeEmpty();
    await expect(page.locator('.course-completion')).not.toBeVisible();
  }
  await chapter.getByRole('link', { name: 'Continue DSA practice', exact: true }).click();
  await expect(page.locator('[data-dsa-stage="concept"]')).toBeVisible();
  await page.goBack();
  if (!await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
  await expect(contents.locator('[data-lesson-part="dsa"]')).toHaveAttribute('aria-current', 'step');
  await contents.locator('[data-lesson-part="interview"]').click();
  await expect(chapter).not.toBeEmpty();
  if (!await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
  await contents.locator('[data-lesson-part="review"]').click();
  await expect(page.locator('.course-completion')).toBeVisible();
  expect(writes).toEqual([]);
  if (!await notes.evaluate(element => element.open)) await notes.locator(':scope > summary').click();
  await expect(draft).toHaveValue('Day 1: explain the prediction, trace the request, test the boundary.');
  if (width < 1120) await notes.locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen reading', exact: true })).toBeVisible();
  expect(writes).toEqual([{ path: '/api/research/read', data: { id: 'interview/day-1', read: true } }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  // The mutation was simulated; the fixture's actual stored course is untouched.
  expect((await (await request.get('/api/learning/curriculum')).json()).completed).toBe(baseline.completed);
});

test('course phases keep all 90 lessons reachable and expose each day’s four subjects before opening it', async ({ page, request }) => {
  const course = await (await request.get('/api/learning/curriculum')).json();
  const active = course.weeks.find(week => week.days.some(day => day.day === course.next_day))
    || course.weeks.find(week => week.number === course.current_week) || course.weeks[0];
  await page.goto('/#/learning/weekly');
  await expect(page.locator('.course-week[open]')).toHaveCount(1);
  await expect(page.locator(`[data-course-week="${active.number}"]`)).toHaveAttribute('open', '');
  const expectedRoutes = course.weeks.flatMap(week => week.days.filter(day => day.available).map(day => day.route));
  const actualRoutes = new Set();
  const phases = page.getByRole('group', { name: 'Course phases', exact: true }).getByRole('button');
  await expect(phases).toHaveCount(course.course.phases.length);
  for (let phase = 0; phase < course.course.phases.length; phase++) {
    await phases.nth(phase).click();
    await expect(phases.nth(phase)).toHaveAttribute('aria-pressed', 'true');
    const expectedWeeks = course.weeks.filter(week => week.end_day >= course.course.phases[phase].start_day && week.start_day <= course.course.phases[phase].end_day);
    await expect(page.locator('.course-week')).toHaveCount(expectedWeeks.length);
    for (const week of expectedWeeks) {
      const panel = page.locator(`[data-course-week="${week.number}"]`);
      if (await panel.getAttribute('open') === null) {
        await panel.locator(':scope > summary').focus();
        await panel.locator(':scope > summary').press('Enter');
      }
      await expect(panel.locator('.course-week-project')).toContainText(week.project);
      for (const day of week.days) {
        const row = panel.locator(`[data-course-day="${day.day}"]`);
        await expect(row.locator('.course-day-subjects > div')).toHaveCount(4);
        for (const topic of day.topics) await expect(row).toContainText(topic.topic);
        if (day.available) {
          await expect(row.locator('.course-day-link')).toBeVisible();
          actualRoutes.add(await row.locator('.course-day-link').getAttribute('href'));
        }
      }
    }
  }
  expect([...actualRoutes].sort()).toEqual([...new Set(expectedRoutes)].sort());
  expect(actualRoutes.size).toBe(90);
  await page.getByRole('button', { name: 'Go to my current week', exact: true }).click();
  await expect(page.locator(`[data-course-week="${active.number}"] > summary`)).toBeFocused();
  expect((await (await request.get('/api/learning/curriculum')).json()).completed).toBe(course.completed);
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
  await expect(page.getByRole('region', { name: 'Your next course lesson', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit focus' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Prepare next lesson' })).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/learning/discover'; });
  await expect(page.locator('.learn-source-note')).toContainText('not connected to this account');
  await expect(page.getByRole('button', { name: 'Find today’s discoveries' })).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/learning/notes'; });
  await expect(page.getByRole('textbox', { name: 'Note content' })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/learning/progress'; });
  await expect(page.locator('.learn-progress-overview')).toBeVisible();
  await expect(page.locator('.learn-header-context')).toContainText('90-day interview course');
  await expect(page.locator('.learn-header-context')).toContainText('Day 1');
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

test('Today selects one task without changing progress and keeps optional work out of the study flow', async ({ page, request }) => {
  const daily = await (await request.get('/api/learning/daily')).json();
  daily.plan.read = false;
  const dsa = await (await request.get('/api/learning/dsa')).json();
  dsa.progress = { ...dsa.progress, read: false, practiced: [], completed_at: null };
  const saves = [];
  page.on('request', req => { if (req.method() === 'POST' && /\/api\/(?:learning|research\/read)/.test(req.url())) saves.push(req.url()); });
  await page.route('**/api/learning/daily', route => route.fulfill({ json: daily }));
  await page.route('**/api/learning/dsa', route => route.fulfill({ json: dsa }));
  await mkdir('artifacts/learning-clarity', { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/learning');
    await expect(page.getByRole('link', { name: 'Continue lesson', exact: true })).toBeVisible();
    await expect(page.locator('.daily-page').getByText(/^(null|undefined)$/, { exact: true })).toHaveCount(0);
    await expect(page.locator('.learn-path-explorer')).toHaveCount(0);
    await expect(page.locator('.daily-agenda [data-learning-task]')).toHaveCount(2);
    await expect(page.locator('.daily-agenda [data-learning-task] a')).toHaveCount(0);
    await expect(page.locator('.daily-agenda-summary .btn-primary')).toHaveCount(1);
    await expect(page.locator('[data-disclosure="explore"]')).not.toHaveAttribute('open', '');
    await expect(page.locator('[data-disclosure="learning-tools"]')).not.toHaveAttribute('open', '');
    await expect(page.locator('[data-learning-task="papers"]')).not.toBeVisible();
    const planChoice = page.locator('[data-learning-focus="select-plan"]');
    const dsaChoice = page.locator('[data-learning-focus="select-dsa"]');
    await expect(planChoice).toHaveAttribute('aria-pressed', 'true');
    await dsaChoice.click();
    await expect(dsaChoice).toHaveAttribute('aria-pressed', 'true');
    await expect(planChoice).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.daily-agenda-summary')).toContainText(dsa.lesson.title);
    await expect(page.locator('.daily-agenda-summary')).not.toContainText(/(^|\s)(null|undefined)(\s|$)/);
    await expect(page.locator('.daily-agenda-summary').getByRole('link', { name: 'Start DSA lesson', exact: true })).toHaveAttribute('href', '#/learning/dsa');
    await expect(page.locator('.daily-session-count')).toHaveText('0 / 2 complete');
    await page.getByRole('button', { name: 'Refresh learning', exact: true }).click();
    await expect(page.locator('[data-learning-focus="select-dsa"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.daily-agenda-summary')).toContainText(dsa.lesson.title);
    await expect(page.locator('.daily-agenda-summary')).not.toContainText(/(^|\s)(null|undefined)(\s|$)/);
    await page.locator('[data-learning-focus="select-plan"]').click();
    await expect(page.locator('.daily-agenda-summary')).toContainText(daily.plan.title);
    await expect(page.locator('.daily-agenda-summary')).not.toContainText(/(^|\s)(null|undefined)(\s|$)/);
    await expect(page.locator('.daily-optional-group [data-learning-task]')).toHaveCount(6);
    await expect(page.locator('.daily-optional-group > ol > [data-learning-task]')).toHaveCount(3);
    await expect(page.locator('.daily-more-reading')).not.toHaveAttribute('open', '');
    await expect(page.locator('[data-learning-task="companies"]')).not.toBeVisible();
    await expect(page.locator('.daily-tools')).not.toHaveAttribute('open', '');
    const noteLink = page.locator('.daily-tools a[href="#/learning/notes?new=1"]');
    await expect(noteLink).not.toBeVisible();
    await expect(noteLink).toHaveAttribute('href', '#/learning/notes?new=1');
    await expect(page.locator('.learn-header-context')).toHaveCount(0);
    await expect(page.locator('.activity-launch')).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue lesson', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.daily-agenda [data-learning-task]').first()).toBeInViewport({ ratio: .1 });
    const buttonFont = await page.getByRole('link', { name: 'Continue lesson', exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(buttonFont).toBeGreaterThanOrEqual(14);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const audit = await new AxeBuilder({ page }).include('.daily-page').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({ path: `artifacts/learning-clarity/today-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await revealControl(page.locator('[data-learning-task="companies"]'));
  await expect(page.locator('[data-learning-task="companies"]')).toBeVisible();
  await revealControl(page.locator('.daily-tools a[href="#/learning/notes?new=1"]'));
  await expect(page.getByRole('link', { name: 'Write a note', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Research activity', exact: true }).click();
  await expect(page.locator('.activity-sheet')).toBeVisible();
  expect(saves).toEqual([]);
});

test('an empty Today keeps the next course lesson ahead of optional research setup', async ({ page, request }) => {
  const daily = await (await request.get('/api/learning/daily')).json();
  daily.plan = { ...daily.plan, available: false, read: false, completed: 0 };
  daily.readings = daily.readings.map(item => ({ ...item, available: false, read: false }));
  daily.briefing = { available_dates: [] };
  await page.route('**/api/learning/daily', route => route.fulfill({ json: daily }));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/#/learning');
  await expect(page.locator('.daily-agenda [data-learning-task]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Prepare today’s research', exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare next lesson', exact: true })).toBeVisible();
  await expect(page.locator('.daily-missing-material')).not.toHaveAttribute('open', '');
  await expect(page.locator('.daily-missing-material')).toContainText('6 not prepared');
  await expect(page.locator('[data-learning-task="plan"]')).toBeVisible();
  await page.screenshot({ path: 'artifacts/learning-clarity/today-empty-390.png', fullPage: true, animations: 'disabled' });
  await revealControl(page.locator('.daily-setup-card'));
  await expect(page.getByRole('button', { name: 'Prepare today’s research', exact: true })).toBeVisible();
  await page.getByText('Choose individual topics · 6 not prepared', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Prepare research papers', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare next lesson', exact: true })).toBeVisible();
  const audit = await new AxeBuilder({ page }).include('.daily-page').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
});

test('additional reading does not complete or block the daily course session', async ({ page, request }) => {
  const daily = await (await request.get('/api/learning/daily')).json();
  const dsa = await (await request.get('/api/learning/dsa')).json();
  daily.plan = { ...daily.plan, read: false, completed: 0 };
  daily.readings = daily.readings.map(item => ({ ...item, read: true }));
  dsa.progress = { ...dsa.progress, read: false, practiced: [], completed_at: null };
  await page.route('**/api/learning/daily', route => route.fulfill({ json: daily }));
  await page.route('**/api/learning/dsa', route => route.fulfill({ json: dsa }));
  await page.goto('/#/learning');
  await expect(page.locator('.daily-session-count')).toHaveText('0 / 2 complete');
  await expect(page.getByRole('heading', { name: 'Today’s work is done.', exact: true })).toHaveCount(0);
  await expect(page.locator('.daily-optional-group')).toContainText('Completed');
  daily.plan.read = true;
  dsa.progress.completed_at = daily.date + 'T12:00:00+05:30';
  daily.readings = daily.readings.map(item => ({ ...item, read: false }));
  await page.getByRole('button', { name: 'Refresh learning', exact: true }).click();
  await expect(page.locator('.daily-session-count')).toHaveText('2 / 2 complete');
  await expect(page.getByRole('heading', { name: 'Today’s work is done.', exact: true })).toBeVisible();
  await expect(page.locator('.daily-optional-group')).toContainText('Ready');
});

test('account learners can study the course and DSA without requesting local code execution', async ({ page, request }) => {
  const daily = await (await request.get('/api/learning/daily')).json();
  const dsa = await (await request.get('/api/learning/dsa')).json();
  const overview = await (await request.get('/api/learning/overview')).json();
  const curriculum = await (await request.get('/api/learning/curriculum')).json();
  const calls = [];
  daily.generation_available = false;
  dsa.execution_available = false;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (/^\/api\/learning\/(code|practice)/.test(path)) calls.push(path);
    const data = {
      '/api/session': { mode: 'accounts', legacy_access: false, user: { id: 'course-learner', email: 'course@example.test', role: 'user', modules: ['learning'] } },
      '/api/learning/daily': daily, '/api/learning/dsa': dsa, '/api/learning/activity': dsa.activity,
      '/api/learning/overview': overview,
      '/api/learning/curriculum': { ...curriculum, generation_available: false },
    };
    return Object.hasOwn(data, path) ? route.fulfill({ json: data[path] }) : route.fallback();
  });
  await page.goto('/#/learning');
  await expect(page.locator('.daily-core-group [data-learning-task="plan"]')).toContainText('Course lesson');
  await expect(page.locator('.learning-summary-copy .eyebrow')).toContainText(`DAY ${daily.plan.day} OF ${daily.plan.total}`);
  await page.locator('[data-learning-focus="select-dsa"]').click();
  await expect(page.locator('.daily-focus-title')).toHaveText(dsa.lesson.title);
  await page.locator('[data-learning-focus="select-plan"]').click();
  await expect(page.locator('.daily-agenda-summary').getByRole('link', { name: daily.plan.read ? 'Review lesson' : 'Continue lesson', exact: true })).toHaveAttribute('href', '#/learning/plan');
  await expect(page.getByRole('button', { name: 'Prepare today’s research', exact: true })).toHaveCount(0);
  await page.goto('/#/learning/dsa?step=practice');
  await expect(page.locator('.daily-question')).toBeVisible();
  await expect(page.locator('.daily-practice-note')).toContainText('your own editor');
  await expect(page.locator('.code-workspace')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Practice & exams', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '02 Worked example', exact: true }).click();
  await expect(page.locator('.daily-example .dsa-reading-prose table')).toBeVisible();
  await page.locator('.dsa-example-code > summary').click();
  await expect(page.locator('.dsa-example-code pre')).toBeVisible();
  await expect(page.locator('.code-workspace')).toHaveCount(0);
  await page.getByRole('tab', { name: '04 Review', exact: true }).click();
  await expect(page.locator('.dsa-review-checkpoints')).toBeVisible();
  await expect(page.locator('.dsa-review-stage .dsa-reading-prose details')).not.toHaveAttribute('open', '');
  await expect(page.locator('.code-workspace')).toHaveCount(0);
  await page.goto('/#/learning/weekly');
  await expect(page.locator('.course-start')).toBeVisible();
  const tools = page.getByRole('navigation', { name: 'More course resources', exact: true });
  await expect(tools.getByRole('link', { name: /Reference chapters|Saved learning/ })).toHaveCount(0);
  await expect(tools.getByRole('link', { name: 'My study notes →', exact: true })).toBeVisible();
  expect(calls).toEqual([]);
});

test('daily fetch saves its setting and starts the course feed through the dedicated action', async ({ page }) => {
  let state = { automatic: false, configured: true, date: new Date().toLocaleDateString('en-CA'), running: false, message: 'Automatic fetching is off.' };
  let runs = 0;
  await page.route('**/api/learning/feed', route => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ automatic: true });
      state = { ...state, automatic: true, message: 'Daily fetching is on.' };
    }
    return route.fulfill({ json: state });
  });
  await page.route('**/api/learning/feed/run', route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({});
    runs++;
    state = { ...state, running: true, message: 'Preparing your next lesson and today’s discoveries.' };
    return route.fulfill({ json: { started: true, status: state } });
  });
  await page.goto('/#/learning');
  const feed = page.locator('.daily-feed');
  await revealControl(feed);
  await feed.locator(':scope > summary').click();
  const toggle = page.getByRole('checkbox', { name: /Fetch new learning each day/ });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: 'Prepare today’s lesson & discoveries', exact: true }).click();
  await expect(page.locator('.daily-feed-state')).toHaveText('On');
  await expect(page.locator('.daily-feed-body')).toContainText('Preparing your next lesson');
  expect(runs).toBe(1);
});
