import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api, accountRequestSignal } from '../api.js';
import { loadingState, errorState, empty } from '../components/panel.js';
import { pagination } from '../components/pagination.js';
import { readQuery, writeQuery, pageNumber, choice } from '../url-state.js';
import { selectControl } from '../components/controls.js';
import { toast } from '../components/toast.js';
import { workflow, isWorking, startDrafts, renderDraftWatch, gmailLink, mailbox, progressRows } from '../components/company-outreach.js';

export const researchLabels = {pending:'To research',researching:'Researching',found:'Found',partial:'Partial info',not_found:'Not found',failed:'Needs retry'};
const fields={website:'Website',careers:'Careers page',hiring_manager:'Hiring contact',ceo:'CEO',cto:'CTO',location:'Location',industry:'Industry',about:'About',linkedin:'LinkedIn',size:'Company size'};
const contactFilters={all:'All companies',email:'With email',phone:'With phone',missing:'No email or phone'};
const url=value=>{try{const parsed=new URL(value);return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password?parsed.href:'';}catch{return '';}};
const date=value=>value?new Date(value*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Not researched yet';
const valuesFor=(item,key)=>(item.fields?.[key]||[]).filter(entry=>String(entry.value||'').trim());
const researchState=status=>Object.hasOwn(researchLabels,status)?status:'pending';
export const researchPill=status=>h('span',{class:`company-status company-status-${researchState(status)}`,text:researchLabels[status]||'To research'});
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
function contactDetails(item){return h('div',{},['email','phone'].map(key=>{
  const values=valuesFor(item,key),label=key==='email'?'Email':'Phone';
  return h('section',{class:'company-detail-section'},h('h3',{text:label}),values.length?values.map(entry=>h('div',{class:'company-contact-detail'},copyButton(entry.value,label),source(entry))):h('p',{class:'company-muted',text:missingContact(item)}));
}),h('section',{class:'company-detail-section'},h('h3',{text:'Linked roles'}),h('ul',{class:'company-jobs'},(item.jobs||[]).map(job=>h('li',{},url(job.url)?h('a',{href:url(job.url),target:'_blank',rel:'noopener noreferrer',text:job.title||'Open job posting'}):h('span',{text:job.title||'Job posting'}))))));}
function draftDetails(item){
  const drafts=(item.drafts||[]).filter(draft=>draft.body);
  if(!drafts.length)return h('p',{class:'company-muted',text:'No draft saved yet. Create draft in the table finds the contact and prepares your email.'});
  return h('div',{},drafts.map(draft=>h('section',{class:'company-pitch'},
    h('div',{class:'company-pitch-address'},h('span',{text:'To'}),h('strong',{text:draft.recipient})),
    h('h3',{text:draft.subject}),h('p',{class:'company-pitch-body',text:draft.body}),
    draft.resume&&(draft.download_url||draft.state==='gmail')?h('div',{class:'company-attachment'},icon('file','icon icon-sm'),h('span',{text:`Resume attached: ${draft.resume}`})):null,
    gmailLink(draft.gmail_url)?h('a',{class:'btn',href:gmailLink(draft.gmail_url),target:'_blank',rel:'noopener noreferrer',text:'Open Gmail'}):null)));
}
function companyDetails(item){return h('div',{},Object.entries(fields).map(([key,label])=>{
  const values=valuesFor(item,key);return values.length?h('section',{class:'company-detail-section'},h('h3',{text:label}),values.map(entry=>h('div',{},['website','careers','linkedin'].includes(key)&&url(entry.value)?h('a',{class:'company-fact-link',href:url(entry.value),target:'_blank',rel:'noopener noreferrer',text:entry.value}):h('p',{text:entry.value}),source(entry)))):null;
}),h('section',{class:'company-detail-section'},h('h3',{text:'Research notes'}),h('p',{class:'company-muted',text:date(item.updated_at)}),h('p',{text:item.notes||'No research notes yet.'}),h('p',{class:'company-muted',text:'Notes are AI-generated. Check the sources for individual facts.'})),item.error?h('p',{class:'company-draft-error',text:item.error}):null);}

const phaseLabels={idle:'Not drafted',queued:'Starting…',contacts:'Finding email…',writing:'Writing email…',attaching:'Attaching résumé…',saving:'Saving to Gmail…',ready:'Saved in Gmail',blocked:'Not saved',failed:'Not saved',local:'Ready to save'};
function contactCell(item,key,open){
  const values=valuesFor(item,key),label=key==='email'?'Email':'Phone';
  return h('div',{class:`company-contact-cell outreach-contact${key==='phone'?' outreach-phone':''}`},
    values.length?copyButton(values[0].value,label,true):h('span',{class:'company-contact-empty',text:'—','aria-label':`${label} not found`,title:key==='email'?'Create draft will look for a public hiring email.':'No public phone number found.'}),
    values.length>1?h('button',{type:'button',class:'company-more',text:`+${values.length-1}`,'aria-label':`${values.length-1} more ${key==='email'?'emails':'phone numbers'} for ${item.name}`,onclick:()=>open(item)}):null);
}
function companyTable(items,controls){
  const {selected,open,start,selectOne,selectPage}=controls;
  const all=h('input',{type:'checkbox','aria-label':'Select companies on this page',onchange:event=>selectPage(event.target.checked)});
  return h('div',{class:'company-table-scroll',role:'region','aria-label':'Company outreach',tabindex:'0'},
    h('table',{class:'company-table is-outreach is-automatic'},h('thead',{},h('tr',{},h('th',{scope:'col',class:'company-col-select','aria-label':'Select companies'},h('label',{class:'company-check'},all)),
      ...[['Company','identity'],['Email','email'],['Phone','phone'],['Gmail draft','action']].map(([text,key])=>h('th',{scope:'col',class:`company-col-${key}`,text})))),
      h('tbody',{},items.map(item=>{
        const state=workflow(item),working=isWorking(item),saved=(item.drafts||[]).filter(d=>d.state==='gmail'&&gmailLink(d.gmail_url));
        const finished=saved.length&&state.phase==='ready';
        const action=finished?h('a',{class:'company-create-button is-ready',href:saved.length===1?gmailLink(saved[0].gmail_url):mailbox(controls.outreach.sender),target:'_blank',rel:'noopener noreferrer',title:'Draft saved and verified in Gmail'},icon('check','icon icon-sm'),h('span',{text:'Open Gmail'})):
          h('button',{class:`company-create-button${working?' is-working':''}`,type:'button',disabled:working||controls.starting,onclick:()=>start(item)},h('span',{text:working?phaseLabels[state.phase]:'Create draft'}));
        const oldRoleIssue=['role_mismatch','missing_context','review_needed'].includes(state.issue?.code);
        const note=state.phase==='idle'?'':oldRoleIssue?'We’ll write an introduction based on your résumé.':state.message;
        const problem=['failed','blocked'].includes(state.phase);
        const status=problem?h('details',{class:'company-row-issue'},h('summary',{text:/No (verified|public) hiring email/i.test(note)?'No hiring email found':'Draft not saved'}),h('p',{text:note})):null;
        return h('tr',{dataset:{company:item.company_id,phase:state.phase}},
          h('td',{class:'company-cell-select'},h('label',{class:'company-check'},h('input',{type:'checkbox','aria-label':`Select ${item.name}`,checked:selected.has(item.company_id),disabled:working,onchange:event=>selectOne(item,event.target.checked)}))),
          h('td',{class:'company-cell-identity'},h('button',{class:'company-name',type:'button','aria-haspopup':'dialog',title:item.name,onclick:()=>open(item)},h('span',{text:item.name}))),
          h('td',{class:'company-cell-email'},contactCell(item,'email',open)),
          h('td',{class:'company-cell-phone'},contactCell(item,'phone',open)),
          h('td',{class:'company-cell-action'},h('div',{class:'company-row-action','aria-live':'polite'},action,status)));
      }))));
}

export function renderCompanies(id=''){
  const query=readQuery(),watch=(query.get('watch')||'').split(',').filter(Boolean),since=Number(query.get('since'));
  if(watch.length&&watch.length<=50&&watch.every(value=>/^[a-f0-9]{24}$/.test(value))&&Number.isFinite(since)&&since>0)return renderDraftWatch(watch,since,query.get('run')||'');
  const filters={q:query.get('q')||'',status:choice(query.get('status'),['all',...Object.keys(researchLabels)],'all'),contact:choice(query.get('contact'),Object.keys(contactFilters),'all'),page:pageNumber(query.get('page')),size:choice(Number(query.get('size')),[20,50,100],20)};
  const scope=accountRequestSignal(),selected=new Map();
  let data=null,timer,ticket=0,lastTable='',drawer=null,starting=false,activeIds=[],activeSince=0,activeRun='',progressTimer,reviewOpened=false;
  const body=h('div',{class:'company-body'},loadingState('Loading companies…')),footer=h('div',{class:'company-footer'}),count=h('span',{class:'company-total',role:'status'}),selectionBar=h('div',{class:'company-selection-bar'});
  const title=h('h1',{text:'Companies'}),connection=h('a',{class:'company-connection',href:'#/connections',text:'Checking Gmail…'}),resumeLabel=h('span',{class:'outreach-resume'});
  const runPanel=h('section',{class:'outreach-run-panel',hidden:true,'aria-label':'Current draft workflow'});
  const refresh=h('button',{class:'company-icon-button',type:'button','aria-label':'Refresh companies',onclick:()=>load()},icon('refresh','icon icon-sm'));
  function selectOne(item,checked){if(checked&&selected.size>=50&&!selected.has(item.company_id))toast('Select up to 50 companies per run.','info');else if(checked)selected.set(item.company_id,item);else selected.delete(item.company_id);updateSelection();}
  function selectPage(checked){for(const item of data.rows){if(!checked)selected.delete(item.company_id);else if(selected.size<50&&!isWorking(item))selected.set(item.company_id,item);}updateSelection();}
  function updateSelection(){
    body.querySelectorAll('tbody tr').forEach(row=>{const checked=selected.has(row.dataset.company);row.classList.toggle('is-selected',checked);row.querySelector('input[type=checkbox]').checked=checked;});
    const all=body.querySelector('thead input'),eligible=(data?.rows||[]).filter(item=>!isWorking(item)),amount=eligible.filter(item=>selected.has(item.company_id)).length;
    if(all){all.checked=!!eligible.length&&amount===eligible.length;all.indeterminate=amount>0&&amount<eligible.length;all.disabled=!eligible.length;}
    selectionBar.hidden=!selected.size;
    selectionBar.replaceChildren(h('strong',{text:`${selected.size} selected`}),h('div',{class:'company-selection-controls'},
      h('button',{class:'company-text-button',type:'button',text:'Clear selection',onclick:()=>{selected.clear();updateSelection();}}),
        h('button',{class:'company-create-button is-primary',type:'button',text:starting?'Starting…':`Create Gmail drafts (${selected.size})`,disabled:!selected.size||starting||!!activeIds.length||data?.outreach?.running,onclick:()=>begin([...selected.values()])})));
  }
  async function begin(items){
    if(starting)return;
    starting=true;lastTable='';renderTable();updateSelection();
    try{await startDrafts(items,data?.outreach,(result,ids,since)=>{
      activeIds=ids;activeSince=since;activeRun=result.id||'';selected.clear();closeDrawer(false);lastTable='';
      const queued={phase:'queued',message:'Finding the contact and preparing your email.',updated_at:since,started_at:since,run_id:activeRun};
      data.rows=data.rows.map(item=>ids.includes(item.company_id)?{...item,workflow:queued}:item);
      renderTable();refreshProgress();
    });}finally{starting=false;lastTable='';renderTable();updateSelection();}
  }
  function closeDrawer(restore=true){if(drawer){drawer._restore=restore;drawer.close();}}
  function openDrawer(item){
    closeDrawer(false);const previous=document.activeElement;
    const element=h('dialog',{class:'company-drawer','aria-labelledby':'company-drawer-name'});drawer=element;element._restore=true;
    const close=h('button',{class:'company-icon-button',type:'button','aria-label':'Close company details',onclick:()=>element.close()},icon('x','icon icon-sm'));
    const state=workflow(item);
    element.append(h('div',{class:'company-drawer-heading'},h('h2',{id:'company-drawer-name',text:item.name}),close),
      h('div',{class:'company-drawer-content'},['failed','blocked'].includes(state.phase)?h('section',{class:'company-detail-section company-draft-problem'},h('h3',{text:'Draft not saved'}),h('p',{text:state.message})):null,contactDetails(item),h('section',{class:'company-detail-section'},h('h3',{text:'Email draft'}),draftDetails(item)),
        h('details',{class:'company-detail-section'},h('summary',{text:'Company information & sources'}),companyDetails(item))));
    document.body.append(element);
    const escape=event=>{if(event.key==='Escape'&&!document.getElementById('confirm')?.open){event.preventDefault();element.close();}};
    document.addEventListener('keydown',escape);
    element.onclose=()=>{document.removeEventListener('keydown',escape);element.remove();if(drawer===element)drawer=null;if(element._restore&&!scope.aborted&&previous?.isConnected)previous.focus({preventScroll:true});};
    if(innerWidth<=700)element.showModal();else element.show();close.focus({preventScroll:true});
  }
  function renderTable(){
    if(!data)return;
    const stamp=JSON.stringify([data.rows,data.page,data.total,starting,activeIds.length,data.outreach?.running]);if(stamp===lastTable)return;lastTable=stamp;
    const scrollTop=body.querySelector('.company-table-scroll')?.scrollTop||0;
    const focused=body.contains(document.activeElement)?document.activeElement?.getAttribute('aria-label'):null;
    const expanded=new Set([...body.querySelectorAll('tr:has(.company-row-issue[open])')].map(row=>row.dataset.company));
    body.replaceChildren(data.rows.length?companyTable(data.rows,{selected,starting:starting||!!activeIds.length||data.outreach?.running,open:openDrawer,start:item=>begin([item]),selectOne,selectPage,outreach:data.outreach||{}}):empty('No companies match these filters.',h('button',{class:'btn',text:'Clear filters',onclick:clearFilters})));
    const scroll=body.querySelector('.company-table-scroll');if(scroll)scroll.scrollTop=scrollTop;
    body.querySelectorAll('tr').forEach(row=>{if(expanded.has(row.dataset.company))row.querySelector('.company-row-issue')?.setAttribute('open','');});
    if(focused)body.querySelector(`[aria-label="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
    footer.replaceChildren(...(data.rows.length&&!id?[pagination({...data,label:'Companies',sizes:[20,50,100],onPage:async page=>{filters.page=page;await load();footer.querySelector('[aria-current=page]')?.focus({preventScroll:true});},onSize:async size=>{filters.size=size;filters.page=1;await load();footer.querySelector('[role=combobox]')?.focus({preventScroll:true});}})]:[]));
    updateSelection();
  }
  async function refreshProgress(){
    clearTimeout(progressTimer);if(scope.aborted||!body.isConnected||!activeIds.length)return;
    try{
      const snapshot=await api('/api/companies?'+new URLSearchParams({ids:activeIds.join(','),size:100,...(activeRun?{run:activeRun}:{})}),undefined,{fresh:true});
      if(scope.aborted)return;
      snapshot.rows=progressRows(snapshot,activeIds,activeSince);
      const done=snapshot.rows.filter(item=>workflow(item).phase==='ready').length,failed=snapshot.rows.filter(item=>['failed','blocked'].includes(workflow(item).phase)).length;
      runPanel.hidden=false;runPanel.replaceChildren(h('p',{role:'status',text:done+failed===activeIds.length?`${done} ${done===1?'company':'companies'} saved to Gmail${failed?` · ${failed} could not be completed`:''}.`:`Creating your Gmail drafts… ${done} of ${activeIds.length} companies saved.`}));
      if(data){data.rows=data.rows.map(item=>snapshot.rows.find(next=>next.company_id===item.company_id)||item);if(!drawer)renderTable();}
      if(snapshot.rows.length===activeIds.length&&snapshot.rows.every(item=>['ready','failed','blocked'].includes(workflow(item).phase))){activeIds=[];data.outreach=snapshot.outreach;lastTable='';renderTable();return;}
    }catch(error){if(scope.aborted)return;runPanel.hidden=false;runPanel.querySelector('.outreach-progress-error')?.remove();runPanel.append(h('p',{class:'outreach-progress-error',role:'alert',text:error.message+' Progress will retry automatically.'}));}
    progressTimer=setTimeout(refreshProgress,2000);
  }
  const search=h('input',{type:'search',value:filters.q,'aria-label':'Search companies',placeholder:'Search companies',oninput:event=>{filters.q=event.target.value;filters.page=1;clearTimeout(timer);timer=setTimeout(load,250);}});
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
      if(data.outreach?.running&&!activeIds.length){runPanel.hidden=false;runPanel.replaceChildren(h('p',{role:'status',text:'Drafts are being prepared. Status updates automatically.'}));}
      else if(!activeIds.length&&!activeRun){runPanel.hidden=true;runPanel.replaceChildren();}
      count.textContent=`${data.total.toLocaleString()} ${data.total===1?'company':'companies'}`;
      const connected=data.outreach?.gmail_configured;
      connection.textContent=connected?`Gmail · ${data.outreach.sender}`:'Connect Google / Gmail';connection.classList.toggle('is-connected',!!connected);
      resumeLabel.textContent=data.outreach?.resume_ready?`Résumé: ${data.outreach.resume_name}`:'Add your PDF résumé in My profile & files';
      if(id)title.textContent=data.rows[0]?.name||'Company not found';
      contactSelect.setOptions(Object.entries(contactFilters).map(([value,label])=>({value,label:label+(data.contact_counts?' ('+data.contact_counts[value]+')':'')})));
      const labels=[filters.q?`Search: ${filters.q}`:null,filters.contact!=='all'?contactFilters[filters.contact]:null,filters.status!=='all'?researchLabels[filters.status]:null].filter(Boolean);
      filterButton.classList.toggle('is-active',filters.contact!=='all'||filters.status!=='all');
      applied.hidden=!labels.length;applied.replaceChildren(...labels.map(text=>h('span',{text})),h('button',{class:'company-text-button',text:'Clear filters',onclick:clearFilters}));
      renderTable();updateSelection();if(id&&query.get('review')==='1'&&!reviewOpened&&data.rows[0]){reviewOpened=true;openDrawer(data.rows[0],'drafts');}if(!id)writeQuery('companies',filters,{replace:true});
    }catch(error){if(!scope.aborted&&request===ticket){lastTable='';body.replaceChildren(errorState(error.message,load));footer.replaceChildren();}}
    finally{if(request===ticket){refresh.disabled=false;body.setAttribute('aria-busy','false');poll();}}
  }
  scope.addEventListener('abort',()=>{clearTimeout(timer);clearTimeout(progressTimer);closeDrawer(false);},{once:true});
  const routeChanged=()=>{if(!body.isConnected){clearTimeout(timer);clearTimeout(progressTimer);closeDrawer(false);window.removeEventListener('hashchange',routeChanged);}};
  window.addEventListener('hashchange',routeChanged);
  load();
  return h('div',{class:'page companies-page companies-sheet companies-outreach companies-automatic'},id?h('a',{class:'company-back',href:'#/companies?'+new URLSearchParams(filters),text:'← All companies'}):null,
    h('section',{class:'company-workspace','aria-label':'Company directory'},
      h('header',{class:'company-directory-header'},h('div',{class:'company-page-title'},title,count),h('div',{class:'company-table-tools'},h('div',{class:'company-search'},icon('search','icon icon-sm'),search),filterButton,filterPopover,refresh)),
      h('p',{class:'company-workspace-hint',text:'Create draft finds the contact, writes your pitch, and attaches your résumé.'}),
      selectionBar,applied,runPanel,body,footer,
      h('div',{class:'company-account-strip'},h('div',{class:'company-account-info'},connection,resumeLabel),h('span',{class:'company-account-note',text:'Drafts only. You review and send.'}))));
}
