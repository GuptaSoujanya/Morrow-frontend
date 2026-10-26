import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Layout and local CSV export need no writes, bot actions, or messages.
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 409, json: { error: 'Read-only action-layout test' } }));
});

async function expectTextFits(control) {
  await expect(control).toBeVisible();
  const metrics = await control.evaluate(element => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    const bounds = {
      left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      top: box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
      bottom: box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
    };
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), clipped = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || node.parentElement.closest('[aria-hidden="true"], .visually-hidden, [hidden]')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width && rect.height && (rect.left < bounds.left - 2 || rect.right > bounds.right + 2 || rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2)) clipped.push(node.textContent.trim());
      }
    }
    return { clipped, height: box.height, overflow: element.scrollWidth - element.clientWidth };
  });
  expect(metrics.clipped, 'Text must fit inside the control padding, not merely the page.').toEqual([]);
  expect(metrics.overflow).toBeLessThanOrEqual(2);
  expect(metrics.height).toBeGreaterThanOrEqual(44);
}
async function ready(page, route) {
  await page.goto('/#/' + route);
  await expect(page.locator('main h1')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

// 640px also represents a 1280px desktop viewport at 200% browser zoom.
for (const width of [320, 375, 640, 768, 1024, 1280, 1440]) {
  test(`overview and Insights text actions fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    for (const route of ['overview', 'analytics']) {
      await ready(page, route);
      const header = page.locator('main .page-head').first();
      const button = header.getByRole('button', { name: 'Export data', exact: true });
      await expect(button).toBeEnabled();
      await expectTextFits(button);
      if (route === 'overview') {
        const practice = header.getByRole('link', { name: 'Practice DSA', exact: true });
        await expect(practice).toHaveAttribute('href', '#/learning/dsa?step=practice');
        await expectTextFits(practice);
        const [first, second] = await Promise.all([practice.boundingBox(), button.boundingBox()]);
        expect(first.x + first.width <= second.x + 1 || first.y + first.height <= second.y + 1, 'Header actions must not overlap.').toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if ([375, 768, 1440].includes(width)) {
        await mkdir('artifacts/action-layout', { recursive: true });
        await page.screenshot({ path: `artifacts/action-layout/${route}-${width}.png`, animations: 'disabled' });
      }
    }
  });
}

test('a long saved-report date remains fully readable on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 950 });
  await ready(page, 'reports');
  const control = page.getByRole('combobox', { name: 'Saved report', exact: true });
  await expectTextFits(control);
  await expect(page.locator('.reports-page .state-loading')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await mkdir('artifacts/action-layout', { recursive: true });
  await page.screenshot({ path: 'artifacts/action-layout/reports-320.png', animations: 'disabled' });
});

test('the resized Export action still downloads daily activity CSV', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await ready(page, 'overview');
  const button = page.locator('main .page-head').getByRole('button', { name: 'Export data', exact: true });
  await expect(button).toBeEnabled();
  const downloaded = page.waitForEvent('download');
  await button.click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/^job-hunt-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  const stream = await file.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk.toString();
  expect(csv.split(/\r?\n/)[0]).toBe('day,naukri,boards,company,waiting,skipped,failed');
});
