import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Load the production CSS cascade without workspace data or API requests.
// Exercise transient states that a default-page accessibility scan misses.
test.beforeEach(async ({ page }) => {
  await page.route('**/theme-state-fixture', route => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Dashboard state checks</title><link rel="stylesheet" href="/assets/workspace.css">
    </head><body><main style="max-width:780px;padding:24px;margin:auto">
      <h1>Form and feedback states</h1>
      <div class="panel" style="padding:24px">
        <label class="field">Email<input class="input" value="incomplete@" aria-invalid="true" aria-describedby="email-error"></label>
        <p class="field-error" id="email-error">Enter a complete email address.</p>
        <label class="field">Answer<textarea class="textarea" aria-invalid="true">An unfinished answer</textarea></label>
        <div class="account-auth-panel"><label class="field">Account email<input class="input" value="account@" aria-invalid="true"></label></div>
        <div class="inline-feedback" role="alert">Your changes could not be saved. Try again.</div>
        <p class="reading-save-status field-error">Reading progress could not be saved.</p>
        <p class="learning-library-note field-error">The reading list could not be loaded.</p>
        <div class="data-source-origin"><p class="source-error">This source is unavailable.</p></div>
        <p class="practice-message is-error">Your practice answer could not be saved.</p>
        <p class="practice-save-state is-error">Save failed. Your draft is still here.</p>
        <div class="preview"><span class="preview-label">Preview</span><code>Run a practice application</code></div>
        <div class="preview preview-error"><span class="preview-label">Check your input</span><code>Enter a limit between 1 and 500.</code></div>
        <button class="collection-card"><strong>Saved reading</strong><span>Open your collection</span></button>
      </div>
    </main></body></html>` }));
  await page.goto('/theme-state-fixture');
  await page.evaluate(() => document.fonts.ready);
});

async function expectReadable(control) {
  const ratio = await control.evaluate(element => {
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const style = getComputedStyle(element);
    const foreground = luminance(style.color), background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  expect(ratio, 'Entered text must remain readable on an invalid control.').toBeGreaterThanOrEqual(4.5);
}

test('invalid input values remain readable at rest, on hover and with keyboard focus', async ({ page }) => {
  for (const control of await page.locator('[aria-invalid=true]').all()) {
    await expectReadable(control);
    await control.hover();
    await expectReadable(control);
    await control.focus();
    await expectReadable(control);
  }
});

test('shared feedback, previews and hovered collections have accessible contrast', async ({ page }) => {
  await page.getByRole('button', { name: 'Saved reading Open your collection' }).hover();
  const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(result.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
});
