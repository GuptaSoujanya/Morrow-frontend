import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const key='a'.repeat(24);
const acme={company_id:key,name:'Acme Labs',status:'partial',updated_at:1793610000,notes:'No public CTO or hiring manager could be confirmed.',error:'',job_count:2,
  fields:{website:[{value:'https://example.com',source:'https://example.com/about',evidence:'Acme Labs builds developer tools.'}],email:[{value:'careers@example.com',source:'https://example.com/careers',evidence:'Email careers@example.com to apply.'}],phone:[{value:'+1 415 555 0100',source:'https://example.com/contact',evidence:'Business phone: +1 415 555 0100.'}],location:[{value:'Gurugram, India',source:'https://example.com/about',evidence:'Our team works in Gurugram, India.'}]},
  jobs:[{job_id:'j1',title:'AI Engineer',url:'https://example.com/jobs/1'},{job_id:'j2',title:'Backend Engineer',url:'https://example.com/jobs/2'}]};
const pending={...acme,company_id:'b'.repeat(24),name:'Northstar Systems',status:'pending',fields:{},jobs:[{job_id:'n1',title:'AI Engineer',url:'https://example.com/northstar'}],job_count:1,updated_at:null};
const missing={...acme,company_id:'c'.repeat(24),name:'Unlisted Employer',status:'not_found',fields:{},jobs:[{job_id:'u1',title:'AI Engineer',url:'https://example.com/unlisted'}],job_count:1};
const counts={pending:1,researching:0,found:0,partial:1,not_found:1,failed:0};
const outreach={sender:'applicant@gmail.com',gmail_configured:true,gmail_method:'browser',workflow_version:2,resume_ready:true,resume_name:'Resume.pdf'};
const payload=rows=>({rows,counts,contact_counts:{all:3,email:1,phone:1,missing:2},total:rows.length,page:1,pages:1,size:20,outreach});
test.beforeEach(async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url());
    if(path.pathname==='/api/companies') {
      let rows=[acme,pending,missing];
      const id=path.searchParams.get('id'),q=path.searchParams.get('q'),status=path.searchParams.get('status');
      if(id) rows=rows.filter(row=>row.company_id===id);
      const ids=path.searchParams.get('ids');if(ids)rows=rows.filter(row=>ids.split(',').includes(row.company_id));
      if(q)rows=rows.filter(row=>(row.name+JSON.stringify(row.fields)).toLowerCase().includes(q.toLowerCase()));
      if(status&&status!=='all')rows=rows.filter(row=>row.status===status);
      const contact=path.searchParams.get('contact');
      if(contact==='email'||contact==='phone')rows=rows.filter(row=>row.fields[contact]?.length);
      if(contact==='missing')rows=rows.filter(row=>!row.fields.email?.length&&!row.fields.phone?.length);
      return route.fulfill({json:payload(rows)});
    }
    if(path.pathname==='/api/application-agent') return route.fulfill({json:{enabled:true,limit:5,budget:2,attempts:[{job_id:'j1',title:'AI Engineer',company:'Acme Labs',state:'uncertain',next_step:'Check Sent before retrying.',detail:'No matching confirmation was found.'}]}});
    if(path.pathname==='/api/preview')return route.fulfill({json:{shown:'venv/bin/python -m common.company_research --limit 10'}});
    if(!['GET','HEAD'].includes(route.request().method()))return route.fulfill({status:409,json:{error:'Read-only UI test: no real actions.'}});
    return route.continue();
  });
});

