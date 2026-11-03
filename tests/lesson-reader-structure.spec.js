import { test, expect } from '@playwright/test';

const idle = { epoch: 'reader-structure', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const chapters = ['ai', 'systems', 'build', 'project', 'dsa', 'interview', 'review'];

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
    if (!['GET', 'HEAD'].includes(route.request().method())) return route.fulfill({ status: 403, json: { error: 'Reader audit does not save progress.' } });
    if (path.startsWith('/api/learning/') || ['/api/document', '/api/research/learning', '/api/library', '/api/course'].includes(path)) return route.continue();
    const fixture = {
      '/api/session': { mode: 'local', legacy_access: true, user: null },
      '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
      '/api/status': { name: 'Learner', greeting: 'Hello', date: '2026-10-27', date_long: '27 October 2026', run: idle, questions: [], facts: [], sites: [], study: { today: null, read: 0, total: 0 }, report: { ready: false, days: [] } },
      '/api/run': idle, '/api/bots': { bots: [], run: idle },
      '/api/overview': { recent: [], boards: [], workspace: { research_count: 0, learning_done: 0 } },
    };
    return route.fulfill({ json: fixture[path] || {} });
  });
});

// Compare authored material, not text added by navigation, goal summaries or SVG
// enhancement. Keep code whitespace exact; ordinary prose ignores layout spaces.
function authoredBlocks(root) {
  if (typeof root === 'string') root = new DOMParser().parseFromString(root, 'text/html').body;
  const roots = Array.isArray(root) ? root : [root];
  return roots.flatMap(element => [...element.querySelectorAll('p, li, pre > code, table')]).filter(node =>
    !node.closest('.lesson-focus') && !node.matches('.lesson-finish-guidance')
    && !(node.tagName === 'P' && (node.closest('.learning-diagram') || node.querySelector(':scope > strong')?.textContent.trim().startsWith('Subject: '))))
    .map(node => node.tagName + ':' + (node.tagName === 'CODE' ? node.textContent : node.textContent.replace(/\s+/g, ' ').trim()));
}
function counts(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) || 0) + 1);
  return result;
}

test('all 90 days keep every authored paragraph, list item, code block and table exactly once across their chapters', async ({ page, request }) => {
  test.setTimeout(240000);
  const writes = [];
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  for (let day = 1; day <= 90; day++) {
    const response = await request.get('/api/document', { params: { id: `interview/day-${day}` } });
    expect(response.ok(), `Day ${day} document`).toBe(true);
    const document = await response.json();
    await page.goto(`/#/learning/read/interview%2Fday-${day}?part=ai`);
    await expect(page.locator('.lesson-chapter-prose')).toBeVisible();
    const menu = page.locator('.lesson-path-menu');
    if (!await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
    expect(await page.locator('.lesson-part-nav [data-lesson-part]').evaluateAll(nodes => nodes.map(node => node.dataset.lessonPart)), `Day ${day} chapters`).toEqual(chapters);
    const expected = await page.evaluate(authoredBlocks, document.html);
    const actual = await page.locator('.lesson-study-guide > .daily-prose, .lesson-introduction > .daily-prose').evaluateAll(authoredBlocks);
    for (const key of chapters) {
      if (!await menu.evaluate(element => element.open)) await menu.locator(':scope > summary').click();
      await page.locator(`[data-lesson-part="${key}"]`).click();
      const prose = page.locator('.lesson-chapter-prose');
      if (['ai', 'systems', 'build'].includes(key)) {
        await expect(prose.locator('[data-lesson-section]')).toHaveCount(4);
        for (const section of ['understand', 'example', 'try', 'interview']) await expect(prose.locator(`[data-lesson-section="${section}"]`)).toBeVisible();
        await expect(prose.locator('.lesson-focus')).toBeVisible();
        await expect(prose.locator('details').filter({ has: page.getByText('Show answer', { exact: true }) })).toHaveCount(2);
        await expect(prose.locator('details[open] > summary').filter({ hasText: /^(Check your answer|Show answer|Show follow-up answer)$/ })).toHaveCount(0);
      }
      actual.push(...await prose.evaluate(authoredBlocks));
    }
    const originalCounts = counts(expected), renderedCounts = counts(actual);
    const changed = [...originalCounts].filter(([text, count]) => renderedCounts.get(text) !== count)
      .map(([text, expected]) => ({ text: text.slice(0, 220), expected, actual: renderedCounts.get(text) || 0 }));
    expect(changed.slice(0, 8), `Day ${day}: authored content lost or duplicated`).toEqual([]);
  }
  expect(writes).toEqual([]);
});

for (const [part, heading, complete] of [
  ['project', 'Build and test', false],
  ['dsa', 'DSA practice', false],
  ['interview', 'Interview and recall', false],
  ['review', 'Review and finish', true],
]) {
  test(`${part} deep links restore the right chapter without completing the day`, async ({ page }) => {
    const writes = [];
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
    await page.goto(`/#/learning/read/interview%2Fday-1?part=${part}`);
    await expect(page.locator(`[data-lesson-part="${part}"]`)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('.lesson-chapter-prose').getByRole('heading', { name: heading, exact: true })).toBeVisible();
    if (complete) await expect(page.locator('.course-completion')).toBeVisible();
    else await expect(page.locator('.course-completion')).not.toBeVisible();
    await page.reload();
    await expect(page.locator(`[data-lesson-part="${part}"]`)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('.lesson-chapter-prose').getByRole('heading', { name: heading, exact: true })).toBeVisible();
    expect(writes).toEqual([]);
  });
}
