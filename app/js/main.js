import './dev-tools.js';
import { h } from './dom.js';
import { revealPage } from './components/motion.js';
import { api, accountRequestSignal, invalidateAccountRequests } from './api.js';
import { accountRequest } from './account-client.js';
import { S, hooks, resetAccountState } from './state.js';
import { parseRoute, routeHref, SECTIONS, navigate } from './router.js';
import { renderNav } from './components/nav.js';
import { initConsole, appendRunLines, clearConsoleLines, updateConsoleStatus, updateConsoleConnection, setConsoleAccess } from './components/console.js';
import { resetSignInBrowsers } from './components/signin-browsers.js';
import { updateRunButtons } from './forms.js';
import { loadingState, errorState } from './components/panel.js';
import { createRouteShell } from './route-shell.js';
import { createScrollMemory, routeScrollKey } from './scroll-position.js';
import { createFocusRestorer } from './focus-restoration.js';
import { invalidateReads } from './query-client.js';
import { normalizeFirebaseActionLink } from './firebase-auth.js';
import { AUTH_ROUTES as authPages, ACCOUNT_ROUTES as accountPages, routeAccess, preloadRoute, keyboardRoutes, routeLabel } from './access-policy.js';
import { renderAccessState } from './views/access-state.js';
import { renderNotFound } from './views/not-found.js';
import { createRunStream, runLifecycleChanged } from './run-stream.js';
import { receiveAnswerNotifications, resetAnswerNotifications } from './answer-notifications.js';
normalizeFirebaseActionLink();
const refreshBots=()=>import('./views/bots.js').then(m=>m.refreshBots());
const content = document.getElementById('content');
const shell=createRouteShell(content);
const scrollMemory=createScrollMemory(content);
const focusRestorer=createFocusRestorer(content);
let presentedRoute=null;
document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); content.focus(); });
let booting = null;
let identityRevision = 0;
let refreshAfterBoot = false;
let timer;
let deferredRender;
let runStream;
let backgroundRefresh;
let statusRefresh;
let lifecycleTimer;
let pendingRunFinish = false;
let runLifecycleRevision = 0;
S.forms = { naukri: { dry_run: true }, external: { dry_run: true }, profile: { dry_run: true },
  boards: { dry_run: true }, pipeline: { dry_run: true }, linkedin: { mode: 'dry-run' },
  linkedin_profile:{dry_run:true}, cold_email:{dry_run:true} };
function accountChrome(){
  const auth=authPages.has(S.route.name)||(S.accountMode==='accounts'&&!S.user);
  document.body.classList.toggle('auth-pending',!S.accountMode);
  document.body.classList.toggle('auth-screen',auth);
  const available=!auth&&!!(S.accountMode==='local'||S.user);
  const dock=document.getElementById('console-dock');
  dock.hidden=!available;
  dock.setAttribute('aria-label',S.legacyAccess?'Run console and browser controls':'Browser controls');
  setConsoleAccess(available);
}
function clearWorkspace(pending=false){
  scrollMemory.clear();focusRestorer.clear();presentedRoute=null;
  identityRevision+=1;refreshAfterBoot=false;
  runStream?.close();runStream=null;
  invalidateAccountRequests();
  resetAnswerNotifications();
  resetSignInBrowsers();
  clearTimeout(timer);clearTimeout(deferredRender);clearTimeout(lifecycleTimer);clearConsoleLines();
  pendingRunFinish=false;
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
  resetAccountState();S.accountMode=pending?null:'accounts';
  accountChrome();renderNav();
}
async function readIdentity(){
  const scope=accountRequestSignal(),revision=++identityRevision;
  try{
    const context=await api('/api/session');
    scope.throwIfAborted();
    return revision===identityRevision?context:null;
  }catch(error){
    scope.throwIfAborted();
    // An older refresh must neither restore old permissions nor expire a newer
    // successful identity read when its delayed response is unauthorized.
    if(revision!==identityRevision)return null;
    throw error;
  }
}
async function refreshAccount(){
  if(booting&&!booting.aborted){await boot();return S.user;}
  const context=await readIdentity();
  if(!context)return S.user;
  if(S.user&&(context.user?.id!==S.user.id||context.legacy_access!==S.legacyAccess)){await boot();return S.user;}
  S.user=context.user;S.accountMode=context.mode;S.legacyAccess=context.legacy_access;
  renderNav();render(false);return S.user;
}
async function logout(){
  const token=document.cookie.split('; ').find(row=>row.startsWith('morrow_csrf='))?.split('=').slice(1).join('=')||'';
  const response=await fetch('/api/v1/auth/logout',{method:'POST',headers:{'X-CSRF-Token':token}});
  if(!response.ok&&response.status!==401)throw new Error('Sign out could not complete. Please try again.');
  clearWorkspace();navigate('login');S.route=parseRoute();render(true);
}
function expired(){
  if(!S.user)return;
  clearWorkspace();navigate('login');S.route=parseRoute();render(true);
}
window.addEventListener('account-expired',expired);
window.addEventListener('learning-updated', () => {
  S.learningRevision = (S.learningRevision || 0) + 1;
  S.learningActivity = null;
});

