import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';
import { field } from '../forms.js';
import { panel, loadingState, errorState } from '../components/panel.js';
import { avatar } from '../components/identity.js';
import { icon } from '../icons.js';

const steps = ['Upload resume', 'Review your details', 'Job preferences', 'Ready to go'];
const lists = new Set(['titles', 'skills', 'preferred_locations']);
let disposePrevious;

export function renderLocalOnboarding() {
  disposePrevious?.();
  const controller = new AbortController(), scope = accountRequestSignal();
  let data, draft, selectedProvider, step = 0, busy = false, timer, disposed = false;
  const rail = h('nav', { class: 'onboarding-steps', 'aria-label': 'Setup steps' });
  const progress = h('p', { class: 'onboarding-progress', role: 'status', text: 'Opening your saved setup…' });
  const feedback = h('div', { class: 'onboarding-feedback' });
  const content = h('div', { class: 'onboarding-content' }, loadingState('Opening your saved setup…'));
  const page = h('div', { class: 'page onboarding-page local-onboarding' },
    h('header', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'YOUR LOCAL WORKSPACE' }),
      h('h1', { text: 'Your next chapter starts with your resume.' }),
      h('p', { class: 'lead', text: 'Upload it once. Morrow fills in your details, finds your skills, and suggests roles to explore.' }))),
    h('div', { class: 'onboarding-layout' }, h('aside', { class: 'onboarding-guide' }, avatar(38, 'onboarding-avatar'),
      h('h2', { text: 'Less typing. More possibility.' }), h('p', { text: 'Start with your resume, then review what we found. Completed steps are saved on this computer.' }), rail, progress),
      h('div', { class: 'onboarding-main' }, feedback, content)));
  const alive = () => !disposed && !scope.aborted;
  const extracting = () => data?.extraction?.state === 'running';
  function dispose() { disposed = true; clearTimeout(timer); controller.abort(); window.removeEventListener('hashchange', leave); scope.removeEventListener('abort', dispose); }
  const leave = () => { if (!location.hash.startsWith('#/onboarding')) dispose(); };
  disposePrevious = dispose; window.addEventListener('hashchange', leave); scope.addEventListener('abort', dispose, { once: true });
  const request = (path = '', body) => api('/api/local-setup' + path, body, { signal: controller.signal, fresh: true });
  function disable() { page.querySelectorAll('button, input, select, textarea').forEach(node => { node.disabled = busy || extracting(); }); }
  async function task(work) {
    if (busy || extracting() || !alive()) return;
    busy = true; feedback.replaceChildren(); progress.textContent = 'Saving your setup…'; disable();
    try { await work(); }
    catch (error) {
      if (alive() && error.name !== 'AbortError') {
        feedback.replaceChildren(errorState(error.message));
        progress.textContent = 'Check the message above, then try again. Your changes are still here.';
      }
    }
    finally {
      if (alive()) {
        busy = false; disable();
        if (!feedback.childElementCount) progress.textContent = extracting() ? 'Reading your resume… You can safely reload this page.' : `Step ${step + 1} of 4 · Saved steps stay on this computer`;
      }
    }
  }
  function go(index) { step = index; feedback.replaceChildren(); draw(); content.querySelector('h2')?.focus(); }
  function actions(label, click, back = true) {
    return h('div', { class: 'onboarding-actions' }, step && back ? h('button', { class: 'btn', type: 'button', onclick: () => go(step - 1) }, 'Back') : null,
      h('button', { class: 'btn btn-primary', type: click ? 'button' : 'submit', ...(click ? { onclick: click } : {}) }, label, icon('arrow-up-right', 'icon icon-sm')));
  }
  function draw() {
    rail.replaceChildren(...steps.map((title, index) => h('div', { class: 'onboarding-step' + (index === step ? ' is-current' : ''), 'aria-current': index === step ? 'step' : null },
      h('span', { class: 'onboarding-step-number', text: String(index + 1).padStart(2, '0') }), h('span', { text: title }))));
    progress.textContent = `Step ${step + 1} of 4 · ${extracting() ? 'Reading your resume…' : 'Saved steps stay on this computer'}`;
    content.replaceChildren([resumeStep, profileStep, preferencesStep, preparationStep][step]());
    content.querySelector('h2')?.setAttribute('tabindex', '-1');
    disable();
  }
  function ensureDraft() {
    draft ||= { ...(data.profile_draft || data.profile), extra_facts: { ...(data.profile_draft || data.profile).extra_facts } };
  }
  function input(key, label, { type = 'text', required = false, hint, extra = false, suggested = false } = {}) {
    ensureDraft();
    const source = extra ? draft.extra_facts : draft;
    const value = source[key] ?? '';
    const empty = value === '' || Array.isArray(value) && !value.length;
    const sourceHint = empty && required ? 'Not found in your resume. Add this to continue.'
      : suggested && !empty ? 'Suggested from your resume. Change this to match what you want next.'
      : data.extraction?.sources?.[key] && !empty ? 'From your resume. Review and edit if needed.' : '';
    const control = h(type === 'textarea' ? 'textarea' : 'input', {
      class: 'input', ...(type === 'textarea' ? { rows: 3 } : { type }), required,
      value: lists.has(key) ? (Array.isArray(value) ? value.join(', ') : value) : value,
      autocomplete: ({ full_name: 'name', email: 'email', phone: 'tel', current_location: 'address-level2' })[key] || 'off',
      ...(type === 'number' ? { min: 0, max: ({ total_experience_years: 80, notice_period_days: 730 })[key] || 10000, step: key === 'notice_period_days' ? 1 : 0.1 } : { maxLength: extra ? 3000 : lists.has(key) ? 6000 : 500 }),
      oninput: event => {
        const text = event.target.value;
        source[key] = lists.has(key) ? text.split(',').map(item => item.trim()).filter(Boolean) : type === 'number' ? (text === '' ? null : Number(text)) : text;
        progress.textContent = 'Your changes will be saved when you continue.';
      },
    });
    return field(label + (required ? ' *' : ''), control, [sourceHint, hint].filter(Boolean).join(' '));
  }
  function choice(key, label) {
    ensureDraft();
    const select = h('select', { class: 'input', onchange: event => { draft[key] = event.target.value === '' ? null : event.target.value === 'yes'; } },
      ...[['', 'Not provided'], ['yes', 'Yes'], ['no', 'No']].map(([value, text]) => h('option', { value, text })));
    select.value = draft[key] == null ? '' : draft[key] ? 'yes' : 'no';
    return field(label, select);
  }
  function providerPicker() {
    selectedProvider ||= data.provider;
    const readiness = h('div', { class: 'local-ai-readiness' });
    const select = h('select', { class: 'input', onchange: event => { selectedProvider = event.target.value; showReadiness(); } },
      h('option', { value: 'claude', text: 'Claude Code' }), h('option', { value: 'kiro', text: 'Kiro CLI' }));
    select.value = selectedProvider;
    function showReadiness() {
      const installed = data.providers[selectedProvider];
      readiness.replaceChildren(installed
        ? h('details', {}, h('summary', { text: 'Installed on this computer · Sign-in help' }),
          h('p', { text: 'Morrow uses the account connected on this computer. If reading fails because you need to sign in, run:' }),
          h('code', { text: selectedProvider === 'claude' ? 'claude auth login' : 'kiro-cli login' }))
        : h('div', {}, h('strong', { text: 'Connect your assistant first' }),
          h('p', { text: 'Run this in the Morrow folder to install the assistant and sign in:' }),
          h('code', { text: `bash setup.sh --provider ${selectedProvider}` })));
    }
    showReadiness();
    return h('div', {}, field('AI assistant', select), readiness);
  }
  function resumeStep() {
    const upload = h('input', { class: 'input', type: 'file', accept: '.pdf,application/pdf', onchange: event => {
      const file = event.target.files[0]; if (!file) return;
      task(async () => {
        if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 5 * 1024 * 1024 || !file.size) throw new Error('Choose a PDF resume up to 5 MB.');
        progress.textContent = 'Uploading your resume…';
        const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Could not read this file. Choose it again.')); reader.readAsDataURL(file); });
        data = await request('/resume', { revision: data.revision, provider: selectedProvider, filename: file.name, content_base64: encoded });
        if (alive()) { draft = null; draw(); schedulePoll(); }
      });
    } });
    const job = data.extraction || { state: 'idle' };
    return panel('01 · Start with your resume', { sub: 'We’ll find your contact details, skills, experience, education, and work history. You’ll review everything next.' },
      providerPicker(),
      h('p', { class: 'onboarding-help', text: 'Uploading sends your resume text to the selected AI assistant to fill in your profile and suggest job preferences. Your provider’s usage limits and charges apply. The PDF and saved details stay on this computer.' }),
      h('div', { class: 'onboarding-resume' }, icon('file'), h('div', {}, h('h3', { text: data.resume?.filename || 'Your resume goes here.' }),
        h('p', { text: data.resume ? `${Math.ceil(data.resume.size_bytes / 1024)} KB · Saved locally` : 'PDF · up to 5 MB · selectable text' }))),
      field(data.resume ? 'Replace resume PDF' : 'Upload resume PDF', upload),
      !data.pdf_reader ? h('p', { class: 'onboarding-runtime-note', text: 'The PDF reader is missing. Run bash setup.sh to install it, then upload your resume.' }) : null,
      extracting() ? loadingState('Reading your resume… This can take up to three minutes. Keep the dashboard server running.') : null,
      job.state === 'error' ? errorState(job.message) : null,
      data.resume && !extracting() ? h('div', {},
        job.state === 'ready' ? h('p', { class: 'onboarding-help', text: 'Your details are ready. Review them before moving on.' }) : null,
        h('button', { class: 'btn', type: 'button', text: 'Read resume again', onclick: () => task(async () => {
          data = await request('/extract', { revision: data.revision, provider: selectedProvider });
          if (alive()) { draft = null; draw(); schedulePoll(); }
        }) }),
        actions(job.state === 'error' ? 'Review available details' : 'Review my details', () => go(1), false)) : null);
  }
  function profileStep() {
    ensureDraft();
    return panel('02 · Review your details', { sub: 'We filled in what we could find. Check it, make any corrections, and add missing details marked *.' },
      h('p', { class: 'local-resume-note', text: data.extraction?.state === 'error' ? 'AI reading could not finish. The details found locally are saved; you can fill in the rest or go back and retry.' : 'These are draft details from your resume. They become your application profile after you review and save them.' }),
      h('form', { onsubmit: event => { event.preventDefault(); task(async () => {
        data = await request('/draft', { profile: draft, revision: data.revision });
        if (alive()) { draft = null; go(2); }
      }); } },
        h('div', { class: 'onboarding-field-grid' }, input('full_name', 'Full name', { required: true }), input('email', 'Contact email', { type: 'email', required: true }),
          input('phone', 'Phone number', { type: 'tel', required: true }), input('current_location', 'Current city', { required: true }),
          input('skills', 'Skills', { required: true, hint: 'Separate skills with commas.' }),
          input('total_experience_years', 'Experience in years', { type: 'number', required: true, hint: 'Check any estimate from job dates. Enter 0 if you are starting your career.' })),
        h('details', { class: 'local-setup-details', open: true }, h('summary', { text: 'Education, work history & links' }),
          h('div', { class: 'onboarding-field-grid' }, input('highest_qualification', 'Highest qualification'), input('current_company', 'Current company', { extra: true }),
            input('current_designation', 'Current job title', { extra: true }), input('linkedin_url', 'LinkedIn URL', { type: 'url', extra: true }), input('github_url', 'GitHub URL', { type: 'url', extra: true })),
          input('employment_history', 'Employment history', { type: 'textarea', extra: true })),
        actions('Confirm details & continue')));
  }
  function preferencesStep() {
    ensureDraft();
    return panel('03 · What would you like next?', { sub: 'Start with suggestions from your resume, then adjust them to the jobs you actually want.' },
      h('form', { onsubmit: event => { event.preventDefault(); task(async () => {
        data = await request('', { profile: draft, provider: selectedProvider || data.provider, revision: data.revision });
        if (!alive()) return;
        draft = null; go(3);
        data = await request('/finish', { revision: data.revision });
        if (alive()) { draw(); schedulePoll(); }
      }); } },
        h('div', { class: 'onboarding-field-grid' },
          input('titles', 'Target roles', { required: true, suggested: true, hint: 'Separate roles with commas.' }),
          input('preferred_locations', 'Preferred work locations', { suggested: true, hint: 'For example: Bengaluru, Remote. Separate locations with commas.' }),
          input('work_mode_preference', 'Preferred work mode', { extra: true, suggested: true, hint: 'Remote, hybrid, on-site, or a combination.' })),
        h('details', { class: 'local-setup-details' }, h('summary', { text: 'Details your resume may not include (optional)' }),
          h('p', { class: 'onboarding-help', text: 'Salary expectations, notice period, and work permissions are often missing from a resume. Add what you know; blank fields stay unanswered.' }),
          h('div', { class: 'onboarding-field-grid' }, input('notice_period_days', 'Notice period in days', { type: 'number' }),
            input('current_ctc_lpa', 'Current annual salary (LPA)', { type: 'number', hint: 'LPA means lakh Indian rupees per year. Leave blank for other currencies.' }), input('expected_ctc_lpa', 'Expected annual salary (LPA)', { type: 'number' }),
            input('work_authorization', 'Work authorization', { hint: 'Your country and whether you need sponsorship.' }), choice('willing_to_relocate', 'Willing to relocate?'),
            choice('serving_notice', 'Currently serving notice?'), choice('has_passport', 'Do you have a passport?')),
          input('reason_for_change', 'Reason for changing roles', { type: 'textarea', extra: true })),
        h('p', { class: 'onboarding-help', text: `Next, ${selectedProvider === 'kiro' || !selectedProvider && data.provider === 'kiro' ? 'Kiro' : 'Claude'} uses your reviewed profile and resume to prepare screening answers automatically. You control when applications are sent.` }),
        actions('Save & prepare my answers')));
  }
  function preparationStep() {
    const job = data.generation, ready = data.complete && job.state === 'ready';
    const title = ready ? 'You’re ready. Make your next move.' : job.state === 'running' ? 'Your assistant is getting things ready.' : 'Your details are saved. Let’s finish up.';
    return panel(title, { sub: ready ? 'Your files are saved on this computer and connected to your crew.' : 'You can leave this page and return. Keep the dashboard server running while answers are prepared.' },
      job.state === 'running' ? loadingState('Preparing answers… This can take up to three minutes.') : null,
      h('p', { role: 'status', class: 'onboarding-help', text: job.message || 'Prepare your answers to finish setup.' }),
      h('div', { class: 'onboarding-checks' }, ...[['Profile', 'Your reviewed details and job preferences'], ['Resume', data.resume?.filename || 'No resume saved'], ['Screening answers', ready ? 'Generated and ready to use' : 'Waiting for your AI assistant']].map(([title, detail], i) =>
        h('div', { class: 'onboarding-check', dataset: { ready: i < 2 || ready } }, icon(i < 2 || ready ? 'check' : 'refresh'), h('div', {}, h('strong', { text: title }), h('p', { text: detail }))))),
      ready ? h('div', {}, h('p', { class: 'onboarding-help', text: 'Next: connect your job sites, review your answers, and try a preview run from Bot Crew. You control when applications are sent.' }),
        h('div', { class: 'onboarding-actions' }, h('a', { class: 'btn', href: '#/files/answers', text: 'Review my answers' }),
          h('a', { class: 'btn btn-primary', href: '#/connections', text: 'Connect my job sites' }), h('a', { class: 'btn', href: '#/overview', text: 'Open dashboard' })),
        h('button', { type: 'button', class: 'btn local-edit-profile', onclick: () => go(1), text: 'Update my details' })) : job.state !== 'running' ? actions('Try again', () => task(async () => { data = await request('/finish', { revision: data.revision }); if (alive()) { draw(); schedulePoll(); } })) : null,
      h('details', { class: 'local-setup-details' }, h('summary', { text: 'Where are my files?' }), h('p', { class: 'local-storage-path', text: data.storage_path }),
        h('p', { text: 'Your profile and answers are in inputs/. Your resume is in resume/. The .env settings file is in the Morrow folder. These files are excluded from Git.' })));
  }
  function schedulePoll() {
    clearTimeout(timer);
    if (!alive() || !extracting() && data.generation.state !== 'running') return;
    timer = setTimeout(async () => {
      try {
        const wasExtracting = extracting(), value = await request();
        if (!alive()) return;
        data = value;
        if (wasExtracting && !extracting()) {
          draft = null;
          if (data.extraction.state === 'ready' && step === 0) go(1); else draw();
        } else if (step === 0 || step === 3) draw();
        schedulePoll();
      } catch (error) { if (alive()) feedback.replaceChildren(errorState(error.message, () => { feedback.replaceChildren(); schedulePoll(); })); }
    }, 1500);
  }
  async function load() {
    try {
      data = await request(); if (!alive()) return;
      selectedProvider = data.provider;
      step = ['running', 'ready', 'error'].includes(data.generation.state) ? 3
        : !data.resume || extracting() || data.extraction?.state === 'error' && data.review_step !== 'preferences' ? 0
        : data.review_step === 'preferences' ? 2 : 1;
      draw(); schedulePoll();
    } catch (error) { if (alive()) content.replaceChildren(errorState(error.message, load)); }
  }
  load();
  return page;
}
