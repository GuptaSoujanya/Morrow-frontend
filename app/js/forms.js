import { h } from "./dom.js";
import { icon } from "./icons.js";
import { api, accountRequestSignal } from "./api.js";
import { toast } from "./components/toast.js";
import { confirmDialog } from "./components/dialog.js";
import { setConsoleSize } from "./components/console.js";
import { S, form, hooks } from "./state.js";
import { sentence } from "./format.js";
import { selectControl, dateControl } from './components/controls.js';
import { BROWSER_ACTIONS, BROWSER_RUN_MESSAGE, browserRunOptions } from './browser-mode.js';
export { form } from "./state.js";

let fieldId = 0;
// A pending preview/confirmation belongs to one account. Other actions stay
// available, and a late result cannot block or start work in a new workspace.
const pendingStarts = new Map();
export function field(label, control, hint, options = {}) {
  const id = `field-${++fieldId}`;
  const target = control.controlElement || control;
  target.dataset.focusKey = `field:${label}`;
  if (!target.id) target.id = id;
  target.setAttribute('aria-labelledby', `${id}-label`);
  const descriptions = [target.getAttribute('aria-describedby'), hint ? `${id}-hint` : null].filter(Boolean);
  const error = h('span', { id: `${id}-error`, class: 'field-error', role: 'status', hidden: true });
  descriptions.push(error.id);
  if (descriptions.length) target.setAttribute('aria-describedby', descriptions.join(' '));
  const wrapper = h("div", { class: "field" }, h("label", { class: "field-label", id: `${id}-label`, for:target.id, text: label }), control, hint ? h("span", { class: "field-hint", id: `${id}-hint`, text: hint }) : null, error);
  wrapper.controlElement = target;
  let assignedError = '';
  const showError = message => {
    const text = String(message || '');
    target.setAttribute('aria-invalid', String(Boolean(text)));
    error.hidden = !text; error.textContent = text;
    return !text;
  };
  wrapper.setError = message => { assignedError = String(message || ''); return showError(assignedError); };
  wrapper.clearError = () => wrapper.setError('');
  wrapper.validate = () => {
    // A server rejection cannot be resolved by native validation alone. Keep it
    // until the user edits this control or its caller explicitly clears it.
    if (assignedError) return showError(assignedError);
    // Calendar controls own their date parsing and error; wrapping them must not
    // erase that state when another field is validated or a form is submitted.
    if (target.matches('.date-input') && !options.validate) return target.getAttribute('aria-invalid') !== 'true';
    const custom = options.validate?.(target);
    if (custom) return showError(custom);
    const validity = target.validity;
    const value = String(target.value ?? '');
    const name = String(label).replace(/\s*\*\s*$/, '').toLowerCase();
    let message = '';
    if (validity?.badInput) message = target.type === 'number' ? 'Enter a valid number.' : 'Enter a valid value.';
    else if (validity?.valueMissing || (target.required && target.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]),textarea') && !value.trim())) {
      message = target.matches('select') ? `Choose ${name}.` : target.type === 'checkbox' ? 'Select this option to continue.' : `Enter ${name}.`;
    }
    else if (validity?.typeMismatch) message = target.type === 'email' ? 'Enter a complete email address, like name@example.com.' : 'Enter a valid web address.';
    else if (validity?.rangeUnderflow) message = `Use ${target.min} or more.`;
    else if (validity?.rangeOverflow) message = `Use ${target.max} or less.`;
    else if (validity?.stepMismatch) message = 'Enter a valid number within the allowed range.';
    else if (validity?.tooLong || (target.maxLength >= 0 && value.length > target.maxLength)) message = `Use ${target.maxLength} characters or fewer.`;
    else if (validity?.tooShort) message = `Use at least ${target.minLength} characters.`;
    else if (validity?.patternMismatch) message = target.title || `Check the format of ${name}.`;
    else if (validity?.customError) message = target.validationMessage || `Check ${name}.`;
    return showError(message);
  };
  if (target.matches('input:not(.date-input),textarea,select') || options.validate) {
    target.addEventListener('invalid', event => { event.preventDefault(); wrapper.validate(); });
    target.addEventListener('blur', event => {
      // Action handlers validate before submitting. Inserting an error between
      // pointerdown and click can move that button out from under the pointer.
      if (options.deferButtonBlur && event.relatedTarget?.closest?.('button')) return;
      wrapper.validate();
    });
    const edited = () => { assignedError = ''; if (target.getAttribute('aria-invalid') === 'true') wrapper.validate(); };
    target.addEventListener('input', edited);
    target.addEventListener('change', edited);
  }
  return wrapper;
}

