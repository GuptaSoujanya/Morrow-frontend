import { h } from '../dom.js';
import { icon } from '../icons.js';
import { S, hooks } from '../state.js';
import { api, accountRequestSignal } from '../api.js';
import { navigate } from '../router.js';
import { quickButton } from '../forms.js';
import { setConsoleSize } from '../components/console.js';
import { num } from '../format.js';
import {avatar} from '../components/identity.js';
import {crewRunSpec} from '../crew-options.js';
import {launchCrew} from '../crew-launch.js';
import { applicationAgentPanel } from '../components/application-agent.js';
import { crewSettings } from '../components/crew-settings.js';
import { toast } from '../components/toast.js';

export const BOTS = [
  { id:'naukri', name:'Naukri', mark:'n', color:'blue', group:'applications', description:'Find, rank and apply to matching roles.', route:'naukri', action:'naukri' },
  { id:'hirist', name:'Hirist', mark:'h', color:'teal', group:'applications', description:'Discover your next role in technology.', route:'boards', action:'boards' },
  { id:'instahyre', name:'Instahyre', mark:'i', color:'violet', group:'applications', description:'Connect with companies that fit you.', route:'boards', action:'boards' },
  { id:'cutshort', name:'Cutshort', mark:'c', color:'coral', group:'applications', description:'Explore opportunities at growing teams.', route:'boards', action:'boards' },
  { id:'wellfound', name:'Wellfound', mark:'w', color:'slate', group:'applications', description:'Find your place in the startup world.', route:'boards', action:'boards' },
  { id:'startups', name:'Startups', mark:'yc', color:'coral', group:'applications', description:'Apply to YC and Hacker News startup jobs open to India.', route:'bots', action:'startups' },
  { id:'external', name:'Company sites', icon:'globe', color:'indigo', group:'applications', description:'Finish applications on company websites.', route:'sites' },
  { id:'profile', name:'Naukri profile', icon:'person', color:'blue', group:'profiles', description:'Keep your Naukri profile and resume fresh.', route:'profile', action:'profile' },
  { id:'linkedin', name:'LinkedIn writer', mark:'in', color:'blue', group:'career', description:'Draft, review and publish your next post.', route:'linkedin', action:'linkedin' },
  { id:'linkedin_profile', name:'LinkedIn profile', icon:'person', color:'slate', group:'profiles', description:'Review and update your profile from saved facts.', route:'linkedin-profile', action:'linkedin_profile' },
  { id:'cold_email', name:'Recruiter drafts', icon:'send', color:'teal', group:'career', description:'Prepare recruiter emails for your review. Drafts only.', route:'outreach', action:'cold_email' },
  { id:'resume', name:'Resume tailor', icon:'file', color:'coral', group:'career', description:'Shape your resume around a specific role.', route:'resume' },
  { id:'learn', name:'Learning assistant', icon:'book', color:'teal', group:'career', description:'Prepare your daily learning material.', route:'pipeline', action:'pipeline', pipeline:'learn' },
  { id:'brief', name:'Daily briefing', icon:'sun', color:'violet', group:'career', description:'Research papers, technology, companies and useful repositories.', route:'pipeline', action:'pipeline', pipeline:'brief' },
  { id:'research', name:'Resume researcher', icon:'search', color:'indigo', group:'career', description:'Research the skills behind your experience.', route:'pipeline', action:'pipeline', pipeline:'research:resume' },
  { id:'company_research', name:'Company researcher', icon:'globe', color:'teal', group:'career', description:'Find public company details, contacts and careers pages, with sources.', route:'companies', action:'company_research', image:23 },
  { id:'company_outreach', name:'Company email drafts', icon:'send', color:'teal', group:'career', description:'Find public hiring emails and prepare your job pitch with a resume. Drafts only.', route:'companies', action:'company_outreach', image:9 },
  ...['hirist','instahyre','cutshort','wellfound'].map((board,i)=>({id:board+'_profile',board,name:({hirist:'Hirist',instahyre:'Instahyre',cutshort:'Cutshort',wellfound:'Wellfound'})[board]+' profile',group:'profiles',description:'Create or refresh your profile using your saved facts and resume.',route:'boards',action:'boards',mode:'profile',image:16+i})),
];
let loading = null;
export async function refreshBots() {
  const scope = accountRequestSignal();
  if (scope.aborted || loading?.scope === scope) return;
  const request = { scope };
  loading = request;
  try {
    const data = await api('/api/bots',undefined,{fresh:true});
    if (scope.aborted) return;
    const changed = JSON.stringify(data.bots) !== JSON.stringify(S.bots?.data?.bots) || S.bots?.error;
    S.bots = { data, at:Date.now() };
    if (changed && ['overview','bots'].includes(S.route.name) && (!document.getElementById('content').contains(document.activeElement) || document.activeElement.id === 'content')) hooks.requestRender();
  } catch (error) {
    if (scope.aborted || error.name === 'AbortError') return;
    S.bots = { ...S.bots, at:Date.now(), error:error.message };
    if (['overview','bots'].includes(S.route.name) && (!document.getElementById('content').contains(document.activeElement) || document.activeElement.id === 'content')) hooks.requestRender();
  }
  finally { if (loading === request) loading = null; }
}
export function selectBot(bot) {
  if (bot.route === 'boards') {
    S.forms.boards = { ...(S.forms.boards || {}), board:bot.board||bot.id, mode:bot.mode||'apply' };
    navigate('boards', (bot.board||bot.id)+(bot.mode==='profile'?'/profile':''));
  } else if (bot.pipeline) {
    S.forms.pipeline = { ...(S.forms.pipeline || {}), group:bot.pipeline };
    navigate('pipeline', bot.pipeline);
  } else navigate(bot.route);
}
export function botIcon(bot) {
  return avatar(bot.image??Math.max(0,BOTS.findIndex(b=>b.id===bot.id)),'bot-icon');
}
export function botCard(bot) {
  const state = S.bots?.data?.bots.find(b => b.id === bot.id);
  const record = state?.last_run;
  const stats = S.overview?.data?.boards.find(b => b.key === bot.id);
  const active = state?.running;
  const spec = crewRunSpec(bot, S.forms, S.crewBrowserMode);
  const status = S.bots?.error ? 'Status unavailable' : !state ? 'Checking status' : active ? 'In current run' : 'Idle';
  const latest = record ? `${record.practice ? 'Practice' : bot.group==='profiles'?'Profile run':'Application run'} · ${new Date(record.at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}${record.finished ? '' : ' · no end recorded'}` : bot.group==='profiles'?'No saved profile run history':'No recorded run';
  let primary;
  if (active) primary = h('button', { class:'btn btn-primary', type:'button', onclick:() => setConsoleSize('normal') }, icon('activity'), 'View live run');
  else if (spec.ready) {
    primary = quickButton(spec.action, spec.label, spec.options, {
      confirm:{ title:`Run ${bot.name}?`, body:spec.effect }
    });
    primary.setAttribute('aria-label', `${primary.textContent} — ${bot.name}`);
    // Each card needs its own busy-state entry even when it shares a backend action.
    S.runButtons[`bot:${bot.id}`] = primary;
    primary.prepend(icon('play','icon icon-sm'));
  } else primary = h('button', { class:'btn', type:'button', onclick:() => selectBot(bot) }, bot.id === 'external' ? 'Add application URL' : 'Add job description', icon('arrow-up-right','icon icon-sm'));
  return h('article', { class:`bot-card ${active ? 'is-running' : ''}`, dataset:{bot:bot.id} },
    h('div', { class:'bot-top' }, botIcon(bot), h('span', { class:`bot-status ${active ? 'is-live' : ''}` }, h('span', {class:'status-pin'}), status)),
    h('h3', {text:bot.name}), h('p', { class:'bot-description', text:bot.description }),
    h('div', { class:'bot-record' }, stats ? h('span', {}, h('strong', {text:num(stats.found)}), ' discovered', h('span',{class:'record-divider',text:'·'}), h('strong',{text:num(stats.sent)}),' sent') : bot.id === 'external' ? h('span',{},h('strong',{text:num(S.status.sites.length)}),' awaiting review') : h('span',{text:bot.group === 'career' ? 'On-demand assistant' : 'Ready to configure'}),
      h('span', {class:'bot-last',text:latest})),
    h('div', { class:'bot-actions' }, primary, h('button', { class:'icon-btn bot-settings', type:'button', 'aria-label':`Configure ${bot.name}`, title:`Configure ${bot.name}`, onclick:() => selectBot(bot) }, icon('sliders','icon icon-sm'))));
}
export function fleetSection() {
  if (!S.bots || Date.now()-S.bots.at>15000) refreshBots();
  return h('section', {class:'fleet-section', 'aria-labelledby':'fleet-title'},
    h('div',{class:'section-heading'},h('div',{},h('h2',{id:'fleet-title',text:'Your application bots'}),h('p',{text:'Find your next opportunity across job boards and company sites.'})),h('a',{class:'text-link',href:'#/bots'},'All bots',icon('arrow-up-right','icon icon-sm'))),
    S.bots?.error ? h('div',{class:'inline-notice',role:'status'},'Bot status is unavailable. ',h('button',{class:'text-link',type:'button',text:'Try again',onclick:async()=>{await refreshBots();hooks.requestRender();}})) : null,
    h('div',{class:'bot-grid'}, BOTS.filter(b=>b.group==='applications').map(bot=>botCard(bot))));
}
const CREW_GROUPS = [
  {key:'applications', name:'Applications', title:'Apply', subtitle:'Find your next role.', art:0},
  {key:'profiles', name:'Profiles', title:'Stay visible', subtitle:'Keep your profiles current.', art:16},
  {key:'career', name:'Career', title:'Grow', subtitle:'Write, research and learn.', art:11},
];

