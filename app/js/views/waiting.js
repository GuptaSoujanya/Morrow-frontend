import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { S, hooks } from '../state.js';
import { panel, empty, errorState } from '../components/panel.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/dialog.js';
import { num } from '../format.js';

/** "Waiting on you" inside Applications: every application the bots stopped on, with what each one still needs.
 *  The Launchpad shows the counts; this module renders the cards, the kind filter options and the open-question panel. */

/** Kinds a person has to do by hand on the employer's site (as opposed to a screener answer or a verification). */
export const HANDS_ON = new Set(['form', 'access', 'video', 'eligibility', 'decision', 'assessment', 'reply']);

/** Count of the items whose kind is in `keys`, from the tallies /api/waiting returns. */
export function tallyKinds(data, keys) { return (data?.kinds || []).filter(k => keys.has(k.key)).reduce((n, k) => n + k.count, 0); }

export function explainWaitingError(error) {
  if (error.status === 404) return 'The dashboard server is running older code and has no /api/waiting yet. Restart the dashboard (scripts/morrow) and reload this page.';
  return error.message;
}

function safeHref(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function when(iso) {
  const date = new Date(iso || '');
  if (!iso || !Number.isFinite(date.getTime())) return h('span', { class: 'muted small', text: 'Time not recorded' });
  return h('time', { dateTime: date.toISOString(), class: 'small muted', text: date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) });
}

function openPath(path) {
  api('/api/open', { what: 'path', path }).catch(error => toast(error.message, 'error'));
}

function externalLink(href, text, cls = 'btn btn-sm') {
  return h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, text, icon('arrow-up-right', 'icon icon-sm'));
}

/** Textarea + Save for one empty A: line in answers.txt, the same flow as the Action inbox. */
function answerBox(question, line, label, onSaved) {
  const key = `answer:${line}`;
  const control = h('textarea', {
    class: 'input textarea-short', 'aria-label': `Answer: ${question}`, value: S.drafts[key] || '', placeholder: 'Write your answer…',
    oninput: e => { S.drafts[key] = e.target.value; if (control.value.trim()) { feedback.hidden = true; control.setAttribute('aria-invalid', 'false'); } },
    onkeydown: e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } },
  });
  const feedback = h('p', { class: 'field-error', role: 'status', id: `waiting-answer-${line}`, hidden: true });
  control.setAttribute('aria-describedby', feedback.id);
  const button = h('button', { class: 'btn btn-primary', type: 'button', text: 'Save answer', onclick: save });
  async function save() {
    if (!control.value.trim()) { feedback.textContent = 'Write the answer before saving.'; feedback.hidden = false; control.setAttribute('aria-invalid', 'true'); control.focus(); return; }
    if (button.disabled) return;
    button.disabled = true; button.textContent = 'Saving…'; feedback.hidden = true;
    try {
      await api('/api/answer', { line, answer: control.value });
      delete S.drafts[key];
      await hooks.refreshStatus().catch(() => {});
      toast('Saved. The next run uses this answer.', 'ok');
      onSaved?.();
    } catch (error) { feedback.textContent = `Could not save. ${error.message} Your draft is still here.`; feedback.hidden = false; }
    finally { button.disabled = false; button.textContent = 'Save answer'; }
  }
  return h('div', { class: 'waiting-answer' },
    h('p', { class: 'waiting-answer-label' }, h('strong', { text: label }), ' ', h('span', { text: question })),
    h('div', { class: 'todo-input' }, control, button), feedback,
    h('p', { class: 'small muted', text: 'Cmd / Ctrl + Enter saves. The answer lands on this question’s line in answers.txt and is reused everywhere it is asked again.' }));
}

