import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const idle = { epoch: 'diagram-fixture', revision: 0, next: 0, running: false, stopping: false,
  label: '', shown: '', action: '', seconds: 0, last: null, active_count: 0, runs: [], lines: [] };
const notebookTitle = /^(AI and ML|System design|Implementation) — /;

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
    if (route.request().method() !== 'GET') return route.fulfill({ status: 403, json: { error: 'This diagram fixture does not save progress.' } });
    const data = {
      '/api/session': { mode: 'local', legacy_access: true, user: null },
      '/api/meta': { files: {}, answer_modes: [], linkedin_modes: [] },
      '/api/status': { name: 'Learner', greeting: 'Hello', date: '2026-10-27', date_long: '27 October 2026', run: idle, questions: [], facts: [], sites: [], study: { today: null, read: 0, total: 0 }, report: { ready: false, days: [] } },
      '/api/run': idle, '/api/bots': { bots: [], run: idle },
      '/api/overview': { recent: [], boards: [], workspace: { research_count: 0, learning_done: 0 } },
    };
    return route.fulfill({ json: data[path] || {} });
  });
});

function notebooks(page) {
  return page.locator('.lesson-panel .learning-diagram').filter({ has: page.locator('figcaption').filter({ hasText: notebookTitle }) });
}

async function fitsPage(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function readyDiagram(figure) {
  await expect(figure).toHaveAttribute('data-diagram-state', 'ready', { timeout: 15000 });
  await expect(figure.locator('svg[role="img"]')).toBeVisible();
  // Every visible diagram is rebuilt from allowed SVG nodes and local markers.
  expect(await figure.locator('svg').evaluate(svg => [...svg.querySelectorAll('*')].some(node =>
    ['script', 'foreignObject', 'a', 'image', 'iframe', 'style'].includes(node.localName)
    || [...node.attributes].some(attr => /^on|href$/i.test(attr.name))))).toBe(false);
  // Losing Mermaid's text-anchor styles can render a valid SVG whose labels
  // begin at the node centre and run outside its box. Check visible geometry.
  const overflowingLabels = await figure.locator('svg .node').evaluateAll(nodes => nodes.flatMap(node => {
    const shape = node.querySelector(':scope > rect, :scope > circle, :scope > ellipse, :scope > polygon, :scope > path');
    if (!shape) return [];
    const box = shape.getBoundingClientRect();
    return [...node.querySelectorAll('text')].flatMap(label => {
      const text = label.getBoundingClientRect();
      return text.left < box.left - 2 || text.right > box.right + 2 || text.top < box.top - 2 || text.bottom > box.bottom + 2
        ? [{ label: label.textContent, box: box.toJSON(), text: text.toJSON() }] : [];
    });
  }));
  expect(overflowingLabels).toEqual([]);
  const clippedAtSvgEdge = await figure.locator('svg').evaluate(svg => {
    const box = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('text')].filter(label => {
      const text = label.getBoundingClientRect();
      return text.left < box.left - 2 || text.right > box.right + 2 || text.top < box.top - 2 || text.bottom > box.bottom + 2;
    }).map(label => label.textContent);
  });
  expect(clippedAtSvgEdge).toEqual([]);
}

async function fitDiagram(figure) {
  const fit = figure.getByRole('button', { name: 'Fit diagram', exact: true });
  if (await fit.isVisible()) await fit.click();
  await expect(figure.getByRole('button', { name: 'Enlarge diagram', exact: true })).toHaveAttribute('aria-pressed', 'false');
}

