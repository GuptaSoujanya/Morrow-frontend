import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';

const saved = (id, answer='30 days') => ({id,kind:'answer_saved',question:'What is your notice period?',answer,
  source:'profile',run_id:'hirist-one',label:'Hirist · apply',at:'2026-10-24T12:00:00Z'});
async function fixture(page,{history=[],accounts=false}={}) {
  const state={snapshot:{epoch:'answers-test',revision:1,next:0,lines:[],notifications:history,runs:[],running:false},
    text:'Q: Existing answer\nA: Keep this\n',revision:'one',reads:0,writes:[],identity:accounts?
      {mode:'accounts',legacy_access:true,user:{id:'owner',name:'Owner',email:'owner@example.test',role:'admin',modules:['profile','files','automations']}}:
      {mode:'local',legacy_access:true,user:null}};
  await page.addInitScript(snapshot=>{
    window.__sources=[];window.__notificationRequests=0;window.__desktopAlerts=[];
    window.Notification=class {
      static permission='default';
      static async requestPermission(){window.__notificationRequests++;this.permission='granted';return 'granted';}
      constructor(title,options){this.title=title;this.options=options;window.__desktopAlerts.push(this);}
      close(){this.closed=true;this.onclose?.();}
    };
    window.EventSource=class extends EventTarget {
      constructor(){super();window.__sources.push(this);queueMicrotask(()=>this.dispatchEvent(new MessageEvent('run',{data:JSON.stringify(snapshot)})));}
      close(){this.closed=true;}
    };
    window.__pushAnswerRun=value=>window.__sources.at(-1).dispatchEvent(new MessageEvent('run',{data:JSON.stringify(value)}));
  },state.snapshot);
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/session')return route.fulfill({json:state.identity});
    if(path==='/api/run/answers'){
      if(!state.identity.legacy_access)return route.fulfill({status:403,json:{error:'Owner only'}});
      if(route.request().method()==='POST'){
        const body=route.request().postDataJSON();state.writes.push(body);
        if(body.revision!==state.revision)return route.fulfill({status:409,json:{error:'The agent saved more answers. Review the latest sheet.'}});
        state.text=body.text;state.revision+='-saved';
      }else state.reads++;
      return route.fulfill({json:{name:'automation_answers',scope:'automation',path:'Agent answer sheet · answers.txt',text:state.text,revision:state.revision}});
    }
    if(route.request().method()==='POST')return route.fulfill({status:409,json:{error:'Synthetic test: no real action'}});
    if(path==='/api/status')return route.fulfill({json:{name:'Demo',date:'2026-10-24',report:{ready:false,days:[]},questions:[],facts:[],sites:[],study:{today:0,read:0,total:0},run:state.snapshot}});
    if(path==='/api/meta')return route.fulfill({json:{files:{},answer_modes:[],linkedin_modes:[]}});
    if(path==='/api/course')return route.fulfill({json:{today:0,read:0,total:0,modules:[]}});
    if(path==='/api/file')return route.fulfill({json:{name:'profile',text:'full_name: Private account\n',revision:'private',path:'Private account file'}});
    if(path==='/api/run')return route.fulfill({json:state.snapshot});
    if(path==='/api/run/browsers')return route.fulfill({json:{runs:[]}});
    if(path==='/api/connections')return route.fulfill({json:{scope:'main',scopes:[],connections:[],browser_available:true}});
    return route.fulfill({json:{}});
  });
  state.push=async notifications=>{
    state.snapshot={...state.snapshot,revision:state.snapshot.revision+1,notifications};
    await page.evaluate(value=>window.__pushAnswerRun(value),state.snapshot);
  };
  return state;
}

