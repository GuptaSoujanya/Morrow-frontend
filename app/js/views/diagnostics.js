import { h } from "../dom.js";
import { api } from "../api.js";
import { S, hooks } from "../state.js";
import { panel, loadingState, errorState, dataTable } from "../components/panel.js";
import { kpiCard } from "../components/kpi.js";
import { segmented } from "../components/segmented.js";
import { longDate, shortDate } from "../format.js";
import { quickButton } from "../forms.js";
import { dateControl } from "../components/controls.js";
import { readQuery, withQuery, writeQuery } from "../url-state.js";

/** "Why no replies": the funnel audit `python -m diagnose` writes, organised as summary, plan, leads, causes, mailbox, boards, checks. */

const cache = new Map();
const leadsCache = new Map();
let loadingDay = null;
let loadingLeadsDay = null;
let section = "plan";
let leadFilter = "all";
const RECHECK_MS = 60_000;
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const SECTIONS = [["plan", "What to do"], ["leads", "Leads"], ["fixes", "Fixes applied"], ["causes", "Causes"], ["mail", "Mailbox"], ["boards", "Job boards"], ["checks", "How it was checked"]];
const LEAD_STATES = ["new", "answered", "needs_you", "deferred", "failed", "skipped"];
const LEAD_FILTERS = [["all", "All"], ["waiting", "Waiting"], ["needs_you", "Need you"], ["answered", "Answered"]];
// Mirrors leads.store.OPEN_STATES: new, deferred and failed leads still wait for the bots.
const FILTER_STATES = { waiting: ["new", "deferred", "failed"], needs_you: ["needs_you"], answered: ["answered"] };
const FILTER_EMPTY = { all: "No lead is listed.", waiting: "Nothing waits for the bots.", needs_you: "Nothing needs you.", answered: "No lead has been answered yet." };

function dayLabel(day) {
  return day === S.status.date ? `Today, ${longDate(day)}` : longDate(day);
}

function dayWord(day) {
  return day === S.status.date ? "today" : `on ${shortDate(day)}`;
}

function explain(error, path = "/api/diagnostics") {
  if (error.status === 404) {
    return `The dashboard server is running older code and has no ${path} yet. Restart the dashboard (scripts/morrow) and reload this page.`;
  }
  return error.message;
}

async function loadDiagnostics(day, fresh = false) {
  if (loadingDay === day) return;
  loadingDay = day;
  try {
    const data = await api(`/api/diagnostics?day=${encodeURIComponent(day)}`, undefined, { fresh });
    cache.set(day, { data, error: "", at: Date.now() });
  } catch (error) {
    cache.set(day, { data: null, error: explain(error), at: Date.now() });
  } finally {
    loadingDay = null;
  }
  if (S.route.name === "diagnostics" && (!S.route.arg || S.route.arg === day)) hooks.requestRender(false);
}

async function loadLeads(day, fresh = false) {
  if (loadingLeadsDay === day) return;
  loadingLeadsDay = day;
  try {
    const data = await api(`/api/leads?day=${encodeURIComponent(day)}`, undefined, { fresh });
    leadsCache.set(day, { data, error: "", at: Date.now() });
  } catch (error) {
    leadsCache.set(day, { data: leadsCache.get(day)?.data || null, error: explain(error, "/api/leads"), at: Date.now() });
  } finally {
    loadingLeadsDay = null;
  }
  if (S.route.name === "diagnostics" && (!S.route.arg || S.route.arg === day)) hooks.requestRender(false);
}

function shownLeads(day, data) {
  const live = leadsCache.get(day);
  if (live?.data) return { leads: live.data, live: true, error: live.error, pending: false };
  // The server zero-fills `leads` (day "") for audits written before the journal existed; only a dated copy was read.
  const snapshot = data.leads?.day ? data.leads : null;
  return { leads: snapshot, live: false, error: live ? live.error : "", pending: !live };
}

function chooseSection(value, argDay) {
  section = value;
  writeQuery(argDay ? `diagnostics/${encodeURIComponent(argDay)}` : "diagnostics", { section: value === "plan" ? "" : value }, { replace: true });
  hooks.requestRender(false);
}

