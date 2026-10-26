import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';
import { loadingState, errorState } from './panel.js';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { readLearningView, writeLearningView } from '../learning-view-state.js';

const languages = { python: ['Python', python], javascript: ['JavaScript', javascript], cpp: ['C++', cpp] };
const draftScopes = new WeakMap();
const format = value => value === undefined ? 'No output' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const codeColors = HighlightStyle.define([
  { tag: tags.keyword, color: '#893817' },
  { tag: [tags.string, tags.regexp], color: '#326044' },
  { tag: [tags.number, tags.bool, tags.null], color: '#713d78' },
  { tag: [tags.typeName, tags.className], color: '#345f80' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#65447c' },
  { tag: tags.comment, color: '#6d6257', fontStyle: 'italic' },
  { tag: tags.invalid, color: '#9b2c25' },
]);
const consoleBlock = (text, label, error = false) => h('pre', { class: 'code-console' + (error ? ' code-error' : ''), role: 'region', tabIndex: 0, 'aria-label': label, text });

/** A local coding workspace reused by lessons, the sheet, and AI papers. */
export function codeEditor({ key, onSubmitted, readOnly = false, showProblemTitle = true, compact = false }) {
  const scope = accountRequestSignal(), lifetime = new AbortController();
  if (!draftScopes.has(scope)) draftScopes.set(scope, new Map());
  const drafts = draftScopes.get(scope);
  const root = h('section', { class: 'code-workspace', 'aria-label': 'Local coding workspace' }, loadingState('Opening the local code editor…'));
  let problem, capabilities, editor, language = 'python', busy = false, disposed = false, saveTimer;
  let saveStatus, output, languageSelect, runtimeMessage, input, runExamples, runInput, submitButton, saveButton, draft;
  const editable = new Compartment();
  // Lessons/papers retain each question's editor while another question is open.
  // An in-flight result must settle even while this retained node is detached.
  const current = () => !disposed && !scope.aborted;
  const cacheKey = lang => `${problem.problem_key}:${lang}`;
  const beforeUnload = event => { if ([...drafts.values()].some(item => item.code !== item.saved)) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  root.dispose = () => {
    if (disposed) return;
    clearTimeout(saveTimer);
    if (!scope.aborted && draft && draft.code !== draft.saved) saveDraft();
    disposed = true; lifetime.abort(); editor?.destroy();
    window.removeEventListener('beforeunload', beforeUnload);
    scope.removeEventListener('abort', root.dispose);
  };
  scope.addEventListener('abort', root.dispose, { once: true });
  root.hasDraft = () => busy || Boolean(draft && (draft.code !== draft.saved || draft.pending));

  function savedState(text, error = false) {
    if (!current() || !saveStatus) return;
    saveStatus.textContent = text;
    saveStatus.classList.toggle('is-error', error);
  }
  async function saveDraft() {
    clearTimeout(saveTimer);
    const selected = draft, selectedLanguage = language;
    if (!selected || scope.aborted || readOnly) return;
    if (selected.pending) {
      try { await selected.pending; }
      catch (error) { if (error.name !== 'AbortError') savedState(`Could not save. ${error.message} Your draft is still here.`, true); return; }
      if (selected.code !== selected.saved) return saveDraft(); return;
    }
    if (selected.code === selected.saved) { savedState('Code saved on this computer'); return; }
    const value = selected.code;
    savedState('Saving code…');
    selected.pending = api('/api/learning/code/draft', { key, language: selectedLanguage, code: value });
    try {
      await selected.pending;
      selected.saved = value;
      savedState(selected.code === selected.saved ? 'Code saved on this computer' : 'Unsaved code');
    } catch (error) { if (error.name !== 'AbortError') savedState(`Could not save. ${error.message} Your draft is still in this editor.`, true); }
    finally { selected.pending = null; }
  }
  function controls() {
    const selected = capabilities.languages?.find(item => item.id === language);
    const available = capabilities?.available && selected?.available;
    runtimeMessage.hidden = !capabilities.available || Boolean(available);
    runtimeMessage.textContent = selected?.reason || `${languages[language][0]} is not installed. Install its local runtime and restart Morrow, or choose an available language.`;
    runExamples.disabled = runInput.disabled = busy || !available;
    submitButton.disabled = busy || !available || readOnly;
    saveButton.disabled = busy || readOnly;
    languageSelect.disabled = busy || readOnly;
    input.disabled = busy;
    runExamples.textContent = busy ? 'Running locally…' : 'Run examples';
    root.setAttribute('aria-busy', String(busy));
    editor?.dispatch({ effects: editable.reconfigure(EditorState.readOnly.of(busy || readOnly)) });
  }
  function mountEditor(value) {
    editor?.destroy();
    const host = root.querySelector('.code-editor-host');
    host.replaceChildren();
    editor = new EditorView({ parent: host, state: EditorState.create({ doc: value, extensions: [
      basicSetup, languages[language][1](), syntaxHighlighting(codeColors), EditorState.tabSize.of(4), EditorView.lineWrapping,
      editable.of(EditorState.readOnly.of(readOnly)),
      EditorView.contentAttributes.of({ 'aria-label': `${languages[language][0]} code editor`, spellcheck: 'false', autocapitalize: 'off' }),
      keymap.of([{ key: 'Mod-Enter', run: () => { if (!busy) run('samples'); return true; } }]),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        draft.code = update.state.doc.toString(); draft.error = '';
        savedState(draft.code === draft.saved ? 'Code saved on this computer' : 'Unsaved code'); clearTimeout(saveTimer);
        saveTimer = setTimeout(saveDraft, 900);
      }),
      EditorState.transactionFilter.of(transaction => transaction.newDoc.length > 100_000 ? [] : transaction),
    ] }) });
  }
  async function selectLanguage(next) {
    if (busy || !current()) return;
    busy = true; controls();
    try {
      await saveDraft();
      const data = await api('/api/learning/code/problem?key=' + encodeURIComponent(key) + '&language=' + next, undefined, { fresh: true, signal: lifetime.signal });
      if (!current()) return;
      language = next;
      writeLearningView(scope, 'language:' + problem.problem_key, { language });
      const cached = drafts.get(cacheKey(next));
      draft = cached || { code: data.draft?.updated_at ? data.draft.code : data.starter?.[next] || '', saved: data.draft?.updated_at ? data.draft.code : data.starter?.[next] || '', pending: null };
      drafts.set(cacheKey(next), draft);
      mountEditor(draft.code); output.replaceChildren();
      savedState(draft.code === draft.saved ? 'Code saved on this computer' : 'Starter code · edits save automatically');
    } catch (error) { if (current() && error.name !== 'AbortError') savedState(error.message, true); }
    finally { if (current()) { busy = false; languageSelect.value = language; controls(); } }
  }
  async function run(action) {
    if (!current() || busy || !capabilities?.available || !capabilities.languages?.find(item => item.id === language)?.available || action === 'submit' && readOnly) return;
    const code = editor.state.doc.toString();
    busy = true; clearTimeout(saveTimer); controls();
    output.replaceChildren(h('p', { role: 'status', class: 'code-running', text: action === 'submit' ? 'Checking the complete test suite on your computer…' : 'Running your code on this computer…' }));
    try {
      await saveDraft();
      const result = await api('/api/learning/code/execute', { key, language, code, action,
        ...(action === 'custom' ? { stdin: input.value } : {}), ...(action === 'submit' ? { submission_id: crypto.randomUUID() } : {}) }, { signal: lifetime.signal });
      if (!current()) return;
      draft.saved = code; savedState('Code saved on this computer');
      showResult(result);
      if (result.scored) onSubmitted?.({ ...result, code, language });
    } catch (error) {
      if (current() && error.name !== 'AbortError') output.replaceChildren(h('p', { class: 'code-error', role: 'alert', text: error.message }));
    } finally { if (current()) { busy = false; controls(); } }
  }
  function showResult(result) {
    const tested = result.action !== 'custom', allPassed = result.total > 0 && result.passed === result.total;
    const status = ['ok', 'accepted', 'failed'].includes(result.status) ? tested ? allPassed ? 'All tests passed' : 'Keep refining your solution' : 'Run complete' : result.status.replaceAll('_', ' ');
    output.replaceChildren(h('div', { class: `code-result-head${allPassed ? ' is-passed' : ''}`, role: 'status' },
      h('strong', { text: status }), h('span', { text: tested && result.total ? `${result.passed || 0} / ${result.total} tests passed` : `${Math.round(result.duration_ms || 0)} ms` })),
      result.scored ? h('p', { class: 'code-score-note', text: `${result.submission.score} / 100 for this problem · +${result.submission.improvement} daily points. Your best result counts.` }) : h('p', { class: 'code-score-note', text: result.status === 'unavailable' ? 'The runtime could not start. Your code is saved; no score or attempt was recorded.' : 'Practice run · submit the full test suite to record a score.' }),
      h('div', { class: 'code-test-results' }, (result.tests || []).map((test, index) => h('details', { class: 'code-test', open: !test.passed },
        h('summary', {}, h('strong', { text: `Test ${index + 1}` }), h('span', { class: test.passed ? 'is-passed' : 'is-failed', text: test.passed ? 'Passed' : (test.status || 'Failed').replaceAll('_', ' ') })),
        h('div', { class: 'code-test-comparison' }, h('div', {}, h('h4', { text: 'Expected' }), consoleBlock(format(test.expected), `Test ${index + 1} expected output`)), h('div', {}, h('h4', { text: 'Your output' }), consoleBlock(format(test.actual), `Test ${index + 1} actual output`))),
        test.status === 'invalid_output' ? h('div', {}, h('p', { class: 'code-error', text: 'Return the result from solve(input), or write one JSON result from a standalone C++ program. Send debugging messages to stderr.' }), consoleBlock(test.stdout || 'No JSON result was returned.', `Test ${index + 1} raw output`)) : null,
        test.stderr ? consoleBlock(test.stderr, `Test ${index + 1} diagnostics`, true) : null))),
      ...[result.stdout && result.action === 'custom' ? h('div', {}, h('h4', { text: 'Output' }), consoleBlock(result.stdout, 'Program output')) : null,
        result.stderr ? consoleBlock(result.stderr, 'Compiler or runtime diagnostics', true) : null].filter(Boolean));
  }
  function draw() {
    languageSelect = h('select', { class: 'input', 'aria-label': 'Code language', onchange: event => selectLanguage(event.target.value) },
      Object.entries(languages).map(([value, [label]]) => h('option', { value, selected: value === language, text: label + (capabilities.languages?.find(item => item.id === value)?.available ? '' : ' · unavailable') })));
    saveStatus = h('span', { class: 'code-save-status', role: 'status', text: draft.code === draft.saved ? 'Code saved on this computer' : 'Starter code · edits save automatically' });
    runtimeMessage = h('p', { class: 'code-error', role: 'status', hidden: true });
    input = h('textarea', { class: 'textarea code-custom-input', rows: 4, maxLength: 20000, 'aria-label': 'Custom JSON input', value: JSON.stringify(problem.samples?.[0]?.input ?? {}, null, 2), spellcheck: 'false' });
    runExamples = h('button', { class: 'btn', type: 'button', onclick: () => run('samples'), text: 'Run examples' });
    runInput = h('button', { class: 'btn', type: 'button', onclick: () => run('custom'), text: 'Run input' });
    submitButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run('submit'), text: 'Submit solution' });
    saveButton = h('button', { class: 'btn code-save', type: 'button', onclick: saveDraft, text: 'Save code' });
    output = h('div', { class: 'code-output', 'aria-label': 'Code results' }, h('p', { class: 'code-empty-result', text: 'Run the examples to check your approach. Submit when you are ready to score the full test suite.' }));
    root.replaceChildren(h('header', { class: 'code-workspace-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'LOCAL CODE WORKSPACE' }), h('h3', { text: showProblemTitle ? problem.title : 'Your solution' })), h('span', { class: 'code-local-badge', text: capabilities.available ? 'Runs on your computer' : 'Runtime setup needed' })),
      ...(problem.companion ? [h('p', { class: 'code-contract-note', text: 'This related coding exercise practices the paper’s topic. Its tests score the exercise below; your written answer is saved separately.' })] : []),
      h('details', { class: 'code-contract', open: !compact }, h('summary', { text: 'Input, output & examples' }),
        h('dl', {}, h('dt', { text: 'Input' }), h('dd', { text: format(problem.input_spec) }), h('dt', { text: 'Output' }), h('dd', { text: format(problem.output_spec) }), h('dt', { text: 'Constraints' }),
          h('dd', {}, Array.isArray(problem.constraints) ? h('ul', { class: 'code-constraints' }, problem.constraints.map(text => h('li', { text }))) : format(problem.constraints))),
        h('div', { class: 'code-examples' }, (problem.samples || []).map((sample, index) => h('div', {}, h('strong', { text: `Example ${index + 1}` }), h('pre', { text: `Input  ${JSON.stringify(sample.input)}\nOutput ${JSON.stringify(sample.expected)}` })))),
        h('p', { class: 'code-contract-note', text: problem.judge_note })),
      ...(!capabilities.available ? [h('p', { class: 'code-error', role: 'status', text: capabilities.reason || 'A supported local runtime and isolation backend are required before code can run.' })] : []),
      h('div', { class: 'code-editor-toolbar' }, languageSelect, h('span', { text: '⌘ / Ctrl + Enter to run examples' })),
      runtimeMessage,
      h('div', { class: 'code-editor-host' }), h('div', { class: 'code-editor-footer' }, saveStatus, saveButton),
      h('details', { class: 'code-custom' }, h('summary', { text: 'Try your own input' }), input, runInput),
      h('div', { class: 'code-run-actions' }, runExamples, submitButton),
      h('p', { class: 'code-score-explanation', text: `${problem.test_count} checks in the full suite · score = tests passed ÷ total × 100. Repeated submissions keep your best result for the day.` }), output);
    mountEditor(draft.code); controls();
  }
  async function load() {
    try {
      const [meta, runtimes] = await Promise.all([
        api('/api/learning/code/problem?key=' + encodeURIComponent(key), undefined, { signal: lifetime.signal, fresh: true }),
        api('/api/learning/code/capabilities', undefined, { signal: lifetime.signal }),
      ]);
      if (!current()) return;
      problem = meta; capabilities = runtimes;
      const preference = readLearningView(scope, 'language:' + problem.problem_key)?.language;
      const preferred = preference && Object.hasOwn(languages, preference) ? preference : 'python';
      let selected = meta;
      if (preferred !== 'python') {
        selected = await api('/api/learning/code/problem?key=' + encodeURIComponent(key) + '&language=' + preferred,
          undefined, { signal: lifetime.signal, fresh: true });
        if (!current()) return;
      }
      language = preferred;
      draft = drafts.get(cacheKey(language)) || { code: selected.draft?.updated_at ? selected.draft.code : selected.starter?.[language] || '', saved: selected.draft?.updated_at ? selected.draft.code : selected.starter?.[language] || '', pending: null };
      drafts.set(cacheKey(language), draft); draw();
    } catch (error) { if (current() && error.name !== 'AbortError') root.replaceChildren(errorState('The coding workspace could not open. ' + error.message, load)); }
  }
  queueMicrotask(load);
  return root;
}
