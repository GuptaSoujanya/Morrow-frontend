import { h } from '../dom.js';
import { SECTIONS, routeHref } from '../router.js';
import { S } from '../state.js';
import { navigationGroups, mobileRoutes, routeLabel } from '../access-policy.js';
import { availableLearningSections, currentLearningSection } from '../learning-sections.js';
import { avatar, workspaceAvatar, brandMark } from './identity.js';
import { navigationArt } from './navigation-art.js';
import { renderWorkspaceHeader } from './workspace-header.js';
const botPages = new Set(['naukri','boards','sites','profile','linkedin','resume','outreach','linkedin-profile']);
/** The Learning group stays open on every page unless the person folds it; the choice is kept on this device. */
const LEARNING_NAV_KEY = 'morrow.learning-nav';
let learningOpen = null;
function learningNavOpen() {
  if (learningOpen === null) {
    try { learningOpen = localStorage.getItem(LEARNING_NAV_KEY) !== 'closed'; } catch { learningOpen = true; }
  }
  return learningOpen;
}
function setLearningNavOpen(open) {
  learningOpen = open;
  try { localStorage.setItem(LEARNING_NAV_KEY, open ? 'open' : 'closed'); } catch { /* Storage may be disabled. */ }
}
function navLink(key, mobile = false, subtitle = '') {
  const [, defaultTitle] = SECTIONS.find(([id]) => id === key);
  const title=routeLabel(key,S)||defaultTitle;
  const count = key === 'todo' ? (S.status?.questions.length || 0) + (S.status?.facts.length || 0) : 0;
  const active = S.route.name === key || (key==='bots' && botPages.has(S.route.name));
  return h('a', { class:`nav-item ${active ? 'active' : ''}${key === 'learning' && active ? ' learning-area' : ''}`, href:routeHref(key), title,
    'aria-current':S.route.name===key ? key === 'learning' ? 'true' : 'page' : null,
    onclick:() => { if(mobile) document.getElementById('mobile-nav').close(); } }, navigationArt(key, 'nav-art'),
    h('span',{class:'nav-copy'},h('span',{class:'nav-title',text:title}),subtitle?h('span',{class:'nav-subtitle',text:subtitle}):null),count ? h('span',{class:'badge','aria-hidden':'true',text:count}):null);
}
function learningGroup() {
  const sections = availableLearningSections();
  if (!sections.length) return [navLink('learning')];
  const open = learningNavOpen();
  const current = S.route.name === 'learning' ? currentLearningSection(S.route.arg) : null;
  const link = navLink('learning', false, !open && current ? current.label : '');
  const toggle = h('button', { class: 'learning-nav-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': 'learning-context-nav',
    'aria-label': open ? 'Hide learning sections' : 'Show learning sections', title: open ? 'Hide learning sections' : 'Show learning sections',
    onclick: () => { setLearningNavOpen(!open); renderNav(); } }, h('span', { class: 'learning-nav-chevron', 'aria-hidden': 'true' }));
  const nav = h('nav', { class: 'learning-context-nav', id: 'learning-context-nav', 'aria-label': 'Learning workspace', hidden: !open },
    ...sections.map(section => h('a', {
      class: 'learning-nav-link', href: section.path,
      'data-learning-section': section.key,
      'aria-current': section.key === current?.key ? 'page' : null,
    }, navigationArt('learning', 'learning-nav-art', section.key), h('span', { text: section.label }))));
  return [h('div', { class: 'learning-nav-row', dataset: { open: String(open) } }, link, toggle), nav];
}
function openMore() {
  const dialog=document.getElementById('mobile-nav');
  dialog.replaceChildren(h('div',{class:'mobile-menu'},h('div',{class:'editor-toolbar'},h('h2',{text:'Your workspace'}),h('button',{class:'text-link',type:'button','aria-label':'Close navigation',onclick:()=>dialog.close(),text:'Close'})),
    ...navigationGroups(S,{includeBotControls:true}).map(([title,keys])=>[title,keys.filter(key=>!mobileRoutes(S).includes(key))]).filter(([,keys])=>keys.length).map(([title,keys])=>h('div',{},h('p',{class:'eyebrow',text:title}),...keys.map(key=>navLink(key,true))))));
  if(!dialog.open)dialog.showModal();
}
export function renderNav() {
  renderWorkspaceHeader();
  const root=document.getElementById('nav'),previous=root.querySelector('.sidebar-scroll');
  const groups=navigationGroups(S),primary=mobileRoutes(S);
  const activePrimary = botPages.has(S.route.name) ? 'bots' : S.route.name;
  const mobile=document.getElementById('mobile-nav');
  // Clear old account links immediately during boot, sign-out and account switches.
  if(!groups.length){root.replaceChildren();delete root.dataset.route;mobile.close();mobile.replaceChildren();return;}
  if(mobile.open)openMore();else mobile.replaceChildren();
  const signature=S.route.name==='learning'?`${S.route.name}/${S.route.arg || ''}:${currentLearningSection(S.route.arg)?.key || ''}`:S.route.name;
  const scrollTop=previous?.scrollTop||0,changed=root.dataset.route!==signature;
  // Arriving in Learning from elsewhere unfolds its sections so the current one is visible.
  if(S.route.name==='learning'&&root.dataset.route&&!root.dataset.route.startsWith('learning')&&!learningNavOpen())setLearningNavOpen(true);
  const focused=document.activeElement?.closest('#nav a'),focusedHref=focused?.getAttribute('href'),focusedSection=focused?.dataset.learningSection;
  const focusedToggle=document.activeElement?.classList.contains('learning-nav-toggle');
  const sections=h('div',{class:'sidebar-scroll',tabIndex:0,'aria-label':'Navigation sections'},...groups.map(([title,keys])=>h('div',{class:'nav-group'},h('p',{class:'nav-group-label',text:title}),...keys.flatMap(key=>key==='learning'?learningGroup():[navLink(key)]))));
  root.replaceChildren(
    h('a',{class:'sidebar-brand',href:'#/overview',title:'Morrow home','aria-label':'Morrow home'},brandMark('brand-mark sidebar-brand-mark'),h('strong',{class:'brand-wordmark',text:'morrow'})),
    sections,
    h('div',{class:'workspace-profile'},avatar(workspaceAvatar(),'profile-avatar'),h('div',{},h('strong',{text:S.status?.name || S.user?.name || 'Your workspace'}),h('span',{text:S.accountMode==='local'?'Personal workspace':S.user?.role==='admin'?'Administrator':S.user?`${S.user.plan_name} plan`:'Personal workspace'}))),
    h('div',{class:'sidebar-foot'},h('span',{class:`status-pin ${S.online ? 'connected' : ''}`}),h('span',{text:S.online?'Connected · private workspace':'Reconnecting to workspace…'})),
    h('div',{class:'mobile-primary',style:{gridTemplateColumns:`repeat(${primary.length+1},minmax(0,1fr))`}},...primary.map(key=>navLink(key)),h('button',{class:`nav-item ${primary.includes(activePrimary)?'':'active'}`,type:'button','aria-label':'More sections',onclick:openMore},navigationArt('more','nav-art'),h('span',{class:'nav-title',text:'More'}))));
  sections.scrollTop=scrollTop;root.dataset.route=signature;
  if(focusedHref&&!changed)[...root.querySelectorAll('a')].find(a=>a.getAttribute('href')===focusedHref&&a.dataset.learningSection===focusedSection)?.focus({preventScroll:true});
  if(focusedToggle)root.querySelector('.learning-nav-toggle')?.focus({preventScroll:true});
  if(changed&&matchMedia('(min-width:768px)').matches){
    const active=matchMedia('(min-width:1101px)').matches?sections.querySelector('[aria-current=page]')||sections.querySelector('[aria-current=true]'):sections.querySelector('.nav-item[aria-current]');
    if(active){const a=active.getBoundingClientRect(),s=sections.getBoundingClientRect();if(a.bottom>s.bottom)sections.scrollTop+=a.bottom-s.bottom+8;else if(a.top<s.top)sections.scrollTop-=s.top-a.top+8;}
  }
}
