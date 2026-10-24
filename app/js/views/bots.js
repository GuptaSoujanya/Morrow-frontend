import { h } from '../dom.js';
import { icon } from '../icons.js';
import { S, hooks } from '../state.js';
import { api, accountRequestSignal } from '../api.js';
import { navigate } from '../router.js';
import { quickButton, updateRunButtons, browserRunToggle } from '../forms.js';
import { setConsoleSize } from '../components/console.js';
import { num } from '../format.js';
import {avatar} from '../components/identity.js';
import {crewRunSpec} from '../crew-options.js';
import {launchCrew} from '../crew-launch.js';

export const BOTS = [
  { id:'naukri', name:'Naukri', mark:'n', color:'blue', group:'applications', description:'Find, rank and apply to matching roles.', route:'naukri', action:'naukri' },
  { id:'hirist', name:'Hirist', mark:'h', color:'teal', group:'applications', description:'Discover your next role in technology.', route:'boards', action:'boards' },
  { id:'instahyre', name:'Instahyre', mark:'i', color:'violet', group:'applications', description:'Connect with companies that fit you.', route:'boards', action:'boards' },
  { id:'cutshort', name:'Cutshort', mark:'c', color:'coral', group:'applications', description:'Explore opportunities at growing teams.', route:'boards', action:'boards' },
  { id:'wellfound', name:'Wellfound', mark:'w', color:'slate', group:'applications', description:'Find your place in the startup world.', route:'boards', action:'boards' },
  { id:'external', name:'Company sites', icon:'globe', color:'indigo', group:'applications', description:'Finish applications on company websites.', route:'sites' },
  { id:'profile', name:'Naukri profile', icon:'person', color:'blue', group:'profiles', description:'Keep your Naukri profile and resume fresh.', route:'profile', action:'profile' },
  { id:'linkedin', name:'LinkedIn writer', mark:'in', color:'blue', group:'career', description:'Draft, review and publish your next post.', route:'linkedin', action:'linkedin' },
  { id:'linkedin_profile', name:'LinkedIn profile', icon:'person', color:'slate', group:'profiles', description:'Review and update your profile from saved facts.', route:'linkedin-profile', action:'linkedin_profile' },
  { id:'cold_email', name:'Recruiter drafts', icon:'send', color:'teal', group:'career', description:'Prepare recruiter emails for your review. Drafts only.', route:'outreach', action:'cold_email' },
  { id:'resume', name:'Resume tailor', icon:'file', color:'coral', group:'career', description:'Shape your resume around a specific role.', route:'resume' },
  { id:'learn', name:'Learning assistant', icon:'book', color:'teal', group:'career', description:'Prepare your daily learning material.', route:'pipeline', action:'pipeline', pipeline:'learn' },
  { id:'brief', name:'Daily briefing', icon:'sun', color:'violet', group:'career', description:'Five agents research roles, news and ideas.', route:'pipeline', action:'pipeline', pipeline:'brief' },
  { id:'research', name:'Resume researcher', icon:'search', color:'indigo', group:'career', description:'Research the skills behind your experience.', route:'pipeline', action:'pipeline', pipeline:'research' },
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
export function botCard(bot, {selectable = false, onSelection = () => {}} = {}) {
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
  const selected = S.crewSelection.includes(bot.id);
  const selection = selectable ? h('label', {class:'crew-pick', title:active ? 'This agent is already running.' : spec.reason || 'Include this agent in your next group run.'},
    h('input', {type:'checkbox', checked:selected, disabled:active || !spec.ready || S.crewLaunch.pending || (!selected && S.crewSelection.length >= 8), 'aria-label':`Select ${bot.name}`, dataset:{crewPick:bot.id}, onchange:event=>{
      S.crewSelection = event.target.checked ? [...new Set([...S.crewSelection, bot.id])] : S.crewSelection.filter(id=>id!==bot.id);
      S.crewLaunch.error=''; S.crewLaunch.conflicts=[]; S.crewLaunch.results=[];
      onSelection();
    }}), h('span',{text:active ? 'Already running' : !spec.ready ? 'Set up first' : selected ? 'Selected' : 'Select agent'})) : null;
  return h('article', { class:`bot-card ${active ? 'is-running' : ''} ${selected && selectable ? 'is-selected' : ''}`, dataset:{bot:bot.id} },
    h('div', { class:'bot-top' }, botIcon(bot), h('span', { class:`bot-status ${active ? 'is-live' : ''}` }, h('span', {class:'status-pin'}), status)),
    selection,
    h('h3', {text:bot.name}), h('p', { class:'bot-description', text:bot.description }),
    selectable && spec.reason ? h('p',{class:'crew-setup-note',text:spec.reason}) : null,
    h('div', { class:'bot-record' }, stats ? h('span', {}, h('strong', {text:num(stats.found)}), ' discovered', h('span',{class:'record-divider',text:'·'}), h('strong',{text:num(stats.sent)}),' sent') : bot.id === 'external' ? h('span',{},h('strong',{text:num(S.status.sites.length)}),' awaiting review') : h('span',{text:bot.group === 'career' ? 'On-demand assistant' : 'Ready to configure'}),
      h('span', {class:'bot-last',text:latest})),
    h('div', { class:'bot-actions' }, primary, h('button', { class:selectable ? 'btn crew-configure' : 'icon-btn bot-settings', type:'button', 'aria-label':`Configure ${bot.name}`, title:`Configure ${bot.name}`, onclick:() => selectBot(bot) }, icon('sliders','icon icon-sm'), selectable ? 'Configure' : null)));
}
export function fleetSection() {
  if (!S.bots || Date.now()-S.bots.at>15000) refreshBots();
  return h('section', {class:'fleet-section', 'aria-labelledby':'fleet-title'},
    h('div',{class:'section-heading'},h('div',{},h('h2',{id:'fleet-title',text:'Your application bots'}),h('p',{text:'Six ways to find your next opportunity.'})),h('a',{class:'text-link',href:'#/bots'},'All bots',icon('arrow-up-right','icon icon-sm'))),
    S.bots?.error ? h('div',{class:'inline-notice',role:'status'},'Bot status is unavailable. ',h('button',{class:'text-link',type:'button',text:'Try again',onclick:async()=>{await refreshBots();hooks.requestRender();}})) : null,
    h('div',{class:'bot-grid'}, BOTS.filter(b=>b.group==='applications').map(bot=>botCard(bot))));
}
export function renderBots() {
  if (!S.bots || Date.now()-S.bots.at>15000) refreshBots();
  const grid = h('div',{class:'bot-grid'});
  const count = h('span',{class:'filter-count'});
  const tabs = h('div',{class:'segmented','aria-label':'Bot category'});
  const selectionSummary = h('p',{class:'crew-selection-summary',role:'status'});
  const chips = h('div',{class:'crew-selected', role:'group', 'aria-label':'Selected agents'});
  const feedback = h('div',{class:'crew-launch-feedback'});
  const clear = h('button',{class:'text-link',type:'button',text:'Clear selection',onclick:()=>{
    S.crewSelection=[];S.crewLaunch.error='';S.crewLaunch.conflicts=[];S.crewLaunch.results=[];drawSelection();
  }});
  const start = h('button',{class:'btn btn-primary',type:'button','aria-label':'Run selected',onclick:async()=>{
    const scope=accountRequestSignal();
    const selected=BOTS.filter(bot=>S.crewSelection.includes(bot.id)).map(bot=>crewRunSpec(bot,S.forms,S.crewBrowserMode));
    await launchCrew(selected,drawSelection);
    if(!scope.aborted&&S.legacyAccess&&S.crewLaunch.results.length){await refreshBots();if(!scope.aborted)hooks.requestRender();}
  }},icon('play','icon icon-sm'),'Run selected');
  const browserSetting = browserRunToggle(S.crewBrowserMode, mode => { S.crewBrowserMode = mode; draw(); });
  const drawSelection = () => {
    const selected=BOTS.filter(bot=>S.crewSelection.includes(bot.id));
    const busy=S.crewLaunch.pending;
    browserSetting.querySelector('input').disabled = busy;
    selectionSummary.textContent=selected.length ? `${selected.length} of 8 agents selected. Review their actions before starting.` : 'Choose up to 8 agents using the checkboxes below.';
    chips.replaceChildren(...selected.map(bot=>h('button',{class:'crew-selected-chip',type:'button',disabled:busy,'aria-label':`Remove ${bot.name}`,onclick:()=>{
      S.crewSelection=S.crewSelection.filter(id=>id!==bot.id);S.crewLaunch.error='';S.crewLaunch.conflicts=[];S.crewLaunch.results=[];drawSelection();
    }},botIcon(bot),h('span',{text:bot.name}),h('span',{'aria-hidden':'true',text:'×'}))));
    clear.disabled=busy||!selected.length;
    start.disabled=busy||!selected.length;
    start.setAttribute('aria-busy',String(busy));
    start.replaceChildren(icon('play','icon icon-sm'),busy?'Preparing agents…':`Run selected${selected.length?' ('+selected.length+')':''}`);
    feedback.replaceChildren(
      S.crewLaunch.error ? h('p',{class:'crew-launch-error',role:'alert',text:S.crewLaunch.error}) : h('span',{hidden:true}),
      ...(S.crewLaunch.conflicts||[]).map(message=>h('p',{class:'crew-launch-error',text:message})),
      ...(S.crewLaunch.results||[]).map(result=>h('p',{class:`crew-launch-result ${result.ok?'is-started':'is-failed'}`,text:`${BOTS.find(bot=>bot.id===result.key)?.name||result.label}: ${result.ok?'Started — follow this agent in Activity.':result.error||'Could not start.'}`})),
    );
    for(const input of grid.querySelectorAll('[data-crew-pick]')){
      const bot=BOTS.find(item=>item.id===input.dataset.crewPick),checked=S.crewSelection.includes(bot.id);
      const active=S.bots?.data?.bots.find(item=>item.id===bot.id)?.running;
      input.checked=checked;
      input.disabled=busy||active||!crewRunSpec(bot,S.forms).ready||(!checked&&selected.length>=8);
      input.closest('.bot-card').classList.toggle('is-selected',checked);
      input.nextElementSibling.textContent=active?'Already running':!crewRunSpec(bot,S.forms).ready?'Set up first':checked?'Selected':'Select agent';
    }
  };
  const selectionPanel=h('section',{class:'crew-launch-panel','aria-labelledby':'crew-launch-title'},
    h('div',{class:'crew-launch-heading'},h('div',{},h('h2',{id:'crew-launch-title',text:'Run agents together'}),selectionSummary),h('div',{class:'crew-launch-actions'},clear,start)),
    chips,feedback);
  const steps=h('ol',{class:'crew-steps','aria-label':'How to run your crew'},
    ...[['Choose agents','Pick the specialists you need.'],['Review together','Check their actions, then start.'],['Follow progress','See each agent live in Activity.']].map(([title,copy],index)=>h('li',{},
      h('span',{class:'crew-step-number','aria-hidden':'true',text:String(index+1)}),h('div',{},h('strong',{text:title}),h('span',{text:copy})))));
  const run = S.status?.run;
  const activeRuns = Array.isArray(run?.runs) ? run.runs.filter(item => item.running) : run?.running ? [run] : [];
  const activity = activeRuns.length > 1 ? `${activeRuns.length} agents are running. Follow each one in Activity.`
    : activeRuns.length ? `${activeRuns[0].label} is running. Follow it in Activity.`
    : '';
  const draw = () => {
    const matches = BOTS.filter(b => (S.botFilter === 'all' || !S.botFilter || b.group === S.botFilter) && `${b.name} ${b.description}`.toLowerCase().includes((S.botQuery || '').toLowerCase()));
    count.textContent = `${matches.length} bots`;
    grid.replaceChildren(...(matches.length ? matches.map(bot=>botCard(bot,{selectable:true,onSelection:drawSelection})) : [h('div',{class:'panel bot-empty',text:'No bots match your search. Try a different name or category.'})]));
    tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === (S.botFilter || 'all'))));
    if(grid.isConnected) updateRunButtons();
    drawSelection();
  };
  for (const [key,label] of [['all','All bots'],['applications','Applications'],['profiles','Profile crew'],['career','Career & research']]) tabs.append(h('button',{type:'button',dataset:{filter:key},text:label,onclick:()=>{S.botFilter=key;draw();}}));
  const search = h('label',{class:'search-control'},icon('search'),h('input',{type:'search',placeholder:'Find a bot…','aria-label':'Find a bot',value:S.botQuery || '',oninput:event=>{S.botQuery=event.target.value;draw();}}));
  draw();
  return h('div',{class:'page bot-page'},
    h('header',{class:'page-head'},h('div',{},h('p',{class:'eyebrow',text:'YOUR CAREER, WITH BACKUP'}),h('h1',{text:'Meet your Bot Crew'}),h('p',{class:'lead',text:'Find roles, keep your profiles fresh and keep learning. Give your crew the work.'})),h('a',{class:'btn',href:'#/pipeline'},icon('workflow'),'Build a flow')),
    steps,
    h('div',{class:'crew-run-note'},h('span',{class:'crew-live-badge',text:'Actual runs'}),h('p',{text:'Run agents on different job sites together. Each site has its own browser session, and each run saves separate résumé files. Applications are submitted; writing agents save drafts. Run one task per site at a time.'})),
    h('div',{class:'crew-browser-setting'},browserSetting),
    selectionPanel,
    activeRuns.length ? h('div',{class:'fleet-notice'},icon('activity','icon icon-sm'),h('span',{text:activity}),h('button',{class:'text-link',type:'button',text:'Open Activity',onclick:()=>setConsoleSize('normal')})) : null,
    h('div',{class:'bot-toolbar'},tabs,search,count),
    S.bots?.error ? h('div',{class:'inline-notice',role:'alert'},'Bot status is unavailable. ',h('button',{class:'text-link',type:'button',text:'Try again',onclick:async()=>{await refreshBots();hooks.requestRender();}})) : null,
    S.bots?.data?.history_error ? h('p',{class:'inline-notice',text:S.bots.data.history_error}) : null,
    grid,h('p',{class:'fleet-footnote',text:'Status reflects runs started here. Platform sign-in is checked when a bot starts.'}));
}