const num = value => h("td", { class: "num", text: String(value ?? 0) });
const cell = (text, cls) => h("td", { class: cls || null, text: text == null ? "" : String(text) });
const leadsWaiting = leads => (leads.waiting || 0) + (leads.needs_you || 0);
const stamp = text => String(text || "").slice(0, 16).replace("T", " ");

function severityBadge(severity) {
  return h("span", { class: `diag-severity is-${severity}`, text: severity });
}

function leadState(state) {
  const known = LEAD_STATES.includes(state) ? state : "other";
  return h("span", { class: `lead-state is-${known}`, text: String(state || "new").replace(/_/g, " ") });
}

// --- summary -----------------------------------------------------------------

function overviewCards(data, leads, day, argDay) {
  const funnel = data.funnel || {};
  const mail = data.mail || {};
  const critical = (data.causes || []).filter(c => c.severity === "critical").length;
  const submitted = funnel.submitted_total || 0;
  const today = leads?.today || {};
  const causes = `${critical} critical cause${critical === 1 ? "" : "s"}`;
  return h("div", { class: "kpi-grid diag-kpis" },
    kpiCard({ label: "Applications submitted", value: String(submitted), sub: `${funnel.days_running ?? "?"} days, all ledgers` }),
    kpiCard({ label: "Interviews expected at normal fit", value: `${Math.floor(submitted * 0.02)}–${Math.floor(submitted * 0.03)}`, sub: "2–3% cold-apply rate" }),
    kpiCard({ label: "Positive mails found", value: String(mail.positive_total ?? 0), sub: mail.scanned ? `of ${mail.scanned} scanned` : "mailbox not read" }),
    kpiCard({ label: "Recruiter leads", value: String(leads ? leadsWaiting(leads) : 0),
      sub: leads ? `${today.new ?? 0} new ${dayWord(day)} · ${today.answered ?? 0} answered · ${causes}` : `leads not read · ${causes}`,
      href: withQuery(argDay ? `diagnostics/${encodeURIComponent(argDay)}` : "diagnostics", { section: "leads" }), link: "See the leads" }));
}

function summaryPanel(data, causes) {
  const top = causes.filter(c => c.severity === "critical" || c.severity === "high").slice(0, 6);
  const review = data.review || {};
  const step = (data.trail || []).find(s => s.name === "Model review of the ranked causes");
  const modelLine = review.used
    ? `Model review: ${review.verdict || "(no verdict text)"} It agreed with ${review.agreed}, disagreed with ${review.disagreed}, added ${review.added}.`
    : `Model review did not run (${step ? step.check.replace(/^not run: /, "") : "no model available"}); every cause comes from the rules and the numbers they quote.`;
  return panel("The root cause, in plain words", { sub: `Written ${String(data.generated_at || "").slice(0, 16).replace("T", " ")}` },
    h("ol", { class: "diag-plain-list" }, top.map(c => h("li", {}, severityBadge(c.severity), " ", h("strong", { text: c.title + "." }), " ", c.plain || ""))),
    h("p", { class: "muted small diag-model-line", text: modelLine }),
    review.used && review.first_three_actions?.length
      ? h("ol", { class: "diag-list small" }, review.first_three_actions.map(line => h("li", { text: line }))) : null);
}

// --- plan ------------------------------------------------------------------------

