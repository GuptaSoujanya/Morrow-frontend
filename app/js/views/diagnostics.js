import { h } from "../dom.js";
import { api } from "../api.js";
import { S, hooks } from "../state.js";
import { panel, loadingState, errorState, dataTable } from "../components/panel.js";
import { kpiCard } from "../components/kpi.js";
import { longDate } from "../format.js";
import { quickButton } from "../forms.js";
import { dateControl } from "../components/controls.js";

/** "Why nobody is calling": the funnel audit `python -m diagnose` writes, with its plan and how each model step was checked. */

const cache = new Map();
let loadingDay = null;
const RECHECK_MS = 60_000;

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function dayLabel(day) {
  return day === S.status.date ? `Today, ${longDate(day)}` : longDate(day);
}

async function loadDiagnostics(day, fresh = false) {
  if (loadingDay === day) return;
  loadingDay = day;
  try {
    const data = await api(`/api/diagnostics?day=${encodeURIComponent(day)}`, undefined, { fresh });
    cache.set(day, { data, error: "", at: Date.now() });
  } catch (error) {
    cache.set(day, { data: null, error: error.message, at: Date.now() });
  } finally {
    loadingDay = null;
  }
  if (S.route.name === "diagnostics" && (!S.route.arg || S.route.arg === day)) hooks.requestRender(false);
}

function severityBadge(severity) {
  return h("span", { class: `diag-severity is-${severity}`, text: severity });
}

function causeCard(cause, index) {
  const fixes = (cause.fix || []).map(line => h("li", { text: line.replace(/^Code: /, "") }));
  const evidence = (cause.evidence || []).map(line => h("li", { text: line }));
  return h("details", { class: `diag-cause is-${cause.severity}`, open: index < 3 ? "" : null },
    h("summary", { class: "diag-cause-head" },
      h("span", { class: "diag-rank", text: String(index + 1) }),
      severityBadge(cause.severity),
      h("span", { class: "diag-cause-title", text: cause.title }),
      h("span", { class: "muted small diag-confidence", text: `confidence ${Math.round((cause.confidence || 0) * 100)}%` })),
    cause.plain ? h("p", { class: "diag-plain", text: cause.plain }) : null,
    cause.model_note ? h("p", { class: "diag-model-note", text: cause.model_note }) : null,
    h("div", { class: "diag-cause-body" },
      h("div", {}, h("h4", { text: "Evidence" }), h("ul", { class: "diag-list" }, evidence)),
      h("div", {}, h("h4", { text: `Fix (${cause.fix_kind})` }), h("ul", { class: "diag-list" }, fixes),
        cause.where && cause.where.length ? h("p", { class: "muted small", text: `Where: ${cause.where.join(", ")}` }) : null)));
}

function planList(title, lines, hint) {
  return h("div", { class: "diag-plan-col" },
    h("h4", { text: title }),
    hint ? h("p", { class: "muted small", text: hint }) : null,
    lines && lines.length ? h("ol", { class: "diag-list" }, lines.map(line => h("li", { text: line.replace(/^Code: /, "") })))
      : h("p", { class: "muted small", text: "Nothing here." }));
}

function reviewPanel(review, trail) {
  if (!review || !review.used) {
    const step = (trail || []).find(s => s.name === "Model review of the ranked causes");
    return h("p", { class: "muted", text: `The model did not review this run (${step ? step.check : "no model available"}). Every cause comes from the rules and the numbers they quote.` });
  }
  return h("div", { class: "diag-review" },
    h("p", { class: "lead", text: review.verdict || "(no verdict text)" }),
    h("p", { class: "muted small", text: `Agreed with ${review.agreed} causes, disagreed with ${review.disagreed}, added ${review.added} (each must quote a number from the data; ${review.rejected_additions || 0} rejected).` }),
    review.first_three_actions && review.first_three_actions.length
      ? h("ol", { class: "diag-list" }, review.first_three_actions.map(line => h("li", { text: line }))) : null);
}

function trailTable(trail) {
  if (!trail || !trail.length) return h("p", { class: "muted", text: "No model steps ran." });
  return dataTable(
    [["Step"], ["Researched"], ["Verified before asking"], ["Accuracy check"], ["Executed"], ["Passed"]],
    trail.map(step => h("tr", { class: step.ok ? "" : "diag-step-failed" },
      h("td", { text: step.name }), h("td", { text: step.research }), h("td", { text: step.verify }),
      h("td", { text: step.check }), h("td", { text: step.execute }),
      h("td", { text: step.ok ? "yes" : "no" }))));
}

