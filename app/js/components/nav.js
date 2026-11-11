import { h } from '../dom.js';
import { SECTIONS, routeHref } from '../router.js';
import { S } from '../state.js';
import { navigationGroups, mobileRoutes, routeLabel } from '../access-policy.js';
import { avatar, workspaceAvatar, brandMark } from './identity.js';
import { navigationArt } from './navigation-art.js';
import { renderWorkspaceHeader } from './workspace-header.js';
const botPages = new Set(['naukri','boards','sites','profile','linkedin','resume','outreach','linkedin-profile']);
let mobileEventsInstalled = false;
function navLink(key, position = 'sidebar') {
  const [, defaultTitle] = SECTIONS.find(([id]) => id === key);
  const title=routeLabel(key,S)||defaultTitle;
  const leads = S.status?.leads;
  const count = key === 'todo' ? (S.status?.questions?.length || 0) + (S.status?.facts?.length || 0)
    : key === 'diagnostics' && leads ? (leads.waiting || 0) + (leads.needs_you || 0) : 0;
  const note = key === 'diagnostics' ? `${count} recruiter ${count === 1 ? 'lead waits' : 'leads wait'} for an answer` : `${count} items need attention`;
  const active = S.route.name === key || (key==='bots' && botPages.has(S.route.name));
  return h('a', { class:`nav-item${active ? ' active' : ''}`, href:routeHref(key), title,
    dataset: { navKey: key, navPosition: position }, 'aria-label': title,
    'aria-description': count ? note : null,
    'aria-current': active ? S.route.name === key && !S.route.arg ? 'page' : 'true' : null,
    onclick:() => { if(position === 'dialog') document.getElementById('mobile-nav').close(); } }, navigationArt(key, 'nav-art'),
    h('span',{class:'nav-copy'},h('span',{class:'nav-title',text:title})),
    count ? h('span',{class:'badge','aria-hidden':'true',title:note,text:count > 99 ? '99+' : count}):null);
}
function openMore() {
  const dialog=document.getElementById('mobile-nav');
  const focused = dialog.contains(document.activeElement) ? document.activeElement : null;
  const focusedKey = focused?.dataset.navKey, focusedClose = focused?.getAttribute('aria-label') === 'Close navigation';
  dialog.replaceChildren(h('div',{class:'mobile-menu'},h('div',{class:'editor-toolbar'},h('h2',{text:'Your workspace'}),h('button',{class:'text-link',type:'button','aria-label':'Close navigation',onclick:()=>dialog.close(),text:'Close'})),
    ...navigationGroups(S,{includeBotControls:true}).map(([title,keys])=>[title,keys.filter(key=>!mobileRoutes(S).includes(key))]).filter(([,keys])=>keys.length).map(([title,keys],index)=>h('div',{class:'nav-group',role:'group','aria-labelledby':`mobile-nav-group-${index}`},h('p',{class:'nav-group-label',id:`mobile-nav-group-${index}`,text:title}),...keys.map(key=>navLink(key,'dialog'))))));
  if(!dialog.open)dialog.showModal();
  document.querySelector('[data-nav-key="more"]')?.setAttribute('aria-expanded','true');
  if(focusedKey) [...dialog.querySelectorAll('a')].find(link=>link.dataset.navKey===focusedKey)?.focus({preventScroll:true});
  if(focusedClose) dialog.querySelector('[aria-label="Close navigation"]')?.focus({preventScroll:true});
}
export function renderNav() {
  renderWorkspaceHeader();
  const root=document.getElementById('nav'),previous=root.querySelector('.sidebar-scroll');
  const groups=navigationGroups(S),primary=mobileRoutes(S);
  const activePrimary = botPages.has(S.route.name) ? 'bots' : S.route.name;
  const mobile=document.getElementById('mobile-nav');
  if(!mobileEventsInstalled){
    mobile.addEventListener('close',()=>{
      const trigger=document.querySelector('[data-nav-key="more"]');
      trigger?.setAttribute('aria-expanded','false');
      // A status refresh can replace the original trigger while the dialog is open.
      if(document.activeElement===document.body||mobile.contains(document.activeElement))trigger?.focus({preventScroll:true});
    });
    mobileEventsInstalled=true;
  }
  // Clear old account links immediately during boot, sign-out and account switches.
  if(!groups.length){root.replaceChildren();delete root.dataset.route;mobile.close();mobile.replaceChildren();return;}
  if(mobile.open)openMore();else mobile.replaceChildren();
  const signature=`${S.route.name}/${S.route.arg || ''}`;
  const scrollTop=previous?.scrollTop||0,changed=root.dataset.route!==signature;
  const focused=document.activeElement?.closest('#nav [data-nav-key]');
  const focusedKey=focused?.dataset.navKey,focusedPosition=focused?.dataset.navPosition;
  const sections=h('div',{class:'sidebar-scroll',tabIndex:0,'aria-label':'Navigation sections'},...groups.map(([title,keys],index)=>h('div',{class:'nav-group',role:'group','aria-labelledby':`sidebar-group-${index}`},h('p',{class:'nav-group-label',id:`sidebar-group-${index}`,text:title}),...keys.map(key=>navLink(key)))));
  root.replaceChildren(
    h('a',{class:'sidebar-brand',href:'#/overview',title:'Morrow home','aria-label':'Morrow home'},brandMark('brand-mark sidebar-brand-mark'),h('strong',{class:'brand-wordmark',text:'morrow'})),
    sections,
    h('div',{class:'workspace-profile'},avatar(workspaceAvatar(),'profile-avatar'),h('div',{},h('strong',{text:S.status?.name || S.user?.name || 'Your workspace'}),h('span',{text:S.accountMode==='local'?'Personal workspace':S.user?.role==='admin'?'Administrator':S.user?`${S.user.plan_name} plan`:'Personal workspace'}))),
    h('div',{class:'sidebar-foot'},h('span',{class:`status-pin ${S.online ? 'connected' : ''}`}),h('span',{text:S.online?'Connected · private workspace':'Reconnecting to workspace…'})),
    h('div',{class:'mobile-primary',style:{gridTemplateColumns:`repeat(${primary.length+1},minmax(0,1fr))`}},...primary.map(key=>navLink(key,'mobile')),h('button',{class:`nav-item ${primary.includes(activePrimary)?'':'active'}`,type:'button',dataset:{navKey:'more',navPosition:'mobile'},'aria-label':'More sections','aria-haspopup':'dialog','aria-controls':'mobile-nav','aria-expanded':String(mobile.open),onclick:openMore},navigationArt('more','nav-art'),h('span',{class:'nav-copy'},h('span',{class:'nav-title',text:'More'})))));
  sections.scrollTop=scrollTop;root.dataset.route=signature;
  if(focusedKey&&!changed)[...root.querySelectorAll('[data-nav-key]')].find(a=>a.dataset.navKey===focusedKey&&a.dataset.navPosition===focusedPosition)?.focus({preventScroll:true});
  if(changed&&matchMedia('(min-width:768px)').matches){
    const active=sections.querySelector('.nav-item[aria-current]');
    if(active){const a=active.getBoundingClientRect(),s=sections.getBoundingClientRect();if(a.bottom>s.bottom)sections.scrollTop+=a.bottom-s.bottom+8;else if(a.top<s.top)sections.scrollTop-=s.top-a.top+8;}
  }
}
