import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api, accountRequestSignal } from '../api.js';
import { loadingState, errorState, empty } from '../components/panel.js';
import { pagination } from '../components/pagination.js';
import { quickButton } from '../forms.js';
import { readQuery, writeQuery, pageNumber, choice } from '../url-state.js';
import { selectControl } from '../components/controls.js';
import { toast } from '../components/toast.js';
import { workflow, timeline, isWorking, startDrafts, renderDraftWatch, gmailLink, mailbox } from '../components/company-outreach.js';

export const researchLabels = {pending:'To research',researching:'Researching',found:'Found',partial:'Partial info',not_found:'Not found',failed:'Needs retry'};
const fields={website:'Website',careers:'Careers page',hiring_manager:'Hiring contact',ceo:'CEO',cto:'CTO',location:'Location',industry:'Industry',about:'About',linkedin:'LinkedIn',size:'Company size'};
const contactFilters={all:'All companies',email:'With email',phone:'With phone',missing:'No email or phone'};
const url=value=>{try{const parsed=new URL(value);return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password?parsed.href:'';}catch{return '';}};
const date=value=>value?new Date(value*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Not researched yet';
const valuesFor=(item,key)=>(item.fields?.[key]||[]).filter(entry=>String(entry.value||'').trim());
const researchState=status=>Object.hasOwn(researchLabels,status)?status:'pending';
export const researchPill=status=>h('span',{class:`company-status company-status-${researchState(status)}`,text:researchLabels[status]||'To research'});
const bestRole=item=>(item.drafts||[]).find(d=>d.title)?.title||[...(item.jobs||[])].sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0))[0]?.title||'No linked role';
function copyButton(value,label,compact=false){
  const button=h('button',{class:`company-copy${compact?' is-cell':''}`,type:'button',title:`Copy ${label.toLowerCase()}`,'aria-label':`Copy ${label.toLowerCase()}: ${value}`,
    onclick:async()=>{button.disabled=true;try{await navigator.clipboard.writeText(value);toast(`${label} copied.`,'success',2200);}catch{toast(`Couldn’t copy ${label.toLowerCase()}. Select the text and copy it manually.`,'error');}finally{button.disabled=false;}}},
    h('span',{text:value}),icon('copy','icon icon-sm'));
  return button;
}
function source(entry){
  return h('div',{class:'company-source-block'},url(entry.source)?h('a',{class:'company-source',href:url(entry.source),target:'_blank',rel:'noopener noreferrer',text:`Source · ${new URL(entry.source).hostname}`},icon('external','icon icon-sm')):null,
    entry.evidence?h('details',{class:'company-evidence'},h('summary',{text:'View evidence'}),h('blockquote',{text:entry.evidence})):null);
}
function missingContact(item){return item.status==='pending'?'Not researched':item.status==='researching'?'Looking…':item.status==='failed'?'Needs retry':'Not found';}
function runButton(item){const button=quickButton('company_research','Research contacts',{company:item.company_id,retry:true,limit:1},{confirm:{title:`Research ${item.name}?`,body:'Check public sources for contacts and refresh this company’s details. Missing facts stay marked as missing.'}});button.disabled=item.status==='researching';return button;}
const draftLabels = {preparing:'Writing pitch', local:'Saved locally', saving_gmail:'Saving to Gmail', gmail:'In Gmail Drafts', needs_review:'Check Gmail save', failed:'Needs retry', existing:'Draft already exists'};
function draftState(item){
  const drafts=item.drafts||[];
  for(const state of ['needs_review','failed','preparing','saving_gmail','local','existing','gmail'])if(drafts.some(d=>d.state===state))return state;
  return '';
}
function draftStatus(item){const state=draftState(item);return h('span',{class:`company-draft-state is-${state||'none'}`,text:draftLabels[state]||(item.draft_note?.startsWith('No public')?'No hiring email':'Not drafted')});}
function contactDetails(item){return h('div',{},['email','phone'].map(key=>{
  const values=valuesFor(item,key),label=key==='email'?'Email':'Phone';
  return h('section',{class:'company-detail-section'},h('h3',{text:label}),values.length?values.map(entry=>h('div',{class:'company-contact-detail'},copyButton(entry.value,label),source(entry))):h('p',{class:'company-muted',text:missingContact(item)}));
}),h('section',{class:'company-detail-section'},h('h3',{text:'Linked roles'}),h('ul',{class:'company-jobs'},(item.jobs||[]).map(job=>h('li',{},url(job.url)?h('a',{href:url(job.url),target:'_blank',rel:'noopener noreferrer',text:job.title||'Open job posting'}):h('span',{text:job.title||'Job posting'}))))));}
function draftDetails(item,start){
  if(!item.drafts?.length)return h('div',{class:'company-draft-empty'},icon('file'),h('h3',{text:'Your pitch starts here'}),h('p',{text:'Find a public hiring email, then prepare an introduction using your résumé and the linked role.'}),h('p',{class:'company-muted',text:'Review the draft before sending it yourself.'}),h('button',{class:'btn btn-primary',type:'button',text:'Create Gmail draft',onclick:()=>start(item)}));
  return h('div',{},item.drafts.map(draft=>h('section',{class:'company-pitch'},
    h('div',{class:'company-pitch-address'},h('span',{text:'To'}),h('strong',{text:draft.recipient})),
    h('span',{class:`company-draft-state is-${draft.state}`,text:draftLabels[draft.state]||draft.state}),
    h('h3',{text:draft.subject||'Preparing your pitch'}),h('p',{class:'company-pitch-body',text:draft.body||draft.error||'The pitch is being prepared.'}),
    draft.resume?h('div',{class:'company-attachment'},icon('file','icon icon-sm'),h('span',{text:`Resume attached: ${draft.resume}`})):null,
    draft.error?h('p',{class:'company-draft-error',text:draft.error}):null,
    h('div',{class:'company-actions'},draft.download_url?.startsWith('/reports/')?h('a',{class:'btn',href:draft.download_url,download:'',text:'Download email + resume'}):null,
      gmailLink(draft.gmail_url)?h('a',{class:'btn',href:gmailLink(draft.gmail_url),target:'_blank',rel:'noopener noreferrer',text:'Open Gmail draft'}):null))),workflow(item).phase!=='ready'&&!isWorking(item)?h('button',{class:'btn btn-primary',type:'button',text:'Retry Gmail draft',onclick:()=>start(item)}):null);
}
function companyDetails(item){return h('div',{},Object.entries(fields).map(([key,label])=>{
  const values=valuesFor(item,key);return values.length?h('section',{class:'company-detail-section'},h('h3',{text:label}),values.map(entry=>h('div',{},['website','careers','linkedin'].includes(key)&&url(entry.value)?h('a',{class:'company-fact-link',href:url(entry.value),target:'_blank',rel:'noopener noreferrer',text:entry.value}):h('p',{text:entry.value}),source(entry)))):null;
}),h('section',{class:'company-detail-section'},h('h3',{text:'Research notes'}),h('p',{class:'company-muted',text:date(item.updated_at)}),h('p',{text:item.notes||'No research notes yet.'}),h('p',{class:'company-muted',text:'Notes are AI-generated. Check the sources for individual facts.'})),item.error?h('p',{class:'company-draft-error',text:item.error}):null);}