test('saved-answer toast reviews the actual sheet and reconnect replay is deduplicated',async({page})=>{
  const state=await fixture(page);
  await page.goto('/#/files/answers');
  await expect(page.locator('.file-editor')).toBeVisible();
  await state.push([saved('first')]);
  await expect(page.locator('.answer-update-toast')).toContainText('Answer sheet updated');
  await page.getByRole('link',{name:'Review changes',exact:true}).click();
  await expect(page).toHaveURL(/#\/files\/automation_answers$/);
  await expect(page.getByRole('region',{name:'Recent agent answer changes'})).toContainText('30 days');
  await expect(page.getByRole('textbox',{name:'Agent answer sheet',exact:true})).toHaveValue(state.text);
  expect(state.reads).toBe(1);
  await state.push([saved('first')]);
  await expect(page.locator('.answer-update-toast')).toHaveCount(0);
  await expect(page.locator('.answer-review-entry')).toHaveCount(1);
});

test('new agent answers preserve an unsaved draft and stale saves cannot overwrite them',async({page})=>{
  const state=await fixture(page);
  await page.goto('/#/files/automation_answers');
  const editor=page.getByRole('textbox',{name:'Agent answer sheet',exact:true});
  await editor.fill('My unsaved answer edits');
  state.text+='\nQ: Notice period?\nA: 30 days\n';state.revision='two';
  await state.push([saved('first')]);
  await expect(editor).toHaveValue('My unsaved answer edits');
  await expect(editor).toBeFocused();
  await expect(page.locator('.answer-review-notice')).toContainText('Your draft is unchanged');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.locator('.inline-feedback')).toContainText('Your edits are still here');
  expect(state.text).toContain('30 days');
  await expect(editor).toHaveValue('My unsaved answer edits');
  await page.getByRole('button',{name:'Reload file',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(editor).toHaveValue('My unsaved answer edits');
});

test('desktop alerts require an explicit click and initial history is silent',async({page})=>{
  const state=await fixture(page,{history:[saved('old')]});
  await page.goto('/#/files/automation_answers');
  await expect(page.locator('.answer-review-entry')).toHaveCount(1);
  await expect(page.locator('.answer-update-toast')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__notificationRequests)).toBe(0);
  await page.getByRole('button',{name:'Enable desktop alerts',exact:true}).click();
  await expect(page.getByRole('button',{name:'Desktop alerts enabled',exact:true})).toBeDisabled();
  await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));
  await state.push([saved('old'),saved('new','15 days')]);
  expect(await page.evaluate(()=>window.__notificationRequests)).toBe(1);
  const alerts=await page.evaluate(()=>window.__desktopAlerts.map(alert=>({title:alert.title,body:alert.options.body})));
  expect(alerts).toEqual([{title:'Answer sheet updated',body:'Your agent saved an answer. Open Morrow to review it.'}]);
});

test('an account switch clears private updates and rejects old stream messages',async({page})=>{
  const state=await fixture(page,{accounts:true});
  await page.goto('/#/files/automation_answers');
  await expect(page.locator('.file-editor')).toBeVisible();
  await state.push([saved('private','Owner private answer')]);
  await expect(page.locator('.answer-review-entry')).toContainText('Owner private answer');
  state.identity={mode:'accounts',legacy_access:false,user:{id:'other',name:'Other',email:'other@example.test',role:'user',modules:['profile','files']}};
  await page.evaluate(()=>{window.__oldSource=window.__sources.at(-1);window.__oldSource.dispatchEvent(new Event('access-revoked'));});
  await expect(page.getByRole('textbox',{name:'Agent answer sheet',exact:true})).toHaveCount(0);
  await expect(page.locator('.answer-update-toast')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Owner private answer');
  await page.evaluate(snapshot=>window.__oldSource.dispatchEvent(new MessageEvent('run',{data:JSON.stringify(snapshot)})),{...state.snapshot,revision:999,notifications:[saved('late','Late private answer')]});
  await expect(page.locator('body')).not.toContainText('Late private answer');
});

test('answer review and notification fit a phone with accessible controls',async({page})=>{
  const state=await fixture(page);
  await page.setViewportSize({width:375,height:812});
  await page.goto('/#/files/automation_answers');
  await expect(page.locator('.file-editor')).toBeVisible();
  await state.push([saved('first')]);
  const result=await new AxeBuilder({page}).include('.answer-review').include('.answer-update-toast').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(result.violations.map(item=>item.id)).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await mkdir('artifacts/answer-notifications',{recursive:true});
  for(const width of [1280,375]){
    await page.setViewportSize({width,height:900});
    await page.locator('.answer-review').evaluate(element=>element.scrollIntoView({block:'start'}));
    await page.screenshot({path:`artifacts/answer-notifications/notification-${width}.png`,animations:'disabled'});
  }
});
