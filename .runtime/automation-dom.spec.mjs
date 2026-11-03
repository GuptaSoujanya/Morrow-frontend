import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const scripts = JSON.parse(execFileSync('./venv/bin/python', ['-c',
  'import json; from sites_bot.profile_agent import _TEXT_JS; from cutshort_bot.questionnaires import _CONVERSATION_SCRIPT,_ROWS_SCRIPT,_PROOF_SCRIPT,_CONTEXT_SCRIPT; print(json.dumps([_TEXT_JS,_CONVERSATION_SCRIPT,_ROWS_SCRIPT,_PROOF_SCRIPT,_CONTEXT_SCRIPT]))'],
  { cwd: '..', encoding: 'utf8' }));
const run = (page, script) => page.evaluate(s => new Function(s)(), script);

test('stored Python browser contracts run in isolated browsers', async () => {
  test.setTimeout(60000);
  const output = execFileSync('./venv/bin/python', ['-m', 'pytest', 'tests/sites/test_cutshort_questionnaires_dom.py', 'tests/sites/test_profile_readback_dom.py', '-q'],
    { cwd: '..', encoding: 'utf8', env: { ...process.env, RUN_BROWSER_CONTRACTS: '1' }, timeout: 45000 });
  expect(output).toContain('2 passed');
});

test('profile readback includes only selected and visible values', async ({ page }) => {
  const fixture = readFileSync('../.runtime/profile_readback_controls.mjs', 'utf8').match(/setContent\(`([\s\S]*?)`\)/)[1];
  await page.setContent(fixture);
  const text = await run(page, scripts[0]);
  for (const name of ['City', 'Radio', 'ExternalCheckbox', 'NestedCheckbox', 'AriaRadio', 'AriaCheckbox', 'AriaOption']) {
    expect(text).toContain('Selected' + name);
    expect(text).not.toContain('Unselected' + name);
  }
  expect(text).toContain('SavedCompany');
  expect(text).toContain('Saved about text');
  expect(text).not.toContain('HiddenCompany');
  expect(text).not.toContain('Hidden duplicate text');
});

test('profile readback rejects old textarea content and hidden duplicates', async ({ page }) => {
  await page.setContent(`<label for="about">About</label><textarea id="about">Stale default summary</textarea>
    <div style="visibility:hidden"><textarea>Invisible duplicate summary</textarea></div>
    <div aria-hidden="true"><textarea>Aria hidden duplicate summary</textarea></div>
    <div hidden><textarea>Hidden attribute duplicate summary</textarea></div>`);
  await page.locator('#about').evaluate(el => { el.value = 'Saved current summary'; });
  const text = await run(page, scripts[0]);
  expect(text).toContain('Saved current summary');
  for (const hidden of ['Stale default summary', 'Invisible duplicate summary', 'Aria hidden duplicate summary', 'Hidden attribute duplicate summary']) {
    expect(text).not.toContain(hidden);
  }
});

test('Cutshort conversation marker requires one rendered job', async ({ page }) => {
  const href = 'https://cutshort.io/profile/conversations/candidate?i=all&thread=6ae9cec32b5c589cb358e966&stage=awaiting';
  await page.setContent(`<p>Showing 1 recently active jobs</p><article><a href="${href}">View conversation</a></article>`);
  expect(await run(page, scripts[1])).toEqual([href]);
  await page.locator('p').evaluate(el => { el.textContent = 'Showing 2 recently active jobs'; });
  expect(await run(page, scripts[1])).toEqual([]);
});

test('Cutshort questionnaire discovery and confirmation exclude unrelated messages', async ({ page }) => {
  await page.setContent(`<aside role="tabpanel">
    <button>Acme<br>For job AI Engineer<br>[Questionnaire]</button>
    <button>Other company<br>For job Developer<br>Hello</button>
    <div role="status">Other questionnaire answers submitted</div></aside>
    <section><a href="https://cutshort.io/company/jobs-at-acme">Acme</a><p>For job AI Engineer</p>
      <a href="https://cutshort.io/job/AI-Engineer-123">View full job description</a>
      <div role="log"><div role="status">Chat questionnaire answers submitted</div></div>
      <div role="status">Your questionnaire answers were submitted</div>
      <div><textarea placeholder="Type your message..."></textarea></div></section>`);
  const rows = await run(page, scripts[2]);
  expect(rows).toHaveLength(1);
  expect(rows[0].company).toBe('Acme');
  expect(rows[0].title).toBe('AI Engineer');
  expect(await run(page, scripts[4])).toEqual({ companies: ['Acme'], titles: ['AI Engineer'], jobs: ['https://cutshort.io/job/AI-Engineer-123'] });
  expect(await run(page, scripts[3])).toEqual(['Your questionnaire answers were submitted']);
});
