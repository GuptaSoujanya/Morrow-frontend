import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api, accountRequestSignal } from '../api.js';
import { loadingState, errorState, empty } from '../components/panel.js';
import { pagination } from '../components/pagination.js';
import { quickButton } from '../forms.js';
import { readQuery, writeQuery, pageNumber, choice } from '../url-state.js';
import { selectControl } from '../components/controls.js';
import { confirmDialog } from '../components/dialog.js';
import { toast } from '../components/toast.js';

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
function draftButton(item, options={}) {
  return quickButton('company_outreach', item ? (item.drafts?.length ? 'Continue drafts' : 'Find & draft') : 'Find emails & draft',
    item ? {company:item.company_id,limit:1} : options,
    {confirm:{title:item ? `Prepare drafts for ${item.name}?` : 'Find contacts and prepare drafts?',
      body:item ? 'Find public hiring emails and save one job pitch per recipient with your resume attached. Existing drafts are reused. No emails are sent.'
        : `Process ${options.all ? 'all remaining companies' : 'up to '+(options.limit || 10)+' companies'}. Search public sources for hiring emails, write a pitch from your resume and save drafts. This can take time and uses your AI account. Gmail sync requires a connected account. No emails are sent.`,ok:'Prepare drafts'}});
}
async function connectGmail(outreach, reload) {
  const scope=accountRequestSignal();
  const sender=h('input',{class:'input',type:'email',value:outreach.sender || '',autocomplete:'email','aria-label':'Gmail address'});
  const password=h('input',{class:'input',type:'password',autocomplete:'new-password','aria-label':'Google app password',placeholder:'16-letter app password'});
  const accepted=await confirmDialog({title:'Connect Gmail Drafts',ok:'Connect Gmail',body:'Save your pitches and attached resume directly in Gmail Drafts. You review and send them yourself.',
    content:h('div',{class:'company-gmail-form'},h('label',{},'Gmail address',sender),h('label',{},'Google app password',password),
      h('a',{href:'https://myaccount.google.com/apppasswords',target:'_blank',rel:'noopener noreferrer',text:'Create a Google app password'}),
      h('p',{class:'small muted',text:'Use an app password, not your normal Google password. It is stored privately on this computer. Google requires 2-Step Verification.'}))});
  const secret=password.value;password.value='';
  if(!accepted || scope.aborted)return;
  try { await api('/api/company-outreach/gmail',{sender:sender.value,password:secret},{scope});toast('Gmail Drafts connected.','success');reload(); }
  catch(error) { if(error.name!=='AbortError')toast(error.message,'error'); }
}
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
function draftDetails(item){
  if(!item.drafts?.length)return h('div',{class:'company-draft-empty'},icon('file'),h('h3',{text:'Your pitch starts here'}),h('p',{text:'Find a public hiring email, then prepare an introduction using your résumé and the linked role.'}),h('p',{class:'company-muted',text:'Review the draft before sending it yourself.'}),draftButton(item));
  return h('div',{},item.drafts.map(draft=>h('section',{class:'company-pitch'},
    h('div',{class:'company-pitch-address'},h('span',{text:'To'}),h('strong',{text:draft.recipient})),
    h('span',{class:`company-draft-state is-${draft.state}`,text:draftLabels[draft.state]||draft.state}),
    h('h3',{text:draft.subject||'Preparing your pitch'}),h('p',{class:'company-pitch-body',text:draft.body||draft.error||'The pitch is being prepared.'}),
    draft.resume?h('div',{class:'company-attachment'},icon('file','icon icon-sm'),h('span',{text:`Resume attached: ${draft.resume}`})):null,
    draft.error?h('p',{class:'company-draft-error',text:draft.error}):null,
    h('div',{class:'company-actions'},draft.download_url?.startsWith('/reports/')?h('a',{class:'btn',href:draft.download_url,download:'',text:'Download email + resume'}):null,
      url(draft.gmail_url)&&new URL(draft.gmail_url).hostname==='mail.google.com'?h('a',{class:'btn',href:draft.gmail_url,target:'_blank',rel:'noopener noreferrer',text:'Open Gmail draft'}):null))),draftButton(item));
}
function companyDetails(item){return h('div',{},Object.entries(fields).map(([key,label])=>{
  const values=valuesFor(item,key);return values.length?h('section',{class:'company-detail-section'},h('h3',{text:label}),values.map(entry=>h('div',{},['website','careers','linkedin'].includes(key)&&url(entry.value)?h('a',{class:'company-fact-link',href:url(entry.value),target:'_blank',rel:'noopener noreferrer',text:entry.value}):h('p',{text:entry.value}),source(entry)))):null;
}),h('section',{class:'company-detail-section'},h('h3',{text:'Research notes'}),h('p',{class:'company-muted',text:date(item.updated_at)}),h('p',{text:item.notes||'No research notes yet.'}),h('p',{class:'company-muted',text:'Notes are AI-generated. Check the sources for individual facts.'})),item.error?h('p',{class:'company-draft-error',text:item.error}):null);}
function contactCell(item,key,open){
  const values=valuesFor(item,key);
  return h('td',{class:`company-cell-${key}`},h('div',{class:'company-contact-cell'},values.length?copyButton(values[0].value,key==='email'?'Email':'Phone',true):h('span',{class:'company-cell-missing',text:missingContact(item)}),
    values.length>1?h('button',{class:'company-more',type:'button',text:`+${values.length-1}`,title:`Show all ${key==='email'?'emails':'phone numbers'}`,'aria-label':`${values.length-1} more ${key==='email'?'emails':'phone numbers'} for ${item.name}`,onclick:()=>open(item,'contacts')}):null));
}
function companyTable(items,view,open,selection){
  const headings=view==='contacts'?[['Company','identity'],['Email','email'],['Phone','phone'],['Research','research'],['Details','open']]
    :[['Company','identity'],['Role','role'],['Draft status','draft'],['Action','action']];
  return h('div',{class:'company-table-scroll',role:'region','aria-label':view==='contacts'?'Company contacts':'Company email drafts',tabindex:'0'},
    h('table',{class:`company-table is-${view}`},h('thead',{},h('tr',{},h('th',{scope:'col',class:'company-col-select','aria-label':'Select companies'},h('label',{class:'company-check'},h('input',{type:'checkbox','aria-label':'Select companies on this page',onchange:event=>selection.page(event.target.checked)}))),headings.map(([name,key])=>h('th',{scope:'col',class:`company-col-${key}`,text:name})))),
      h('tbody',{},items.map(item=>h('tr',{dataset:{company:item.company_id}},
        h('td',{class:'company-cell-select'},h('label',{class:'company-check'},h('input',{type:'checkbox','aria-label':`Select ${item.name}`,checked:selection.selected.has(item.company_id),onchange:event=>selection.one(item,event.target.checked)}))),
        h('td',{class:'company-cell-identity'},h('button',{class:'company-name',type:'button',title:item.name,'aria-haspopup':'dialog',onclick:()=>open(item,view)},h('span',{text:item.name})),
          h('small',{text:valuesFor(item,'location')[0]?.value||`${item.job_count} linked ${item.job_count===1?'job':'jobs'}`})),
        ...(view==='contacts'?[contactCell(item,'email',open),contactCell(item,'phone',open),h('td',{class:'company-cell-research'},researchPill(item.status)),
          h('td',{class:'company-cell-open'},h('button',{class:'company-icon-button',type:'button','aria-label':`View details for ${item.name}`,onclick:()=>open(item,'contacts')},icon('chevron-right','icon icon-sm')))]
          :[h('td',{class:'company-cell-role'},h('span',{text:bestRole(item)})),h('td',{class:'company-cell-draft'},draftStatus(item),item.drafts?.length?h('small',{text:`${item.drafts.length} ${item.drafts.length===1?'draft':'drafts'}`}):null),
            h('td',{class:'company-cell-action'},h('button',{class:'company-text-button',type:'button',text:item.drafts?.length?'Review draft':'Prepare draft',onclick:()=>open(item,'drafts')}))]))))));
}

