import { h } from '../dom.js';
import { S } from '../state.js';
import { api, accountRequestSignal } from '../api.js';
import { accountRequest } from '../account-client.js';
import { avatar } from '../components/identity.js';
import { icon } from '../icons.js';
import { field } from '../forms.js';
import { panel, loadingState, errorState } from '../components/panel.js';
import { connectionPanel, PROVIDERS } from '../components/connections.js';

const steps = ['Your profile', 'Your resume', 'Connect accounts', 'Review setup'];
let disposeCurrent;
const listValue = value => Array.isArray(value) ? value.join(', ') : String(value || '');
const listInput = value => value.split(',').map(item => item.trim()).filter(Boolean);

export function renderOnboarding() {
  disposeCurrent?.();
  const signal = accountRequestSignal();
  let disposed = false, data, step = 0, busy = false, connections, activeConnection, profileDraft;
  let selectedPlatforms = [], hints = {}, resumeId = null, artifacts = [];
  const rail = h('nav', { class: 'onboarding-steps', 'aria-label': 'Setup steps' });
  const content = h('div', { class: 'onboarding-content' }, loadingState('Opening your saved setup…'));
  const feedback = h('div', { class: 'onboarding-feedback' });
  const progress = h('p', { class: 'onboarding-progress', role: 'status', text: 'Your setup is saved to your account.' });
  const page = h('div', { class: 'page onboarding-page' },
    h('header', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'A GOOD START' }), h('h1', { text: 'Make your crew ready.' }),
      h('p', { class: 'lead', text: 'Your details, your resume, your signed-in automation browser.' })), h('a', { class: 'btn', href: '#/overview', text: 'Finish later' })),
    h('div', { class: 'onboarding-layout' }, h('aside', { class: 'onboarding-guide' }, avatar(38, 'onboarding-avatar'),
      h('h2', { text: 'Set up once. Keep it yours.' }), h('p', { text: 'Save the essentials your crew needs. You can update your details or change connected accounts at any time.' }), rail, progress),
    h('div', { class: 'onboarding-main' }, feedback, content)));
  const current = () => !disposed && !signal.aborted && page.isConnected;
  function dispose() { disposed = true; activeConnection?.dispose(); signal.removeEventListener('abort', dispose); window.removeEventListener('hashchange', leave); }
  const leave = () => { if (!location.hash.startsWith('#/onboarding')) dispose(); };
  disposeCurrent = dispose; signal.addEventListener('abort', dispose, { once: true }); window.addEventListener('hashchange', leave);
  function error(message) { feedback.replaceChildren(errorState(message)); }
  function note(message) { progress.textContent = message; }
  function prefs(completed = false) { return { expected_version: data.version, platforms: selectedPlatforms, account_hints: hints, resume_artifact_id: resumeId, completed }; }
  async function savePreferences(completed = false) {
    const saved = await accountRequest('/onboarding', { method: 'PUT', body: prefs(completed) });
    if (!current()) return;
    data = saved; S.onboarding = saved; note('Saved to your account.');
  }
  async function task(work) {
    if (!current() || busy) return;
    busy = true; feedback.replaceChildren(); disable(true);
    try { await work(); }
    catch (cause) { if (current() && cause.name !== 'AbortError') error(cause.message + (cause.status === 409 && /changed|version/i.test(cause.message) ? ' Open setup again in a new tab to review the newer version. Your edits remain here.' : '')); }
    finally { if (current()) { busy = false; disable(false); } }
  }
  function disable(value) { content.querySelectorAll('[data-save], input, textarea, select').forEach(node => { if (!node.closest('.connection-manager')) node.disabled = value; }); rail.querySelectorAll('button').forEach(node => { node.disabled = value; }); }
  function setStep(index) {
    if (!current()) return;
    activeConnection?.dispose(); activeConnection = null; step = index; feedback.replaceChildren(); draw();
    content.querySelector('h2')?.focus({ preventScroll: true });
  }
  function drawRail() {
    rail.replaceChildren(...steps.map((title, index) => h('button', { type: 'button', class: 'onboarding-step' + (index === step ? ' is-current' : ''), disabled: busy,
      'aria-current': index === step ? 'step' : null, onclick: () => { if (index !== step) setStep(index); } },
      h('span', { class: 'onboarding-step-number', text: String(index + 1).padStart(2, '0') }), h('span', { text: title }))));
  }
  function actions(label, next) {
    return h('div', { class: 'onboarding-actions' }, step ? h('button', { class: 'btn', type: 'button', dataset: { save: '' }, onclick: () => setStep(step - 1) }, icon('chevron-left', 'icon icon-sm'), 'Back') : null,
      h('button', { class: 'btn btn-primary', type: 'submit', dataset: { save: '' }, ...(next ? { onclick: next } : {}) }, label, icon('arrow-up-right', 'icon icon-sm')));
  }
  function profileStep() {
    profileDraft ||= { ...data.profile.data };
    const fields = [['full_name', 'Full name', 'text'], ['email', 'Contact email', 'email'], ['phone', 'Phone number', 'tel'], ['current_location', 'Current location', 'text'],
      ['titles', 'Target roles', 'text'], ['skills', 'Skills', 'text'], ['preferred_locations', 'Preferred locations', 'text'], ['total_experience_years', 'Experience in years', 'number'], ['notice_period_days', 'Notice period in days', 'number']];
    const form = h('form', { onsubmit: event => { event.preventDefault(); task(async () => {
      if (!form.reportValidity()) return;
      const saved = await accountRequest('/profile', { method: 'PUT', body: { expected_version: data.profile.version, data: profileDraft } });
      if (!current()) return;
      data.profile = saved;
      await savePreferences(); if (current()) setStep(1);
    }); } },
      h('div', { class: 'onboarding-field-grid' }, fields.map(([key, label, type]) => {
        const isList = ['titles', 'skills', 'preferred_locations'].includes(key);
        const required = ['full_name', 'email', 'phone', 'current_location', 'titles'].includes(key);
        const input = h('input', { class: 'input', type, required, autocomplete: ({ full_name: 'name', email: 'email', phone: 'tel', current_location: 'address-level2' })[key] || 'off',
          value: isList ? listValue(profileDraft[key]) : profileDraft[key] ?? (key === 'email' ? S.user?.email || '' : ''),
          ...(type === 'number' ? { min: 0, max: key === 'notice_period_days' ? 730 : 80, step: key === 'notice_period_days' ? 1 : 0.1 } : { maxLength: isList ? 1500 : 254 }),
          oninput: e => { profileDraft[key] = isList ? listInput(e.target.value) : type === 'number' ? e.target.value === '' ? null : Number(e.target.value) : e.target.value; note('Unsaved profile changes.'); },
        });
        if (key === 'email' && !profileDraft.email) profileDraft.email = input.value;
        return field(label + (required ? ' *' : ''), input, isList ? 'Separate items with commas.' : null);
      })), h('p', { class: 'onboarding-help', text: 'Use accurate details. Your crew will ask for missing screening answers instead of inventing them. * Required.' }), actions('Save profile & continue'));
    return panel('01 · Tell your crew about you', { sub: 'These details become your reusable application profile.' }, form,
      h('a', { class: 'text-link', href: '#/files/profile', text: 'Open the full profile editor' }));
  }
  function resumeStep() {
    const selected = data.resume?.id === resumeId ? data.resume : artifacts.find(item => item.id === resumeId);
    const input = h('input', { type: 'file', accept: '.pdf,application/pdf', class: 'input', 'aria-label': 'Upload resume PDF', onchange: () => task(async () => {
      const file = input.files[0]; if (!file) return;
      if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 10 * 1024 * 1024 || !file.size) throw new Error('Choose a PDF resume up to 10 MB.');
      const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (String.fromCharCode(...signature) !== '%PDF-') throw new Error('This file is not a PDF. Export your resume as a PDF and try again.');
      const artifact = await accountRequest('/artifacts?' + new URLSearchParams({ filename: file.name, category: 'resumes' }), { method: 'POST', binary: true, body: file });
      if (!current()) return;
      resumeId = artifact.id; artifacts.unshift(artifact);
      await savePreferences(); if (current()) draw();
    }) });
    const existing = artifacts.filter(file => file.category === 'resumes' && file.filename.toLowerCase().endsWith('.pdf'));
    const select = h('select', { class: 'input', 'aria-label': 'Choose a saved resume', onchange: e => { resumeId = e.target.value || null; note('Resume selection changed. Save to continue.'); } },
      h('option', { value: '', text: 'Choose a saved PDF' }), ...existing.map(file => h('option', { value: file.id, text: file.filename, selected: file.id === resumeId })));
    return panel('02 · Add your resume', { sub: 'Upload a current PDF. It stays private in your account.' },
      h('div', { class: 'onboarding-resume' }, avatar(43, 'onboarding-resume-art'), h('div', {}, h('h3', { text: selected?.filename || 'Your experience, ready to share.' }), h('p', { text: selected ? 'Saved privately · ' + Math.ceil(selected.size_bytes / 1024 || 1) + ' KB' : 'PDF · up to 10 MB · replace it whenever your experience changes' }))),
      field('Upload or replace resume', input), existing.length ? field('Use a saved resume', select) : null,
      h('p', { class: 'onboarding-help', text: 'Choose an unlocked PDF with selectable text, up to 20 pages. Workflows attach this PDF as uploaded; resume tailoring requires a LaTeX source. Existing files are kept when you select a replacement.' }),
      actions('Save resume & continue', () => task(async () => { if (!resumeId) throw new Error('Upload or choose a resume before continuing.'); await savePreferences(); if (current()) setStep(2); })));
  }
  function platformsStep() {
    const picker = h('div', { class: 'onboarding-platforms' }, PROVIDERS.map(([id, label, art]) => {
      const input = h('input', { type: 'checkbox', checked: selectedPlatforms.includes(id), onchange: e => { selectedPlatforms = e.target.checked ? [...selectedPlatforms, id] : selectedPlatforms.filter(value => value !== id); note('Account selection changed. Save to continue.'); drawConnections(); } });
      return h('label', { class: 'onboarding-platform' }, input, avatar(art, 'onboarding-platform-art'), h('span', { text: label }));
    }));
    const target = h('div');
    function drawConnections() {
      activeConnection?.dispose();
      activeConnection = connectionPanel({ providers: selectedPlatforms, hints, onHint: (id, value) => { hints[id] = value; }, onUpdate: value => { connections = value; } });
      target.replaceChildren(activeConnection);
    }
    drawConnections();
    return panel('03 · Connect the accounts you use', { sub: 'Choose your job sites. Google / Gmail is optional for sites that use Google sign-in.' }, picker,
      h('p', { class: 'onboarding-help', text: 'Passwords and verification codes are entered directly into each site in the automation browser. Morrow does not ask you to paste them here.' }), target,
      actions('Save connections & review', () => task(async () => { if (!selectedPlatforms.length) throw new Error('Select at least one account to continue.'); Object.assign(hints, activeConnection?.getHints()); await savePreferences(); if (current()) setStep(3); })));
  }
  function reviewStep() {
    const readiness = data.readiness || {};
    const checks = h('div', { class: 'onboarding-checks' },
      checkRow('Profile details', readiness.profile_complete, readiness.profile_complete ? 'Required application facts are saved.' : 'Missing: ' + (readiness.missing_profile_fields || []).join(', '), 0),
      checkRow('Private resume', readiness.resume_ready, data.resume?.filename || 'Choose a current PDF resume.', 1),
      checkRow('Account selection', selectedPlatforms.length > 0, selectedPlatforms.map(id => PROVIDERS.find(([key]) => key === id)?.[1]).join(', ') || 'Choose the sites you use.', 2));
    const live = h('div', { class: 'onboarding-runtime-review' });
    activeConnection = connectionPanel({ providers: selectedPlatforms, hints, onHint: (id, value) => { hints[id] = value; }, onUpdate: value => {
      connections = value;
      const verified = value.connections.filter(row => selectedPlatforms.includes(row.id) && row.state === 'connected').length;
      live.replaceChildren(h('p', { class: 'onboarding-help', text: verified + ' of ' + selectedPlatforms.length + ' sign-ins checked in this browser group. Complete any remaining sign-ins, then close the browser before a run.' }),
        !value.automation_available ? h('p', { class: 'onboarding-runtime-note', text: 'Your account’s setup and browser sessions are private. Workflow execution for this account is not connected to the local runner yet; shared owner workflows remain restricted.' }) : h('p', { class: 'onboarding-runtime-note', text: 'Your local runner is available. Check that your own Claude or Kiro CLI is signed in before running AI-assisted work.' }));
    } });
    return panel('04 · Review your setup', { sub: 'Saved setup makes runs easier. Sites can still require a new sign-in, OTP or CAPTCHA.' }, checks, live,
      h('details', { class: 'onboarding-review-connections' }, h('summary', { text: 'Review browser connections' }), activeConnection),
      actions('Finish setup', () => task(async () => {
        Object.assign(hints, activeConnection?.getHints()); await savePreferences();
        if (!current()) return;
        await api('/api/runner/setup', { version: data.version, profile_version: data.profile.version });
        if (!current()) return;
        await savePreferences(true);
        if (!current()) return;
        activeConnection?.dispose(); activeConnection = null;
        content.replaceChildren(panel('Your setup is saved.', { cls: 'onboarding-complete', sub: 'You can update it whenever your resume, preferences or accounts change.' }, avatar(38, 'onboarding-avatar'),
          h('p', { text: 'Connections stays in your sidebar for checking sign-ins, reconnecting and changing accounts. Your own Claude or Kiro subscription is separate from your Morrow plan.' }),
          h('div', { class: 'onboarding-actions' }, h('a', { class: 'btn', href: '#/connections', text: 'Manage connections' }), h('a', { class: 'btn btn-primary', href: connections?.automation_available ? '#/pipeline' : '#/overview', text: connections?.automation_available ? 'Open Flows' : 'Open workspace' }))));
        note('Setup saved.');
      })));
  }
  function checkRow(title, ready, description, index) {
    return h('div', { class: 'onboarding-check', dataset: { ready: String(Boolean(ready)) } }, icon(ready ? 'check' : 'alert-triangle'), h('div', {}, h('strong', { text: title }), h('p', { text: description })), h('button', { class: 'btn', type: 'button', onclick: () => setStep(index), text: ready ? 'Edit' : 'Complete', 'aria-label': (ready ? 'Edit ' : 'Complete ') + title.toLowerCase() }));
  }
  function draw() { drawRail(); content.replaceChildren([profileStep, resumeStep, platformsStep, reviewStep][step]()); content.querySelector('h2')?.setAttribute('tabindex', '-1'); }
  async function load() {
    try {
      const [saved, files] = await Promise.all([accountRequest('/onboarding'), accountRequest('/artifacts?limit=100')]);
      if (!current()) return;
      data = saved; S.onboarding = saved; artifacts = files.items || []; selectedPlatforms = [...saved.platforms]; hints = { ...saved.account_hints }; resumeId = saved.resume_artifact_id;
      if (saved.resume && !artifacts.some(item => item.id === saved.resume.id)) artifacts.unshift(saved.resume);
      draw();
    } catch (cause) { if (current() && cause.name !== 'AbortError') content.replaceChildren(errorState(cause.message, load)); }
  }
  queueMicrotask(load); return page;
}

