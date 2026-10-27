import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';
import { loadingState, errorState } from './panel.js';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language';
import { acceptCompletion, autocompletion, nextSnippetField, prevSnippetField } from '@codemirror/autocomplete';
import { indentMore, indentLess } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { readLearningView, writeLearningView } from '../learning-view-state.js';
import { icon } from '../icons.js';

const languages = { python: ['Python', python], javascript: ['JavaScript', javascript], cpp: ['C++', cpp] };
const extensions = { python: 'py', javascript: 'js', cpp: 'cpp' };
let editorId = 0;
const draftScopes = new WeakMap();
const format = value => value === undefined ? 'No output' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const jsonValue = value => value === undefined ? 'No value returned' : JSON.stringify(value, null, 2);
const verdicts = { accepted: 'Accepted', wrong_answer: 'Wrong answer', runtime_error: 'Runtime error',
  compile_error: 'Compilation error', timeout: 'Time limit exceeded', memory_limit: 'Memory limit exceeded',
  output_limit: 'Output limit exceeded', process_limit: 'Process limit exceeded', invalid_output: 'Invalid output',
  unavailable: 'Runtime unavailable', not_run: 'Not run' };
const comparisons = { exact: 'Values, types and array order must match.', unordered: 'Outer array order may differ; values and duplicate counts must match.',
  nested_unordered: 'Group and item order may differ; values and duplicate counts must match.', rows_unordered: 'Neighbor order may differ; row order must match.',
  approximate: 'Numbers use an absolute tolerance of 0.0000001; other values must match.' };