export function renderCompanies(id=''){
  const query=readQuery();
  const filters={q:query.get('q')||'',status:choice(query.get('status'),['all',...Object.keys(researchLabels)],'all'),contact:choice(query.get('contact'),Object.keys(contactFilters),'all'),page:pageNumber(query.get('page')),size:choice(Number(query.get('size')),[20,50,100],20)};
  let view=choice(query.get('view'),['contacts','drafts'],'contacts'),data=null,ticket=0,timer,lastTable='',drawer=null;
  const scope=accountRequestSignal(),selected=new Map();
  const selectionBar=h('div',{class:'company-selection-bar'});
  const companyHref=item=>`#/companies/${item.company_id}?${new URLSearchParams({...filters,view})}`;
  const body=h('div',{class:'company-body'},loadingState('Loading companies…'));
  const footer=h('div',{class:'company-footer'}),count=h('span',{class:'company-total',role:'status'}),connection=h('button',{class:'company-connection',type:'button','aria-label':'Connect Gmail',onclick:()=>{if(data?.outreach?.gmail_method==='browser')location.hash='#/connections';else connectGmail(data?.outreach||{},load);}});
  const title=h('h1',{text:'Companies'});
  const refresh=h('button',{class:'company-icon-button',type:'button','aria-label':'Refresh companies',title:'Refresh companies',onclick:()=>load()},icon('refresh','icon icon-sm'));
  const batch=selectControl({label:'Companies per run',value:'10',options:[{value:'10',label:'10'},{value:'50',label:'50'},{value:'all',label:'All'}],onChange:()=>renderActions()});
  const primary=h('div',{class:'company-primary-action'});
  function renderActions(){const button=draftButton(null,batch.value==='all'?{all:true}:{limit:Number(batch.value)});button.classList.add('company-primary');primary.replaceChildren(button,batch);}
  function selectOne(item,checked){
    if(checked&&selected.size>=50&&!selected.has(item.company_id))toast('Select up to 50 companies per draft run.','info');
    else if(checked)selected.set(item.company_id,item.name);else selected.delete(item.company_id);
    updateSelection();
  }
  function selectPage(checked){
    if(!checked)data.rows.forEach(item=>selected.delete(item.company_id));
    else for(const item of data.rows){if(selected.size>=50&&!selected.has(item.company_id)){toast('Selected up to 50 companies for this run.','info');break;}selected.set(item.company_id,item.name);}
    updateSelection();
  }
  function updateSelection(){
    const amount=selected.size,ready=!!data?.outreach?.gmail_configured;
    body.querySelectorAll('tbody tr').forEach(row=>{const checked=selected.has(row.dataset.company);row.classList.toggle('is-selected',checked);const input=row.querySelector('input[type=checkbox]');if(input)input.checked=checked;});
    const all=body.querySelector('thead input[type=checkbox]'),visible=data?.rows||[],checked=visible.filter(row=>selected.has(row.company_id)).length;
    if(all){all.checked=!!visible.length&&checked===visible.length;all.indeterminate=checked>0&&checked<visible.length;}
    const action=ready?quickButton('company_outreach',`Draft selected (${amount})`,{companies:[...selected.keys()],require_gmail:true},{tone:'primary',onStarted:()=>{selected.clear();setView('drafts');updateSelection();load();},confirm:{title:`Save drafts for ${amount} selected ${amount===1?'company':'companies'}?`,body:`${[...selected.values()].join(', ')}. Find verified hiring emails, write a separate pitch with your résumé for each recipient, and save it in ${data.outreach.sender}'s Gmail Drafts. Existing drafts are reused. Companies without a verified hiring email are reported. No emails are sent.`,ok:'Save to Gmail Drafts'}})
      :h('button',{class:'btn btn-primary',type:'button',text:`Draft selected (${amount})`,onclick:()=>{if(data?.outreach?.gmail_method==='browser')location.hash='#/connections';else connectGmail(data?.outreach||{},load);}});
    // The disabled wrapper also guards against the shared runner re-enabling a zero-selection button.
    const gate=h('fieldset',{class:'company-selection-action',disabled:!amount},action);
    selectionBar.replaceChildren(h('div',{class:'company-selection-summary'},h('strong',{text:amount?`${amount} selected`:'Select companies to draft emails'}),h('span',{text:amount?(ready?`Save to Gmail Drafts · ${data.outreach.sender}`:'Connect Gmail to save these drafts'):'Choose rows, then save a pitch and résumé to Gmail Drafts.'})),h('div',{class:'company-selection-controls'},amount?h('button',{class:'company-text-button',type:'button',text:'Clear selection',onclick:()=>{selected.clear();updateSelection();}}):null,gate));
  }
  function closeDrawer(restore=true){if(!drawer)return;drawer._restore=restore;drawer.close();}
  function openDrawer(item,tab='contacts'){
    closeDrawer(false);const previous=document.activeElement;
    const element=h('dialog',{class:'company-drawer','aria-labelledby':'company-drawer-name'});drawer=element;drawer._restore=true;
    const content=h('div',{class:'company-drawer-content'}),tabs=h('div',{class:'company-drawer-tabs',role:'group','aria-label':'Company detail view'});
    function select(selected){const restore=tabs.contains(document.activeElement);tab=selected;tabs.replaceChildren(...[['contacts','Contacts'],['drafts','Drafts'],['company','Company']].map(([key,label])=>h('button',{class:'company-view-button',type:'button','aria-pressed':key===tab,text:label,onclick:()=>select(key)})));content.replaceChildren(tab==='contacts'?contactDetails(item):tab==='drafts'?draftDetails(item):companyDetails(item));if(restore)tabs.querySelector('[aria-pressed=true]').focus({preventScroll:true});}
    const close=h('button',{class:'company-icon-button',type:'button','aria-label':'Close company details',onclick:()=>element.close()},icon('x','icon icon-sm'));
    element.append(h('div',{class:'company-drawer-heading'},h('div',{},h('p',{text:'COMPANY DETAILS'}),h('h2',{id:'company-drawer-name',text:item.name}),researchPill(item.status)),close),tabs,content,
      h('div',{class:'company-drawer-footer'},h('a',{href:companyHref(item),text:'Open company page',onclick:()=>closeDrawer(false)}),runButton(item)));
    select(tab);document.body.append(element);
    const escape=event=>{if(event.key==='Escape'&&element.open&&!document.getElementById('confirm')?.open){event.preventDefault();element.close();}};
    document.addEventListener('keydown',escape);
    element.onclose=()=>{document.removeEventListener('keydown',escape);element.remove();if(drawer===element)drawer=null;if(element._restore&&!scope.aborted&&previous?.isConnected)previous.focus({preventScroll:true});};
    if(innerWidth<=700)element.showModal();else element.show();close.focus({preventScroll:true});
  }
  const abort=()=>{clearTimeout(timer);closeDrawer(false);};scope.addEventListener('abort',abort,{once:true});
  const routeChanged=()=>{if(!body.isConnected){abort();window.removeEventListener('hashchange',routeChanged);scope.removeEventListener('abort',abort);}};
  window.addEventListener('hashchange',routeChanged);
  function poll(){timer=setTimeout(()=>{if(!body.isConnected){routeChanged();return;}if(document.hidden||drawer||selectionBar.contains(document.activeElement)||body.contains(document.activeElement)||document.querySelector('dialog[open],:popover-open')||getSelection()?.toString())poll();else load();},5000);}
  function syncQuery(){if(!id)writeQuery('companies',{...filters,view},{replace:true});}
  function renderTable(){
    if(!data)return;
    const stamp=JSON.stringify([data.rows,data.page,data.total,view]);
    if(stamp===lastTable)return;lastTable=stamp;
    const positions={top:body.querySelector('.company-table-scroll')?.scrollTop||0,left:body.querySelector('.company-table-scroll')?.scrollLeft||0};
    body.replaceChildren(data.rows.length?companyTable(data.rows,view,openDrawer,{selected,one:selectOne,page:selectPage}):empty(Object.values(data.counts).some(Boolean)?'No companies match these filters.':'Companies will appear here when your bots discover jobs.',h('button',{class:'btn',type:'button',text:'Clear filters',onclick:clearFilters})));
    updateSelection();
    const scroll=body.querySelector('.company-table-scroll');if(scroll){scroll.scrollTop=positions.top;scroll.scrollLeft=positions.left;}
    footer.replaceChildren(...(data.rows.length&&!id?[pagination({...data,label:'Companies',sizes:[20,50,100],onPage:async page=>{filters.page=page;await load();footer.querySelector('[aria-current=page]')?.focus({preventScroll:true});},onSize:async size=>{filters.size=size;filters.page=1;await load();footer.querySelector('[role=combobox]')?.focus({preventScroll:true});}})]:[]));
  }
  function setView(next){view=next;viewButtons.forEach((button,key)=>button.setAttribute('aria-pressed',String(key===view)));renderTable();syncQuery();}
  const viewButtons=new Map(['contacts','drafts'].map(key=>[key,h('button',{class:'company-view-button',type:'button','aria-pressed':key===view,text:key==='contacts'?'Contacts':'Drafts',onclick:()=>setView(key)})]));
  const search=h('input',{type:'search',value:filters.q,'aria-label':'Search companies',placeholder:'Search companies or contacts',oninput:event=>{filters.q=event.target.value;filters.page=1;clearTimeout(timer);timer=setTimeout(()=>{if(search.isConnected)load();},250);}});
  const statusSelect=selectControl({label:'Research status',options:[{value:'all',label:'All research states'},...Object.entries(researchLabels).map(([value,label])=>({value,label}))],value:filters.status,onChange:value=>{filters.status=value;filters.page=1;load();}});
  const contactSelect=selectControl({label:'Contact availability',options:Object.entries(contactFilters).map(([value,label])=>({value,label})),value:filters.contact,onChange:value=>{filters.contact=value;filters.page=1;load();}});
  const filterButton=h('button',{class:'company-filter-button',type:'button','aria-expanded':'false','aria-haspopup':'dialog',onclick:()=>{if(filterPopover.matches(':popover-open'))filterPopover.hidePopover();else{filterPopover.showPopover();const rect=filterButton.getBoundingClientRect();Object.assign(filterPopover.style,{top:`${rect.bottom+8}px`,left:`${Math.max(12,Math.min(rect.right-300,innerWidth-312))}px`});}}},icon('sliders','icon icon-sm'),h('span',{text:'Filters'}));
  const filterPopover=h('div',{class:'company-filter-popover',popover:'auto',role:'dialog','aria-label':'Company filters'},h('h2',{text:'Filter companies'}),h('div',{class:'company-filter-field'},h('span',{text:'Contact information'}),contactSelect),h('div',{class:'company-filter-field'},h('span',{text:'Research status'}),statusSelect),h('div',{class:'company-filter-footer'},h('button',{class:'company-text-button',type:'button',text:'Reset filters',onclick:clearFilters}),h('button',{class:'btn',type:'button',text:'Done',onclick:()=>{filterPopover.hidePopover();filterButton.focus();}})));
  filterPopover.addEventListener('toggle',event=>filterButton.setAttribute('aria-expanded',String(event.newState==='open')));
  const applied=h('div',{class:'company-applied-filters',hidden:true});
  function updateApplied(){
    const active=[filters.contact!=='all'?contactFilters[filters.contact]:null,filters.status!=='all'?researchLabels[filters.status]:null,filters.q?`Search: ${filters.q}`:null].filter(Boolean);
    applied.hidden=!active.length;
    applied.replaceChildren(...active.map(label=>h('span',{text:label})),h('button',{class:'company-text-button',type:'button',text:'Clear filters',onclick:clearFilters}));
    filterButton.classList.toggle('is-active',filters.contact!=='all'||filters.status!=='all');
  }
  function clearFilters(){filters.q='';filters.status='all';filters.contact='all';filters.page=1;search.value='';statusSelect.value='all';contactSelect.value='all';load();}
  async function load(){
    clearTimeout(timer);const request=++ticket;refresh.disabled=true;body.setAttribute('aria-busy','true');
    try{
      const result=await api('/api/companies?'+new URLSearchParams(id?{id}:filters),undefined,{fresh:true});
      if(request!==ticket)return;data=result;
      count.textContent=`${data.total.toLocaleString()} ${data.total===1?'company':'companies'}`;
      const connected=!!data.outreach?.gmail_configured;
      connection.classList.toggle('is-connected',connected);connection.textContent=connected?(data.outreach.gmail_method==='browser'?'Google session ready':'Gmail connected'):'Connect Gmail';connection.setAttribute('aria-label',connected?'Change Gmail account':'Connect Gmail');connection.title=connected?data.outreach.sender:'Save pitches and attached resumes directly in Gmail Drafts';
      contactSelect.setOptions(Object.entries(contactFilters).map(([value,label])=>({value,label:`${label}${data.contact_counts?' ('+data.contact_counts[value]+')':''}`})));
      if(id){title.textContent=data.rows[0]?.name||'Company not found';}
      filters.page=data.page;updateApplied();renderTable();updateSelection();syncQuery();
    }catch(error){if(request===ticket&&error.name!=='AbortError'){lastTable='';body.replaceChildren(errorState(error.message,load));footer.replaceChildren();}}
    finally{if(request===ticket){refresh.disabled=false;body.setAttribute('aria-busy','false');poll();}}
  }
  renderActions();load();
  return h('div',{class:'page companies-page companies-sheet'},
    id?h('a',{class:'company-back',href:'#/companies?'+new URLSearchParams({...filters,view}),text:'← All companies'}):null,
    h('header',{class:'company-page-heading'},h('div',{class:'company-page-title'},title,count),h('div',{class:'company-heading-actions'},connection,primary)),
    h('section',{class:'company-workspace','aria-label':'Company directory'},
      h('div',{class:'company-table-toolbar'},h('div',{class:'company-views',role:'group','aria-label':'Table view'},...viewButtons.values()),
        h('div',{class:'company-table-tools'},h('div',{class:'company-search'},icon('search','icon icon-sm'),search),filterButton,filterPopover,refresh)),
      selectionBar,applied,body,footer),
    h('p',{class:'company-page-note',text:'Public contact details, with sources. Email pitches stay as drafts until you send them.'}));
}