test('flow and sequence diagrams stay usable through stages, read-all clones and phone zoom', async ({ page }) => {
  test.setTimeout(90000);
  const writes = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await mkdir('artifacts/learning-depth', { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#/learning/read/interview%2Fday-1?part=ai&stage=understand');
    // A hash-only navigation may reuse the open stage from the previous width.
    // Reload to check the initial disclosure state of a fresh reader as well.
    await page.reload();
    const flow = notebooks(page).first();
    await readyDiagram(flow);
    await expect(flow.locator('.learning-diagram-source')).not.toHaveAttribute('open', '');
    await expect(flow.locator('code')).toContainText('flowchart');
    const firstId = await flow.locator('figcaption').getAttribute('id');
    if (width < 480) {
      // A narrow vertical diagram may already fit; labels must remain readable
      // in either initial mode. Wide diagrams expose their scrolling guidance.
      if (await flow.getByRole('button', { name: 'Fit diagram', exact: true }).isVisible()) {
        await expect(flow.locator('.learning-diagram-scroll-hint')).toContainText('Scroll sideways or down');
      }
      const labelSize = await flow.locator('svg text').first().evaluate(label => {
        const matrix = label.getScreenCTM();
        return parseFloat(getComputedStyle(label).fontSize) * Math.hypot(matrix.a, matrix.b);
      });
      expect(labelSize).toBeGreaterThanOrEqual(14);
    }
    await flow.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/learning-depth/course-diagram-${width}.png`, animations: 'disabled' });
    await fitDiagram(flow);
    await flow.getByRole('button', { name: 'Enlarge diagram', exact: true }).click();
    await expect(flow.getByRole('button', { name: 'Fit diagram', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await flow.locator('.learning-diagram-viewport').evaluate(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX))).toBe(true);
    await fitsPage(page);
    await flow.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await expect(flow.getByRole('button', { name: 'Enlarge diagram', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await flow.getByText('Read diagram source', { exact: true }).click();
    await expect(flow.locator('pre')).toBeVisible();
    await fitsPage(page);
    await page.getByRole('button', { name: 'Read all parts', exact: true }).click();
    await expect(notebooks(page)).toHaveCount(3);
    for (const figure of await notebooks(page).all()) await readyDiagram(figure);
    const ids = await notebooks(page).locator('figcaption').evaluateAll(nodes => nodes.map(node => node.id));
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain(firstId);
    const sequence = notebooks(page).filter({ has: page.locator('code').filter({ hasText: 'sequenceDiagram' }) });
    await readyDiagram(sequence);
    await fitDiagram(sequence);
    await sequence.getByRole('button', { name: 'Enlarge diagram', exact: true }).click();
    await fitsPage(page);
    await sequence.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await page.getByRole('button', { name: 'Read one subject at a time', exact: true }).click();
    await readyDiagram(notebooks(page).first());
    await expect(notebooks(page).first().locator('.learning-diagram-source')).toHaveAttribute('open', '');
    await expect(notebooks(page).first().locator('.learning-diagram-zoom')).toBeEnabled();
    await fitsPage(page);
  }
  expect(writes).toEqual([]);
});

test('all 39 weekly engineering diagrams render from the real course API', async ({ page }) => {
  test.setTimeout(180000);
  const seen = new Set();
  for (let day = 1; day <= 90; day += 7) {
    await page.goto(`/#/learning/read/interview%2Fday-${day}?part=all`);
    const figures = notebooks(page);
    await expect(figures).toHaveCount(3);
    for (const figure of await figures.all()) {
      await readyDiagram(figure);
      seen.add(await figure.locator('figcaption').textContent());
    }
    await expect(page.locator('.lesson-panel .learning-diagram[data-diagram-state="fallback"]')).toHaveCount(0);
    await fitsPage(page);
  }
  expect(seen.size).toBe(39);
});

test('unsupported and malformed diagrams show readable source without external requests or executable content', async ({ page, request }) => {
  const daily = await (await request.get('/api/learning/daily')).json();
  const sources = [
    'flowchart LR\n A[Read] --> B[Practice]\n click A "https://example.invalid/diagram-probe"',
    'flowchart LR\n A[Unclosed',
    'flowchart LR\n A["<img src=x onerror=alert(1)>"] --> B[Stop]',
    '%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\n A --> B',
  ];
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  daily.plan.content_html = '<h2>Diagram source checks</h2>' + sources.map((source, index) =>
    `<h3>Source ${index + 1}</h3><pre><code class="language-mermaid">${escape(source)}</code></pre>`).join('');
  const requests = [], dialogs = [];
  page.on('request', request => { if (/example\.invalid|\/x$/.test(request.url())) requests.push(request.url()); });
  page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.dismiss(); });
  await page.route('**/api/learning/daily', route => route.fulfill({ json: daily }));
  await page.goto('/#/learning/plan');
  await expect(page.locator('.learning-diagram')).toHaveCount(sources.length);
  for (let index = 0; index < sources.length; index++) {
    const figure = page.locator('.learning-diagram').nth(index);
    await expect(figure).toHaveAttribute('data-diagram-state', 'fallback');
    await expect(figure.locator('.learning-diagram-source')).toHaveAttribute('open', '');
    await expect(figure.locator('pre')).toBeVisible();
    expect(await figure.locator('code').textContent()).toBe(sources[index]);
    await expect(figure.locator('svg, img, iframe, a')).toHaveCount(0);
    await expect(figure.getByRole('button', { name: 'Enlarge diagram', exact: true })).not.toBeVisible();
  }
  expect(requests).toEqual([]);
  expect(dialogs).toEqual([]);
  await page.setViewportSize({ width: 375, height: 900 });
  await fitsPage(page);
});