function online(value) {
  const changed = S.online !== value;
  S.online = value;
  document.getElementById('offline').hidden = value;
  if (changed) renderNav();
}

function resolveCurrentRoute() {
  const route = parseRoute();
  if (/^#\/?(?:research|study|dsa)(?:[/?]|$)/.test(location.hash) && route.name === 'learning') {
    const query = new URLSearchParams(location.hash.split('?')[1] || '');
    if (route.arg.startsWith('read/') && !query.has('from')) query.set('from', query.get('view') === 'resume' ? 'resume' : query.get('view') === 'library' ? 'library' : 'today');
    query.delete('view');
    history.replaceState(null, '', routeHref(route.name, route.arg) + (query.size ? '?' + query : ''));
  }
  const access = routeAccess(route, S);
  if (access.kind !== 'redirect') return route;
  history.replaceState(null, '', routeHref(access.route.name, access.route.arg));
  return access.route;
}

function render(scroll = false) {
  focusRestorer.clear();
  S.route=resolveCurrentRoute();
  const commitPosition=()=>{
    const changed=presentedRoute!==routeScrollKey(S.route);
    presentedRoute=routeScrollKey(S.route);
    const restore=scrollMemory.begin(S.route,{reset:scroll});
    return ()=>{
      restore();
      if(changed||scroll)content.focus({preventScroll:true});
    };
  };
  if(S.route.name==='not-found'){
    accountChrome();
    shell.state(renderNotFound(S.route,S),commitPosition());
    document.title='Page not found · Morrow';
    renderNav();
    return;
  }
  if(S.accountMode==='accounts'&&!S.user&&!authPages.has(S.route.name)){
    history.replaceState(null,'','#/login');S.route=parseRoute();
  }
  accountChrome();
  const access=routeAccess(S.route,S);
  if(access.kind==='loading'){
    renderNav();shell.state(loadingState('Opening your workspace…'),commitPosition());return;
  }
  if(['upgrade','runtime','forbidden'].includes(access.kind)){
    shell.state(renderAccessState({route:S.route,kind:access.kind,user:S.user,module:access.module}),commitPosition());
    document.title=`${routeLabel(S.route.name,S)||SECTIONS.find(([name])=>name===S.route.name)?.[1]||'Workspace'} · Morrow`;
    renderNav();return;
  }
  if(accountPages.has(S.route.name)){
    shell.account(S.route,{user:S.user,onAuthenticated:boot,onRefresh:refreshAccount,onLogout:logout},commitPosition());
    document.title=`${SECTIONS.find(([name])=>name===S.route.name)?.[1]||'Account'} · Morrow`;
    renderNav();return;
  }
  if (!S.meta || !S.status || !S.course) {
    renderNav();
    if(!booting)boot(true);
    return;
  }
  clearTimeout(deferredRender);
  if (!scroll && content.querySelector(':popover-open')) {
    deferredRender = setTimeout(() => render(false), 180);
    return;
  }
  const changed=presentedRoute!==routeScrollKey(S.route);
  const focusKey = S.pendingFocusKey || (!changed && !scroll && document.activeElement?.dataset.focusKey);
  S.pendingFocusKey=null;
  const selection = focusKey && typeof document.activeElement.selectionStart === 'number' ? [document.activeElement.selectionStart,document.activeElement.selectionEnd] : null;
  const route={...S.route};
  const viewRoute={...route,name:!S.legacyAccess&&route.name==='setup'?'account':preloadRoute(route,S)};
  if(viewRoute.name==='account'){shell.account(viewRoute,{user:S.user,onRefresh:refreshAccount,onLogout:logout},commitPosition());renderNav();return;}
  const restorePosition=commitPosition();
  const restoreFocus=focusRestorer.prepare(focusKey,selection);
  shell.route(viewRoute,()=>{
    const page=content.querySelector('.page');
    if(changed||scroll) revealPage(page);
    document.title=`${routeLabel(route.name,S)||SECTIONS.find(([name])=>name===route.name)?.[1]||'Workspace'} · Morrow`;
    updateRunButtons();
    restorePosition();
    restoreFocus();
  },()=>render(false));
  renderNav();
}

