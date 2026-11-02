import { h } from '../dom.js';
import { api } from '../api.js';
import { panel, loadingState, errorState, empty, dataTable } from '../components/panel.js';
import { pagination } from '../components/pagination.js';
import { quickButton } from '../forms.js';
import { readQuery, writeQuery } from '../url-state.js';
import { selectControl } from '../components/controls.js';
import { navigationArt } from '../components/navigation-art.js';

export const researchLabels = { pending:'Pending', researching:'Researching', found:'Found', partial:'Partial', not_found:'Not found', failed:'Failed' };
const fields = { website:'Website', careers:'Careers page', email:'Business email', phone:'Business phone', ceo:'CEO', cto:'CTO', hiring_manager:'Hiring contact', location:'Location', industry:'Industry', about:'About', linkedin:'LinkedIn', size:'Company size' };
const url = value => { try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : ''; } catch { return ''; } };
const date = value => value ? new Date(value * 1000).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' }) : 'Not researched yet';
export const researchPill = status => h('span', { class:`company-status company-status-${Object.hasOwn(researchLabels, status) ? status : 'pending'}`, text:researchLabels[status] || 'Pending' });
function runButton(item) {
  return quickButton('company_research', item ? 'Research this company' : 'Research next 10',
    item ? {company:item.company_id, retry:true, limit:1} : {limit:10},
    {confirm:{title:item ? `Research ${item.name}?` : 'Research pending companies?',
      body:item ? 'Check public sources and refresh this company’s details. Missing facts stay marked as missing.' : 'Research up to 10 pending employers from your saved jobs using your connected AI provider. Results and sources are saved here. No messages are sent.'}});
}

function detail(item) {
  return h('div', {class:'company-detail'},
    h('div', {class:'company-detail-intro'}, researchPill(item.status), h('p', {text:`${Object.keys(item.fields).length} of ${Object.keys(fields).length} fields sourced · ${date(item.updated_at)}`})),
    item.error ? h('p', {class:'company-notice', role:'status', text:item.error}) : null,
    item.notes ? h('p', {class:'company-notice', text:item.notes}) : null,
    h('div', {class:'company-fields'}, Object.entries(fields).map(([key, label]) => {
      const values = item.fields[key] || [];
      return h('section', {class:`company-field${values.length ? '' : ' is-missing'}`}, h('h2', {text:label}),
        values.length ? values.map(entry => h('div', {class:'company-fact'},
          ['website', 'careers', 'linkedin'].includes(key) && url(entry.value)
            ? h('a', {class:'company-value', href:url(entry.value), target:'_blank', rel:'noopener noreferrer', text:entry.value})
            : h('p', {class:'company-value', text:entry.value}),
          url(entry.source) ? h('a', {class:'company-source', href:url(entry.source), target:'_blank', rel:'noopener noreferrer', text:`Source · ${new URL(entry.source).hostname}`}) : null,
          entry.evidence ? h('details', {}, h('summary', {text:'View evidence'}), h('blockquote', {text:entry.evidence})) : null))
          : h('p', {text:item.status === 'pending' ? 'Awaiting research' : 'Not found in checked sources'}));
    })),
    panel('Related jobs', {sub:'One company record is shared across these saved jobs.'},
      h('ul', {class:'company-jobs'}, item.jobs.map(job => h('li', {}, url(job.url)
        ? h('a', {href:url(job.url), target:'_blank', rel:'noopener noreferrer', text:job.title || 'Open job posting'})
        : h('span', {text:job.title || job.job_id}))))));
}

