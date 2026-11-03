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
export function timeline(item){
  const state=workflow(item),index=stages.findIndex(([key])=>key===state.phase),history=state.history||[];
  return h('ol',{class:'outreach-timeline','aria-label':'Draft progress'},stages.map(([key,label],i)=>{
    const recorded=history.some(event=>event.phase===key),done=state.phase==='ready'||index>i;
    return h('li',{class:`${done?'is-done':index===i?'is-current':recorded?'was-reached':''}`,'aria-current':index===i?'step':null},h('span',{class:'outreach-step-mark','aria-hidden':'true',text:done?'✓':i+1}),h('span',{text:label}));
  }));
}
let starting=false;
export async function startDrafts(items, roles, outreach, onStarted){
  if(starting)return;
  if(outreach?.workflow_version!==2){toast('Draft preparation is temporarily unavailable. Refresh the page and retry.','error');return;}
  if(!outreach?.gmail_configured){toast('Connect Google / Gmail in Connections before creating drafts.','error');return;}
  if(!outreach.resume_ready){toast('Add your PDF résumé in My profile & files before creating drafts.','error');return;}
  if(!items.length||items.length>50){toast('Choose between 1 and 50 companies.','error');return;}
  const missing=items.find(item=>!roles[item.company_id]);
  if(missing){toast(`Choose the role for ${missing.name} first.`,'error');return;}
  starting=true;
  const scope=accountRequestSignal(),since=Date.now()/1000,ids=items.map(item=>item.company_id);
  // Reserve a tab during the user's click. The handoff page independently tracks
  // the durable workflow and opens Gmail only after verification succeeds.
  const tab=window.open('about:blank','_blank');
  if(tab){tab.opener=null;tab.document.title='Preparing your Gmail draft';tab.document.body.textContent='Starting your draft workflow…';}
  const href=new URL('#/companies?watch='+ids.join(',')+'&since='+since,location.href).href;
  try{
    const result=await api('/api/run',{action:'company_outreach',options:{companies:ids,roles:Object.fromEntries(ids.map(id=>[id,roles[id]])),require_gmail:true}});
    scope.throwIfAborted();
    if(tab&&!tab.closed)tab.location.replace(href);else toast('Draft run started. Allow pop-ups for automatic Gmail opening, or use Open Gmail when ready.','info',6000);
    onStarted?.(result,ids,since);
    try{await hooks.refreshStatus?.();}catch{}
  }catch(error){if(tab&&!tab.closed)tab.close();if(!scope.aborted)toast(error.message,'error');}
  finally{starting=false;}
}

export function renderDraftWatch(ids,since){
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
      const data=await api('/api/companies?'+new URLSearchParams({ids:ids.join(','),size:100}),undefined,{fresh:true});
      scope.throwIfAborted();
      const rows=ids.map(id=>data.rows.find(row=>row.company_id===id)).filter(Boolean);
      const current=rows.filter(row=>(row.workflow?.updated_at||0)>=since-2);
      const ready=current.filter(row=>workflow(row).phase==='ready'&&row.drafts?.some(d=>d.state==='gmail'&&gmailLink(d.gmail_url)));
      const failed=current.filter(row=>['blocked','failed'].includes(workflow(row).phase));
      content.replaceChildren(...rows.map(row=>{
        const fresh=(row.workflow?.updated_at||0)>=since-2;
        return h('section',{class:'outreach-watch-item'},h('h2',{text:row.name}),h('p',{class:'company-muted',text:fresh?row.workflow.title||'Preparing the selected role':'Waiting for the selected role…'}),timeline(fresh?row:{...row,workflow:{phase:'queued'}}),h('p',{class:fresh&&['failed','blocked'].includes(row.workflow.phase)?'company-draft-error':'company-muted',text:fresh?row.workflow.message:'Opening the saved Google session…'}));
      }));
      if(ready.length===ids.length){
        title.textContent='Your draft is ready';subtitle.textContent='Opening Gmail…';stop();
        const drafts=ready.flatMap(row=>row.drafts.filter(d=>d.state==='gmail'));
        window.location.replace(drafts.length===1?gmailLink(drafts[0].gmail_url):mailbox(data.outreach.sender));return;
      }
      if(ready.length+failed.length===ids.length&&failed.length){
        title.textContent='Some drafts need attention';subtitle.textContent='Review the reason below, then return to Companies to choose a role or retry.';
        if(ready.length)content.append(h('a',{class:'btn btn-primary',href:mailbox(data.outreach.sender),text:`Open ${ready.length} ready ${ready.length===1?'company':'companies'} in Gmail`}));
        stop();return;
      }
      if(!current.length&&Date.now()/1000-since>180){
        title.textContent='The draft run has not started';subtitle.textContent='Return to Companies and check Activity for the run result.';stop();return;
      }
    }catch(error){if(scope.aborted)return;subtitle.textContent=error.message;}
    timer=setTimeout(refresh,2000);
  }
  timer=setTimeout(refresh,0);
  return root;
}
