import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const key='a'.repeat(24);
const acme={company_id:key,name:'Acme Labs',status:'partial',updated_at:1793610000,notes:'No public CTO or hiring manager could be confirmed.',error:'',job_count:2,
  fields:{website:[{value:'https://example.com',source:'https://example.com/about',evidence:'Acme Labs builds developer tools.'}],email:[{value:'careers@example.com',source:'https://example.com/careers',evidence:'Email careers@example.com to apply.'}],phone:[{value:'+1 415 555 0100',source:'https://example.com/contact',evidence:'Business phone: +1 415 555 0100.'}],location:[{value:'Gurugram, India',source:'https://example.com/about',evidence:'Our team works in Gurugram, India.'}]},
  jobs:[{title:'AI Engineer',url:'https://example.com/jobs/1'},{title:'Backend Engineer',url:'https://example.com/jobs/2'}]};
const pending={...acme,company_id:'b'.repeat(24),name:'Northstar Systems',status:'pending',fields:{},job_count:1,updated_at:null};
const missing={...acme,company_id:'c'.repeat(24),name:'Unlisted Employer',status:'not_found',fields:{},job_count:1};
const counts={pending:1,researching:0,found:0,partial:1,not_found:1,failed:0};
test.beforeEach(async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url());
    if(path.pathname==='/api/companies') {
      let rows=[acme,pending,missing];
      const id=path.searchParams.get('id'),q=path.searchParams.get('q'),status=path.searchParams.get('status');
      if(id) rows=rows.filter(row=>row.company_id===id);
      if(q)rows=rows.filter(row=>(row.name+JSON.stringify(row.fields)).toLowerCase().includes(q.toLowerCase()));
      if(status&&status!=='all')rows=rows.filter(row=>row.status===status);
      const contact=path.searchParams.get('contact');
      if(contact==='email'||contact==='phone')rows=rows.filter(row=>row.fields[contact]?.length);
      if(contact==='missing')rows=rows.filter(row=>!row.fields.email?.length&&!row.fields.phone?.length);
      return route.fulfill({json:{rows,counts,contact_counts:{all:3,email:1,phone:1,missing:2},total:rows.length,pending:1,page:1,pages:1,size:20}});
    }
    if(path.pathname==='/api/application-agent') return route.fulfill({json:{enabled:true,limit:5,budget:2,attempts:[{job_id:'j1',title:'AI Engineer',company:'Acme Labs',state:'uncertain',next_step:'Check Sent before retrying.',detail:'No matching confirmation was found.'}]}});
    if(path.pathname==='/api/preview')return route.fulfill({json:{shown:'venv/bin/python -m common.company_research --limit 10'}});
    if(!['GET','HEAD'].includes(route.request().method()))return route.fulfill({status:409,json:{error:'Read-only UI test: no real actions.'}});
    return route.continue();
  });
});