hooks.requestRender = (scroll = false) => {
  if (S.pendingRender) return;
  S.pendingRender = true;
  requestAnimationFrame(() => { S.pendingRender = false; render(scroll); });
};
hooks.refreshStatus = ({refreshRun=true}={}) => {
  const scope=accountRequestSignal();
  // Mutation callers need a request made after their command, even when a
  // background summary read is already pending or SSE is reconnecting.
  const activityRefresh=refreshRun&&runStream?runStream.refresh():Promise.resolve();
  if(statusRefresh?.scope===scope)return Promise.all([statusRefresh.promise,activityRefresh]).then(()=>scope.throwIfAborted());
  const work={scope};
  work.promise=(async()=>{
    const previous=S.status;
    const [status]=await Promise.all([api('/api/status',undefined,{onOnline:online}),activityRefresh]);
    scope.throwIfAborted();
    // A slower summary request must never replace a newer streamed run or advance
    // its log cursor without delivering the corresponding lines.
    S.status={...status,run:runStream&&S.status?.run?S.status.run:status.run};
    updateConsoleStatus(S.status.run);updateRunButtons();
    if(previous?.study&&JSON.stringify(previous.study)!==JSON.stringify(S.status.study))await hooks.refreshCourse();
    scope.throwIfAborted();
    if(JSON.stringify(previous&&{...previous,run:null})!==JSON.stringify({...S.status,run:null})){
      renderNav();
      if(['overview','todo','sites'].includes(S.route.name)&&!content.contains(document.activeElement))render();
    }
  })().finally(()=>{if(statusRefresh===work)statusRefresh=null;});
  statusRefresh=work;
  return work.promise;
};
hooks.refreshCourse = async () => {
  S.course = await api('/api/course',undefined,{fresh:true});
  S.status.study = { today: S.course.today, read: S.course.read, total: S.course.total };
  if (S.route.name === 'learning') window.dispatchEvent(new Event('learning-refresh'));
};

function queueRunRefresh(finished){
  pendingRunFinish=pendingRunFinish||finished;
  clearTimeout(lifecycleTimer);
  const scope=accountRequestSignal();
  lifecycleTimer=setTimeout(async()=>{
    if(scope.aborted)return;
    const completed=pendingRunFinish;pendingRunFinish=false;
    try{
      if(completed){
        S.overview=null;S.pipeline=null;S.library=null;S.document=null;S.dataHub=null;
        await invalidateReads();scope.throwIfAborted();
      }
      await hooks.refreshStatus({refreshRun:false});scope.throwIfAborted();
      if(['overview','bots'].includes(S.route.name)&&routeAccess('bots',S).kind==='allowed')await refreshBots();
      scope.throwIfAborted();
      if(completed&&['overview','analytics','bots','pipeline','reports','research','records','data'].includes(S.route.name))render();
      if(completed&&S.route.name==='learning')window.dispatchEvent(new Event('learning-refresh'));
    }catch(error){if(error.name!=='AbortError')online(false);}
  },180);
}

function receiveRun(run){
  if(!S.status)return false;
  const reset=!!run.reset||!!(S.runEpoch&&run.epoch&&S.runEpoch!==run.epoch);
  if(!reset&&run.next<S.runNext)return false;
  if(run.epoch===S.status.run?.epoch&&Number.isSafeInteger(run.revision)&&Number.isSafeInteger(S.status.run?.revision)&&run.revision<S.status.run.revision)return false;
  if(reset){clearConsoleLines();S.runNext=0;}
  const previous=reset?null:S.status.run;
  const lifecycle=runLifecycleChanged(previous,run);
  appendRunLines((run.lines||[]).filter(([sequence])=>sequence>=S.runNext));
  S.runNext=run.next;S.runEpoch=run.epoch||S.runEpoch;
  S.status.run=run;online(true);
  receiveAnswerNotifications(run);
  updateConsoleStatus(run);updateRunButtons();
  if(lifecycle.changed||reset){runLifecycleRevision+=1;queueRunRefresh(lifecycle.finished||reset);}
  return true;
}