for(const width of [1440,1024,768,375])test(`outreach table and role controls work at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:960});await page.goto('/#/companies');
  const table=page.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText(width<=700?['','Company & role','Email & phone']:['','Company & role','Email & phone','Progress','Draft']);
  for(const name of ['Copy email: careers@example.com','Copy phone: +1 415 555 0100']){
    const bounds=await page.getByRole('button',{name,exact:true}).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
  }
  await page.getByRole('combobox',{name:'Role for Acme Labs'}).click();
  await page.getByRole('option',{name:'AI Engineer',exact:true}).click();
  await page.getByRole('checkbox',{name:'Select Acme Labs',exact:true}).check();
  await expect(page.getByRole('button',{name:'Create selected drafts (1)',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect((await new AxeBuilder({page}).include('.companies-page').analyze()).violations).toEqual([]);
  await mkdir('artifacts/companies',{recursive:true});
  await page.screenshot({path:`artifacts/companies/outreach-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.getByRole('combobox',{name:'Contact availability'}).click();
  await page.getByRole('option',{name:'With email (1)',exact:true}).click();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('button',{name:'Northstar Systems',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Acme Labs',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Acme Labs',exact:true});
  await expect(dialog.getByRole('link',{name:'Source · example.com'})).toHaveCount(2);
  await dialog.getByRole('button',{name:'Company',exact:true}).click();
  await expect(dialog).toContainText('No public CTO or hiring manager could be confirmed.');
  expect((await new AxeBuilder({page}).include('.company-drawer').analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Acme Labs',exact:true})).toBeFocused();
});

async function mockTab(page){
  await page.addInitScript(()=>{window.openedTabs=[];window.open=()=>{const tab={opener:window,closed:false,document:{title:'',body:{textContent:''}},location:{replace:value=>window.openedTabs.push(value)},close(){this.closed=true;}};return tab;};});
}
test('one click starts exactly the selected roles and opens the independent Gmail handoff tab',async({page})=>{
  const starts=[];await mockTab(page);
  await page.route('**/api/run',route=>{starts.push(route.request().postDataJSON());return route.fulfill({json:{id:'fixture-run',label:'Company drafts'}});});
  await page.goto('/#/companies');
  await page.getByRole('combobox',{name:'Role for Acme Labs'}).click();await page.getByRole('option',{name:'Backend Engineer',exact:true}).click();
  await page.getByRole('checkbox',{name:'Select Acme Labs',exact:true}).check();
  await page.getByRole('searchbox',{name:'Search companies'}).fill('Northstar');
  await expect(page.getByRole('checkbox',{name:'Select Acme Labs',exact:true})).toHaveCount(0);
  await page.getByRole('checkbox',{name:'Select Northstar Systems',exact:true}).check();
  await page.getByRole('button',{name:'Create selected drafts (2)',exact:true}).click();
  await expect.poll(()=>starts.length).toBe(1);
  expect(starts[0]).toEqual({action:'company_outreach',options:{companies:[key,pending.company_id],roles:{[key]:'j2',[pending.company_id]:'n1'},require_gmail:true}});
  await expect.poll(()=>page.evaluate(()=>window.openedTabs.length)).toBe(1);
  const destination=await page.evaluate(()=>window.openedTabs[0]);
  expect(destination).toContain('/#/companies?watch='+key+','+pending.company_id+'&since=');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a missing role cannot silently draft for a different job',async({page})=>{
  const starts=[];await page.route('**/api/run',route=>{starts.push(route.request());return route.fulfill({json:{}});});
  await page.goto('/#/companies');
  await page.getByRole('checkbox',{name:'Select Acme Labs',exact:true}).check();
  await page.getByRole('button',{name:'Create selected drafts (1)',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Choose the role for Acme Labs first.');
  await expect(page.getByRole('combobox',{name:'Role for Acme Labs'})).toBeFocused();expect(starts).toHaveLength(0);
});

test('a previous failed run does not stop the new workflow progress',async({page})=>{
  await mockTab(page);
  let started=false,ready=false;
  await page.route('**/api/run',route=>{started=true;return route.fulfill({json:{id:'new-run'}});});
  await page.route('**/api/companies?*',route=>{
    const polling=new URL(route.request().url()).searchParams.has('ids');
    const state=ready?{phase:'ready',message:'New draft verified.',updated_at:Date.now()/1000}: {phase:'failed',message:'Old failed run.',updated_at:1};
    return route.fulfill({json:payload([{...pending,workflow:polling&&started?state:null}])});
  });
  await page.goto('/#/companies');
  await page.getByRole('button',{name:'Create draft',exact:true}).click();
  const panel=page.getByRole('region',{name:'Current draft workflow'});
  await expect(panel).toContainText('Opening Gmail and starting your draft.');
  await expect(panel).not.toContainText('Old failed run.');
  ready=true;
  await expect(panel).toContainText('New draft verified.',{timeout:10000});
});

test('Gmail handoff waits for verified saved contents before opening the correct draft',async({page})=>{
  const since=Date.now()/1000,target='https://mail.google.com/mail/u/0/#search/verified-test';
  let ready=false;
  await page.route('https://mail.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Gmail test</title>Gmail draft'}));
  await page.route('**/api/companies?*',route=>route.fulfill({json:payload([{...acme,workflow:{phase:ready?'ready':'saving',message:ready?'Draft verified.':'Checking the attachment.',updated_at:since+1,title:'AI Engineer'},drafts:ready?[{state:'gmail',gmail_url:target}]:[]}])}));
  await page.goto('/#/companies?watch='+key+'&since='+since);
  await expect(page.getByRole('heading',{name:'Preparing your Gmail draft'})).toBeVisible();
  await expect(page.getByText('Checking the attachment.',{exact:true})).toBeVisible();
  expect(page.url()).not.toContain('mail.google.com');ready=true;
  await expect(page).toHaveURL(target,{timeout:10000});
});

test('role mismatch stays visible with the timeline and never opens Gmail',async({page})=>{
  const since=Date.now()/1000;
  await page.route('**/api/companies?*',route=>route.fulfill({json:payload([{...acme,workflow:{phase:'failed',message:'This role is not supported by the résumé. Choose a matching role.',updated_at:since+1,title:'Front Office Executive',history:[{phase:'contacts'},{phase:'writing'}]}}])}));
  await page.goto('/#/companies?watch='+key+'&since='+since);
  await expect(page.getByRole('heading',{name:'Some drafts need attention'})).toBeVisible();
  await expect(page.getByText('This role is not supported by the résumé. Choose a matching role.',{exact:true})).toBeVisible();
  expect((await new AxeBuilder({page}).include('.outreach-watch').analyze()).violations).toEqual([]);
  expect(page.url()).not.toContain('mail.google.com');
});

test('ready draft preview includes subject, recipient and resume with a direct Gmail link',async({page})=>{
  const target='https://mail.google.com/mail/u/0/#search/verified';
  await page.route('**/api/companies?*',route=>route.fulfill({json:payload([{...acme,drafts:[{state:'gmail',subject:'AI Engineer application',recipient:'careers@example.com',body:'I build evaluation tools. My resume is attached.',resume:'Resume.pdf',gmail_url:target}]}])}));
  await page.goto('/#/companies');
  await expect(page.getByRole('link',{name:'Open Gmail',exact:true}).first()).toHaveAttribute('href',target);
  await page.getByRole('button',{name:'Review pitch',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Acme Labs'});
  await expect(dialog).toContainText('AI Engineer application');await expect(dialog).toContainText('careers@example.com');await expect(dialog).toContainText('Resume attached: Resume.pdf');
  await expect(dialog.getByRole('link',{name:'Open Gmail draft',exact:true})).toHaveAttribute('target','_blank');
});

test('copy contacts, clear selection and recover a failed request',async({page})=>{
  await page.addInitScript(()=>{window.copiedContacts=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>window.copiedContacts.push(value)}});});
  await page.goto('/#/companies');
  await page.getByRole('button',{name:'Copy email: careers@example.com',exact:true}).click();
  await page.getByRole('button',{name:'Copy phone: +1 415 555 0100',exact:true}).click();
  expect(await page.evaluate(()=>window.copiedContacts)).toEqual(['careers@example.com','+1 415 555 0100']);
  await page.getByRole('checkbox',{name:'Select companies on this page',exact:true}).check();
  await expect(page.locator('tbody input:checked')).toHaveCount(3);
  await page.getByRole('button',{name:'Clear selection',exact:true}).click();await expect(page.locator('tbody input:checked')).toHaveCount(0);
  let fail=true;await page.route('**/api/companies?*',route=>fail?route.fulfill({status:503,json:{error:'Database unavailable'}}):route.fulfill({json:payload([])}));
  await page.getByRole('button',{name:'Refresh companies',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Database unavailable');
  fail=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.getByRole('button',{name:'Clear filters',exact:true})).toBeVisible();
});
test('agent review requires explicit checked outcome and preserves cancel',async({page})=>{
  let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/application-agent/resolve')writes++;});
  await page.goto('/#/bots');
  await page.getByRole('button',{name:/^Application history/}).click();
  await expect(page.getByRole('heading',{name:'Application history',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Review AI Engineer at Acme Labs',exact:true}).click();
  await page.getByRole('button',{name:'I verified nothing was sent',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Gmail Sent');
  await page.keyboard.press('Escape');expect(writes).toBe(0);
});

for(const [budget,limitText] of [[0,'no app-set dollar limit per task'],[2.5,'app-set limit: $2.5 per task']]) {
  test(`application task budget ${budget} clearly shows its app limit and account limits`,async({page})=>{
    const writes=[];
    page.on('request',request=>{if(!['GET','HEAD'].includes(request.method()))writes.push(request.url());});
    await page.route('**/api/application-agent',route=>route.fulfill({json:{enabled:true,limit:200,budget,attempts:[]}}));
    await page.goto('/#/bots');
    await page.getByRole('button',{name:/^Application history/}).click();
    const assistance=page.locator('.application-history details').filter({has:page.locator('summary').filter({hasText:'Assistance & limits'})});
    await expect(assistance).not.toHaveAttribute('open', '');
    await assistance.locator('summary').click();
    await expect(page.locator('.agent-task-limits')).toBeVisible();
    await expect(page.locator('.agent-task-limits')).toHaveText(`AI assistance is on · up to 200 tasks per bot run · ${limitText}.`);
    await expect(page.locator('.agent-usage-note')).toHaveText('Claude account usage limits still apply. This app setting does not show your actual charges.');
    await expect(page.locator('.agent-task-limits')).not.toContainText('$0');
    await expect(page.locator('.agent-task-limits')).not.toContainText('maximum');
    expect(writes).toEqual([]);
  });
}

test('application review saves only the explicitly confirmed outcome',async({page})=>{
  const writes=[];
  await page.route('**/api/application-agent/resolve',route=>{
    writes.push(route.request().postDataJSON());
    return route.fulfill({json:{ok:true}});
  });
  await page.goto('/#/bots');
  await page.getByRole('button',{name:/^Application history/}).click();
  for(const [action,confirmation,outcome] of [
    ['I verified it was sent','Mark as confirmed','confirmed'],
    ['I verified nothing was sent','I checked: nothing was sent','not_sent'],
  ]) {
    const review=page.getByRole('button',{name:'Review AI Engineer at Acme Labs',exact:true});
    if(await review.getAttribute('aria-expanded')!=='true')await review.click();
    await page.getByRole('button',{name:action,exact:true}).click();
    const dialog=page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(writes).toHaveLength(outcome==='confirmed'?0:1);
    const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/application-agent'&&response.request().method()==='GET');
    await dialog.getByRole('button',{name:confirmation,exact:true}).click();
    await refreshed;
  }
  expect(writes).toEqual([{job_id:'j1',outcome:'confirmed'},{job_id:'j1',outcome:'not_sent'}]);
});
