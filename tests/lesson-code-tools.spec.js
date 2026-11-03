import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

let helper;
test.beforeAll(async () => {
  const bundle = await build({ entryPoints: ['app/js/components/lesson-code-tools.js'],
    bundle: true, write: false, format: 'iife', globalName: 'LessonCodeTools' });
  helper = bundle.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent('<main id="lesson"></main>');
  await page.addScriptTag({ content: helper });
});

test('code controls preserve original nodes and skip diagrams', async ({ page }) => {
  const result = await page.evaluate(() => {
    const lesson = document.querySelector('#lesson');
    const pre = document.createElement('pre'), code = document.createElement('code');
    const exact = '\n  def score(value):\n\treturn value + 1  \n';
    pre.tabIndex = 0; code.className = 'language-python'; code.textContent = exact;
    pre.append(code); lesson.append(pre);
    lesson.insertAdjacentHTML('beforeend', '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre><figure class="learning-diagram"><pre><code>diagram source</code></pre></figure>');
    LessonCodeTools.enhanceLessonCode(lesson);
    LessonCodeTools.enhanceLessonCode(lesson);
    return { originalPre: lesson.querySelector('pre') === pre, originalCode: pre.firstChild === code,
      text: code.textContent, exact, tabIndex: pre.tabIndex,
      wrappers: lesson.querySelectorAll('.lesson-code-example').length,
      buttons: lesson.querySelectorAll('.lesson-code-copy').length,
      diagramsUnchanged: lesson.querySelector('.language-mermaid').parentElement.parentElement === lesson
        && !lesson.querySelector('.learning-diagram .lesson-code-toolbar') };
  });
  expect(result).toEqual({ originalPre: true, originalCode: true, text: result.exact,
    exact: result.exact, tabIndex: 0, wrappers: 1, buttons: 1, diagramsUnchanged: true });
  await expect(page.locator('.lesson-code-language')).toHaveText('Python');
  const size = await page.getByRole('button', { name: 'Copy code', exact: true }).boundingBox();
  expect(size.width).toBeGreaterThanOrEqual(44);
  expect(size.height).toBeGreaterThanOrEqual(44);
});

test('copy keeps whitespace, reads current code, and works on cloned lessons', async ({ page }) => {
  const exact = '\n  const answer = 42;\n\tconsole.log(answer);  \n';
  await page.evaluate(text => {
    const lesson = document.querySelector('#lesson');
    lesson.innerHTML = '<pre><code class="language-js">old example</code></pre>';
    window.copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async value => { window.copied.push(value); },
    } });
    LessonCodeTools.enhanceLessonCode(lesson);
    lesson.querySelector('code').textContent = text;
    const clone = lesson.cloneNode(true); clone.id = 'cloned-lesson'; document.body.append(clone);
    LessonCodeTools.enhanceLessonCode(clone);
  }, exact);
  for (const root of ['#lesson', '#cloned-lesson']) {
    const button = page.locator(root).getByRole('button', { name: 'Copy code', exact: true });
    await button.focus(); await page.keyboard.press('Enter');
    await expect(page.locator(root).getByRole('status')).toHaveText('Code copied.');
    await expect(button).toBeEnabled();
  }
  expect(await page.evaluate(() => window.copied)).toEqual([exact, exact]);
});

test('denied and unavailable clipboard show inline help and allow another attempt', async ({ page }) => {
  await page.evaluate(() => {
    const lesson = document.querySelector('#lesson');
    lesson.innerHTML = '<pre><code>  retry me  </code></pre>';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
    } });
    LessonCodeTools.enhanceLessonCode(lesson);
  });
  const button = page.getByRole('button', { name: 'Copy code', exact: true });
  for (const unavailable of [false, true]) {
    if (unavailable) await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
    await button.click();
    await expect(page.getByRole('status')).toHaveText('Could not copy. Select the code and copy it yourself.');
    await expect(button).toBeEnabled();
    await expect(button).not.toHaveAttribute('aria-busy');
  }
});