function startRunStream(){
  runStream?.close();runStream=null;
  if(!S.legacyAccess||!S.status)return;
  const scope=accountRequestSignal();
  runStream=createRunStream({
    signal:scope,
    getCursor:()=>({next:S.runNext,epoch:S.runEpoch}),
    readSnapshot:({next,epoch},{signal})=>api(`/api/run?${new URLSearchParams({after:String(next),...(epoch?{epoch}:{})})}`,undefined,{signal}),
    onSnapshot:receiveRun,
    onState:state=>{updateConsoleConnection(state);if(state==='offline')online(false);},
    // Re-resolve the account before retaining any data from a revoked stream.
    onAccessLost:()=>boot(),
  });
  runStream.start();
}

function poll(){
  if(booting&&!booting.aborted){refreshAfterBoot=true;return Promise.resolve();}
  const scope=accountRequestSignal();
  if(backgroundRefresh?.scope===scope)return backgroundRefresh.promise;
  clearTimeout(timer);
  const work={scope};
  work.promise=(async()=>{
    if(S.accountMode==='accounts'&&S.user){
      const previous=JSON.stringify(S.user);
      const context=await readIdentity();scope.throwIfAborted();
      if(!context)return;
      if(context.user?.id!==S.user.id||context.legacy_access!==S.legacyAccess){await boot();return;}
      S.user=context.user;S.accountMode=context.mode;S.legacyAccess=context.legacy_access;
      if(JSON.stringify(S.user)!==previous)render();
    }
    if(!S.legacyAccess||!S.meta||document.hidden)return;
    await hooks.refreshStatus({refreshRun:runStream?.state!=='live'});scope.throwIfAborted();
    if(['overview','bots'].includes(S.route.name)&&routeAccess('bots',S).kind==='allowed')await refreshBots();
    scope.throwIfAborted();
    if(S.route.name==='overview'&&S.overview&&Date.now()-S.overview.at>60000){S.overview=null;render();}
  })().catch(error=>{
    if(error.name==='AbortError')return;
    if(error.status===401)expired();else online(false);
  }).finally(()=>{
    if(backgroundRefresh===work)backgroundRefresh=null;
    if(!scope.aborted){clearTimeout(timer);timer=setTimeout(poll,30000);}
  });
  backgroundRefresh=work;
  return work.promise;
}

