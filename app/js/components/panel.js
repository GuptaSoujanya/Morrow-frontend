import { h } from "../dom.js";
import {icon} from '../icons.js';

export function panel(title, { sub, tools, cls = "" } = {}, ...body) {
  return h(
    "section",
    { class: `panel ${cls}` },
    h(
      "div",
      { class: "panel-head" },
      h("div", {}, h("h2", { class: "panel-title", text: title }), sub ? h("p", { class: "panel-sub", text: sub }) : null),
      tools || null,
    ),
    h("div", { class: "panel-body" }, ...body),
  );
}

export function empty(text, extra) {
  return h("div", { class: "state-empty" },
    h('span', { class: 'empty-illustration', 'aria-hidden': 'true' },
      h('span', { class: 'empty-sheet empty-sheet-back' }),
      h('span', { class: 'empty-sheet' }, icon('folder')),
      h('span', { class: 'empty-spark' }, icon('search'))),
    h("p", { text }), extra || null);
}

export function loadingState(text = "Loading…", { compact = false } = {}) {
  return h("div", { class: `state-loading${compact ? ' is-compact' : ''}`, role:'status','aria-live':'polite' },
    h('span', { class: 'loading-progress', 'aria-hidden': 'true' }, h('span')),
    h("p", { text }));
}

export function errorState(text, retry) {
  return h(
    "div",
    { class: "state-error", role:'alert' },
    h('span', { class: 'error-emblem', 'aria-hidden': 'true' }, icon('alert-triangle')),
    h('div', { class: 'error-copy' },
      h('strong', { text: 'Something needs another try.' }),
      h("p", { text })),
    retry ? h("button", { class: "btn error-retry", type: "button", onclick: retry }, icon('refresh'), 'Try again') : null,
  );
}

export function dataTable(columns, rows) {
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "table" },
      h("thead", {}, h("tr", {}, columns.map(([text, cls]) => h("th", { class: cls || null, text, scope: "col" })))),
      h("tbody", {}, rows),
    ),
  );
}