const phaseLabels={idle:'Not started',queued:'Starting',contacts:'Finding a hiring email',writing:'Writing your pitch',attaching:'Attaching résumé',saving:'Saving to Gmail',ready:'Ready in Gmail',blocked:'Needs attention',failed:'Needs attention',local:'Pitch prepared'};
function contactBlock(item,open){
  const emails=valuesFor(item,'email'),phones=valuesFor(item,'phone');
  return h('div',{class:'outreach-contact'},emails.length?h('div',{class:'company-contact-cell'},copyButton(emails[0].value,'Email',true),emails.length>1?h('button',{type:'button',class:'company-more',text:`+${emails.length-1}`,'aria-label':`${emails.length-1} more emails for ${item.name}`,onclick:()=>open(item,'contacts')}):null):h('span',{class:'company-muted',text:'Find email automatically'}),
    phones.length?h('div',{class:'company-contact-cell outreach-phone'},copyButton(phones[0].value,'Phone',true),phones.length>1?h('button',{type:'button',class:'company-more',text:`+${phones.length-1}`,'aria-label':`${phones.length-1} more phone numbers for ${item.name}`,onclick:()=>open(item,'contacts')}):null):null);
}
function companyTable(items,controls){
  const {selected,roles,open,start,selectOne,selectPage}=controls;
  const all=h('input',{type:'checkbox','aria-label':'Select companies on this page',onchange:event=>selectPage(event.target.checked)});
  return h('div',{class:'company-table-scroll',role:'region','aria-label':'Company outreach',tabindex:'0'},
    h('table',{class:'company-table is-outreach'},h('thead',{},h('tr',{},h('th',{scope:'col',class:'company-col-select','aria-label':'Select companies'},h('label',{class:'company-check'},all)),
      ...[['Company & role','identity'],['Email & phone','contact'],['Progress','progress'],['Draft','action']].map(([text,key])=>h('th',{scope:'col',class:`company-col-${key}`,text})))),
      h('tbody',{},items.map(item=>{
        const state=workflow(item),jobs=(item.jobs||[]).filter(job=>job.job_id&&job.title),working=isWorking(item),saved=item.drafts?.filter(d=>d.state==='gmail'&&gmailLink(d.gmail_url))||[];
        if(!roles.has(item.company_id))roles.set(item.company_id,item.workflow?.job_id&&jobs.some(j=>j.job_id===item.workflow.job_id)?item.workflow.job_id:jobs.find(j=>saved.some(d=>d.job_url===j.url))?.job_id||(jobs.length===1?jobs[0].job_id:''));
        const role=jobs.length>1?selectControl({label:`Role for ${item.name}`,value:roles.get(item.company_id),options:[{value:'',label:'Choose a role'},...jobs.map(job=>({value:job.job_id,label:job.title}))],onChange:value=>{roles.set(item.company_id,value);controls.changed();}}):h('span',{class:'outreach-role-title',text:jobs[0]?.title||'No linked role available'});
        if((working||state.phase==='ready')&&role.controlElement)role.controlElement.disabled=true;
        const makeAction=()=>saved.length&&state.phase==='ready'?h('a',{class:'company-create-button is-ready',href:saved.length===1?gmailLink(saved[0].gmail_url):mailbox(controls.outreach.sender),target:'_blank',rel:'noopener noreferrer',text:'Open Gmail'},icon('external','icon icon-sm')):
          h('button',{class:'company-create-button',type:'button',text:working?'Preparing…':state.phase==='failed'?'Retry draft':'Create draft',disabled:working||!jobs.length,onclick:()=>start(item)});
        const review=()=>h('button',{class:'company-text-button outreach-review',type:'button',text:item.drafts?.some(d=>d.body)?'Review pitch':state.phase==='failed'||state.phase==='blocked'?'View issue':'View details',onclick:()=>open(item,'drafts')});
        return h('tr',{dataset:{company:item.company_id}},
          h('td',{class:'company-cell-select'},h('label',{class:'company-check'},h('input',{type:'checkbox','aria-label':`Select ${item.name}`,checked:selected.has(item.company_id),disabled:working,onchange:event=>selectOne(item,event.target.checked)}))),
          h('td',{class:'company-cell-identity'},h('button',{class:'company-name',type:'button','aria-haspopup':'dialog',title:item.name,onclick:()=>open(item,'contacts')},h('span',{text:item.name})),h('div',{class:'outreach-role'},role)),
          h('td',{class:'company-cell-contact'},contactBlock(item,open),h('span',{class:`outreach-mobile-status is-${state.phase}`,text:phaseLabels[state.phase]}),h('div',{class:'outreach-mobile-action'},makeAction(),review())),
          h('td',{class:'company-cell-progress'},h('span',{class:`outreach-state is-${state.phase}`,text:phaseLabels[state.phase]}),h('span',{class:'outreach-progress-note',text:state.message})),
          h('td',{class:'company-cell-action'},makeAction(),review()));
      }))));
}