function selectionChanged() {
  S.crewLaunch.error = ''; S.crewLaunch.conflicts = []; S.crewLaunch.results = [];
}

function botPurpose(bot) {
  return {
    naukri:'Match and apply to roles', hirist:'Technology roles', instahyre:'Personalized job matches',
    cutshort:'Growing tech teams', wellfound:'Startup opportunities', startups:'YC & Hacker News jobs',
    external:'Company application forms', profile:'Resume & headline refresh', linkedin_profile:'Experience & profile updates',
    linkedin:'LinkedIn post drafts', cold_email:'Recruiter email drafts', company_outreach:'Hiring contacts & email drafts',
    resume:'Resumes tailored to a role', learn:'Daily learning material', brief:'Your daily research brief',
    research:'Research your resume skills', company_research:'Employer & contact research',
  }[bot.id] || (bot.group === 'profiles' ? 'Saved facts & resume updates' : bot.description);
}

function botHistory(bot, state) {
  const stats = S.overview?.data?.boards?.find(board => board.key === bot.id);
  const record = state?.last_run;
  const date = record?.at ? new Date(record.at) : null;
  const latest = date && Number.isFinite(date.getTime())
    ? `${record.practice ? 'Last practice' : 'Last run'} ${date.toLocaleDateString(undefined, { month:'short', day:'numeric' })}${record.finished ? '' : ' · no end recorded'}`
    : '';
  if (!stats && !latest) return null;
  return h('div', {class:'crew-card-history'},
    stats ? h('span', {}, h('strong', {text:num(stats.found)}), ' found · ', h('strong', {text:num(stats.sent)}), ' sent') : null,
    latest ? h('span', {text:latest}) : null);
}