const milliseconds = value => `${Math.round(value || 0)} ms`;
const memorySize = bytes => bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : 'Not measured';
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
  let problem, capabilities, editor, language = 'python', busy = false, disposed = false, saveTimer, runningAction = null;
  let saveStatus, output, languageSelect, runtimeMessage, input, runExamples, runInput, submitButton, saveButton, draft, filename, cursorStatus, runLabel, clearButton;
  const editable = new Compartment();
  const wrapping = new Compartment();
  let wrapLines = true;
  let lastResultCode = null;
  const helpId = `code-editor-help-${++editorId}`;
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
  const draftStatus = () => draft.code !== draft.saved ? 'Unsaved code' : draft.persisted ? 'Code saved on this computer' : 'Starter code · edits save automatically';
  const newDraft = data => {
    const persisted = Boolean(data.draft?.updated_at);
    const code = persisted ? data.draft.code : data.starter?.[language] || '';
    return { code, saved: code, persisted, pending: null };
  };
  function updateCursor() {
    if (!editor || !cursorStatus) return;
    const position = editor.state.selection.main.head, line = editor.state.doc.lineAt(position);
    cursorStatus.textContent = `Ln ${line.number}, Col ${position - line.from + 1} · ${language === 'javascript' ? 2 : 4} spaces`;
  }
  function emptyOutput() {
    lastResultCode = null;
    output.replaceChildren(h('div', { class: 'code-empty-result' }, icon('code'),
      h('strong', { text: 'Ready when you are' }),
      h('p', { text: 'Run the examples to see test results and errors here. Your score changes only when you submit.' })));
  }
  async function saveDraft(force = false) {
    clearTimeout(saveTimer);
    const selected = draft, selectedLanguage = language;
    if (!selected || scope.aborted || readOnly) return;
    if (selected.pending) {
      try { await selected.pending; }
      catch (error) { if (error.name !== 'AbortError') savedState(`Could not save. ${error.message} Your draft is still here.`, true); return; }
      if (selected.code !== selected.saved || force && !selected.persisted) return saveDraft(force); return;
    }
    if (selected.code === selected.saved && (!force || selected.persisted)) { savedState(draftStatus()); return; }
    const value = selected.code;
    savedState('Saving code…');
    selected.pending = api('/api/learning/code/draft', { key, language: selectedLanguage, code: value });
    try {
      await selected.pending;
      selected.saved = value;
      selected.persisted = true;
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
    runLabel.textContent = runningAction === 'samples' ? 'Running…' : 'Run examples';
    runInput.textContent = runningAction === 'custom' ? 'Running…' : 'Run input';
    submitButton.textContent = runningAction === 'submit' ? 'Checking…' : 'Submit solution';
    clearButton.disabled = busy;
    root.setAttribute('aria-busy', String(busy));
    editor?.dispatch({ effects: editable.reconfigure(EditorState.readOnly.of(busy || readOnly)) });
  }
  function mountEditor(value) {
    editor?.destroy();
    const host = root.querySelector('.code-editor-host');
    host.replaceChildren();
    editor = new EditorView({ parent: host, state: EditorState.create({ doc: value, extensions: [
      basicSetup, languages[language][1](), syntaxHighlighting(codeColors),
      EditorState.tabSize.of(language === 'javascript' ? 2 : 4), indentUnit.of(language === 'javascript' ? '  ' : '    '),
      wrapping.of(wrapLines ? EditorView.lineWrapping : []),
      autocompletion({ interactionDelay: 0, maxRenderedOptions: 12, tooltipClass: () => 'code-completion-tooltip' }),
      editable.of(EditorState.readOnly.of(readOnly)),
      EditorView.contentAttributes.of({ 'aria-label': `${languages[language][0]} code editor`, 'aria-describedby': helpId, spellcheck: 'false', autocapitalize: 'off' }),
      Prec.highest(keymap.of([
        { key: 'Tab', run: view => !view.state.readOnly && (acceptCompletion(view) || nextSnippetField(view) || indentMore(view)),
          shift: view => !view.state.readOnly && (prevSnippetField(view) || indentLess(view)) },
        { key: 'Mod-s', preventDefault: true, run: () => { if (!busy && !readOnly) saveDraft(true); return true; } },
        { key: 'Mod-Enter', preventDefault: true, run: () => { if (!busy) run('samples'); return true; } },
      ])),
      EditorView.updateListener.of(update => {
        if (update.selectionSet || update.docChanged) updateCursor();
        if (!update.docChanged) return;
        draft.code = update.state.doc.toString(); draft.error = '';
        if (lastResultCode !== null && draft.code !== lastResultCode) emptyOutput();
        savedState(draftStatus()); clearTimeout(saveTimer);
        saveTimer = setTimeout(saveDraft, 900);
      }),
      EditorState.transactionFilter.of(transaction => transaction.newDoc.length > 100_000 ? [] : transaction),
    ] }) });
    filename.textContent = `solution.${extensions[language]}`;
    updateCursor();
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
      draft = cached || newDraft(data);
      drafts.set(cacheKey(next), draft);
      mountEditor(draft.code); emptyOutput();
      savedState(draftStatus());
    } catch (error) { if (current() && error.name !== 'AbortError') savedState(error.message, true); }
    finally { if (current()) { busy = false; languageSelect.value = language; controls(); } }
  }
  async function run(action) {
    if (!current() || busy || !capabilities?.available || !capabilities.languages?.find(item => item.id === language)?.available || action === 'submit' && readOnly) return;
    const code = editor.state.doc.toString();
    if (!code.trim() || code.trim() === problem.starter?.[language]?.trim()) {
      output.replaceChildren(h('p', { class: 'code-error', role: 'alert', text: 'Write your solution before running or submitting. Replace the starter placeholder with your code.' }));
      editor.focus();
      return;
    }
    lastResultCode = null;
    busy = true; runningAction = action; clearTimeout(saveTimer); controls();
    output.replaceChildren(h('p', { role: 'status', class: 'code-running', text: action === 'submit' ? 'Checking the complete test suite on your computer…' : 'Running your code on this computer…' }));
    try {
      await saveDraft();
      const result = await api('/api/learning/code/execute', { key, language, code, action,
        ...(action === 'custom' ? { stdin: input.value } : {}), ...(action === 'submit' ? { submission_id: crypto.randomUUID() } : {}) }, { signal: lifetime.signal });
      if (!current()) return;
      draft.saved = code; draft.persisted = true; savedState('Code saved on this computer');
      showResult(result);
      lastResultCode = code;
      if (result.scored) onSubmitted?.({ ...result, code, language });
    } catch (error) {
      if (current() && error.name !== 'AbortError') output.replaceChildren(h('p', { class: 'code-error', role: 'alert', text: error.message }));
    } finally { if (current()) { busy = false; runningAction = null; controls(); } }
  }
  function showResult(result) {
    const tested = result.action !== 'custom', allPassed = result.total > 0 && result.passed === result.total;
    const failure = result.tests?.find(test => !test.passed);
    const verdict = result.verdict || (result.status === 'failed' ? failure?.status === 'ok' ? 'wrong_answer' : failure?.status : result.status);
    const status = result.action === 'custom' && result.status === 'ok' ? 'Executed · not judged'
      : allPassed && result.status === 'accepted' ? result.action === 'samples' ? 'Examples passed' : 'Accepted'
      : verdicts[verdict] || 'Execution failed';
    const metric = (label, value) => h('div', {}, h('dt', { text: label }), h('dd', { text: value }));
    output.replaceChildren(...[h('div', { class: `code-result-head${allPassed ? ' is-passed' : ''}`, role: 'status' },
      h('strong', { text: status }), h('span', { text: tested && result.total ? `${result.passed || 0} / ${result.total} ${result.action === 'samples' ? 'examples' : 'tests'} passed` : milliseconds(result.duration_ms) })),
      result.scored ? h('p', { class: 'code-score-note', text: `${result.submission.score} / 100 for this problem · +${result.submission.improvement} daily points. Your best result counts.` }) : h('p', { class: 'code-score-note', text: result.status === 'unavailable' ? 'The runtime could not start. Your code is saved; no score or attempt was recorded.' : 'Practice run · submit the full test suite to record a score.' }),
      result.action === 'samples' ? h('p', { class: 'code-result-note', text: 'Examples are a quick check. Submit solution runs every edge case and larger input.' }) : null,
      result.action === 'custom' ? h('p', { class: 'code-result-note', text: 'Custom input runs your code without an expected answer. Execution does not mean the solution is correct.' }) : null,
      h('dl', { class: 'code-metrics' }, metric(result.tests?.length ? 'Slowest case' : result.status === 'compile_error' ? 'Compile time' : 'Runtime', milliseconds(result.runtime_ms ?? result.duration_ms)),
        metric('Peak memory · sampled', memorySize(result.peak_memory_bytes))),
      h('p', { class: 'code-result-note', text: `Limits: ${capabilities.limits?.time_seconds ?? 3} s per case · ${capabilities.limits?.memory_mb ?? 384} MB. Local measurements include runtime startup and overhead.` }),
      h('div', { class: 'code-test-results' }, (result.tests || []).map((test, index) => h('details', { class: 'code-test', open: !test.passed },
        h('summary', {}, h('strong', { text: `Test ${index + 1}` }), h('span', { class: test.passed ? 'is-passed' : 'is-failed', text: test.passed ? 'Passed' : verdicts[test.status] || 'Wrong answer' })),
        h('p', { class: 'code-result-note', text: test.name || `Test ${index + 1}` }),
        test.status !== 'not_run' ? h('p', { class: 'code-result-note', text: `${milliseconds(test.duration_ms)} · ${memorySize(test.peak_memory_bytes)} sampled memory` }) : null,
        h('div', { class: 'code-test-comparison' },
          h('div', {}, h('h4', { text: 'Input' }), consoleBlock(jsonValue(test.input), `Test ${index + 1} input`)),
          h('div', {}, h('h4', { text: 'Expected' }), consoleBlock(jsonValue(test.expected), `Test ${index + 1} expected output`)),
          h('div', {}, h('h4', { text: 'Your output' }), consoleBlock(['accepted', 'wrong_answer', 'ok'].includes(test.status) ? jsonValue(test.actual) : 'No valid result', `Test ${index + 1} actual output`))),
        h('p', { class: 'code-result-note', text: comparisons[test.comparison || problem.comparison] || comparisons.exact }),
        test.status === 'invalid_output' ? h('div', {}, h('p', { class: 'code-error', text: 'Return a JSON-compatible value from solve(input). Printing an answer does not return it. Standalone C++ must write exactly one JSON value to stdout.' }), consoleBlock(test.stdout || 'No JSON result was returned.', `Test ${index + 1} raw output`)) : null,
        test.debug_stdout ? h('div', {}, h('h4', { text: 'Debug output' }), consoleBlock(test.debug_stdout, `Test ${index + 1} debug output`)) : null,
        test.stderr ? consoleBlock(test.stderr, `Test ${index + 1} diagnostics`, true) : null))),
      problem.complexity ? h('details', { class: 'code-complexity' }, h('summary', { text: 'Time & space complexity targets' }),
        h('dl', { class: 'code-metrics' }, metric('Reference time', problem.complexity.time), metric('Reference space', problem.complexity.space)),
        h('p', { class: 'code-result-note', text: problem.complexity.note })) : null,
      result.tests?.some(test => test.category === 'stress') ? h('details', { class: 'code-complexity' }, h('summary', { text: 'Larger-input performance' }),
        h('p', { class: 'code-result-note', text: 'Compare the scale cases below. Startup overhead and sampling make these observations unsuitable for proving a Big-O bound.' }),
        h('div', { class: 'code-scaling' }, result.tests.filter(test => test.category === 'stress').map(test => h('div', {},
          h('strong', { text: test.name }), h('span', { text: test.status === 'not_run' ? 'Not run' : `${milliseconds(test.duration_ms)} · ${memorySize(test.peak_memory_bytes)}` }),
          h('span', { class: test.passed ? 'is-passed' : 'is-failed', text: verdicts[test.status] || 'Failed' }))))) : null,
      result.stdout && result.action === 'custom' ? h('div', {}, h('h4', { text: 'Output' }), consoleBlock(result.stdout, 'Program output')) : null,
        result.debug_stdout && result.action === 'custom' ? h('div', {}, h('h4', { text: 'Debug output' }), consoleBlock(result.debug_stdout, 'Program debug output')) : null,
        result.status === 'invalid_output' && !result.tests?.length ? h('p', { class: 'code-error', text: 'No valid JSON result was returned. Implement solve(input) and return the answer; standalone C++ must print one JSON value.' }) : null,
        result.stderr ? consoleBlock(result.stderr, 'Compiler or runtime diagnostics', true) : null].filter(Boolean));
  }
  function draw() {
    languageSelect = h('select', { class: 'input', 'aria-label': 'Code language', onchange: event => selectLanguage(event.target.value) },
      Object.entries(languages).map(([value, [label]]) => h('option', { value, selected: value === language, text: label + (capabilities.languages?.find(item => item.id === value)?.available ? '' : ' · unavailable') })));
    saveStatus = h('span', { class: 'code-save-status', role: 'status', text: draftStatus() });
    filename = h('span', { class: 'code-filename' });
    cursorStatus = h('span', { class: 'code-cursor-status' });
    runtimeMessage = h('p', { class: 'code-error', role: 'status', hidden: true });
    input = h('textarea', { class: 'textarea code-custom-input', rows: 4, maxLength: 20000, 'aria-label': 'Custom JSON input', value: JSON.stringify(problem.samples?.[0]?.input ?? {}, null, 2), spellcheck: 'false' });
    runLabel = h('span', { text: 'Run examples' });
    runExamples = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run('samples'), title: 'Run examples (⌘ / Ctrl + Enter)' }, icon('play'), runLabel);
    runInput = h('button', { class: 'btn', type: 'button', onclick: () => run('custom'), text: 'Run input' });
    submitButton = h('button', { class: 'btn code-submit', type: 'button', onclick: () => run('submit'), text: 'Submit solution' });
    saveButton = h('button', { class: 'btn code-save', type: 'button', onclick: () => saveDraft(true), title: 'Save code (⌘ / Ctrl + S)', text: 'Save code' });
    clearButton = h('button', { class: 'btn btn-ghost code-tool', type: 'button', onclick: emptyOutput, text: 'Clear output' });
    output = h('div', { class: 'code-output', role: 'region', 'aria-label': 'Code results', tabIndex: 0 });
    emptyOutput();
    const searchButton = h('button', { class: 'btn btn-ghost code-tool', type: 'button', 'aria-label': 'Find in code', title: 'Find in code (⌘ / Ctrl + F)', onclick: () => openSearchPanel(editor) }, icon('search'), 'Find');
    const wrapButton = h('button', { class: 'btn btn-ghost code-tool', type: 'button', 'aria-pressed': String(wrapLines), text: 'Wrap lines', onclick: () => {
      wrapLines = !wrapLines;
      editor.dispatch({ effects: wrapping.reconfigure(wrapLines ? EditorView.lineWrapping : []) });
      wrapButton.setAttribute('aria-pressed', String(wrapLines));
    } });
    const shortcut = (keys, label) => h('div', {}, h('kbd', { text: keys }), h('span', { text: label }));
    root.replaceChildren(h('header', { class: 'code-workspace-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'CODE WORKSPACE' }), h('h3', { text: showProblemTitle ? problem.title : 'Your solution' })), h('span', { class: 'code-local-badge' }, icon(capabilities.available ? 'check' : 'info'), capabilities.available ? 'Runs locally' : 'Runtime setup needed')),
      ...(problem.companion ? [h('p', { class: 'code-contract-note', text: 'This related coding exercise practices the paper’s topic. Its tests score the exercise below; your written answer is saved separately.' })] : []),
      h('details', { class: 'code-contract', open: !compact }, h('summary', { text: 'Input, output & examples' }),
        h('dl', {}, h('dt', { text: 'Input' }), h('dd', { text: format(problem.input_spec) }), h('dt', { text: 'Output' }), h('dd', { text: format(problem.output_spec) }), h('dt', { text: 'Constraints' }),
          h('dd', {}, Array.isArray(problem.constraints) ? h('ul', { class: 'code-constraints' }, problem.constraints.map(text => h('li', { text }))) : format(problem.constraints))),
        h('div', { class: 'code-examples' }, (problem.samples || []).map((sample, index) => h('div', {}, h('strong', { text: `Example ${index + 1}` }), h('pre', { text: `Input  ${JSON.stringify(sample.input)}\nOutput ${JSON.stringify(sample.expected)}` })))),
        h('p', { class: 'code-contract-note', text: problem.judge_note })),
      ...(!capabilities.available ? [h('p', { class: 'code-error', role: 'status', text: capabilities.reason || 'A supported local runtime and isolation backend are required before code can run.' })] : []),
      h('div', { class: 'code-editor-toolbar' }, h('label', { class: 'code-language' }, h('span', { text: 'Language' }), languageSelect),
        h('div', { class: 'code-run-actions' }, runExamples, submitButton)),
      runtimeMessage,
      h('div', { class: 'code-workbench' },
        h('div', { class: 'code-editor-pane' },
          h('div', { class: 'code-filebar' }, h('div', { class: 'code-file' }, icon('code'), filename), h('div', { class: 'code-tools' }, searchButton, wrapButton)),
          h('div', { class: 'code-editor-host' }),
          h('div', { class: 'code-editor-footer' }, saveStatus, saveButton),
          h('div', { class: 'code-editor-meta' }, cursorStatus, h('span', { id: helpId, text: 'Tab completes or indents. Esc, then Tab leaves the editor.' }))),
        h('section', { class: 'code-console-pane', 'aria-label': 'Execution console' },
          h('div', { class: 'code-console-toolbar' }, h('h4', { text: 'Console' }), clearButton),
          h('details', { class: 'code-custom' }, h('summary', { text: 'Try your own input' }), h('p', { class: 'code-input-help', text: 'Enter JSON matching the problem’s input format.' }), input, runInput), output)),
      h('footer', { class: 'code-workspace-footer' },
        h('p', { class: 'code-score-explanation', text: `${problem.test_count} tests · Running examples is practice. Submitting records your best score for the day.` }),
        h('details', { class: 'code-shortcuts' }, h('summary', { text: 'Keyboard shortcuts' }),
          h('div', { class: 'code-shortcut-grid' }, shortcut('Tab', 'Accept suggestion or indent'), shortcut('Shift + Tab', 'Outdent'),
            shortcut('Ctrl + Space', 'Show suggestions'), shortcut('⌘ / Ctrl + Enter', 'Run examples'), shortcut('⌘ / Ctrl + S', 'Save code'),
            shortcut('⌘ / Ctrl + F', 'Find in code'), shortcut('Esc, then Tab', 'Move focus out of the editor')))));
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
      draft = drafts.get(cacheKey(language)) || newDraft(selected);
      drafts.set(cacheKey(language), draft); draw();
    } catch (error) { if (current() && error.name !== 'AbortError') root.replaceChildren(errorState('The coding workspace could not open. ' + error.message, load)); }
  }
  queueMicrotask(load);
  return root;
}