export function renderCompanies(id='') {
  const query = readQuery();
  const filters = {q:query.get('q') || '', status:query.get('status') || 'all', page:1, size:20};
  const body = h('div', {class:'company-body'}, loadingState('Loading your company knowledge…'));
  const stats = h('div', {class:'company-stats', 'aria-label':'Research totals'});
  const title = h('h1', {text:id ? 'Company details' : 'Company knowledge'});
  const description = h('p', {class:'lead', text:'Know the people, places and opportunities behind your next role.'});
  const actions = h('div', {class:'company-actions'});
  const count = h('p', {class:'company-count', role:'status'});
  const refresh = h('button', {class:'btn', type:'button', text:'Refresh', onclick:()=>load()});
  let ticket = 0, timer;
  function poll() {
    timer = setTimeout(()=>{
      if (!body.isConnected) return;
      if (document.hidden || body.contains(document.activeElement) || stats.contains(document.activeElement)) poll();
      else load();
    }, 5000);
  }
  async function load() {
    clearTimeout(timer);
    const request = ++ticket;
    refresh.disabled = true; body.setAttribute('aria-busy', 'true');
    try {
      const data = await api('/api/companies?' + new URLSearchParams(id ? {id} : filters), undefined, {fresh:true});
      if (request !== ticket) return;
      if (id) {
        const item = data.rows[0];
        if (!item) { body.replaceChildren(empty('This company is not in your saved jobs.', h('a', {href:'#/companies', text:'Back to companies'}))); return; }
        title.textContent = item.name;
        description.textContent = `${item.job_count} linked ${item.job_count === 1 ? 'job' : 'jobs'} · Public information with supporting sources.`;
        const run = runButton(item); run.disabled = item.status === 'researching';
        actions.replaceChildren(run, refresh);
        body.replaceChildren(detail(item));
      } else {
        stats.replaceChildren(...[['pending','To research'],['researching','In progress'],['found','All fields found'],['partial','Partial findings'],['not_found','Not found'],['failed','Needs retry']].map(([status,label]) =>
          h('button', {type:'button', class:`company-stat${filters.status === status ? ' is-active' : ''}`, 'aria-pressed':filters.status === status, onclick:()=>{filters.status=status;statusSelect.value=status;filters.page=1;load();}},
            h('strong', {text:data.counts[status] || 0}), h('span', {text:label}))));
        count.textContent = `${data.total} ${data.total === 1 ? 'company' : 'companies'} · ${data.pending} ready for research`;
        body.replaceChildren(data.rows.length ? dataTable([['Company'],['Research'],['Details found'],['Last checked'],['']],
          data.rows.map(item => h('tr', {},
            h('td', {}, h('a', {class:'company-name', href:`#/companies/${item.company_id}`, text:item.name}), h('small', {class:'company-job-count', text:`${item.job_count} linked ${item.job_count === 1 ? 'job' : 'jobs'}`})),
            h('td', {}, researchPill(item.status)), h('td', {text:`${Object.keys(item.fields).length} / ${Object.keys(fields).length} fields`}),
            h('td', {text:date(item.updated_at)}), h('td', {}, h('a', {class:'btn btn-sm', href:`#/companies/${item.company_id}`, 'aria-label':`View ${item.name}`, text:'View details'})))))
          : empty(data.counts.pending + data.counts.found + data.counts.partial + data.counts.researching + data.counts.failed + data.counts.not_found
            ? 'No companies match these filters.' : 'Companies will appear here when your bots discover jobs.',
            h('a', {class:'btn', href:'#/records?kind=jobs', text:'View discovered jobs'})),
          pagination({...data, label:'Companies', sizes:[20,50,100], onPage:page=>{filters.page=page;load();}, onSize:size=>{filters.size=size;filters.page=1;load();}}));
        writeQuery('companies', filters, {replace:true});
      }
    } catch(error) { if (request === ticket && error.name !== 'AbortError') body.replaceChildren(errorState(error.message, load)); }
    finally { if (request === ticket) {refresh.disabled=false;body.setAttribute('aria-busy','false');poll();} }
  }
  const search = h('input', {type:'search', class:'input', value:filters.q, 'aria-label':'Search companies', placeholder:'Search a company, location or contact…', oninput:event=>{
    filters.q=event.target.value;filters.page=1;clearTimeout(timer);timer=setTimeout(()=>{if(search.isConnected)load();},250);
  }});
  const statusSelect = selectControl({label:'Research status', options:[{value:'all',label:'All research states'},...Object.entries(researchLabels).map(([value,label])=>({value,label}))], value:filters.status,
    onChange:value=>{filters.status=value;filters.page=1;load();}});
  if (!id) actions.append(runButton(),refresh); else actions.append(refresh);
  load();
  return h('div', {class:'page companies-page'},
    id ? h('a', {class:'company-back', href:'#/companies', text:'← All companies'}) : null,
    h('header', {class:'page-head'}, h('div', {}, h('p', {class:'eyebrow', text:'YOUR COMPANY DATABASE'}), title, description), navigationArt('companies','company-header-art')),
    h('div', {class:'company-toolbar'}, actions, h('p', {class:'muted small', text:'Daily pipeline researches up to 10 remaining employers after applications. Public sources only; unknown facts stay missing.'})),
    id ? null : stats,
    id ? null : h('div', {class:'company-filters'}, search, statusSelect), id ? null : count, body);
}
