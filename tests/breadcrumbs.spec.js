import { test, expect } from '@playwright/test';

const breadcrumb = page => page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', route => {
    if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/preview') return route.continue();
    return ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 409, json: { error: 'Read-only breadcrumb test' } });
  });
});

test('reader breadcrumb restores the filtered library on desktop and phone', async ({ page }) => {
  await page.route('**/api/document?*', route => route.fulfill({ json: { title: 'Hash maps and practical collision handling', html: '<p>Saved reading fixture.</p>', read: false, category: 'Learning' } }));
  await page.route('**/api/library?*', route => route.fulfill({ json: {
    total: 60, pages: 3, page: 2, size: 24,
    items: [{ id: 'notes/hash-maps.md', title: 'Hash maps and practical collision handling', category: 'Learning', read: false }],
  } }));
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/#/learning/read/notes%2Fhash-maps.md?from=library&q=hash+maps&category=Learning&page=2&size=24');
    const nav = breadcrumb(page);
    await expect(nav.locator('a')).toHaveText(['Home', 'Learning', 'Saved library', 'Hash maps and practical collision handling']);
    await expect(nav.locator('a[aria-current="page"]')).toHaveAttribute('href', /learning\/read\/notes\/hash-maps.md\?/);
    for (const link of await nav.locator('a').all()) await expect(link).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await nav.getByRole('link', { name: 'Saved library', exact: true }).click();
    await expect(page).toHaveURL(/#\/learning\/library\?/);
    await expect(page.locator('main h1')).toHaveText('Saved library');
    const params = new URLSearchParams(new URL(page.url()).hash.split('?')[1] ?? '');
    expect(Object.fromEntries(params)).toEqual({ q: 'hash maps', category: 'Learning', page: '2', size: '24' });
  }
});

test('bot provider and files breadcrumb anchors open their actual parents', async ({ page }) => {
  await page.goto('/#/boards/hirist/profile');
  let nav = breadcrumb(page);
  await expect(nav.locator('a')).toHaveText(['Home', 'Bot Crew', 'Job boards', 'Hirist', 'Profile update']);
  await nav.getByRole('link', { name: 'Hirist', exact: true }).click();
  await expect(page).toHaveURL(/#\/boards\/hirist$/);
  await nav.getByRole('link', { name: 'Bot Crew', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('Meet your Bot Crew');
  await page.goto('/#/files/answers');
  nav = breadcrumb(page);
  await expect(nav.locator('a')).toHaveText(['Home', 'My profile & files', 'Screening answers']);
  await nav.getByRole('link', { name: 'My profile & files', exact: true }).click();
  await expect(nav.locator('a[aria-current="page"]')).toHaveText('Your profile');
  await expect(page.getByRole('textbox', { name: 'First name', exact: true })).toBeVisible();
});

test('record filters update live breadcrumbs and their parent clears outcome', async ({ page }) => {
  await page.goto('/#/records/jobs/matched/30?board=hirist&q=engineer');
  const nav = breadcrumb(page);
  await expect(nav.locator('a')).toHaveText(['Home', 'Applications', 'Discovered jobs', 'Hirist', 'Above match threshold']);
  await nav.getByRole('link', { name: 'Discovered jobs', exact: true }).click();
  await expect(nav.locator('a')).toHaveText(['Home', 'Applications', 'Discovered jobs']);
  await expect(page.getByRole('searchbox', { name: 'Search records', exact: true })).toHaveValue('engineer');
  const outcome = page.getByRole('combobox', { name: 'Outcome', exact: true });
  await outcome.click();
  await page.locator('[role=listbox]:popover-open').getByRole('option', { name: 'Above match threshold', exact: true }).click();
  await expect(nav.locator('a[aria-current="page"]')).toHaveText('Above match threshold');
});

test('header contains only clickable breadcrumb and artwork search with focus recovery', async ({ page }) => {
  await page.goto('/#/overview');
  const header = page.locator('#workspace-header');
  await expect(breadcrumb(page).locator('a')).toHaveText(['Home']);
  await expect(header.locator('svg,.workspace-header-tools,.workspace-header-profile')).toHaveCount(0);
  const trigger = header.getByRole('button', { name: /^Search .*: your workspace$/ });
  await trigger.click();
  const dialog = page.locator('.workspace-search-dialog');
  await expect(dialog.locator('svg')).toHaveCount(0);
  await expect(dialog.locator('.workspace-search-result .navigation-art').first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search workspace', exact: true }).fill('courses');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Control+k');
  await page.getByRole('searchbox', { name: 'Search workspace', exact: true }).fill('courses');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/learning\/courses$/);
});