/** Start with the bots. Group runs and configuration appear only on request. */
export function renderBots() {
  if (!S.bots || Date.now()-S.bots.at>15000) refreshBots();
  const catalogue=h('div',{class:'crew-catalogue crew-team-board'});
  let library, historyPanel;
  let workspaceView=S.crewStudioView==='history'?'history':'crew';
  const crewView=h('button',{class:'crew-library-switch',type:'button',text:'Your crew',onclick:()=>setView('crew')});
  const historyCount=h('span',{class:'crew-history-count','aria-hidden':'true',hidden:true});
  const historyView=h('button',{class:'crew-history-switch',type:'button','aria-label':'Application history',onclick:()=>setView('history')},'Application history ',historyCount);
  function setView(view) {
    workspaceView=view;S.crewStudioView=view;
    if(library)library.hidden=view!=='crew';
    if(historyPanel)historyPanel.hidden=view!=='history';
    mode.hidden=view!=='crew';
    crewView.setAttribute('aria-pressed',String(view==='crew'));
    historyView.setAttribute('aria-pressed',String(view==='history'));
  }
  const tabs=h('div',{class:'crew-category-tabs',role:'group','aria-label':'Bot category'});
  const count=h('span',{class:'filter-count',role:'status'});
  const feedback=h('div',{class:'crew-launch-feedback'});
  const selectionCount=h('strong');
  const selectionHint=h('small');
  const chips=h('div',{class:'crew-selection-chips',role:'group','aria-label':'Selected bots'});
  const mode=h('button',{class:'btn crew-mode-button',type:'button',onclick:()=>{
    if(S.crewLaunch.pending)return;
    S.crewMulti=!S.crewMulti;
    if(!S.crewMulti){S.crewSelection=[];selectionChanged();}
    draw();
  }});
  const clear=h('button',{class:'text-link',type:'button',text:'Clear selection',onclick:()=>{
    S.crewSelection=[];selectionChanged();update();
  }});
  const start=h('button',{class:'btn btn-primary',type:'button','aria-label':'Review & start selected bots',onclick:()=>startBots(BOTS.filter(bot=>S.crewSelection.includes(bot.id)))},'Review & start',icon('chevron-right','icon icon-sm'));
  const runOptions=h('button',{class:'text-link crew-run-options',type:'button','aria-label':'Run settings',title:'Run settings',onclick:()=>settings(BOTS.filter(bot=>S.crewSelection.includes(bot.id)))},icon('sliders','icon icon-sm'),h('span',{class:'crew-run-options-label',text:'Run settings'}));
  const selectionBar=h('section',{class:'crew-selection-bar','aria-label':'Selected bots',hidden:true},
    h('div',{class:'crew-selection-copy'},selectionCount,selectionHint),chips,
    h('div',{class:'crew-selection-actions'},runOptions,clear,start));
  const active=bot=>Boolean(S.bots?.data?.bots?.find(item=>item.id===bot.id)?.running);
  const settings=(bots,purpose='settings')=>{
    if(S.crewLaunch.pending)return;
    crewSettings(bots,{
      purpose,
      onSave:()=>{
        selectionChanged();draw();
        const target=bots.length===1&&(purpose==='run'||!S.crewMulti)?catalogue.querySelector('[data-bot="'+bots[0].id+'"] '+(purpose==='run'?'.crew-card-run':'.crew-configure')):runOptions;
        target?.focus({preventScroll:true});
        if(purpose==='settings')toast('Settings updated for your next run.','info');
      },
      onRun:chosen=>startBots(chosen),
      onAdvanced:bot=>selectBot(bot),
    });
  };
  const startBots=async(bots)=>{
    if(S.crewLaunch.pending||!bots.length)return;
    const specs=bots.map(bot=>crewRunSpec(bot,S.forms,S.crewBrowserMode));
    if(specs.some(spec=>!spec.ready)){settings(bots,'run');return;}
    const scope=accountRequestSignal();
    await launchCrew(specs,update);
    if(scope.aborted)return;
    if(S.crewLaunch.results.some(result=>result.ok)&&!S.crewSelection.length)S.crewMulti=false;
    if(S.legacyAccess&&S.crewLaunch.results.length)await refreshBots();
    if(scope.aborted)return;
    // Card instances stay mounted while confirming so Escape restores the trigger.
    if(S.crewLaunch.results.length)draw();
    if(S.crewLaunch.error)feedback.querySelector('[role="alert"]')?.focus();
  };
  const card=bot=>{
    const spec=crewRunSpec(bot,S.forms,S.crewBrowserMode),running=active(bot);
    const state=S.bots?.data?.bots?.find(item=>item.id===bot.id);
    const selected=S.crewSelection.includes(bot.id);
    const status=S.bots?.error?'Status unavailable':!state?'Checking status':running?'Running':!spec.ready?'Needs setup':'';
    const label=spec.ready?spec.label:'Set up';
    const compactLabel=!spec.ready?'Set up':/drafts/i.test(spec.label)?'Drafts':/draft/i.test(spec.label)?'Draft':'Run';
    let primary;
    if(running){
      primary=h('button',{class:'btn crew-card-run',type:'button','aria-label':'View progress — '+bot.name,onclick:()=>setConsoleSize('normal')},'Progress');
    }else if(S.crewMulti){
      primary=h('label',{class:'crew-pick'},
        h('input',{type:'checkbox',checked:selected,'aria-label':'Select '+bot.name,dataset:{crewPick:bot.id},onchange:event=>{
          if(S.crewLaunch.pending)return;
          S.crewSelection=event.target.checked?[...new Set([...S.crewSelection,bot.id])]:S.crewSelection.filter(id=>id!==bot.id);
          selectionChanged();update();
        }}),h('span',{text:selected?'Selected':'Select bot'}));
    }else{
      primary=h('button',{class:'btn crew-card-run',type:'button','aria-label':label+' — '+bot.name,dataset:{crewRun:bot.id},onclick:()=>startBots([bot])},
        icon(spec.ready?'play':'sliders','icon icon-sm'),compactLabel);
    }
    return h('article',{class:'bot-card crew-bot-card crew-roster-bot',dataset:{bot:bot.id}},
      h('div',{class:'bot-top'},botIcon(bot),h('div',{class:'crew-bot-title'},h('h3',{text:bot.name}),h('span',{class:'crew-outcome',text:botPurpose(bot)}),
        status?h('span',{class:'bot-status'+(running?' is-live':'')+(spec.ready?'':' needs-setup')},h('span',{class:'status-pin','aria-hidden':'true'}),status):null)),
      botHistory(bot,state),
      h('div',{class:'bot-actions'},primary,
        h('button',{class:'btn crew-configure',type:'button','aria-label':'Configure '+bot.name,title:'Configure '+bot.name,onclick:()=>{
          if(S.crewLaunch.pending)return;
          if(bot.id==='startups')settings([bot]);else selectBot(bot);
        }},icon('sliders','icon icon-sm'))));
  };
  const update=()=>{
    const selected=BOTS.filter(bot=>S.crewSelection.includes(bot.id));
    const busy=S.crewLaunch.pending;
    crewView.disabled=busy;historyView.disabled=busy;
    mode.textContent=S.crewMulti?'Cancel selection':'Run multiple';
    mode.setAttribute('aria-pressed',String(Boolean(S.crewMulti)));mode.disabled=busy;
    selectionBar.hidden=!S.crewMulti;
    selectionCount.textContent=selected.length?selected.length+' of 8 bots selected':'Choose bots to run together';
    selectionHint.textContent=selected.length?'Review each action before starting.':'Select up to 8 bots from any category.';
    chips.replaceChildren(...selected.map(bot=>h('button',{class:'crew-selected-chip',type:'button','aria-label':'Remove '+bot.name,disabled:busy,onclick:()=>{
      const index=selected.indexOf(bot);
      S.crewSelection=S.crewSelection.filter(id=>id!==bot.id);selectionChanged();update();
      const next=chips.querySelectorAll('button');
      (next[Math.min(index,next.length-1)]||catalogue.querySelector('[data-crew-pick="'+bot.id+'"]')||mode).focus({preventScroll:true});
    }},bot.name,icon('x','icon icon-sm'))));
    clear.disabled=busy||!selected.length;start.disabled=busy||!selected.length;runOptions.disabled=busy||!selected.length;
    start.setAttribute('aria-busy',String(busy));
    start.replaceChildren(busy?'Preparing…':'Review & start',icon('chevron-right','icon icon-sm'));
    for(const element of catalogue.querySelectorAll('[data-bot]')){
      const bot=BOTS.find(item=>item.id===element.dataset.bot),checked=S.crewSelection.includes(bot.id);
      element.classList.toggle('is-selected',Boolean(S.crewMulti&&checked));
      element.classList.toggle('is-running',active(bot));
      for(const button of element.querySelectorAll('button'))button.disabled=busy;
      const input=element.querySelector('[data-crew-pick]');
      if(input){
        input.checked=checked;input.disabled=busy||active(bot)||(!checked&&selected.length>=8);
        input.nextElementSibling.textContent=checked?'Selected':selected.length>=8?'Selection full':'Select bot';
      }
    }
    feedback.replaceChildren(
      ...(S.crewLaunch.error?[h('p',{class:'crew-launch-error',role:'alert',tabindex:'-1',text:S.crewLaunch.error})]:[]),
      ...(S.crewLaunch.conflicts||[]).map(message=>h('p',{class:'crew-launch-error',text:message})),
      ...(S.crewLaunch.results||[]).map(result=>h('p',{class:'crew-launch-result '+(result.ok?'is-started':'is-failed'),text:(BOTS.find(bot=>bot.id===result.key)?.name||result.label)+': '+(result.ok?'Started — follow this bot in Activity.':result.error||'Could not start.')})));
  };
  const searchInput=h('input',{type:'search',placeholder:'Find a bot…','aria-label':'Find a bot',value:S.crewCatalogQuery||'',oninput:event=>{S.crewCatalogQuery=event.target.value;draw();}});
  const draw=()=>{
    const query=(S.crewCatalogQuery||'').trim().toLowerCase(),filter=S.crewCatalogFilter||'all';
    const matches=BOTS.filter(bot=>(filter==='all'||bot.group===filter)&&(!query||(bot.name+' '+bot.description).toLowerCase().includes(query)));
    count.textContent=matches.length+' '+(matches.length===1?'bot':'bots');
    tabs.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===filter)));
    catalogue.replaceChildren(...(matches.length?CREW_GROUPS.filter(group=>matches.some(bot=>bot.group===group.key)).map(group=>{
      const bots=matches.filter(bot=>bot.group===group.key);
      return h('section',{class:'crew-team',dataset:{team:group.key},'aria-label':group.name+' bots'},
        h('header',{class:'crew-team-header'},h('div',{},h('span',{class:'crew-team-count',text:bots.length+' specialists'}),h('h2',{text:group.title}),h('p',{text:group.subtitle})),avatar(group.art,'crew-team-art')),
        h('div',{class:'crew-team-bots'},bots.map(card)));
    }):[h('div',{class:'bot-empty'},icon('search'),h('h2',{text:'No bots found'}),h('p',{text:'Try another name or show all bots.'}),
      h('button',{class:'btn',type:'button',text:'Clear search',onclick:()=>{S.crewCatalogQuery='';searchInput.value='';draw();searchInput.focus();}}),
      h('button',{class:'text-link',type:'button',text:'Show all bots',onclick:()=>{S.crewCatalogFilter='all';S.crewCatalogQuery='';searchInput.value='';draw();}}))]));
    update();
  };
  for(const [key,label]of [['all','All bots'],...CREW_GROUPS.map(group=>[group.key,group.name])]){
    tabs.append(h('button',{type:'button',dataset:{filter:key},onclick:()=>{
      S.crewCatalogFilter=key;S.crewCatalogQuery='';searchInput.value='';draw();setView('crew');
    }},label));
  }
  draw();
  const run=S.status?.run;
  const activeRuns=Array.isArray(run?.runs)?run.runs.filter(item=>item.running):run?.running?[run]:[];
  library=h('div',{class:'crew-library-body'},
    h('div',{class:'crew-toolbar'},tabs,h('label',{class:'search-control'},icon('search'),searchInput),count),
    activeRuns.length?h('div',{class:'fleet-notice'},icon('activity','icon icon-sm'),h('span',{text:activeRuns.length+' '+(activeRuns.length===1?'bot is':'bots are')+' running.'}),h('button',{class:'text-link',type:'button',text:'Open Activity',onclick:()=>setConsoleSize('normal')})):null,
    S.bots?.error?h('div',{class:'inline-notice',role:'alert'},'Bot status is unavailable. ',h('button',{class:'text-link',type:'button',text:'Try again',onclick:async()=>{await refreshBots();hooks.requestRender();}})):null,
    S.bots?.data?.history_error?h('p',{class:'inline-notice',text:S.bots.data.history_error}):null,
    feedback,catalogue,selectionBar,
    h('div',{class:'crew-footer'},h('p',{class:'fleet-footnote',text:'Sign-in is checked when a bot starts. You’ll review every action before it runs.'})));
  historyPanel=applicationAgentPanel({compact:true,onSummary:summary=>{
    const count=summary.reviewCount;
    historyCount.hidden=!(count>0);
    historyCount.textContent=count>0?'('+count+')':'';
    historyView.setAttribute('aria-label','Application history'+(count>0?' ('+count+')':''));
    historyView.title=summary.error?'History could not refresh. Open it to try again.':count>0?count+' application outcomes need review.':'Application history';
    historyView.setAttribute('aria-description',summary.error?'The displayed count is from the last successful refresh.':count>0?count+' outcomes need review.':'Review recorded application outcomes.');
  }});
  const page=h('div',{class:'page bot-page crew-workspace crew-studio'},
    h('header',{class:'page-head'},h('h1',{text:'Bot Crew'}),mode,h('p',{class:'lead',text:'A specialist for every next step.'})),
    h('div',{class:'crew-view-tabs'},h('div',{class:'crew-view-switches',role:'group','aria-label':'Bot Crew workspace'},crewView,historyView),h('a',{class:'text-link',href:'#/pipeline'},'Build a flow',icon('arrow-up-right','icon icon-sm'))),
    library,historyPanel);
  setView(workspaceView);
  return page;
}
