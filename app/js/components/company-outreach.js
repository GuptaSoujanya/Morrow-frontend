import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';
import { toast } from './toast.js';
import { hooks } from '../state.js';

export const stages=[['contacts','Find email'],['writing','Write pitch'],['attaching','Attach résumé'],['saving','Save in Gmail'],['ready','Ready to review']];
const active=new Set(['queued','contacts','writing','attaching','saving']);
export function gmailLink(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='mail.google.com'&&!url.username&&!url.password?url.href:'';}catch{return '';}}
export function mailbox(sender){return 'https://mail.google.com/mail/u/?authuser='+encodeURIComponent(sender||'')+'#drafts';}
export function workflow(item){
  if(item.workflow)return item.workflow;
  const drafts=item.drafts||[],problem=drafts.find(row=>['failed','needs_review'].includes(row.state));
  if(problem)return {phase:'failed',message:problem.error||'This draft needs attention.'};
  if(drafts.length&&drafts.every(row=>row.state==='gmail'))return {phase:'ready',message:'Saved and verified in Gmail.'};
  if(drafts.some(row=>row.state==='saving_gmail'))return {phase:'saving',message:'Checking the saved draft and attachment.'};
  if(drafts.some(row=>row.state==='preparing'))return {phase:'writing',message:'Writing your role-specific pitch.'};
  if(drafts.some(row=>row.state==='local'))return {phase:'local',message:'Pitch is prepared. Save it to Gmail to continue.'};
  if(drafts.some(row=>row.state==='existing'))return {phase:'blocked',message:'An earlier draft already exists. Review it before creating another.'};
  return {phase:'idle',message:'Ready to find a contact and prepare your pitch.'};
}
export function isWorking(item){return active.has(workflow(item).phase);}
export function roleNeedsReview(item){return ['role_mismatch','missing_context','review_needed','resume_unreadable'].includes(workflow(item).issue?.code);}
export function recovery(item){
  const state=workflow(item),code=state.issue?.code,title=state.title||item.drafts?.find(d=>d.title)?.title||'the selected role';
  if(!roleNeedsReview(item))return null;
  const alternatives=(item.jobs||[]).filter(job=>job.job_id!==state.job_id);
  return {title:code==='missing_context'?'More job information needed':code==='resume_unreadable'?'Check your résumé':'Review this role',
    message:state.message,
    next:alternatives.length?'Choose another saved role below, or review the posting and your résumé before rechecking.':`There is no other saved role for ${item.name}. Browse other companies, or review the posting and your résumé before rechecking.`,
    role:title,alternatives};
}
export function progressRows(data,ids,since){
  return ids.map(id=>data.rows.find(row=>row.company_id===id)).filter(Boolean).map(row=>{
    const fresh=(row.workflow?.updated_at||0)>=since-2;
    const state=fresh?row.workflow:{phase:'queued',message:'Waiting for the draft run to start.',updated_at:since};
    if(data.draft_run&&!data.draft_run.running&&active.has(state.phase))return {...row,workflow:{...state,phase:'failed',issue:{code:'interrupted'},message:data.draft_run.stopped?'This run was stopped. No new draft was confirmed. Review any saved drafts before retrying.':'The run ended before this draft was verified. Check Activity and retry from the company page.'}};
    return {...row,workflow:state};
  });
}
export function timeline(item){
  const state=workflow(item),index=stages.findIndex(([key])=>key===state.phase),history=state.history||[];
  const reached=[...history].reverse().map(event=>stages.findIndex(([key])=>key===event.phase)).find(index=>index>=0)??-1;
  const stopped=['failed','blocked'].includes(state.phase);
  return h('ol',{class:'outreach-timeline','aria-label':'Draft progress'},stages.map(([key,label],i)=>{
    const done=state.phase==='ready'||index>i||(stopped&&reached>i),failed=stopped&&reached===i;
    return h('li',{class:done?'is-done':failed?'is-failed':index===i?'is-current':'','aria-current':index===i?'step':null},h('span',{class:'outreach-step-mark','aria-hidden':'true',text:done?'✓':failed?'!':i+1}),h('span',{text:label}),failed?h('span',{class:'outreach-step-note',text:'Stopped here'}):null);
  }));
}
let starting=false;
export async function startDrafts(items, outreach, onStarted){
  if(starting)return;
  if(!outreach?.automatic_drafts){toast('Refresh Companies to load the automatic draft workflow.','error');return;}
  if(!outreach?.gmail_configured){toast('Connect Google / Gmail in Connections before creating drafts.','error');return;}
  if(!outreach.resume_ready){toast('Add your PDF résumé in My profile & files before creating drafts.','error');return;}
  if(!items.length||items.length>50){toast('Choose between 1 and 50 companies.','error');return;}
  starting=true;
  const scope=accountRequestSignal(),since=Date.now()/1000,ids=items.map(item=>item.company_id);
  try{
    const result=await api('/api/run',{action:'company_outreach',options:{companies:ids,automatic:true,require_gmail:true}});
    scope.throwIfAborted();
    onStarted?.(result,ids,since);
    try{await hooks.refreshStatus?.();}catch{}
  }catch(error){if(!scope.aborted)toast(error.message,'error');}
  finally{starting=false;}
}