function mailPanel(data) {
  const mail = data.mail || {};
  if (!mail || !mail.account && !mail.error) return h("p", { class: "muted", text: "The mailbox was not read in this run." });
  if (mail.error) return h("p", { class: "muted", text: `Mailbox not read: ${mail.error}` });
  const kinds = Object.entries(mail.positive_by_kind || {}).map(([k, v]) => `${k} ${v}`).join(", ");
  const parts = [
    h("p", { class: "muted small", text: `${mail.account}, last ${mail.days} days, ${mail.scanned} mails scanned via ${mail.via || "IMAP"}; model: ${mail.model || "not used"}.` }),
    h("p", { text: `${mail.positive_total || 0} positive signals${kinds ? ` (${kinds})` : ""}; ${data.spam_hiring || 0} hiring mails in Spam.` }),
  ];
  const verification = mail.verification || {};
  if (verification.used) {
    parts.push(h("p", { class: "muted small", text: `Model re-judged ${verification.items} mails in ${verification.batches} batches: same kind ${Math.round(verification.agreement_kind * 100)}%, same positive/negative call ${Math.round(verification.agreement_positive * 100)}%; ${verification.changed} verdicts changed (${verification.promoted} promoted, ${verification.demoted} demoted), ${verification.distrusted_batches} batches distrusted.` }));
  }
  if (mail.queries && mail.queries.length) {
    parts.push(h("h4", { text: `Targeted searches (${mail.queries.length})` }));
    parts.push(dataTable(
      [["Search"], ["Purpose"], ["Made by"], ["Rows", "num"], ["New", "num"], ["Positive", "num"], ["Status"]],
      mail.queries.map(q => h("tr", {},
        h("td", {}, h("code", { text: q.query })), h("td", { text: q.purpose || "" }), h("td", { text: q.source || "" }),
        h("td", { class: "num", text: String(q.rows ?? 0) }), h("td", { class: "num", text: String(q.new_rows ?? 0) }),
        h("td", { class: "num", text: String(q.positives ?? 0) }), h("td", { text: q.status || "" })))));
  }
  if (data.positives && data.positives.length) {
    parts.push(h("h4", { text: "Latest positive signals" }));
    parts.push(dataTable(
      [["Date"], ["Platform"], ["Kind"], ["From"], ["Subject"]],
      data.positives.slice(0, 25).map(p => h("tr", {},
        h("td", { text: String(p.date || "").slice(0, 16) }), h("td", { text: p.platform || "" }), h("td", { text: p.kind || "" }),
        h("td", { text: (p.from || "").slice(0, 40) }), h("td", { text: (p.subject || "").slice(0, 90) })))));
  }
  return h("div", {}, ...parts);
}