function splitToday(lines) {
  const boards = [], mails = [], rest = [];
  for (const line of lines || []) {
    if (/^Answer: \[/.test(line)) boards.push(line.replace(/^Answer: /, ""));
    else if (/^Answer: /.test(line)) mails.push(line.replace(/^Answer: /, ""));
    else rest.push(line.replace(/^Today: /, ""));
  }
  return { boards, mails, rest };
}

function planGroup(title, hint, lines, numbered = true) {
  return h("div", { class: "diag-plan-col" },
    title ? h("h4", { text: title }) : null,
    hint ? h("p", { class: "muted small", text: hint }) : null,
    lines && lines.length ? h(numbered ? "ol" : "ul", { class: "diag-list" }, lines.map(line => h("li", { text: line.replace(/^Code: /, "") })))
      : h("p", { class: "muted small", text: "Nothing here." }));
}

function planSection(plan) {
  const today = splitToday(plan?.today);
  return h("div", { class: "diag-body" },
    panel("Today, by hand", { sub: "Recruiters already wrote. Answering them is the only step that can turn into an interview this week." },
      h("div", { class: "diag-plan" },
        planGroup("Messages on the job boards", "Open the board's inbox and finish the questionnaire or assessment.", today.boards),
        planGroup("Replies in the mailbox", "Open Gmail and reply; (xN) is how many reminder mails the same thread sent.", today.mails),
        planGroup("Also today", "", today.rest, false))),
    panel("This week", { sub: "Settings, saved answers, profile and resume." }, planGroup("", "", plan?.week)),
    panel("Code changes for the bots", { sub: "What to change in the repository so the next two weeks do not repeat the last two." }, planGroup("", "", plan?.code)));
}

// --- leads -----------------------------------------------------------------------

function leadRole(lead) {
  const linked = /^https?:\/\//i.test(lead.url || "");
  const text = [lead.company, lead.title].filter(Boolean).join(" · ") || lead.subject || (linked ? "Open the thread" : "—");
  return h("td", { class: "lead-wrap lead-role" }, linked ? h("a", { href: lead.url, target: "_blank", rel: "noopener", text }) : text);
}

function leadsSection(shown, data, day) {
  const { leads, live, error, pending } = shown;
  if (pending) return loadingState("Reading the leads journal…");
  if (!leads) return errorState(`${error} This audit holds no copy of the leads either.`, () => loadLeads(day, true));
  const source = live ? "Live from the journal." : `As of the audit at ${stamp(data.generated_at)}.`;
  const notices = [
    leads.error ? h("p", { class: "inline-notice", role: "alert", text: leads.error }) : null,
    !live && error ? h("p", { class: "inline-notice", role: "status", text: `The journal could not be read live: ${error}` }) : null,
  ];
  if (!(leads.total > 0)) {
    return panel("Recruiter leads", { sub: source }, notices,
      leads.error ? null : h("p", { class: "panel-empty", text: "No lead recorded yet. The inbox:<board> and leads:mail stages fill this every morning." }));
  }
  const today = leads.today || {};
  const states = leads.by_state || {};
  const items = leads.items || [];
  const platforms = Object.entries(leads.by_platform || {}).sort((a, b) => (b[1].total || 0) - (a[1].total || 0) || a[0].localeCompare(b[0]));
  const rows = (leadFilter === "all" ? items : items.filter(lead => FILTER_STATES[leadFilter].includes(lead.state)))
    .slice().sort((a, b) => String(b.first_seen || "").localeCompare(String(a.first_seen || "")) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const filter = segmented("Show leads", LEAD_FILTERS, leadFilter, value => { leadFilter = value; hooks.requestRender(false); });
  return h("div", { class: "diag-body" },
    panel("Recruiter leads", { sub: `${source} Board inbox messages, questionnaires, assessments and Gmail replies the bots answer every morning.` },
      notices,
      h("div", { class: "kpi-grid diag-kpis" },
        kpiCard({ label: `Leads ${dayWord(day)}`, value: String(today.new ?? 0), sub: `answered ${today.answered ?? 0} · need you ${today.needs_you ?? 0}` }),
        kpiCard({ label: "Waiting for the bots", value: String(leads.waiting ?? 0), sub: `new ${states.new ?? 0} · deferred ${states.deferred ?? 0} · failed ${states.failed ?? 0}` }),
        kpiCard({ label: "Need you", value: String(leads.needs_you ?? 0), sub: "the bots handed these to you" }),
        kpiCard({ label: "Answered in all", value: String(leads.answered ?? 0), sub: `of ${leads.total ?? 0}` }))),
    panel("By platform", { sub: "Every lead in the journal, by where it came from." },
      dataTable(
        [["Platform"], ["Total", "num"], ["Waiting", "num"], ["Answered", "num"], ["Need you", "num"]],
        platforms.map(([platform, p]) => h("tr", {}, h("th", { scope: "row", text: platform }), num(p.total), num(p.waiting), num(p.answered), num(p.needs_you))))),
    panel(`Leads (${rows.length})`, { sub: `Newest first.${items.length < leads.total ? ` The newest ${items.length} of ${leads.total} are listed.` : ""} The company links to the thread on the board or in Gmail.`, tools: filter },
      rows.length
        ? dataTable(
          [["Received"], ["Platform"], ["Kind"], ["Company · role"], ["From"], ["State"], ["What happened"]],
          rows.map(lead => h("tr", {},
            cell(/^\d{4}-\d\d-\d\dT/.test(lead.received_at || "") ? stamp(lead.received_at) : lead.received_at || stamp(lead.first_seen)),
            cell(lead.source === "mail" ? `${lead.platform} · mail` : lead.platform),
            cell(String(lead.kind || "").replace(/_/g, " "), "lead-wrap"),
            leadRole(lead),
            cell((lead.who || "").slice(0, 40), "lead-wrap lead-from"),
            h("td", {}, leadState(lead.state)),
            cell(lead.why || "—", "lead-wrap lead-why"))))
        : h("p", { class: "muted", text: FILTER_EMPTY[leadFilter] })));
}

// --- causes ------------------------------------------------------------------------

function causeCard(cause, index, open) {
  const fixes = (cause.fix || []).map(line => h("li", { text: line.replace(/^Code: /, "") }));
  const evidence = (cause.evidence || []).map(line => h("li", { text: line }));
  return h("details", { class: `diag-cause is-${cause.severity}`, open: open ? "" : null },
    h("summary", { class: "diag-cause-head" },
      h("span", { class: "diag-rank", text: String(index) }),
      severityBadge(cause.severity),
      h("span", { class: "diag-cause-title", text: cause.title }),
      h("span", { class: "diag-kind", text: cause.fix_kind }),
      h("span", { class: "muted small diag-confidence", text: `${Math.round((cause.confidence || 0) * 100)}% sure` })),
    cause.plain ? h("p", { class: "diag-plain", text: cause.plain }) : null,
    cause.model_note ? h("p", { class: "diag-model-note", text: cause.model_note }) : null,
    h("div", { class: "diag-cause-body" },
      h("div", {}, h("h4", { text: "Evidence" }), h("ul", { class: "diag-list" }, evidence)),
      h("div", {}, h("h4", { text: "Fix" }), h("ul", { class: "diag-list" }, fixes),
        cause.where && cause.where.length ? h("p", { class: "muted small", text: `Where: ${cause.where.join(", ")}` }) : null)));
}

function causesSection(causes) {
  let index = 0;
  const groups = SEVERITIES.map(severity => {
    const items = causes.filter(c => c.severity === severity);
    if (!items.length) return null;
    return h("div", { class: "diag-severity-group" },
      h("h3", { class: "diag-group-head" }, severityBadge(severity), ` ${items.length} ${severity}`),
      h("div", { class: "diag-causes" }, items.map(c => causeCard(c, ++index, severity === "critical"))));
  });
  return panel(`Every cause with its evidence (${causes.length})`, { sub: "Ranked critical to low. Each card quotes the numbers behind it and names the fix: env, code, answers, profile, resume, skill or manual." },
    h("div", { class: "diag-body" }, groups));
}

// --- mailbox -------------------------------------------------------------------------

function groupPositives(positives) {
  const groups = new Map();
  for (const p of positives || []) {
    const key = `${p.platform}|${p.kind}|${(p.from || "").slice(0, 40).toLowerCase()}|${(p.subject || "").trim().toLowerCase()}`;
    const group = groups.get(key) || { ...p, count: 0 };
    group.count += 1;
    if (String(p.date || "") > String(group.date || "")) group.date = p.date;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function mailSection(data) {
  const mail = data.mail || {};
  if (!mail.account && !mail.error) return panel("Mailbox", {}, h("p", { class: "muted", text: "The mailbox was not read in this run (--skip-mail)." }));
  if (mail.error) return panel("Mailbox", {}, h("p", { class: "muted", text: `Mailbox not read: ${mail.error}` }));
  const kinds = Object.entries(mail.positive_by_kind || {});
  const platforms = Object.entries(mail.positive_by_platform || {});
  const verification = mail.verification || {};
  const verificationLine = verification.used
    ? `Model re-judged ${verification.items} mails in ${verification.batches} batches: same kind ${Math.round(verification.agreement_kind * 100)}%, same positive/negative call ${Math.round(verification.agreement_positive * 100)}%; ${verification.changed} verdicts changed (${verification.promoted} promoted, ${verification.demoted} demoted), ${verification.distrusted_batches} batches distrusted.`
    : `Model verification did not run (${verification.batches ? "the model did not answer" : "no model available"}); the kinds below are the rules' verdicts.`;
  return h("div", { class: "diag-body" },
    panel("What the mailbox shows", { sub: `${mail.account}, last ${mail.days} days, read via ${mail.via === "browser" ? "the signed-in browser" : "IMAP"}.` },
      h("div", { class: "kpi-grid diag-kpis" },
        kpiCard({ label: "Mails scanned", value: String(mail.scanned ?? 0), sub: "All Mail and Spam" }),
        kpiCard({ label: "Positive signals", value: String(mail.positive_total ?? 0), sub: kinds.map(([k, v]) => `${k} ${v}`).join(" · ") || "none" }),
        kpiCard({ label: "Hiring mail in Spam", value: String(data.spam_hiring ?? 0), sub: "recruiter mail Google filed wrongly" }),
        kpiCard({ label: "Model", value: mail.model ? (mail.model.includes("gave up") ? "silent" : "used") : "off", sub: mail.model || "not used" })),
      platforms.length ? h("p", { class: "small", text: "Positive by sender: " + platforms.map(([k, v]) => `${k} ${v}`).join(" · ") }) : null,
      h("p", { class: "muted small", text: verificationLine })),
    panel(`Positive signals (${(data.positives || []).length} shown, grouped)`, { sub: "One row per thread; the count is how many mails it sent. Newest first." },
      dataTable(
        [["Latest"], ["Platform"], ["Kind"], ["From"], ["Subject"], ["Mails", "num"]],
        groupPositives(data.positives).map(p => h("tr", {},
          cell(String(p.date || "").slice(0, 16)), cell(p.platform), cell(p.kind), cell((p.from || "").slice(0, 40)), cell((p.subject || "").slice(0, 90)), num(p.count))))),
    mail.queries && mail.queries.length
      ? panel(`Targeted searches (${mail.queries.length})`, { sub: "Filters run inside Gmail on top of the folder sweep. New = mails the sweep had not listed." },
        dataTable(
          [["Search"], ["Purpose"], ["Made by"], ["Rows", "num"], ["New", "num"], ["Positive", "num"], ["Status"]],
          mail.queries.map(q => h("tr", {},
            h("td", {}, h("code", { text: q.query })), cell(q.purpose), cell(q.source), num(q.rows), num(q.new_rows), num(q.positives), cell(q.status)))))
      : null);
}

// --- boards ----------------------------------------------------------------------------

function boardsSection(boards) {
  const entries = Object.entries(boards || {});
  if (!entries.length) return panel("Job boards", {}, h("p", { class: "muted", text: "No job board was read in this run (--skip-browser)." }));
  const rows = entries.map(([site, board]) => {
    const facts = board.facts || {};
    const listed = facts.applications_listed ?? facts.applied_listed ?? facts.applications ?? facts.total_applies ?? Object.values(board.status_counts || {}).reduce((a, b) => a + b, 0);
    const statuses = Object.entries(board.status_counts || {}).map(([k, v]) => `${k} ${v}`).join(" · ");
    return h("tr", { class: board.state === "read" ? "" : "diag-muted-row" },
      cell(site), cell(board.state), num(listed || 0), cell(statuses || "—"), num((board.messages || []).length),
      cell(board.state === "read" ? "" : (board.message || "").slice(0, 90)));
  });
  const details = entries.filter(([, b]) => b.state === "read" && (Object.keys(b.facts || {}).length || (b.messages || []).length)).map(([site, board]) =>
    panel(site, { sub: Object.entries(board.facts || {}).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ") || "" },
      board.messages && board.messages.length
        ? dataTable(
          [["Date"], ["From"], ["About"], ["Asks for"], ["Message"]],
          board.messages.map(m => h("tr", {}, cell(m.date), cell((m.who || "").slice(0, 30)), cell((m.about || "").slice(0, 40)), cell(m.action || "—"), cell((m.text || "").slice(0, 160)))))
        : h("p", { class: "muted small", text: "No messages waiting for an answer." })));
  return h("div", { class: "diag-body" },
    panel("What each board shows", { sub: "Read from the board's own applied, activity and inbox pages in the saved browser profiles. 'locked' means a bot or the dashboard held the profile." },
      dataTable([["Board"], ["State"], ["Applications", "num"], ["Statuses on the site"], ["Messages waiting", "num"], ["Note"]], rows)),
    ...details);
}

// --- checks ------------------------------------------------------------------------------

function checksSection(trail) {
  const steps = trail || [];
  const failed = steps.filter(s => !s.ok).length;
  return panel("How each step was checked", { sub: `Every model step went research → verify → check → execute. ${failed ? `${failed} step${failed === 1 ? "" : "s"} failed the check, so the rules' result was kept there.` : "Every step passed its check."}` },
    steps.length
      ? dataTable(
        [["Step"], ["Researched"], ["Verified before asking"], ["Accuracy check"], ["Executed"], ["Passed"]],
        steps.map(step => h("tr", { class: step.ok ? "" : "diag-step-failed" },
          cell(step.name), cell(step.research), cell(step.verify), cell(step.check), cell(step.execute), cell(step.ok ? "yes" : "no"))))
      : h("p", { class: "muted", text: "No model steps ran." }));
}

// --- fixes -------------------------------------------------------------------------------------

function fixesSection(data, day, today) {
  const fix = data.autofix || {};
  const runButton = quickButton("pipeline", "Fix it now", { group: "autofix", redo: true, date: day === today ? "" : day }, {
    tone: "primary",
    confirm: { title: "Apply the audit's fixes?", ok: "Fix it", tone: "primary",
      body: "Settings in .env and the saved location answers are corrected by Morrow itself. The code changes are handed to a coding CLI on this machine: opencode, else Claude Code, else Kiro. Nothing is committed; if the tests get worse or a forbidden file is touched, the code changes are reverted." } });
  if (!fix.generated_at) {
    return panel("Fixes applied", { sub: "Nothing has been applied for this audit yet." },
      h("p", { class: "muted", text: "Fix it now reads this audit, changes the settings and saved answers it names, and hands the code tasks to a local coding CLI. Every step is written down below, researched → verified → checked → executed." }),
      h("div", { class: "row" }, runButton));
  }
  const settings = fix.settings || {};
  const changes = Object.entries(settings.changes || {});
  const answers = fix.answers || {};
  const code = fix.code || {};
  const tests = code.tests || {};
  const when = String(fix.generated_at).slice(0, 16).replace("T", " ");
  const codeLine = !(code.tasks || []).length ? "The audit asked for no code change."
    : code.used ? `${code.tasks.length} task${code.tasks.length === 1 ? "" : "s"} handed to ${code.used}${(code.attempts || []).length > 1 ? ` after ${code.attempts.length - 1} other CLI${code.attempts.length === 2 ? "" : "s"} failed` : ""}; ${code.kept ? `${code.files.length} file${code.files.length === 1 ? "" : "s"} changed and kept (not committed)` : code.files.length ? "its changes were reverted" : "it changed no file"}.`
    : (code.attempts || []).length ? "Every coding CLI failed; the tasks are listed for a person." : "No coding CLI ran; the tasks are listed for a person.";
  return h("div", { class: "diag-body" },
    panel("Fixes applied", { sub: `Written ${when}${fix.dry_run ? " (dry run: nothing was changed)" : ""}.`, tools: h("div", { class: "row" }, runButton) },
      h("div", { class: "kpi-grid diag-kpis" },
        kpiCard({ label: "Settings changed", value: String(changes.length), sub: (settings.skipped || []).length ? `${settings.skipped.length} already strict enough` : ".env" }),
        kpiCard({ label: "Answers corrected", value: String((answers.rewritten || []).length + (answers.deleted || []).length), sub: answers.error || "location answers" }),
        kpiCard({ label: "Code files changed", value: String((code.files || []).length), sub: code.used ? `by ${code.used}${code.kept ? "" : ", reverted"}` : "no CLI ran" }),
        kpiCard({ label: "Tests after", value: tests.ran_after ? (tests.after_failed == null ? "did not run" : `${tests.after_failed} failing`) : "—", sub: `${tests.baseline_failed ?? 0} failing before` })),
      (fix.failed_steps || []).length ? h("p", { class: "muted small diag-model-line", text: `Steps that failed their check and changed nothing: ${fix.failed_steps.join(", ")}.` }) : null),
    panel("Settings (.env)", {},
      changes.length
        ? dataTable([["Key"], ["Was"], ["Now"], ["Because of cause"]], changes.map(([key, c]) => h("tr", {}, cell(key), cell(c.old || "unset"), cell(c.value), cell(c.cause))))
        : h("p", { class: "muted", text: "No setting needed a change." }),
      (settings.overrode_notes || []).length ? h("p", { class: "muted small", text: `${settings.overrode_notes.join(", ")} carried a comment saying the old value was on purpose; the audit's number won. Change it back in .env if you disagree.` }) : null),
    panel("Saved answers", {},
      (answers.rewritten || []).length || (answers.deleted || []).length
        ? h("ul", { class: "diag-list" },
          ...(answers.rewritten || []).map(a => h("li", { text: `${a.question}: "${a.old}" → "${a.new}"` })),
          ...(answers.deleted || []).map(q => h("li", { text: `cached answer dropped, re-learned from the corrected file: ${q}` })))
        : h("p", { class: "muted", text: answers.error || "No location answer said Others/Remote/Any." })),
    panel("Code, through a coding CLI", { sub: codeLine },
      (code.attempts || []).length
        ? dataTable([["CLI"], ["Result"], ["Seconds"]], code.attempts.map(a => h("tr", { class: a.error ? "diag-step-failed" : "" }, cell(a.cli), cell(a.error || "answered"), num(Math.round(a.seconds || 0)))))
        : null,
      (code.tasks || []).length ? h("ol", { class: "diag-list" }, code.tasks.map(t => h("li", {}, t.task, t.cause ? h("span", { class: "muted small", text: ` (${t.cause})` }) : null))) : null,
      (code.files || []).length ? h("p", { class: "small" }, h("strong", { text: code.kept ? "Changed, not committed: " : "Reverted: " }), code.files.join(", ")) : null,
      (code.reverted || []).length ? h("p", { class: "muted small", text: code.reverted.join("; ") }) : null,
      code.summary ? h("details", {}, h("summary", { text: "What the CLI said" }), h("pre", { class: "diag-pre", text: code.summary })) : null,
      Object.keys(code.proxies || {}).length ? h("p", { class: "muted small", text: `Proxy variables were set while the CLIs ran (${Object.keys(code.proxies).join(", ")}); a stale proxy makes a CLI hang.` }) : null),
    panel("How each fix step was checked", {},
      (fix.trail || []).length
        ? dataTable([["Step"], ["Researched"], ["Verified"], ["Accuracy check"], ["Executed"], ["Passed"]],
          fix.trail.map(step => h("tr", { class: step.ok ? "" : "diag-step-failed" }, cell(step.name), cell(step.research), cell(step.verify), cell(step.check), cell(step.execute), cell(step.ok ? "yes" : "no"))))
        : h("p", { class: "muted", text: "No steps recorded." })),
    fix.markdown_url ? h("p", { class: "muted small" }, "Full write-up: ", h("a", { href: fix.markdown_url, target: "_blank", rel: "noopener", text: "autofix.md" })) : null);
}

// --- page ----------------------------------------------------------------------------------

export function renderDiagnostics(argDay) {
  const today = S.status.date;
  const status = S.status.diagnostics || { ready: false, days: [] };
  const known = status.days && status.days.length ? status.days : status.ready ? [today] : [];
  const day = argDay || known[0] || today;
  const wanted = readQuery().get("section");
  if (SECTIONS.some(([key]) => key === wanted)) section = wanted;
  const entry = cache.get(day);
  if (!entry) loadDiagnostics(day);
  else if (Date.now() - entry.at > RECHECK_MS) loadDiagnostics(day, true);
  const leadsEntry = leadsCache.get(day);
  if (!leadsEntry) loadLeads(day);
  else if (Date.now() - leadsEntry.at > RECHECK_MS) loadLeads(day, true);
  const days = entry?.data?.days && entry.data.days.length ? entry.data.days : known;

  const select = dateControl({ label: "Audit date", value: day, marked: days, commitOnly: true,
    onChange: value => { window.location.hash = withQuery(value ? `diagnostics/${value}` : "diagnostics", { section: section === "plan" ? "" : section }); } });
  const tools = h("div", { class: "row" },
    quickButton("pipeline", "Run the audit now", { group: "diagnose", redo: true, date: day === today ? "" : day }),
    h("button", { class: "btn btn-sm", type: "button", text: "Fixes applied", onclick: () => chooseSection("fixes", argDay) }),
    h("button", { class: "btn btn-sm", type: "button", text: "Refresh", onclick: () => { loadDiagnostics(day, true); loadLeads(day, true); } }));

  let body;
  if (!entry) {
    body = loadingState("Reading the audit…");
  } else if (entry.error) {
    body = errorState(entry.error, () => loadDiagnostics(day, true));
  } else if (!entry.data.exists) {
    body = h("div", { class: "diag-empty" },
      h("p", { class: "panel-empty", text: "No audit was written for this day yet." }),
      h("p", { class: "muted small", text: "Run the audit: it reads the ledgers, the mailbox and the job boards (read-only) and writes why nobody is calling and what to fix. The browser lanes must be free while it runs." }));
  } else {
    const data = entry.data;
    const rank = c => { const i = SEVERITIES.indexOf(c.severity); return i < 0 ? 9 : i; };
    const causes = [...(data.causes || [])].sort((a, b) => rank(a) - rank(b) || (b.confidence || 0) - (a.confidence || 0));
    const shown = shownLeads(day, data);
    const switcher = segmented("Audit section", SECTIONS, section, value => chooseSection(value, argDay));
    let content;
    if (section === "leads") content = leadsSection(shown, data, day);
    else if (section === "causes") content = causesSection(causes);
    else if (section === "mail") content = mailSection(data);
    else if (section === "boards") content = boardsSection(data.boards);
    else if (section === "checks") content = checksSection(data.trail);
    else if (section === "fixes") content = fixesSection(data, day, today);
    else content = planSection(data.plan);
    body = h("div", { class: "diag-body" },
      overviewCards(data, shown.leads, day, argDay),
      summaryPanel(data, causes),
      h("div", { class: "diag-switcher" }, switcher),
      content,
      data.markdown_url ? h("p", { class: "muted small" }, "Full write-up: ", h("a", { href: data.markdown_url, target: "_blank", rel: "noopener", text: "diagnostics.md" })) : null);
  }

  return h("div", { class: "page diagnostics-page" },
    h("header", { class: "page-head" },
      h("div", {}, h("h1", { text: "Why no replies" }),
        h("p", { class: "lead", text: "A read-only audit of the ledgers, the mailbox and the job boards: the real reasons nobody is calling, and what to fix first." })),
      h("div", { class: "head-actions" }, select)),
    panel(entry?.data?.exists ? entry.data.title : dayLabel(day), { cls: "diag-shell", tools }, body));
}