export function renderCompanies(id=''){
  const query=readQuery(),watch=(query.get('watch')||'').split(',').filter(Boolean),since=Number(query.get('since'));
  if(watch.length&&watch.length<=50&&watch.every(value=>/^[a-f0-9]{24}$/.test(value))&&Number.isFinite(since)&&since>0)return renderDraftWatch(watch,since);
  const filters={q:query.get('q')||'',status:choice(query.get('status'),['all',...Object.keys(researchLabels)],'all'),contact:choice(query.get('contact'),Object.keys(contactFilters),'all'),page:pageNumber(query.get('page')),size:choice(Number(query.get('size')),[20,50,100],20)};
  const scope=accountRequestSignal(),selected=new Map(),roles=new Map();
  let data=null,timer,ticket=0,lastTable='',drawer=null,starting=false,activeIds=[],activeSince=0,progressTimer;
  const body=h('div',{class:'company-body'},loadingState('Loading companies…')),footer=h('div',{class:'company-footer'}),count=h('span',{class:'company-total',role:'status'}),selectionBar=h('div',{class:'company-selection-bar'});
  const title=h('h1',{text:'Companies'}),connection=h('a',{class:'company-connection',href:'#/connections',text:'Checking Gmail…'}),resumeLabel=h('span',{class:'outreach-resume'});
  const runPanel=h('section',{class:'outreach-run-panel',hidden:true,'aria-label':'Current draft workflow'});
  const gmail=h('a',{class:'company-text-button',target:'_blank',rel:'noopener noreferrer',text:'Open Gmail Drafts'});
  const refresh=h('button',{class:'company-icon-button',type:'button','aria-label':'Refresh companies',onclick:()=>load()},icon('refresh','icon icon-sm'));
  const companyHref=item=>'#/companies/'+item.company_id+'?'+new URLSearchParams(filters);
  function selectOne(item,checked){if(checked&&selected.size>=50&&!selected.has(item.company_id))toast('Select up to 50 companies per run.','info');else if(checked)selected.set(item.company_id,item);else selected.delete(item.company_id);updateSelection();}
  function selectPage(checked){for(const item of data.rows){if(!checked)selected.delete(item.company_id);else if(selected.size<50&&!isWorking(item))selected.set(item.company_id,item);}updateSelection();}
  function updateSelection(){
    body.querySelectorAll('tbody tr').forEach(row=>{const checked=selected.has(row.dataset.company);row.classList.toggle('is-selected',checked);row.querySelector('input[type=checkbox]').checked=checked;});
    const all=body.querySelector('thead input'),eligible=(data?.rows||[]).filter(item=>!isWorking(item)),amount=eligible.filter(item=>selected.has(item.company_id)).length;
    if(all){all.checked=!!eligible.length&&amount===eligible.length;all.indeterminate=amount>0&&amount<eligible.length;all.disabled=!eligible.length;}
    selectionBar.replaceChildren(h('div',{class:'company-selection-summary'},h('strong',{text:selected.size?`${selected.size} ${selected.size===1?'company':'companies'} selected`:'Choose a role, then create your draft'}),h('span',{text:selected.size?'Contact research, pitch, résumé and Gmail saving run automatically.':'Your pitch is based on your résumé. You review and send it in Gmail.'})),
      h('div',{class:'company-selection-controls'},selected.size?h('button',{class:'company-text-button',type:'button',text:'Clear selection',onclick:()=>{selected.clear();updateSelection();}}):null,
        h('button',{class:'company-create-button is-primary',type:'button',text:starting?'Starting…':`Create selected drafts${selected.size?' ('+selected.size+')':''}`,disabled:!selected.size||starting,onclick:()=>begin([...selected.values()])})));
  }
  async function begin(items){
    if(starting)return;
    const missing=items.find(item=>!roles.get(item.company_id));
    if(missing){toast(`Choose the role for ${missing.name} first.`,'error');body.querySelector(`tr[data-company="${missing.company_id}"] [role=combobox]`)?.focus();return;}
    starting=true;updateSelection();
    try{await startDrafts(items,Object.fromEntries(roles),data?.outreach,(_result,ids,since)=>{
      activeIds=ids;activeSince=since;selected.clear();closeDrawer(false);lastTable='';
      items.forEach(item=>{item.workflow={phase:'queued',message:'Opening Gmail and starting your draft.',job_id:roles.get(item.company_id)};});
      renderTable();refreshProgress();
    });}finally{starting=false;updateSelection();}
  }
  function closeDrawer(restore=true){if(drawer){drawer._restore=restore;drawer.close();}}
  function openDrawer(item,tab='contacts'){
    closeDrawer(false);const previous=document.activeElement;
    const element=h('dialog',{class:'company-drawer','aria-labelledby':'company-drawer-name'});drawer=element;element._restore=true;
    const content=h('div',{class:'company-drawer-content'}),tabs=h('div',{class:'company-drawer-tabs',role:'group','aria-label':'Company detail view'});
    function select(value){const restore=tabs.contains(document.activeElement);tab=value;
      tabs.replaceChildren(...[['contacts','Contacts'],['drafts','Pitch & progress'],['company','Company']].map(([key,label])=>h('button',{class:'company-view-button',type:'button','aria-pressed':tab===key,text:label,onclick:()=>select(key)})));
      content.replaceChildren(tab==='contacts'?contactDetails(item):tab==='company'?companyDetails(item):h('div',{},timeline(item),h('p',{class:['failed','blocked'].includes(workflow(item).phase)?'company-draft-error':'company-muted',text:workflow(item).message}),draftDetails(item,item=>begin([item]))));
      if(restore)tabs.querySelector('[aria-pressed=true]').focus();
    }
    const close=h('button',{class:'company-icon-button',type:'button','aria-label':'Close company details',onclick:()=>element.close()},icon('x','icon icon-sm'));
    element.append(h('div',{class:'company-drawer-heading'},h('div',{},h('p',{text:'COMPANY DETAILS'}),h('h2',{id:'company-drawer-name',text:item.name}),researchPill(item.status)),close),tabs,content,h('div',{class:'company-drawer-footer'},h('a',{href:companyHref(item),text:'Open company page',onclick:()=>closeDrawer(false)}),runButton(item)));
    select(tab);document.body.append(element);
    const escape=event=>{if(event.key==='Escape'&&!document.getElementById('confirm')?.open){event.preventDefault();element.close();}};
    document.addEventListener('keydown',escape);
    element.onclose=()=>{document.removeEventListener('keydown',escape);element.remove();if(drawer===element)drawer=null;if(element._restore&&!scope.aborted&&previous?.isConnected)previous.focus({preventScroll:true});};
    if(innerWidth<=700)element.showModal();else element.show();close.focus({preventScroll:true});
  }
  function renderTable(){
    if(!data)return;
    const stamp=JSON.stringify([data.rows,data.page,data.total]);if(stamp===lastTable)return;lastTable=stamp;
    const scrollTop=body.querySelector('.company-table-scroll')?.scrollTop||0;
    body.replaceChildren(data.rows.length?companyTable(data.rows,{selected,roles,open:openDrawer,start:item=>begin([item]),selectOne,selectPage,changed:updateSelection,outreach:data.outreach||{}}):empty('No companies match these filters.',h('button',{class:'btn',text:'Clear filters',onclick:clearFilters})));
    const scroll=body.querySelector('.company-table-scroll');if(scroll)scroll.scrollTop=scrollTop;
    footer.replaceChildren(...(data.rows.length&&!id?[pagination({...data,label:'Companies',sizes:[20,50,100],onPage:async page=>{filters.page=page;await load();footer.querySelector('[aria-current=page]')?.focus({preventScroll:true});},onSize:async size=>{filters.size=size;filters.page=1;await load();footer.querySelector('[role=combobox]')?.focus({preventScroll:true});}})]:[]));
    updateSelection();
  }
  async function refreshProgress(){
    clearTimeout(progressTimer);if(scope.aborted||!body.isConnected||!activeIds.length)return;
    try{
      const snapshot=await api('/api/companies?'+new URLSearchParams({ids:activeIds.join(','),size:100}),undefined,{fresh:true});
      if(scope.aborted)return;
      snapshot.rows=snapshot.rows.map(item=>(item.workflow?.updated_at||0)>=activeSince-2?item:{...item,workflow:{phase:'queued',message:'Opening Gmail and starting your draft.'}});
      runPanel.hidden=false;runPanel.replaceChildren(h('div',{class:'outreach-run-heading'},h('h2',{text:'Your draft workflow'}),h('a',{class:'company-text-button',href:mailbox(data.outreach.sender),target:'_blank',rel:'noopener noreferrer',text:'Open Gmail'})),
        ...snapshot.rows.map(item=>h('div',{class:'outreach-run-item'},h('strong',{text:item.name}),timeline(item),h('p',{class:['failed','blocked'].includes(workflow(item).phase)?'company-draft-error':'company-muted',text:workflow(item).message}))));
      if(data){data.rows=data.rows.map(item=>snapshot.rows.find(next=>next.company_id===item.company_id)||item);if(!drawer&&!body.contains(document.activeElement))renderTable();}
      if(snapshot.rows.length===activeIds.length&&snapshot.rows.every(item=>['ready','failed','blocked'].includes(workflow(item).phase)))return;
    }catch(error){if(scope.aborted)return;}
    progressTimer=setTimeout(refreshProgress,2000);
  }
  const search=h('input',{type:'search',value:filters.q,'aria-label':'Search companies',placeholder:'Search companies, roles or contacts',oninput:event=>{filters.q=event.target.value;filters.page=1;clearTimeout(timer);timer=setTimeout(load,250);}});
  const contactSelect=selectControl({label:'Contact availability',options:Object.entries(contactFilters).map(([value,label])=>({value,label})),value:filters.contact,onChange:value=>{filters.contact=value;filters.page=1;load();}});
  const statusSelect=selectControl({label:'Research status',options:[{value:'all',label:'All research states'},...Object.entries(researchLabels).map(([value,label])=>({value,label}))],value:filters.status,onChange:value=>{filters.status=value;filters.page=1;load();}});
  const filterButton=h('button',{class:'company-filter-button',type:'button','aria-haspopup':'dialog','aria-expanded':'false',onclick:()=>{if(filterPopover.matches(':popover-open'))filterPopover.hidePopover();else{filterPopover.showPopover();const rect=filterButton.getBoundingClientRect();Object.assign(filterPopover.style,{top:`${rect.bottom+8}px`,left:`${Math.max(12,Math.min(rect.right-300,innerWidth-312))}px`});}}},icon('sliders','icon icon-sm'),h('span',{text:'Filters'}));
  const filterPopover=h('div',{class:'company-filter-popover',popover:'auto',role:'dialog','aria-label':'Company filters'},h('h2',{text:'Filter companies'}),h('div',{class:'company-filter-field'},h('span',{text:'Contact information'}),contactSelect),h('div',{class:'company-filter-field'},h('span',{text:'Research status'}),statusSelect),h('div',{class:'company-filter-footer'},h('button',{class:'company-text-button',text:'Reset filters',onclick:clearFilters}),h('button',{class:'btn',text:'Done',onclick:()=>{filterPopover.hidePopover();filterButton.focus();}})));
  filterPopover.addEventListener('toggle',event=>filterButton.setAttribute('aria-expanded',String(event.newState==='open')));
  const applied=h('div',{class:'company-applied-filters',hidden:true});
  function clearFilters(){filters.q='';filters.contact='all';filters.status='all';filters.page=1;search.value='';contactSelect.value='all';statusSelect.value='all';load();}
  function poll(){timer=setTimeout(()=>{if(!body.isConnected||scope.aborted)return;if(drawer||body.contains(document.activeElement)||selectionBar.contains(document.activeElement)||document.querySelector(':popover-open')||getSelection()?.toString())poll();else load();},5000);}
  async function load(){
    clearTimeout(timer);const request=++ticket;refresh.disabled=true;body.setAttribute('aria-busy','true');
    try{
      const result=await api('/api/companies?'+new URLSearchParams(id?{id}:filters),undefined,{fresh:true});
      if(request!==ticket||scope.aborted)return;data=result;filters.page=data.page;
      count.textContent=`${data.total.toLocaleString()} ${data.total===1?'company':'companies'}`;
      const connected=data.outreach?.gmail_configured;
      connection.textContent=connected?`Gmail · ${data.outreach.sender}`:'Connect Google / Gmail';connection.classList.toggle('is-connected',!!connected);
      gmail.href=mailbox(data.outreach?.sender);gmail.hidden=!connected;
      resumeLabel.textContent=data.outreach?.resume_ready?`Résumé: ${data.outreach.resume_name}`:'Add your PDF résumé in My profile & files';
      if(id)title.textContent=data.rows[0]?.name||'Company not found';
      contactSelect.setOptions(Object.entries(contactFilters).map(([value,label])=>({value,label:label+(data.contact_counts?' ('+data.contact_counts[value]+')':'')})));
      const labels=[filters.q?`Search: ${filters.q}`:null,filters.contact!=='all'?contactFilters[filters.contact]:null,filters.status!=='all'?researchLabels[filters.status]:null].filter(Boolean);
      applied.hidden=!labels.length;applied.replaceChildren(...labels.map(text=>h('span',{text})),h('button',{class:'company-text-button',text:'Clear filters',onclick:clearFilters}));
      renderTable();updateSelection();if(!id)writeQuery('companies',filters,{replace:true});
    }catch(error){if(!scope.aborted&&request===ticket){lastTable='';body.replaceChildren(errorState(error.message,load));footer.replaceChildren();}}
    finally{if(request===ticket){refresh.disabled=false;body.setAttribute('aria-busy','false');poll();}}
  }
  scope.addEventListener('abort',()=>{clearTimeout(timer);clearTimeout(progressTimer);closeDrawer(false);},{once:true});
  const routeChanged=()=>{if(!body.isConnected){clearTimeout(timer);clearTimeout(progressTimer);closeDrawer(false);window.removeEventListener('hashchange',routeChanged);}};
  window.addEventListener('hashchange',routeChanged);
  load();
  return h('div',{class:'page companies-page companies-sheet companies-outreach'},id?h('a',{class:'company-back',href:'#/companies?'+new URLSearchParams(filters),text:'← All companies'}):null,
    h('header',{class:'company-page-heading'},h('div',{},h('div',{class:'company-page-title'},title,count),h('p',{class:'outreach-subtitle',text:'From company contact to a ready-to-review Gmail draft.'})),h('div',{class:'outreach-connection'},connection,resumeLabel,gmail)),
    runPanel,h('section',{class:'company-workspace','aria-label':'Company directory'},h('div',{class:'company-table-toolbar'},h('span',{class:'outreach-directory-label',text:'Company directory'}),h('div',{class:'company-table-tools'},h('div',{class:'company-search'},icon('search','icon icon-sm'),search),filterButton,filterPopover,refresh)),selectionBar,applied,body,footer),
    h('p',{class:'company-page-note',text:'Verified public contacts. A role-specific pitch with your résumé. Saved as a draft—sending stays with you.'}));
}
