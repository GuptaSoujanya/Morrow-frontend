import { h } from '../dom.js';
import { api } from '../api.js';
import { panel, loadingState, errorState } from './panel.js';
import { confirmDialog } from './dialog.js';

export function applicationAgentPanel() {
  const body = h('div', {}, loadingState('Checking application intelligence…', {compact:true}));
  const refresh = h('button', {class:'btn btn-sm',type:'button',text:'Refresh',onclick:load});
  async function review(item, outcome) {
    const confirmed = outcome === 'confirmed';
    if (!await confirmDialog({title:confirmed ? 'Confirm this application was sent?' : 'Allow another attempt?',
      body:confirmed ? 'Choose this only after finding a receipt or the matching message in Sent. The bot will not submit this job again.'
        : 'Check the employer’s application page and Gmail Sent first. Choose this only if you confirmed nothing was sent. A later run may submit this application.',
      ok:confirmed ? 'Mark as confirmed' : 'I checked: nothing was sent'})) return;
    try {await api('/api/application-agent/resolve', {job_id:item.job_id, outcome});await load();}
    catch(error) {body.prepend(errorState(error.message));}
  }
  async function load() {
    refresh.disabled=true;
    try {
      const data = await api('/api/application-agent', undefined, {fresh:true});
      const attempts = data.attempts || [];
      body.replaceChildren(h('p', {text:data.enabled ? `AI assistance is on · up to ${data.limit} tasks per bot run · $${data.budget} maximum per task.` : 'AI assistance is off. Enable BROWSER_AGENT in Preferences to let the bot handle unfamiliar application steps.'}),
        h('div', {class:'agent-capabilities'}, ['Board-specific instructions','ATS redirects','Account checks','Verification email','Application email','Duplicate protection'].map(text=>h('span',{text}))),
        h('p', {class:'muted small',text:'Email is sent only to an application address published on the job page. Unknown facts, human checks and uncertain sends pause for review.'}),
        attempts.length ? h('div', {}, h('h3', {text:'Recent AI attempts'}), ...attempts.slice(0,8).map(item =>
          h('article', {class:'agent-attempt'}, h('strong', {text:`${item.company || 'Company'} · ${item.title || 'Application'}`}),
            h('p', {text:`${item.state === 'running' ? 'Started — outcome not recorded yet' : item.state.replaceAll('_',' ')} · ${item.next_step || 'Check the saved run.'}`}),
            item.detail ? h('details', {}, h('summary', {text:'What happened'}), h('p', {text:item.detail})) : null,
            ['running','uncertain'].includes(item.state) ? h('div', {class:'agent-attempt-actions'},
              h('button', {type:'button',class:'btn btn-sm',text:'I verified it was sent',onclick:()=>review(item,'confirmed')}),
              h('button', {type:'button',class:'btn btn-sm',text:'I verified nothing was sent',onclick:()=>review(item,'not_sent')})) : null)))
          : h('p', {class:'muted small',text:'No AI application attempts recorded yet. The agent takes over when an application needs more than the standard form handler.'}));
    } catch(error) {if(error.name !== 'AbortError')body.replaceChildren(errorState(error.message,load));}
    finally {refresh.disabled=false;}
  }
  load();
  return panel('Application intelligence', {sub:'See what the agents can handle and resolve uncertain outcomes.', tools:refresh}, body);
}