/** "Was it sent?" buttons for an outcome the agent could not verify, copied from Application history. */
function reviewButtons(item, feedback, onDone) {
  let pending = false;
  async function review(result) {
    if (pending) return;
    const confirmed = result === 'confirmed';
    const dialog = document.getElementById('confirm');
    if (dialog?.open) return;
    pending = true; feedback.replaceChildren();
    try {
      const ok = await confirmDialog({
        title: confirmed ? 'Confirm this application was sent?' : 'Allow another attempt?',
        body: confirmed ? 'Choose this only after finding a receipt or the matching message in Sent. The bot will not submit this job again.'
          : 'Check the employer’s application page and Gmail Sent first. Choose this only if you confirmed nothing was sent. A later run may submit this application.',
        ok: confirmed ? 'Mark as confirmed' : 'I checked: nothing was sent',
      });
      if (!ok) return;
      await api('/api/application-agent/resolve', { job_id: item.job_id, outcome: result });
      toast(confirmed ? 'Application marked as confirmed.' : 'Recorded as not sent. A later bot run can try again.', 'ok');
      onDone?.();
    } catch (error) {
      if (error.name !== 'AbortError') feedback.replaceChildren(errorState(error.message));
    } finally { pending = false; }
  }
  return h('div', { class: 'waiting-actions' },
    h('button', { type: 'button', class: 'btn', text: 'I verified it was sent', onclick: () => review('confirmed') }),
    h('button', { type: 'button', class: 'btn', text: 'I verified nothing was sent', onclick: () => review('not_sent') }));
}

function listDetails(summary, items, cls, ordered = false) {
  return h('details', { class: `waiting-more ${cls}` }, h('summary', { text: summary }),
    h(ordered ? 'ol' : 'ul', { class: 'waiting-detail-list' }, items));
}

function card(item, reload) {
  const title = item.title || `Job ${item.job_id || ''}`.trim();
  const job = safeHref(item.links?.job), site = safeHref(item.links?.site), listing = safeHref(item.links?.naukri);
  const primary = job || site;
  const feedback = h('div', { class: 'waiting-feedback' });
  const links = [
    job ? externalLink(job, 'Open job') : null,
    site && site !== job ? externalLink(site, 'Open company site') : null,
    listing && listing !== job && listing !== site ? externalLink(listing, 'Open listing') : null,
    item.links?.resume ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Open resume', onclick: () => openPath(item.links.resume) }) : null,
    item.source !== 'naukri' || item.kind === 'review' ? h('a', { class: 'btn btn-sm', href: '#/sites', text: 'Company-site tools' }) : null,
  ];
  let answer = null;
  if (item.question) {
    if (item.question.answered) answer = h('p', { class: 'waiting-ready small', text: 'Your answer is saved; the next Naukri round retries this job.' });
    else if (Number.isInteger(item.question.line)) answer = answerBox(item.question.text, item.question.line, 'Answer this screener question:', reload);
    else answer = h('div', { class: 'waiting-answer' },
      h('p', { class: 'waiting-answer-label' }, h('strong', { text: 'Screener question: ' }), h('span', { text: item.question.text })),
      h('a', { class: 'btn btn-sm', href: '#/files/answers', text: 'Add this answer in answers.txt' }));
  }
  const whyText = item.why || '', detailText = item.detail && item.detail !== item.why ? item.detail : '';
  return h('article', { class: 'waiting-card', dataset: { kind: item.kind, id: item.id } },
    h('div', { class: 'waiting-head' },
      h('div', { class: 'waiting-identity' },
        h('h3', { class: 'waiting-title' }, primary ? externalLink(primary, title, 'waiting-title-link') : h('span', { text: title })),
        h('div', { class: 'waiting-meta' },
          h('span', { class: 'waiting-company', text: item.company || 'Company not recorded' }),
          h('span', { class: 'pill waiting-board', text: item.board_label || item.board }),
          when(item.when),
          item.score != null ? h('span', { class: 'small muted tabular', text: `${Math.round(item.score)}/100 match` }) : null,
          item.odds ? h('span', { class: 'pill waiting-odds', title: item.odds, text: 'long shot' }) : null)),
      h('span', { class: 'waiting-kind', dataset: { kind: item.kind }, text: item.kind_label || item.kind })),
    item.needs?.length ? h('div', { class: 'waiting-needs' }, h('strong', { text: 'Needs from you' }),
      h('ul', { class: 'waiting-needs-list' }, item.needs.map(need => h('li', { text: need })))) : null,
    item.next_step ? h('p', { class: 'waiting-next' }, h('strong', { text: 'Next step: ' }), h('span', { text: item.next_step })) : null,
    answer,
    whyText || detailText ? h('details', { class: 'waiting-more' }, h('summary', { text: 'Why the bot stopped' }),
      whyText ? h('p', { text: whyText }) : null, detailText ? h('p', { class: 'small muted', text: detailText }) : null) : null,
    item.already_filled?.length ? listDetails(`Already filled by the bot (${item.already_filled.length})`, item.already_filled.map(text => h('li', { text })), 'waiting-filled') : null,
    item.steps?.length ? listDetails(`What the agent did (${item.steps.length} steps)`, item.steps.map(step => h('li', {},
      h('strong', { text: step.state ? `${step.state}: ` : '' }), h('span', { text: step.observation || '' }),
      step.action ? h('span', { class: 'waiting-step-action', text: ` → ${step.action}` }) : null)), 'waiting-steps', true) : null,
    h('div', { class: 'waiting-links' }, links),
    item.reviewable ? reviewButtons(item, feedback, reload) : null,
    feedback);
}