export function toggle(action, key, label, hint) {
  const values = form(action);
  const input = h("input", {
    type: "checkbox",
    class: "switch",
    checked: !!values[key],
    onchange: (e) => {
      values[key] = e.target.checked;
      schedulePreview(action);
    },
  });
  return h("label", { class: "toggle" }, input, h("span", { class: "toggle-text" }, h("span", { text: label }), hint ? h("span", { class: "muted small", text: hint }) : null));
}

export function textInput(action, key, { placeholder = "", type = "text", inputmode, onEnter, min, max, step } = {}) {
  const values = form(action);
  if (type === 'date') return dateControl({value: values[key] ?? '', onChange: value => { values[key] = value; schedulePreview(action); }});
  return h("input", {
    class: "input",
    type,
    inputmode,
    min, max, step,
    placeholder,
    value: values[key] ?? "",
    oninput: (e) => {
      values[key] = e.target.value;
      schedulePreview(action);
    },
    onkeydown: (e) => {
      if (e.key === "Enter" && onEnter) {
        e.preventDefault();
        onEnter();
      }
    },
  });
}

export function textArea(action, key, { placeholder = "", rows = 5 } = {}) {
  const values = form(action);
  const el = h("textarea", {
    class: "textarea",
    placeholder,
    rows,
    oninput: (e) => {
      values[key] = e.target.value;
      schedulePreview(action);
    },
  });
  el.value = values[key] ?? "";
  return el;
}

export function selectInput(action, key, choices, fallback = "") {
  const values = form(action);
  if (values[key] === undefined) values[key] = fallback;
  return selectControl({options: choices, value: values[key], onChange: value => { values[key] = value; schedulePreview(action); }});
}

/** The required preview-before-run box: always rendered, always calls the backend `/api/preview`
 * before any run button becomes clickable. */
export function previewBox(action) {
  const box = h("div", { class: "preview", id: `preview-${action}` }, h("span", { class: "muted small", text: "Checking…" }));
  const browserNote = BROWSER_ACTIONS.has(action)
    ? browserRunToggle(browserRunOptions(action, form(action)).browser_mode, mode => {
      form(action).browser_mode = mode;
      delete form(action).headless;
      schedulePreview(action);
    }) : null;
  schedulePreview(action);
  return h('div', {class:'run-preview-controls'}, browserNote, h('details', {class:'run-details'}, h('summary', {text:'Run details'}), box));
}

export function browserRunToggle(mode, onChange) {
  return h('label', {class: 'toggle browser-run-toggle'},
    h('input', {type: 'checkbox', class: 'switch', checked: mode === 'background',
      'aria-label': 'Run in background', onchange: event => onChange(event.target.checked ? 'background' : 'visible')}),
    h('span', {class: 'toggle-text'}, h('span', {text: 'Run in background'}),
      h('span', {class: 'muted small browser-run-note', text: BROWSER_RUN_MESSAGE})));
}

export function schedulePreview(action) {
  clearTimeout((S.previews[action] || {}).timer);
  S.previews[action] = S.previews[action] || {};
  S.previews[action].error = 'Checking these options…';
  S.previews[action].version = (S.previews[action].version || 0) + 1;
  updateRunButtons();
  S.previews[action].timer = setTimeout(() => preview(action), 200);
}

async function preview(action) {
  const box = document.getElementById(`preview-${action}`);
  if (!box) return;
  const state = S.previews[action] || (S.previews[action] = {});
  const version = state.version;
  const scope = accountRequestSignal();
  try {
    const reply = await api("/api/preview", { action, options: browserRunOptions(action, form(action)) });
    if (scope.aborted || S.previews[action] !== state || version !== state.version) return;
    if (reply.needed) throw new Error(sentence(reply.needed));
    state.error = "";
    state.shown = reply.shown;
    box.replaceChildren(h("span", { class: "preview-label", text: "Will run" }), h("code", { text: `$ ${reply.shown}` }));
    box.classList.remove("preview-error");
  } catch (error) {
    if (scope.aborted || error.name === 'AbortError' || S.previews[action] !== state || version !== state.version) return;
    state.error = error.message;
    state.shown = "";
    box.replaceChildren(h("span", { class: "preview-label", text: "Needed" }), h("span", { text: error.message }));
    box.classList.add("preview-error");
    box.parentElement.open = true;
  }
  updateRunButtons();
}

/** Every run — dry or real — previews the exact command it is about to start, with the exact
 * options this call uses (not just whatever a mounted form last previewed), then asks for
 * explicit confirmation before anything happens. Returns null if the user does not confirm. */