export function renderConnections() {
  disposeCurrent?.();
  const signal = accountRequestSignal();
  let manager, disposed = false;
  const content = h('div', {}, loadingState('Opening your connections…'));
  const page = h('div', { class: 'page connections-page' },
    h('header', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'READY FOR THE NEXT RUN' }), h('h1', { text: 'Connections' }), h('p', { class: 'lead', text: 'Keep your automation browser signed in. Reconnect or change an account here.' })), h('a', { class: 'btn', href: '#/onboarding', text: 'Review setup' })),
    h('div', { class: 'connection-intro' }, avatar(31, 'connection-intro-art'), h('div', {}, h('h2', { text: 'One place for your saved sign-ins.' }), h('p', { text: 'These are the sessions used by the bot’s Chrome window on this computer. They are separate from signing in to Morrow.' }))), content);
  const current = () => !disposed && !signal.aborted && page.isConnected;
  function dispose() { disposed = true; manager?.dispose(); signal.removeEventListener('abort', dispose); window.removeEventListener('hashchange', leave); }
  const leave = () => { if (!location.hash.startsWith('#/connections')) dispose(); };
  disposeCurrent = dispose; signal.addEventListener('abort', dispose, { once: true }); window.addEventListener('hashchange', leave);
  async function load() {
    try {
      const saved = S.accountMode === 'local' ? { account_hints: {} } : await accountRequest('/onboarding');
      if (!current()) return;
      manager = connectionPanel({ hints: saved.account_hints });
      content.replaceChildren(manager);
    } catch (cause) { if (current() && cause.name !== 'AbortError') content.replaceChildren(errorState(cause.message, load)); }
  }
  queueMicrotask(load); return page;
}
