import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method())
    ? route.continue() : route.fulfill({ status: 409, json: { error: 'UI check: workspace changes are disabled.' } }));
});

test('workspace search opens by keyboard, navigates, and restores focus on Escape', async ({ page }) => {
  await page.goto('/#/overview');
  const trigger = page.getByRole('button', { name: /^Search .*: your workspace$/ });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Find your next step' });
  const input = dialog.getByRole('searchbox', { name: 'Search workspace' });
  await expect(input).toBeFocused();
  await input.fill('courses');
  await input.press('Enter');
  await expect(page).toHaveURL(/#\/learning\/courses/);
  await expect(page.locator('.workspace-breadcrumb [aria-current=page]')).toHaveText('Courses');
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('workspace search searches records even when already on Applications', async ({ page }) => {
  await page.goto('/#/records');
  await expect(page.getByRole('searchbox', { name: 'Search records' })).toBeVisible();
  for (const term of ['compiler engineer', 'platform engineer']) {
    await page.getByRole('button', { name: /^Search .*: your workspace$/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Find your next step' });
    await dialog.getByRole('searchbox', { name: 'Search workspace' }).fill(term);
    await dialog.getByRole('link', { name: new RegExp(`Search applications for “${term}”`) }).click();
    await expect(page.getByRole('searchbox', { name: 'Search records' })).toHaveValue(term);
  }
});

test('workspace shortcut preserves an open avatar dialog', async ({ page }) => {
  await page.goto('/#/files/profile');
  await page.getByRole('button', { name: 'Change avatar', exact: true }).click();
  await expect(page.locator('.avatar-dialog')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.locator('.workspace-search-dialog')).toHaveCount(0);
  await expect(page.locator('.avatar-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.avatar-dialog')).not.toBeVisible();
});

for (const width of [375, 768, 1280, 1440]) test(`workspace shell and search fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/overview');
  await expect(page.locator('main h1')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#nav svg, #workspace-header svg')).toHaveCount(0);
  const visibleNavigation = page.locator(width < 768 ? '.mobile-primary' : '.sidebar-scroll');
  await expect(visibleNavigation.locator('.nav-art').first()).toBeVisible();
  if (width > 1100) {
    const sidebar = page.locator('.sidebar-scroll');
    const settings = sidebar.getByRole('link', { name: 'Preferences', exact: true });
    await settings.scrollIntoViewIfNeeded();
    await expect(settings).toBeInViewport();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  }
  await page.getByRole('button', { name: /^Search .*: your workspace$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Find your next step' });
  await expect(dialog).toBeInViewport();
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  const result = await new AxeBuilder({ page }).exclude('iframe').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([]);
});

test('phone More menu contains additional destinations without repeating the primary bar', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/#/overview');
  await expect(page.locator('main h1')).toBeVisible();
  const primary = await page.locator('.mobile-primary a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  await page.getByRole('button', { name: 'More sections' }).click();
  const more = page.locator('#mobile-nav');
  await expect(more).toBeVisible();
  const destinations = await more.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  expect(destinations.filter(href => primary.includes(href))).toEqual([]);
  await expect(more.getByRole('link', { name: 'Preferences', exact: true })).toBeVisible();
  await expect(more.locator('svg')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('/#/naukri');
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.locator('.mobile-primary .nav-item.active')).toHaveCount(1);
  await expect(page.locator('.mobile-primary .nav-item.active')).toHaveText('Bot Crew');
});
