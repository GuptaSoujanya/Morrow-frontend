import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method())
    ? route.continue() : route.fulfill({ status: 409, json: { error: 'Read-only navigation check.' } }));
});

async function open(page, route = 'learning') {
  await page.goto('/#/' + route);
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function capture(page, name) {
  await mkdir('artifacts/sidebar', { recursive: true });
  if (!await page.locator('#mobile-nav').isVisible()) await page.evaluate(() => {
    document.activeElement?.blur();
    document.querySelector('#nav .sidebar-scroll').scrollTop = 0;
  });
  await page.screenshot({ path: `artifacts/sidebar/${name}.png`, animations: 'disabled' });
}

test('Learning stays a single sidebar destination through deep links, history and reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const sidebar = page.locator('#nav .sidebar-scroll');
  const learning = sidebar.getByRole('link', { name: 'Learning', exact: true });
  for (const section of ['90-day course', 'Saved library', 'Progress', 'Today']) {
    await page.getByRole('navigation', { name: 'Learning sections', exact: true }).getByRole('link', { name: section, exact: true }).click();
    await expect(learning).toHaveCount(1);
    await expect(learning).toHaveClass(/active/);
    await expect(sidebar.locator('a[aria-current]')).toHaveCount(1);
    await expect(page.locator('#nav .learning-context-nav, #nav .learning-nav-toggle, #nav a[href^="#/learning/"]')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Learning sections', exact: true }).getByRole('link')).toHaveCount(6);
  }
  await page.goBack();
  await expect(page).toHaveURL(/#\/learning\/progress$/);
  await expect(learning).toHaveClass(/active/);
  await page.reload();
  await expect(page.locator('main h1')).toBeVisible();
  await expect(learning).toHaveCount(1);
  await expect(page.locator('#nav .learning-nav-toggle')).toHaveCount(0);
  await learning.focus();
  await page.keyboard.press('Tab');
  await expect(sidebar.getByRole('link', { name: 'Companies', exact: true })).toBeFocused();
});

for (const [width, height] of [[1440, 900], [1280, 720], [1024, 768], [768, 900], [640, 900], [375, 812]]) {
  test(`sidebar geometry, active state and accessibility at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    const nav = page.locator(width < 768 ? '#nav .mobile-primary' : '#nav .sidebar-scroll');
    await expect(nav.locator('.nav-item.active')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: 'Learning', exact: true })).toHaveClass(/active/);
    const metrics = await nav.locator('.nav-item').evaluateAll(links => links.map(link => {
      const box = link.getBoundingClientRect(), art = link.querySelector('.nav-art').getBoundingClientRect();
      const copy = link.querySelector('.nav-title');
      return { height: box.height, width: box.width, iconWidth: art.width, iconHeight: art.height,
        textOverflow: copy.clientWidth ? copy.scrollWidth - copy.clientWidth : 0 };
    }));
    for (const metric of metrics) {
      expect(metric.height).toBeGreaterThanOrEqual(44);
      expect(metric.width).toBeGreaterThanOrEqual(44);
      expect(metric.iconWidth).toBe(width < 768 ? 26 : 28);
      expect(metric.iconHeight).toBe(metric.iconWidth);
      expect(metric.textOverflow).toBeLessThanOrEqual(1);
    }
    expect(new Set(metrics.map(metric => metric.height)).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width >= 768) {
      const preferences = nav.getByRole('link', { name: 'Preferences', exact: true });
      await preferences.scrollIntoViewIfNeeded();
      await expect(preferences).toBeInViewport();
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await nav.getByRole('link', { name: 'Learning', exact: true }).focus();
      const outline = await nav.getByRole('link', { name: 'Learning', exact: true }).evaluate(link => getComputedStyle(link).outlineWidth);
      expect(parseFloat(outline)).toBeGreaterThanOrEqual(2);
    }
    const accessibility = await new AxeBuilder({ page }).include('#nav').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([]);
    await capture(page, `after-${width}`);
  });
}

test('phone More menu has readable rows, no repeated destinations, and restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  const primary = await page.locator('.mobile-primary a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  const more = page.getByRole('button', { name: 'More sections', exact: true });
  await more.click();
  const dialog = page.getByRole('dialog', { name: 'All sections', exact: true });
  await expect(dialog).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const destinations = await dialog.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  expect(destinations.filter(href => primary.includes(href))).toEqual([]);
  expect(new Set(destinations).size).toBe(destinations.length);
  const preferences = dialog.getByRole('link', { name: 'Preferences', exact: true });
  await preferences.scrollIntoViewIfNeeded();
  await expect(preferences).toBeInViewport();
  const shape = await preferences.boundingBox();
  expect(shape.height).toBeGreaterThanOrEqual(44);
  await capture(page, 'after-mobile-menu');
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await preferences.click();
  await expect(page).toHaveURL(/#\/setup$/);
  await expect(dialog).toBeHidden();
  await expect(more).toHaveClass(/active/);
  await expect(page.locator('.mobile-primary .nav-item.active')).toHaveCount(1);
});

test('large inbox counts do not push out labels and nested bot routes retain their parent', async ({ page }) => {
  await page.route('**/api/status', async route => {
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({ response, json: { ...status, questions: Array(123).fill({}), facts: [] } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, 'naukri');
  const sidebar = page.locator('#nav .sidebar-scroll');
  const inbox = sidebar.getByRole('link', { name: 'Action inbox', exact: true });
  await expect(inbox.locator('.badge')).toHaveText('99+');
  await expect(inbox).toHaveAttribute('aria-description', '123 items need attention');
  await expect(sidebar.getByRole('link', { name: 'Bot Crew', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(sidebar.locator('.nav-item.active')).toHaveCount(1);
  const copy = await inbox.locator('.nav-copy').boundingBox(), badge = await inbox.locator('.badge').boundingBox();
  expect(copy.x + copy.width).toBeLessThanOrEqual(badge.x);
});
