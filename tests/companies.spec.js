import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const key='a'.repeat(24);
const acme={company_id:key,name:'Acme Labs',status:'partial',updated_at:1793610000,notes:'No public CTO or hiring manager could be confirmed.',error:'',job_count:2,
  fields:{website:[{value:'https://example.com',source:'https://example.com/about',evidence:'Acme Labs builds developer tools.'}],email:[{value:'careers@example.com',source:'https://example.com/careers',evidence:'Email careers@example.com to apply.'}],location:[{value:'Gurugram, India',source:'https://example.com/about',evidence:'Our team works in Gurugram, India.'}]},
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
      if(q)rows=rows.filter(row=>row.name.toLowerCase().includes(q.toLowerCase()));
      if(status&&status!=='all')rows=rows.filter(row=>row.status===status);
      return route.fulfill({json:{rows,counts,total:rows.length,pending:1,page:1,pages:1,size:20}});
    }
    if(path.pathname==='/api/application-agent') return route.fulfill({json:{enabled:true,limit:5,budget:2,attempts:[{job_id:'j1',title:'AI Engineer',company:'Acme Labs',state:'uncertain',next_step:'Check Sent before retrying.',detail:'No matching confirmation was found.'}]}});
    if(path.pathname==='/api/preview')return route.fulfill({json:{shown:'venv/bin/python -m common.company_research --limit 10'}});
    if(!['GET','HEAD'].includes(route.request().method()))return route.fulfill({status:409,json:{error:'Read-only UI test: no real actions.'}});
    return route.continue();
  });
});

for(const width of [1440,375])test(`company database and evidence are usable at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/#/companies');
  await expect(page.getByRole('heading',{name:'Company knowledge',exact:true})).toBeVisible();
  const searchWidth = await page.getByRole('searchbox',{name:'Search companies'}).evaluate(element=>element.getBoundingClientRect().width);
  expect(searchWidth).toBeGreaterThan(240);
  await expect(page.getByRole('link',{name:'Acme Labs',exact:true})).toBeVisible();
  await page.getByRole('searchbox',{name:'Search companies'}).fill('Northstar');
  await expect(page.getByRole('link',{name:'Northstar Systems',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Acme Labs',exact:true})).toHaveCount(0);
  await page.getByRole('searchbox',{name:'Search companies'}).fill('');
  await page.getByRole('button',{name:'1 Partial findings',exact:true}).click();
  await expect(page.getByRole('link',{name:'Northstar Systems',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await mkdir('artifacts/companies',{recursive:true});
  await page.screenshot({path:`artifacts/companies/list-${width}.png`,fullPage:true});
  await page.getByRole('link',{name:'Acme Labs',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Acme Labs',exact:true})).toBeVisible();
  await expect(page.getByText('careers@example.com',{exact:true})).toBeVisible();
  await expect(page.locator('.company-field').filter({has:page.getByRole('heading',{name:'CTO',exact:true})})).toContainText('Not found in checked sources');
  await expect(page.locator('.company-fields .company-source').first()).toHaveAttribute('href','https://example.com/about');
  await page.locator('.company-field details').first().locator('summary').click();
  await expect(page.getByText('Acme Labs builds developer tools.',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const scan=await new AxeBuilder({page}).include('.companies-page').analyze();
  expect(scan.violations).toEqual([]);
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
  await page.screenshot({path:`artifacts/companies/detail-${width}.png`,fullPage:true});
});

test('research previews the bounded action and cancellation sends no run',async({page})=>{
  let starts=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/run'&&r.method()==='POST')starts++;});
  await page.goto('/#/companies');
  await page.getByRole('button',{name:'Research next 10',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('up to 10');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);expect(starts).toBe(0);
});

test('company load failures provide retry and empty searches remain clear',async({page})=>{
  let fail=true;
  await page.route('**/api/companies?*',route=> fail ? route.fulfill({status:503,json:{error:'Research database unavailable'}}) : route.fulfill({json:{rows:[],counts,total:0,pending:1,page:1,pages:1,size:20}}));
  await page.goto('/#/companies');
  await expect(page.getByRole('alert')).toContainText('Research database unavailable');
  fail=false;await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.getByText('No companies match these filters.',{exact:true})).toBeVisible();
});

test('agent review requires explicit checked outcome and preserves cancel',async({page})=>{
  let writes=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/application-agent/resolve')writes++;});
  await page.goto('/#/bots');
  await expect(page.getByRole('heading',{name:'Application intelligence',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'I verified nothing was sent',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Gmail Sent');
  await page.keyboard.press('Escape');expect(writes).toBe(0);
});