function openQuestions(data, reload) {
  const open = (data.questions || []).filter(entry => !entry.linked);
  const body = open.length ? h('ul', { class: 'plain-list waiting-questions' }, open.map(entry => h('li', { class: 'waiting-question' },
    entry.title || entry.company ? h('p', { class: 'small muted', text: `Asked ${entry.asked ? entry.asked + ' ' : ''}while applying to ${entry.title || 'a role'}${entry.company ? ' at ' + entry.company : ''}` }) : null,
    answerBox(entry.questions.join(' / '), entry.line, 'Question:', reload))))
    : empty('Every question in answers.txt has an answer.');
  const facts = (data.facts || []).length ? h('p', { class: 'small' }, `${data.facts.length} profile fact${data.facts.length === 1 ? '' : 's'} still blank: ${data.facts.map(f => f.key.replaceAll('_', ' ')).join(', ')}. `,
    h('a', { href: '#/files/profile', text: 'Edit profile' })) : null;
  return panel(`Open questions in answers.txt (${open.length})`, { sub: 'Questions the bots were asked and left for you; they are not tied to a job above.', tools: h('a', { class: 'btn btn-sm', href: '#/files/answers', text: 'Manage all answers' }) }, body, facts);
}

/** Options for the "What it needs" filter, with counts; `current` is kept even when nothing matches it. */
export function waitingKindOptions(data, current = 'all') {
  const options = [['all', 'Everything'], ...(data.kinds || []).map(k => [k.key, `${k.label} (${num(k.count)})`])];
  if (!options.some(([key]) => key === current)) options.push([current, current.replaceAll('_', ' ')]);
  return options;
}

/** One line for the toolbar: how many jobs match and when the list was built. */
export function waitingCount(data) {
  return `${num(data.matched)} job${data.matched === 1 ? '' : 's'} waiting on you · ${data.days === 0 ? 'since the first run' : `last ${data.days} days`} · refreshed ${new Date(data.generated_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/** The cards for one page of /api/waiting, or an empty state with a button that clears the filters. */
export function waitingCards(data, reload, onClear) {
  if (!data.items.length) return empty('Nothing is waiting on you for these filters.', onClear ? h('button', { class: 'btn', type: 'button', text: 'Clear search & filters', onclick: onClear }) : null);
  return h('div', { class: 'waiting-cards' }, data.items.map(item => card(item, reload)));
}

/** The panel of answers.txt questions that are not tied to any job above. */
export function waitingExtras(data, reload) { return openQuestions(data, reload); }