function boardsPanel(boards) {
  const entries = Object.entries(boards || {});
  if (!entries.length) return h("p", { class: "muted", text: "No job board was read in this run." });
  return h("div", { class: "diag-boards" }, entries.map(([site, board]) => {
    const facts = Object.entries(board.facts || {}).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`);
    const statuses = Object.entries(board.status_counts || {}).map(([k, v]) => `${k} ${v}`);
    return h("div", { class: `diag-board is-${board.state || "unknown"}` },
      h("h4", {}, site, h("span", { class: "muted small", text: ` · ${board.state || "?"}` })),
      board.message && board.state !== "read" ? h("p", { class: "muted small", text: board.message }) : null,
      statuses.length ? h("p", { class: "small", text: statuses.join(" · ") }) : null,
      facts.length ? h("ul", { class: "diag-list small" }, facts.map(f => h("li", { text: f }))) : null,
      board.messages && board.messages.length
        ? h("div", {}, h("strong", { class: "small", text: `${board.messages.length} messages waiting for an answer` }),
          h("ul", { class: "diag-list small" }, board.messages.slice(0, 6).map(m => h("li", { text: `[${m.action}] ${m.who || ""} ${m.date || ""} ${m.about || ""}: ${(m.text || "").slice(0, 140)}` }))))
        : null);
  }));
}

function overviewCards(data) {
  const funnel = data.funnel || {};
  const mail = data.mail || {};
  const waiting = Object.values(data.boards || {}).reduce((n, b) => n + ((b.messages || []).length), 0);
  const critical = (data.causes || []).filter(c => c.severity === "critical").length;
  const expectedLow = Math.floor((funnel.submitted_total || 0) * 0.02);
  const expectedHigh = Math.floor((funnel.submitted_total || 0) * 0.03);
  return h("div", { class: "kpi-grid diag-kpis" },
    kpiCard({ label: "Applications submitted", value: String(funnel.submitted_total ?? 0), sub: `${funnel.days_running ?? "?"} days, all ledgers` }),
    kpiCard({ label: "Interviews expected at normal fit", value: `${expectedLow}–${expectedHigh}`, sub: "2–3% cold-apply rate" }),
    kpiCard({ label: "Positive mails found", value: String(mail.positive_total ?? 0), sub: mail.scanned ? `of ${mail.scanned} scanned` : "mailbox not read" }),
    kpiCard({ label: "Board messages waiting", value: String(waiting), sub: `${critical} critical causes` }));
}

export function renderDiagnostics(argDay) {
  const today = S.status.date;
  const status = S.status.diagnostics || { ready: false, days: [] };
  const known = status.days && status.days.length ? status.days : status.ready ? [today] : [];
  const day = argDay || known[0] || today;
  const entry = cache.get(day);
  if (!entry) loadDiagnostics(day);
  else if (Date.now() - entry.at > RECHECK_MS) loadDiagnostics(day, true);
  const days = entry?.data?.days && entry.data.days.length ? entry.data.days : known;

  const select = dateControl({ label: "Audit date", value: day, marked: days, commitOnly: true,
    onChange: value => { window.location.hash = value ? `#/diagnostics/${value}` : "#/diagnostics"; } });
  const tools = h("div", { class: "row" },
    quickButton("pipeline", "Run the audit now", { group: "diagnose", redo: true, date: day === today ? "" : day }),
    h("button", { class: "btn btn-sm", type: "button", text: "Refresh", onclick: () => loadDiagnostics(day, true) }));

  let body;
  if (!entry) {
    body = loadingState("Reading the audit…");
  } else if (entry.error) {
    body = errorState(entry.error, () => loadDiagnostics(day));
  } else if (!entry.data.exists) {
    body = h("div", { class: "diag-empty" },
      h("p", { class: "panel-empty", text: "No audit was written for this day yet." }),
      h("p", { class: "muted small", text: "Run the audit: it reads the ledgers, the mailbox and the job boards (read-only) and writes why nobody is calling and what to fix. The browser lanes must be free while it runs." }));
  } else {
    const data = entry.data;
    const causes = [...(data.causes || [])].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || (b.confidence || 0) - (a.confidence || 0));
    const top = causes.filter(c => c.severity === "critical" || c.severity === "high").slice(0, 6);
    body = h("div", { class: "diag-body" },
      overviewCards(data),
      panel("The root cause, in plain words", { sub: `Written ${String(data.generated_at || "").slice(0, 16).replace("T", " ")}` },
        h("ol", { class: "diag-plain-list" }, top.map(c => h("li", {}, h("strong", { text: c.title + "." }), " ", c.plain || "")))),
      panel("What to do, in order", {},
        h("div", { class: "diag-plan" },
          planList("Today, by hand", data.plan?.today, "Replies and messages that are waiting for you."),
          planList("This week", data.plan?.week, "Settings, answers, profile and resume."),
          planList("Code changes for the bots", data.plan?.code))),
      panel("Model review", { sub: "A second reader of the same numbers; its additions are kept only when they quote the data." }, reviewPanel(data.review, data.trail)),
      panel(`Every cause with its evidence (${causes.length})`, {}, h("div", { class: "diag-causes" }, causes.map(causeCard))),
      panel("Mailbox", {}, mailPanel(data)),
      panel("Job boards", {}, boardsPanel(data.boards)),
      panel("How each step was checked", { sub: "Every model step went research → verify → check → execute; a failed check keeps the rules' result." }, trailTable(data.trail)),
      data.markdown_url ? h("p", { class: "muted small" }, "Full write-up: ", h("a", { href: data.markdown_url, target: "_blank", rel: "noopener", text: "diagnostics.md" })) : null);
  }

  return h("div", { class: "page diagnostics-page" },
    h("header", { class: "page-head" },
      h("div", {}, h("h1", { text: "Why no replies" }),
        h("p", { class: "lead", text: "A read-only audit of the ledgers, the mailbox and the job boards: the real reasons nobody is calling, and what to fix first." })),
      h("div", { class: "head-actions" }, select)),
    panel(entry?.data?.exists ? entry.data.title : dayLabel(day), { cls: "diag-shell", tools }, body));
}
