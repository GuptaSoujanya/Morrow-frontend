import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api, accountRequestSignal } from '../api.js';
import { loadingState, errorState } from './panel.js';
import { confirmDialog } from './dialog.js';

let historySequence = 0;
const needsReview = item => ['running', 'uncertain'].includes(item.state);
const outcome = item => ({
  running: ['Outcome not recorded', 'warning'],
  uncertain: ['Needs review', 'warning'],
  confirmed: ['Confirmed', 'success'],
  needs_you: ['Not submitted', 'neutral'],
}[item.state] || ['Outcome unavailable', 'neutral']);

function applicationUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function recordedTime(value) {
  if (!value) return null;
  // SQLite's CURRENT_TIMESTAMP is UTC even though it has no zone suffix.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return null;
  return h('time', {dateTime:date.toISOString(), text:date.toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})});
}

/** Recorded application outcomes, with explicit verification before releasing a reservation.
 * Optional synchronous onSummary receives {reviewCount, total, loading, error}.
 * Counts are null until history is loaded; refresh errors retain the last known counts.
 */
export function applicationAgentPanel({compact=false, onSummary} = {}) {
  const scope = accountRequestSignal(), route = location.hash;
  const instance = ++historySequence;
  let snapshot = null, filter = null, expanded = null, visible = 8, pending = false, loading = false;
  const body = h('div', {class:'application-history-body'}, loadingState('Loading application history…', {compact:true}));
  const feedback = h('div', {class:'application-history-feedback'});
  const refresh = h('button', {class:'btn application-history-refresh', type:'button', onclick:() => load()}, icon('refresh', 'icon icon-sm'), 'Refresh');
  const assistance = h('details', {class:'application-assistance'}, h('summary', {text:'Assistance & limits'}));
  const content = h('section', {class:'panel application-history' + (compact ? ' is-compact' : ''), 'aria-label':'Application history'},
    h('header', {class:'application-history-header'},
      h('div', {}, h('h2', {class:'panel-title', text:'Application history'}),
        h('p', {class:'panel-sub', text:'Review outcomes from applications handled with AI assistance.'})), refresh),
    feedback, body, assistance);
  assistance.hidden = true;
  const current = () => !scope.aborted && accountRequestSignal() === scope && location.hash === route && content.isConnected;

  function publishSummary({loading=false, error=''} = {}) {
    if (!current() || typeof onSummary !== 'function') return;
    try {
      onSummary({reviewCount:snapshot ? snapshot.attempts.filter(needsReview).length : null,
        total:snapshot ? snapshot.attempts.length : null, loading, error});
    } catch { /* A surrounding view's summary must not interrupt history or review. */ }
  }

  function busy() {
    content.setAttribute('aria-busy', String(loading || pending));
    for (const button of content.querySelectorAll('button')) button.disabled = loading || pending;
  }
  function announce(text) {
    feedback.replaceChildren(h('p', {class:'application-history-success', role:'status', text}));
  }
  function focusReview() {
    const target = body.querySelector('[data-review-toggle]') || body.querySelector('.application-history-empty button') || body.querySelector('[aria-pressed="true"]');
    target?.focus({preventScroll:true});
  }

  async function review(item, result) {
    if (!current() || pending || loading) return;
    const trigger = document.activeElement;
    const confirmed = result === 'confirmed';
    const dialog = document.getElementById('confirm');
    if (dialog.open) return;
    pending = true;
    feedback.replaceChildren();
    const rowFeedback = [...content.querySelectorAll('[data-attempt]')].find(row => row.dataset.attempt === String(item.job_id))?.querySelector('.application-row-feedback');
    rowFeedback?.replaceChildren();
    busy();
    const confirmation = confirmDialog({
      title:confirmed ? 'Confirm this application was sent?' : 'Allow another attempt?',
      body:confirmed ? 'Choose this only after finding a receipt or the matching message in Sent. The bot will not submit this job again.'
        : 'Check the employer’s application page and Gmail Sent first. Choose this only if you confirmed nothing was sent. A later run may submit this application.',
      ok:confirmed ? 'Mark as confirmed' : 'I checked: nothing was sent',
    });
    const dialogContents = dialog.firstElementChild;
    const cancel = () => {
      if (dialog.open && dialog.firstElementChild === dialogContents) dialog.dispatchEvent(new Event('cancel', {cancelable:true}));
    };
    scope.addEventListener('abort', cancel, {once:true});
    window.addEventListener('hashchange', cancel, {once:true});
    let saved = false;
    try {
      if (!await confirmation || !current()) return;
      await api('/api/application-agent/resolve', {job_id:item.job_id, outcome:result});
      if (!current()) return;
      saved = true;
      // The write succeeded. Keep that known result even if refreshing history fails.
      snapshot.attempts = snapshot.attempts.map(entry => entry.job_id === item.job_id ? {...entry,
        state:confirmed ? 'confirmed' : 'needs_you',
        next_step:confirmed ? 'Do not submit again.' : 'The user checked that nothing was sent; retry is allowed.',
        detail:'Submission outcome checked by the user',
      } : entry);
      expanded = null;
      draw();
      publishSummary();
      announce(confirmed ? 'Application marked as confirmed.' : 'Recorded as not sent. A later bot run can try again.');
      await load({afterSave:true});
    } catch (error) {
      if (current() && error.name !== 'AbortError') (rowFeedback?.isConnected ? rowFeedback : feedback).replaceChildren(errorState(error.message));
    } finally {
      scope.removeEventListener('abort', cancel);
      window.removeEventListener('hashchange', cancel);
      pending = false;
      if (current()) {
        busy();
        if (saved) focusReview();
        else if (trigger?.isConnected && (document.activeElement === document.body || dialog.contains(document.activeElement))) trigger.focus({preventScroll:true});
      }
    }
  }

  function drawAssistance() {
    const data = snapshot;
    const budgetLabel = data.budget === 0 ? 'no app-set dollar limit per task' : `app-set limit: $${data.budget} per task`;
    assistance.querySelector('.application-assistance-body')?.remove();
    assistance.append(h('div', {class:'application-assistance-body'},
      h('p', {class:'agent-task-limits', text:data.enabled ? `AI assistance is on · up to ${data.limit} tasks per bot run · ${budgetLabel}.`
        : 'AI assistance is off. Enable BROWSER_AGENT in Preferences to let the bot handle unfamiliar application steps.'}),
      data.enabled ? h('p', {class:'muted small agent-usage-note', text:'Claude account usage limits still apply. This app setting does not show your actual charges.'}) : null,
      h('div', {class:'agent-capabilities'}, ['Board-specific instructions','ATS redirects','Account checks','Verification email','Application email','Duplicate protection'].map(text => h('span', {text}))),
      h('p', {class:'muted small', text:'Email is sent only to an application address published on the job page. Unknown facts, human checks and uncertain sends pause for review.'})));
    assistance.hidden = false;
  }

  function row(item, index) {
    const key = item.job_id || String(index), title = item.title || 'Application', company = item.company || 'Company not recorded';
    const reviewable = needsReview(item), open = expanded === key;
    const [label, tone] = outcome(item);
    const detailId = `application-detail-${instance}-${index}`;
    const url = applicationUrl(item.url);
    const guidance = item.state === 'running'
      ? 'This attempt has no recorded outcome. Check Activity and stop any active run before recording a result. Then check the application page or Sent folder.'
      : 'Check the application page or your Sent folder, then record only the outcome you verified.';
    const toggle = h('button', {type:'button', class:'btn application-review-toggle',
      'aria-label':`${reviewable ? 'Review' : 'Details for'} ${title} at ${company}`, 'aria-expanded':String(open), 'aria-controls':detailId,
      dataset:{reviewToggle:key}, onclick:() => {
        if (loading || pending) return;
        expanded = expanded === key ? null : key;
        // Preserve the clicked control and scroll position while closing other rows.
        for (const article of body.querySelectorAll('.application-history-row')) {
          const selected = article.dataset.attempt === expanded;
          article.querySelector('.application-review-detail').hidden = !selected;
          article.querySelector('.application-review-toggle').setAttribute('aria-expanded', String(selected));
          article.classList.toggle('is-expanded', selected);
        }
      }}, reviewable ? 'Review' : 'Details', icon('chevron-down', 'icon icon-sm'));
    return h('article', {class:'application-history-row' + (open ? ' is-expanded' : ''), dataset:{attempt:key}},
      h('div', {class:'application-history-row-head'},
        h('div', {class:'application-history-identity'}, h('h3', {text:title}),
          h('div', {class:'application-history-meta'}, h('span', {text:company}), recordedTime(item.updated_at))),
        h('span', {class:'application-outcome', dataset:{tone}, text:label}), toggle),
      h('div', {class:'application-review-detail', id:detailId, hidden:!open},
        h('p', {class:'application-next-step', text:item.next_step || (reviewable ? guidance : 'No next step was recorded.')}),
        url ? h('a', {class:'text-link application-source', href:url, target:'_blank', rel:'noopener noreferrer'}, 'Open application', icon('arrow-up-right', 'icon icon-sm')) : null,
        item.detail ? h('details', {class:'application-evidence'}, h('summary', {text:'What happened'}),
          item.state === 'running' ? h('p', {class:'application-evidence-note', text:'This saved detail may be from an earlier attempt. The latest attempt has no recorded outcome.'}) : null,
          h('p', {text:item.detail})) : null,
        reviewable ? h('p', {class:'application-review-guidance', text:guidance}) : null,
        h('div', {class:'application-row-feedback'}),
        reviewable && item.job_id ? h('div', {class:'agent-attempt-actions'},
          h('button', {type:'button', class:'btn', text:'I verified it was sent', onclick:() => review(item, 'confirmed')}),
          h('button', {type:'button', class:'btn', text:'I verified nothing was sent', onclick:() => review(item, 'not_sent')})) : null));
  }

  function draw() {
    const openEvidence = new Set([...body.querySelectorAll('.application-evidence[open]')].map(details => details.closest('[data-attempt]').dataset.attempt));
    const attempts = snapshot.attempts;
    const attention = attempts.filter(needsReview);
    filter ||= attention.length ? 'review' : 'all';
    const matches = filter === 'review' ? attention : attempts;
    const shown = filter === 'review' ? matches : matches.slice(0, visible);
    const tabs = h('div', {class:'application-history-tabs', role:'group', 'aria-label':'Application history filter'});
    for (const [key, label, count] of [['review','Needs review',attention.length], ['all','All history',attempts.length]]) {
      tabs.append(h('button', {type:'button', 'aria-label':`${label} (${count})`, 'aria-pressed':String(filter === key), onclick:() => {
        if (loading || pending) return;
        filter = key; visible = 8; expanded = null; draw();
        body.querySelector('[aria-pressed="true"]').focus({preventScroll:true});
      }}, label + ' ', h('span', {class:'application-history-count', 'aria-hidden':'true', text:`(${count})`})));
    }
    const empty = h('div', {class:'application-history-empty'},
      h('p', {text:attempts.length ? 'Nothing needs review right now.' : 'No application history yet.'}),
      h('span', {text:attempts.length ? 'Recorded outcomes are available in All history.' : 'Outcomes appear here when AI assistance handles an application.'}),
      attempts.length ? h('button', {class:'text-link', type:'button', text:'View all history', onclick:() => {
        filter = 'all'; draw(); body.querySelector('[aria-pressed="true"]').focus({preventScroll:true});
      }}) : null);
    body.replaceChildren(...[attempts.length ? tabs : null,
      shown.length ? h('div', {class:'application-history-list'}, shown.map(row)) : empty,
      filter === 'all' && matches.length > shown.length ? h('button', {class:'btn application-history-more', type:'button',
        text:`Show ${Math.min(8, matches.length - shown.length)} more`, onclick:() => {
          const firstNew = shown.length;
          visible += 8; draw();
          body.querySelectorAll('[data-review-toggle]')[firstNew]?.focus({preventScroll:true});
        }}) : null,
      attempts.length ? h('p', {class:'application-history-caption', text:`${filter === 'all' ? `Showing ${shown.length} of ${attempts.length} records. ` : ''}Latest recorded outcome per application${attempts.length >= 100 ? ' · up to 100 recent records' : ''}.`}) : null].filter(Boolean));
    for (const article of body.querySelectorAll('[data-attempt]')) {
      if (openEvidence.has(article.dataset.attempt)) article.querySelector('.application-evidence')?.setAttribute('open', '');
    }
    drawAssistance();
    busy();
  }

  async function load({afterSave=false} = {}) {
    if (loading || (pending && !afterSave) || scope.aborted) return;
    loading = true;
    if (!afterSave) feedback.replaceChildren();
    busy();
    publishSummary({loading:true});
    try {
      const data = await api('/api/application-agent', undefined, {fresh:true});
      if (!current()) return;
      snapshot = {...data, attempts:Array.isArray(data.attempts) ? data.attempts : []};
      draw();
      publishSummary();
    } catch (error) {
      if (!current() || error.name === 'AbortError') return;
      if (snapshot) feedback.append(errorState(`History could not refresh. Showing the last loaded records. ${error.message}`, () => load()));
      else body.replaceChildren(errorState(error.message, () => load()));
      publishSummary({error:error.message});
    } finally {
      loading = false;
      if (current()) busy();
    }
  }
  load();
  return content;
}