async function boot(preserveIdentity=false) {
  // A confirmed sign-in or changed account must supersede an older bootstrap.
  // Only repeated data loads for the same resolved identity may share that work.
  if (preserveIdentity===true&&booting&&!booting.aborted) return;
  // Moving from an account page to the first workspace page only needs its data.
  // Keep resolved navigation visible; a changed session still gets a full reset.
  const previous=preserveIdentity===true&&S.accountMode
    ? {id:S.user?.id,mode:S.accountMode,legacy:S.legacyAccess}:null;
  if(previous){clearTimeout(timer);clearTimeout(deferredRender);}
  else clearWorkspace(true);
  const scope=accountRequestSignal();
  booting = scope;
  if(parseRoute().name==='not-found')render();
  else shell.state(loadingState('Opening your workspace…'));
  try {
    let context=await readIdentity();
    if(refreshAfterBoot){refreshAfterBoot=false;context=await readIdentity();}
    if(!context)return;
    scope.throwIfAborted();
    if(previous&&(context.user?.id!==previous.id||context.mode!==previous.mode||context.legacy_access!==previous.legacy)){
      booting=null;await boot();return;
    }
    S.user=context.user;S.accountMode=context.mode;S.legacyAccess=context.legacy_access;
    S.route=resolveCurrentRoute();
    if(S.accountMode==='local' && S.route.name==='overview'){
      const setup=await api('/api/local-setup',undefined,{fresh:true});scope.throwIfAborted();
      if(setup.needs_setup)history.replaceState(null,'','#/onboarding');
    }
    if(S.user&&['login','signup'].includes(parseRoute().name)){
      let destination='overview';
      try{
        const setup=await accountRequest('/onboarding');scope.throwIfAborted();
        S.onboarding=setup;
        if(!setup.completed_at)destination='onboarding';
      }catch(error){if(error.name==='AbortError')throw error;}
      history.replaceState(null,'','#/'+destination);
    }
    S.route=parseRoute();
    accountChrome();
    renderNav();
    const initialAccess=routeAccess(S.route,S);
    if(accountPages.has(S.route.name)||initialAccess.kind!=='allowed'){
      render();
      if(S.user)timer=setTimeout(poll,30000);
      return;
    }
    // Load the first-screen data together: avoid rendering, then fetching, then replacing
    // the same headline twice while the overview and crew inventory arrive in sequence.
    const days=S.overviewDays;
    const initialRoute=preloadRoute(S.route,S);
    const needsOverview=['overview','analytics','tenant-overview'].includes(initialRoute);
    const needsBots=S.legacyAccess&&['overview','bots'].includes(initialRoute)&&routeAccess('bots',S).kind==='allowed';
    const initialRunRevision=runLifecycleRevision;
    const [meta,status,course,overview,bots]=await Promise.all([
      ...['/api/meta','/api/status','/api/course'].map(path=>api(path)),
      (needsOverview?api(`/api/overview?days=${days}`).then(data=>({days,data,at:Date.now(),error:''})).catch(error=>({days,at:Date.now(),error:error.message})):Promise.resolve(null)),
      (needsBots?api('/api/bots').then(data=>({data,at:Date.now()})).catch(error=>({at:Date.now(),error:error.message})):Promise.resolve(null)),
      (initialRoute?shell.preload(initialRoute).catch(()=>{}):Promise.resolve()),
    ]);
    scope.throwIfAborted();
    // A preserved workspace may keep receiving activity while its route data loads.
    // Keep those updates and discard summaries fetched before an agent finished.
    const streamedRun=previous&&runStream?S.status?.run:null;
    const activityChanged=initialRunRevision!==runLifecycleRevision;
    if(activityChanged){await invalidateReads();scope.throwIfAborted();}
    S.meta=meta;S.status=streamedRun?{...status,run:streamedRun}:status;S.course=course;
    S.overview=activityChanged?null:overview;S.bots=activityChanged?null:bots;
    online(true);
    S.route = parseRoute();
    updateConsoleStatus(S.status.run);
    receiveAnswerNotifications(S.status.run, {announce:false});
    startRunStream();
    render();
    clearTimeout(timer);
    timer = setTimeout(poll, 30000);
  } catch (error) {
    if(error.name==='AbortError')return;
    if(error.status===401){clearWorkspace();S.route=parseRoute();render();return;}
    S.route=parseRoute();
    accountChrome();
    online(false);
    const currentAccess=routeAccess(S.route,S);
    if(S.route.name==='not-found'||(S.accountMode&&(accountPages.has(S.route.name)||['upgrade','runtime','forbidden'].includes(currentAccess.kind)))){
      // A failed data load from a page we left cannot replace the current account
      // or access screen. Those pages have their own requests and retry controls.
      render();
      if(S.user)timer=setTimeout(poll,30000);
      return;
    }
    shell.state(errorState(`Your workspace is unavailable. ${error.message || 'Start the dashboard server, then reconnect.'}`, boot));
    timer = setTimeout(boot, 5000);
  } finally {
    if(booting===scope){
      booting=null;
      if(refreshAfterBoot){
        refreshAfterBoot=false;
        if(!scope.aborted&&(S.user||S.meta)){clearTimeout(timer);timer=setTimeout(poll,0);}
      }
    }
  }
}

window.addEventListener('hashchange', () => { S.route = parseRoute();render(); });
window.addEventListener('beforeunload', event => {
  if (Object.values(S.loadedFiles).some(file => file.draft !== file.text)) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide',()=>runStream?.close());
window.addEventListener('pageshow',event=>{if(event.persisted&&S.legacyAccess){startRunStream();poll();}});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(timer); (S.meta||S.user) ? poll() : !authPages.has(S.route.name)&&boot();if(S.meta&&S.route.name==='study'&&S.legacyAccess)hooks.refreshCourse().catch(()=>{}); } });
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, textarea, select, [contenteditable], dialog, [role="combobox"], [role="slider"], [popover]')) return;
  if (/^[1-9]$/.test(event.key)) {
    const destination=keyboardRoutes(S)[Number(event.key)-1];
    if(destination){event.preventDefault();navigate(destination);}
  }
});
initConsole();
renderNav();
boot();