export function renderDraftWatch(ids,since,run=''){
  const scope=accountRequestSignal();
  let timer,disposed=false;
  const title=h('h1',{text:'Preparing your Gmail draft'}),subtitle=h('p',{text:'This tab opens Gmail automatically after your draft and résumé are verified.'});
  const content=h('div',{class:'outreach-watch-items',role:'status'},h('p',{text:'Starting the workflow…'}));
  const root=h('div',{class:'page outreach-watch'},h('a',{href:'#/companies',class:'company-back',text:'← Back to Companies'}),h('header',{},title,subtitle),content);
  function stop(){disposed=true;clearTimeout(timer);}
  scope.addEventListener('abort',stop,{once:true});
  async function refresh(){
    if(disposed||!root.isConnected){stop();return;}
    try{
      const data=await api('/api/companies?'+new URLSearchParams({ids:ids.join(','),size:100,...(run?{run}:{})}),undefined,{fresh:true});
      scope.throwIfAborted();
      const rows=progressRows(data,ids,since);
      const current=rows.filter(row=>row.workflow.phase!=='queued');
      const ready=current.filter(row=>workflow(row).phase==='ready'&&row.drafts?.some(d=>d.state==='gmail'&&gmailLink(d.gmail_url)));
      const failed=current.filter(row=>['blocked','failed'].includes(workflow(row).phase));
      subtitle.textContent='This tab opens Gmail automatically after your draft and résumé are verified.';
      content.replaceChildren(...rows.map(row=>{
        const fresh=(row.workflow?.updated_at||0)>=since-2;
        const problem=['failed','blocked'].includes(row.workflow.phase),help=recovery(row);
        const readyDrafts=(row.drafts||[]).filter(d=>d.state==='gmail'&&gmailLink(d.gmail_url));
        return h('section',{class:'outreach-watch-item'},h('h2',{text:row.name}),h('p',{class:'company-muted',text:fresh?row.workflow.title||'Preparing the selected role':'Waiting for the selected role…'}),timeline(row),
          h('p',{class:problem?'company-draft-error':'company-muted',text:row.workflow.message}),
          help?h('p',{text:help.next}):null,
          h('div',{class:'company-actions'},...readyDrafts.map(d=>h('a',{class:'btn',href:gmailLink(d.gmail_url),text:'Open verified draft',target:'_blank',rel:'noopener noreferrer'})),
            problem?h('a',{class:'btn btn-primary',href:'#/companies/'+row.company_id+'?review=1',text:help?'Review role & résumé':'Review and resume'}):null));
      }));
      if(ready.length===ids.length){
        title.textContent='Your draft is ready';subtitle.textContent='Opening Gmail… If the redirect is blocked, use Open verified draft below.';stop();
        const drafts=ready.flatMap(row=>row.drafts.filter(d=>d.state==='gmail'));
        window.location.replace(drafts.length===1?gmailLink(drafts[0].gmail_url):mailbox(data.outreach.sender));return;
      }
      if(ready.length+failed.length===ids.length&&failed.length){
        title.textContent=ids.length===1?'Your draft needs attention':'Some drafts need attention';subtitle.textContent='Your progress is saved. Use the action below to resolve the issue.';
        if(ready.length)content.append(h('a',{class:'btn btn-primary',href:mailbox(data.outreach.sender),text:`Open ${ready.length} ready ${ready.length===1?'company':'companies'} in Gmail`}));
        stop();return;
      }
      if(!current.length&&Date.now()/1000-since>180){
        title.textContent='The draft run has not started';subtitle.textContent='Return to Companies and check Activity for the run result.';stop();return;
      }
    }catch(error){if(scope.aborted)return;subtitle.textContent=error.message+' Retrying the progress check automatically.';}
    timer=setTimeout(refresh,2000);
  }
  timer=setTimeout(refresh,0);
  return root;
}