async function previewThenConfirm(action, options, confirm, scope) {
  let shown = "";
  try {
    const reply = await api("/api/preview", { action, options: options || {} });
    scope.throwIfAborted();
    if (reply.needed) {
      toast(sentence(reply.needed), "warn");
      return false;
    }
    shown = reply.shown;
  } catch (error) {
    if (scope.aborted || error.name === 'AbortError') return false;
    toast(error.message, "error");
    return false;
  }
  const dialog = confirm
    ? { ok: "Run it", tone: "primary", ...confirm, code: shown }
    : { title: "Run this?", body: "This is the exact command that will run:", code: shown, ok: "Run it" };
  scope.throwIfAborted();
  const element = document.getElementById('confirm');
  if (element?.open) return false;
  const answer = confirmDialog(dialog);
  const contents = element?.firstElementChild;
  const cancel = () => {
    if (element?.open && element.firstElementChild === contents) {
      element.dispatchEvent(new Event('cancel', { cancelable: true }));
    }
  };
  scope.addEventListener('abort', cancel, { once: true });
  try { return await answer && !scope.aborted; }
  finally { scope.removeEventListener('abort', cancel); }
}

export function updateRunButtons() {
  const scope = accountRequestSignal();
  for (const [key, button] of Object.entries(S.runButtons)) {
    if (!button.isConnected) {
      delete S.runButtons[key];
      continue;
    }
    const action = button.dataset.action;
    const busy = pendingStarts.get(button.dataset.runAction || action)?.scope === scope;
    const blocked = (S.previews[action] || {}).error;
    button.disabled = busy || !!blocked;
    button.setAttribute('aria-busy', String(busy));
    button.title = busy ? 'Finish confirming this run before starting it again.' : blocked || "";
  }
}

async function run(action, options, { confirm } = {}) {
  const scope = accountRequestSignal();
  if (scope.aborted || pendingStarts.get(action)?.scope === scope) return;
  const trigger = document.activeElement;
  const pending = { scope };
  pendingStarts.set(action, pending);
  const release = () => {
    if (pendingStarts.get(action) === pending) pendingStarts.delete(action);
    updateRunButtons();
  };
  scope.addEventListener('abort', release, { once: true });
  updateRunButtons();
  try {
    // The command submitted must use exactly the options shown for confirmation,
    // even if the underlying form changes while the dialog is open.
    const selected = structuredClone(browserRunOptions(action, options || {}));
    if (!(await previewThenConfirm(action, selected, confirm, scope))) return;
    scope.throwIfAborted();
    const reply = await api("/api/run", { action, options: selected });
    scope.throwIfAborted();
    if (S.consoleSize === "collapsed") setConsoleSize("normal");
    toast(`Started ${reply.label}.`, "info", 2500);
  } catch (error) {
    if (!scope.aborted && error.name !== 'AbortError') toast(error.message, "error");
  } finally {
    scope.removeEventListener('abort', release);
    release();
    // Disabling a pending trigger can move focus to <body> before the dialog
    // records it. Restore it only after re-enabling, without stealing new focus.
    const dialog = document.getElementById('confirm');
    if (!scope.aborted && trigger?.isConnected && !dialog?.open &&
        (document.activeElement === document.body || dialog?.contains(document.activeElement))) trigger.focus({preventScroll:true});
  }
  if (!scope.aborted) {
    try { await hooks.refreshStatus(); }
    catch (error) { if (!scope.aborted && error.name !== 'AbortError') toast(error.message, 'error'); }
  }
}

export function runButton(action, label, { tone = "primary", confirm, options } = {}) {
  const button = h("button", {
    class: `btn btn-${tone}`,
    type: "button",
    dataset: { action },
    onclick: () => run(action, options ? options() : form(action), { confirm: typeof confirm === "function" ? confirm() : confirm }),
  }, icon("play", "icon icon-sm"), label);
  S.runButtons[`${action}:${label}`] = button;
  return button;
}

export function quickButton(action, label, options = {}, extra = {}) {
  const button = h("button", {
    class: `btn ${extra.tone ? `btn-${extra.tone}` : ""}`,
    type: "button",
    dataset: { action: `${action}-fixed`, runAction: action },
    onclick: () => run(action, options, { confirm: typeof extra.confirm === "function" ? extra.confirm() : extra.confirm }),
  }, label);
  S.runButtons[`${action}-fixed:${label}`] = button;
  return button;
}

/** A real-world run (not a dry run) always gets this confirmation. */
export function liveRunConfirm(what = "This applies for real, not a practice run.") {
  return { title: "Run for real?", body: what, ok: "Run it", tone: "primary" };
}