for(const width of [1440,1024,768,375])test(`spreadsheet contacts and details work at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/#/companies');
  await expect(page.getByRole('heading',{name:'Companies',exact:true})).toBeVisible();
  const table=page.getByRole('table').first();
  await expect(table.getByRole('columnheader')).toHaveText(width<=700?['','Company','Email','Phone']:['','Company','Email','Phone','Research','Details']);
  await expect(table.getByText('careers@example.com',{exact:true})).toBeVisible();
  for(const contact of ['Copy email: careers@example.com','Copy phone: +1 415 555 0100']){
    const bounds=await page.getByRole('button',{name:contact,exact:true}).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
  }
  await mkdir('artifacts/companies',{recursive:true});
  await page.screenshot({path:`artifacts/companies/table-${width}.png`,fullPage:true});
  const scan=await new AxeBuilder({page}).include('.companies-page').analyze();expect(scan.violations).toEqual([]);
  await page.getByRole('searchbox',{name:'Search companies'}).fill('Northstar');
  await expect(table.getByRole('button',{name:'Northstar Systems',exact:true})).toBeVisible();
  await expect(table.getByRole('button',{name:'Acme Labs',exact:true})).toHaveCount(0);
  await page.getByRole('searchbox',{name:'Search companies'}).fill('');
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.getByRole('combobox',{name:'Contact availability',exact:true}).click();
  await page.getByRole('option',{name:'With email (1)',exact:true}).click();
  await expect(table.getByRole('button',{name:'Northstar Systems',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.locator('.company-applied-filters')).toContainText('With email');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await table.getByRole('button',{name:'Acme Labs',exact:true}).click();
  const details=page.getByRole('dialog',{name:'Acme Labs',exact:true});
  await expect(details).toBeVisible();
  expect(await details.evaluate(el=>el.matches(':modal'))).toBe(width<=700);
  await expect(details.getByRole('link',{name:'Source · example.com'})).toHaveCount(2);
  await details.getByRole('button',{name:'Company',exact:true}).click();
  await expect(details.getByRole('button',{name:'Company',exact:true})).toBeFocused();
  await expect(details).toContainText('No public CTO or hiring manager could be confirmed.');
  const detailScan=await new AxeBuilder({page}).include('.company-drawer').analyze();expect(detailScan.violations).toEqual([]);
  await page.screenshot({path:`artifacts/companies/details-${width}.png`,fullPage:true});
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(table.getByRole('button',{name:'Acme Labs',exact:true})).toBeFocused();
  await table.getByRole('button',{name:'Acme Labs',exact:true}).click();
  await page.getByRole('link',{name:'Open company page',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Acme Labs',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'← All companies',exact:true}).click();
  await expect(page.locator('.company-applied-filters')).toContainText('With email');
});

test('dense contacts stay compact with extra numbers available in details',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const many={...acme,fields:{...acme.fields,phone:[...acme.fields.phone,{value:'+1 415 555 0101',source:'https://example.com/contact'},{value:'+1 415 555 0102',source:'https://example.com/contact'}]}};
  const rows=[many,...Array.from({length:19},(_,i)=>({...pending,company_id:String(i).padStart(24,'0'),name:`Company ${i+2}`}))];
  await page.route('**/api/companies?*',route=>route.fulfill({json:{rows,counts,contact_counts:{all:20,email:1,phone:1,missing:19},total:20,page:1,pages:1,size:20}}));
  await page.goto('/#/companies');
  await expect(page.locator('.company-table tbody tr')).toHaveCount(20);
  const sizes=await page.locator('.company-table tbody tr').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));
  expect(Math.max(...sizes)).toBeLessThanOrEqual(72);expect(Math.max(...sizes)-Math.min(...sizes)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('table')).not.toContainText('+1 415 555 0102');
  await page.getByRole('button',{name:'2 more phone numbers for Acme Labs',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Acme Labs'})).toContainText('+1 415 555 0102');
  await page.keyboard.press('Escape');
  const region=page.getByRole('region',{name:'Company contacts'});
  await region.evaluate(el=>{el.scrollTop=600;});
  const top=await region.boundingBox(),header=await page.getByRole('columnheader',{name:'Email',exact:true}).boundingBox();
  expect(Math.abs(top.y-header.y)).toBeLessThanOrEqual(1);
});

test('pagination keeps keyboard focus and an open drawer survives refreshes',async({page})=>{
  let fetches=0;
  await page.route('**/api/companies?*',route=>{
    fetches++;
    const query=new URL(route.request().url()).searchParams,number=Number(query.get('page'))||1,size=Number(query.get('size'))||20;
    return route.fulfill({json:{rows:number===1?[acme]:[pending],counts,total:40,page:number,pages:Math.ceil(40/size),size}});
  });
  await page.goto('/#/companies');
  await page.getByRole('button',{name:'Page 2',exact:true}).click();
  await expect(page.getByRole('button',{name:'Page 2',exact:true})).toBeFocused();
  await expect(page.getByRole('button',{name:'Northstar Systems',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Page 1',exact:true}).click();
  await page.getByRole('button',{name:'Acme Labs',exact:true}).click();
  const detail=page.getByRole('dialog',{name:'Acme Labs',exact:true}),before=fetches;
  await page.clock.install();await page.clock.fastForward(6000);
  await expect(detail).toBeVisible();expect(fetches).toBe(before);
  await page.keyboard.press('Escape');
  await page.getByRole('combobox',{name:'Rows per page',exact:true}).click();
  await page.getByRole('option',{name:'50 per page',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Rows per page',exact:true})).toBeFocused();
  await expect(page).toHaveURL(/size=50/);
});

test('selected rows persist across filters and start only that exact Gmail draft batch',async({page})=>{
  const writes=[];
  await page.route('**/api/companies?*',route=>{
    const q=new URL(route.request().url()).searchParams.get('q');
    const rows=q?[pending]:[acme,pending,missing];
    return route.fulfill({json:{rows,counts,total:rows.length,page:1,pages:1,size:20,outreach:{sender:'applicant@gmail.com',gmail_configured:true,gmail_method:'browser'}}});
  });
  await page.route('**/api/run',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{id:'fixture-run',label:'Company email drafts'}});});
  await page.goto('/#/companies');
  await expect(page.getByRole('button',{name:'Draft selected (0)',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'Select Acme Labs',exact:true}).check();
  await page.getByRole('searchbox',{name:'Search companies',exact:true}).fill('Northstar');
  await expect(page.getByRole('checkbox',{name:'Select Acme Labs',exact:true})).toHaveCount(0);
  await page.getByRole('checkbox',{name:'Select Northstar Systems',exact:true}).check();
  await page.getByRole('button',{name:'Draft selected (2)',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('Acme Labs, Northstar Systems');
  await expect(dialog).toContainText('No emails are sent.');
  expect(writes).toHaveLength(0);
  await dialog.getByRole('button',{name:'Save to Gmail Drafts',exact:true}).click();
  await expect(page.getByRole('group',{name:'Table view',exact:true}).getByRole('button',{name:'Drafts',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(writes).toEqual([{action:'company_outreach',options:{companies:[key,pending.company_id],require_gmail:true}}]);
  await expect(page.getByRole('button',{name:'Draft selected (0)',exact:true})).toBeDisabled();
});

test('select page and clear selection remain explicit and cancellation starts nothing',async({page})=>{
  let starts=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/run'&&request.method()==='POST')starts++;});
  await page.route('**/api/companies?*',route=>route.fulfill({json:{rows:[acme,pending,missing],counts,total:3,page:1,pages:1,size:20,outreach:{sender:'applicant@gmail.com',gmail_configured:true}}}));
  await page.goto('/#/companies');
  await page.getByRole('checkbox',{name:'Select companies on this page',exact:true}).check();
  await expect(page.locator('tbody input:checked')).toHaveCount(3);
  await page.getByRole('checkbox',{name:'Select Acme Labs',exact:true}).uncheck();
  await expect(page.getByRole('checkbox',{name:'Select companies on this page',exact:true})).toBeChecked({indeterminate:true});
  await page.getByRole('button',{name:'Draft selected (2)',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();expect(starts).toBe(0);
  await page.getByRole('button',{name:'Clear selection',exact:true}).click();
  await expect(page.locator('tbody input:checked')).toHaveCount(0);
});

test('copy buttons copy exact contacts and explain clipboard denial',async({page})=>{
  await page.addInitScript(()=>{
    window.copiedContacts=[];
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{if(window.denyCopy)throw new Error('denied');window.copiedContacts.push(value);}}});
  });
  await page.goto('/#/companies');
  await page.getByRole('button',{name:'Copy email: careers@example.com',exact:true}).click();
  await page.getByRole('button',{name:'Copy phone: +1 415 555 0100',exact:true}).click();
  expect(await page.evaluate(()=>window.copiedContacts)).toEqual(['careers@example.com','+1 415 555 0100']);
  await page.evaluate(()=>{window.denyCopy=true;});
  await page.getByRole('button',{name:'Copy email: careers@example.com',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Select the text and copy it manually.');
});

test('find and draft supports all remaining but cancellation starts nothing',async({page})=>{
  let starts=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/run'&&r.method()==='POST')starts++;});
  await page.goto('/#/companies');
  await page.getByRole('combobox',{name:'Companies per run',exact:true}).click();
  await page.getByRole('option',{name:'All',exact:true}).click();
  await page.getByRole('button',{name:'Find emails & draft',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('all remaining companies');
  await expect(page.getByRole('dialog')).toContainText('No emails are sent.');
  await page.keyboard.press('Escape');expect(starts).toBe(0);
});

test('pitch preview shows recipient resume and accurate local status',async({page})=>{
  await page.route('**/api/companies?*',route=>route.fulfill({json:{rows:[{...acme,drafts:[{draft_id:'d1',recipient:'careers@example.com',state:'local',subject:'AI Engineer application',body:'I build evaluation tools. My resume is attached.',resume:'Candidate_Resume.pdf',download_url:'/reports/2026-11-03/emails/pitch.eml',gmail_url:''}]}],counts,contact_counts:{all:1,email:1,phone:1,missing:0},total:1,page:1,pages:1,size:20,outreach:{sender:'applicant@gmail.com',gmail_configured:false}}}));
  await page.goto('/#/companies');
  await page.getByRole('group',{name:'Table view',exact:true}).getByRole('button',{name:'Drafts',exact:true}).click();
  await expect(page.getByRole('table')).toContainText('Saved locally');
  await expect(page).toHaveURL(/view=drafts/);
  await page.getByRole('button',{name:'Review draft',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('careers@example.com');
  await expect(dialog).toContainText('Resume attached: Candidate_Resume.pdf');
  await expect(dialog.getByRole('link',{name:'Download email + resume',exact:true})).toHaveAttribute('href','/reports/2026-11-03/emails/pitch.eml');
  await expect(dialog.getByRole('link',{name:'Open Gmail draft',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Close company details',exact:true}).click();
  await expect(dialog).not.toBeVisible();
});

test('Gmail connection uses a secret field and only saves after explicit connect',async({page})=>{
  const writes=[];
  await page.route('**/api/company-outreach/gmail',route=>{writes.push(route.request().postDataJSON());return route.fulfill({json:{connected:true,sender:'applicant@gmail.com'}});});
  await page.goto('/#/companies');
  await page.getByRole('button',{name:'Connect Gmail',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('textbox',{name:'Gmail address'})).toBeVisible();
  await dialog.getByLabel('Gmail address',{exact:true}).fill('applicant@gmail.com');
  await dialog.getByLabel('Google app password',{exact:true}).fill('abcdefghijklmnop');
  expect(writes).toHaveLength(0);
  await dialog.getByRole('button',{name:'Connect Gmail',exact:true}).click();
  await expect(page.getByText('Gmail Drafts connected.',{exact:true})).toBeVisible();
  expect(writes).toEqual([{sender:'applicant@gmail.com',password:'abcdefghijklmnop'}]);
  await expect(page.getByLabel('Google app password',{exact:true})).toHaveValue('');
});

test('load failure can retry and empty filters can reset',async({page})=>{
  let fail=true;
  await page.route('**/api/companies?*',route=>fail?route.fulfill({status:503,json:{error:'Research database unavailable'}}):route.fulfill({json:{rows:[],counts,total:0,page:1,pages:1,size:20}}));
  await page.goto('/#/companies');
  await expect(page.getByRole('alert')).toContainText('Research database unavailable');
  fail=false;await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.getByRole('button',{name:'Clear filters',exact:true})).toBeVisible();
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
