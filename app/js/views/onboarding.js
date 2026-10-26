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
const profileLabels = { full_name: 'Full name', email: 'Contact email', phone: 'Phone number', current_location: 'Current location', titles: 'Target roles' };
const requiredProfile = Object.keys(profileLabels);
const hasValue = value => Array.isArray(value) ? value.some(item => String(item).trim()) : value !== null && value !== undefined && String(value).trim() !== '';
const normalized = value => Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])])) : value;
const same = (a, b) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
const cleanHints = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
const savedTime = value => value && !Number.isNaN(new Date(value).valueOf()) ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

export function renderOnboarding() {
  disposeCurrent?.();
  const signal = accountRequestSignal();
  let disposed = false, data, step = 0, busy = false, connections, mainConnections, activeConnection, profileDraft, completionDirty = false;
  let focusAfterTask;
  let selectedPlatforms = [], hints = {}, resumeId = null, artifacts = [];
  let artifactOffset = 0, moreArtifacts = false;
  const rail = h('nav', { class: 'onboarding-steps', 'aria-label': 'Setup steps' });
  const savedSummary = h('div', { class: 'onboarding-saved-summary', hidden: true });
  const content = h('div', { class: 'onboarding-content' }, loadingState('Opening your saved setup…'));
  const feedback = h('div', { class: 'onboarding-feedback' });
  const progress = h('p', { class: 'onboarding-progress', role: 'status', text: 'Checking your saved details…' });
  const page = h('div', { class: 'page onboarding-page' },
    h('header', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'A GOOD START' }), h('h1', { text: 'Make your crew ready.' }),
      h('p', { class: 'lead', text: 'Your details, your resume, your signed-in automation browser.' })), h('a', { class: 'btn', href: '#/overview', text: 'Finish later' })),
    h('div', { class: 'onboarding-layout' }, h('aside', { class: 'onboarding-guide' }, avatar(38, 'onboarding-avatar'),
      h('h2', { text: 'Set up once. Keep it yours.' }), h('p', { text: 'Save the essentials your crew needs. You can update your details or change connected accounts at any time.' }), rail, progress),
    h('div', { class: 'onboarding-main' }, savedSummary, feedback, content)));
  const current = () => !disposed && !signal.aborted && page.isConnected;
  function dispose() { disposed = true; activeConnection?.dispose(); signal.removeEventListener('abort', dispose); window.removeEventListener('hashchange', leave); }
  const leave = () => { if (!location.hash.startsWith('#/onboarding')) dispose(); };
  disposeCurrent = dispose; signal.addEventListener('abort', dispose, { once: true }); window.addEventListener('hashchange', leave);
  function error(message) { feedback.replaceChildren(errorState(message)); }
  function note(message) { progress.textContent = message; }
  const profileDirty = () => Boolean(profileDraft && !same(profileDraft, data.profile.data));
  const prefsDirty = () => resumeId !== data.resume_artifact_id || !same([...selectedPlatforms].sort(), [...data.platforms].sort()) || !same(cleanHints(hints), cleanHints(data.account_hints));
  const savedResumes = () => artifacts.filter(file => file.category === 'resumes' && file.filename.toLowerCase().endsWith('.pdf'));
  const selectedResume = () => data.resume?.id === resumeId ? data.resume : savedResumes().find(file => file.id === resumeId);
  const savedProfileCount = () => requiredProfile.filter(key => hasValue(data.profile.data[key])).length;
  const profileReady = () => Boolean(data.readiness?.profile_complete);
  function updateOverview() {
    if (!data) return;
    drawRail();
    const count = savedProfileCount(), files = savedResumes().length;
    const finished = data.completed_at && data.platforms.length && !profileDirty() && !prefsDirty() && !completionDirty && profileReady() && data.readiness?.resume_ready;
    const exists = count || files || data.platforms.length || data.completed_at;
    savedSummary.hidden = false;
    savedSummary.dataset.state = finished ? 'saved' : exists ? 'existing' : 'new';
    const parts = [count ? `${count} of ${requiredProfile.length} required profile details saved` : '',
      data.readiness?.resume_ready ? `${data.resume.filename} selected` : files ? `${files} saved PDF${files === 1 ? '' : 's'} available to choose` : '',
      data.platforms.length ? `${data.platforms.length} account${data.platforms.length === 1 ? '' : 's'} selected` : ''].filter(Boolean);
    savedSummary.replaceChildren(icon(finished ? 'check' : 'folder'), h('div', {},
      h('strong', { text: finished ? 'Your setup is already saved.' : exists ? 'Your saved details are here.' : 'Start with the details your crew needs.' }),
      h('p', { text: parts.length ? parts.join(' · ') + '.' : 'Save your profile, choose a resume, and connect the sites you use.' }),
      exists ? h('p', { class: 'onboarding-saved-caption', text: finished ? `Finished ${savedTime(data.completed_at)}. You can review or update any step. Browser sign-ins are checked separately.` : 'Existing details are filled in below. Update only what has changed; saved files do not need to be uploaded again.' }) : null));
  }
  function receiveConnections(value) {
    connections = value;
    if (value.scope === 'main' || !value.scope) mainConnections = value;
    updateOverview();
  }
  function prefs(completed = false) { return { expected_version: data.version, platforms: selectedPlatforms, account_hints: hints, resume_artifact_id: resumeId, completed }; }
  async function savePreferences(completed = false, force = false) {
    if (!force && !completed && !prefsDirty() && !completionDirty && data.version > 0) return;
    const saved = await accountRequest('/onboarding', { method: 'PUT', body: prefs(completed) });
    if (!current()) return;
    data = saved; completionDirty = false; S.onboarding = saved; note('Saved to your account.'); updateOverview();
  }
  async function task(work, handleError) {
    if (!current() || busy) return;
    busy = true; feedback.replaceChildren(); disable(true);
    try { await work(); }
    catch (cause) { if (current() && cause.name !== 'AbortError' && !handleError?.(cause)) error(cause.message + (cause.status === 409 && /changed|version/i.test(cause.message) ? ' Open setup again in a new tab to review the newer version. Your edits remain here.' : '')); }
    finally { if (current()) { busy = false; disable(false); updateOverview(); focusAfterTask?.focus({ preventScroll: true }); focusAfterTask = null; } }
  }
  function disable(value) { content.querySelectorAll('[data-save], input, textarea, select').forEach(node => { if (!node.closest('.connection-manager')) node.disabled = value; }); rail.querySelectorAll('button').forEach(node => { node.disabled = value; }); }
  function setStep(index) {
    if (!current()) return;
    activeConnection?.dispose(); activeConnection = null; step = index; feedback.replaceChildren(); draw();
    content.querySelector('h2')?.focus({ preventScroll: true });
  }
  function drawRail() {
    const profileMissing = data.readiness?.missing_profile_fields?.length ?? requiredProfile.length - savedProfileCount();
    const draftResume = resumeId !== data.resume_artifact_id;
    const draftAccounts = !same([...selectedPlatforms].sort(), [...data.platforms].sort()) || !same(cleanHints(hints), cleanHints(data.account_hints));
    const checked = mainConnections?.connections.filter(row => data.platforms.includes(row.id) && row.state === 'connected').length || 0;
    const states = [
      profileDirty() ? ['Unsaved changes', 'draft'] : profileReady() ? ['Saved', 'saved'] : [savedProfileCount() ? `${profileMissing} detail${profileMissing === 1 ? '' : 's'} needed` : 'Add your details', 'needed'],
      draftResume ? ['Unsaved selection', 'draft'] : data.readiness?.resume_ready ? ['Saved', 'saved'] : savedResumes().length ? ['Saved PDFs · choose one', 'needed'] : ['Add a resume', 'needed'],
      draftAccounts ? ['Unsaved choices', 'draft'] : data.platforms.length ? [mainConnections ? `${checked}/${data.platforms.length} sign-ins checked` : `${data.platforms.length} choices saved`, checked === data.platforms.length ? 'saved' : 'needed'] : ['Choose accounts', 'needed'],
      data.completed_at && data.platforms.length && !profileDirty() && !prefsDirty() && !completionDirty && profileReady() && data.readiness?.resume_ready ? ['Setup saved', 'saved'] : ['Review & finish', 'needed'],
    ];
    // Update status nodes in place so polling never removes a focused step button.
    if (rail.children.length === steps.length) {
      [...rail.children].forEach((button, index) => {
        button.classList.toggle('is-current', index === step); button.disabled = busy;
        if (index === step) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
        button.dataset.state = states[index][1]; button.querySelector('.onboarding-step-status').textContent = states[index][0];
      });
      return;
    }
    rail.replaceChildren(...steps.map((title, index) => h('button', { type: 'button', class: 'onboarding-step' + (index === step ? ' is-current' : ''), disabled: busy,
      dataset: { state: states[index][1] },
      'aria-current': index === step ? 'step' : null, onclick: () => { if (index !== step) setStep(index); } },
      h('span', { class: 'onboarding-step-number', text: String(index + 1).padStart(2, '0') }), h('span', { class: 'onboarding-step-copy' }, h('span', { text: title }), h('span', { class: 'onboarding-step-status', text: states[index][0] })))));
  }
  function actions(label, next) {
    return h('div', { class: 'onboarding-actions' }, step ? h('button', { class: 'btn', type: 'button', dataset: { save: '' }, onclick: () => setStep(step - 1) }, icon('chevron-left', 'icon icon-sm'), 'Back') : null,
      h('button', { class: 'btn btn-primary', type: 'submit', dataset: { save: '' }, ...(next ? { onclick: next } : {}) }, label, icon('arrow-up-right', 'icon icon-sm')));
  }
  function profileStep() {
    profileDraft ||= { ...data.profile.data };
    const controls = new Map();
    const profileNote = h('p', { class: 'onboarding-section-state' });
    function updateProfileState() {
      const dirty = profileDirty();
      profileNote.dataset.state = dirty ? 'draft' : 'saved';
      profileNote.textContent = dirty ? 'You have unsaved profile changes. Save them before finishing setup.' : savedProfileCount() ? `Your existing profile is filled in.${savedTime(data.profile.updated_at) ? ' Last saved ' + savedTime(data.profile.updated_at) + '.' : ''}` : 'These details have not been saved yet.';
      for (const [key, wrapper] of controls) {
        const changed = !same(profileDraft[key], data.profile.data[key]);
        const saved = hasValue(data.profile.data[key]);
        const status = wrapper.querySelector('.onboarding-field-state');
        status.textContent = changed ? 'Unsaved' : saved ? 'Saved' : requiredProfile.includes(key) ? 'Required' : 'Optional';
        status.dataset.state = changed ? 'draft' : saved ? 'saved' : 'empty';
      }
      updateOverview();
    }
    const fields = [['full_name', 'Full name', 'text'], ['email', 'Contact email', 'email'], ['phone', 'Phone number', 'tel'], ['current_location', 'Current location', 'text'],
      ['titles', 'Target roles', 'text'], ['skills', 'Skills', 'text'], ['preferred_locations', 'Preferred locations', 'text'], ['total_experience_years', 'Experience in years', 'number'], ['notice_period_days', 'Notice period in days', 'number']];
    const form = h('form', { onsubmit: event => {
      event.preventDefault();
      if (busy) return;
      const invalid = [...controls.values()].filter(wrapper => !wrapper.validate());
      if (invalid.length) { invalid[0].controlElement.focus(); note('Check the highlighted profile fields. Your changes are still here.'); return; }
      task(async () => {
        if (profileDirty()) {
          const saved = await accountRequest('/profile', { method: 'PUT', body: { expected_version: data.profile.version, data: profileDraft } });
          if (!current()) return;
          data.profile = saved; profileDraft = { ...saved.data }; completionDirty = true;
          updateProfileState();
        }
        await savePreferences(); if (current()) setStep(1);
      }, cause => {
        const errors = cause.details?.detail;
        if (!Array.isArray(errors)) return false;
        let mapped = false;
        for (const issue of errors) {
          const wrapper = [...(issue.loc || [])].reverse().map(key => controls.get(key)).find(Boolean);
          if (wrapper) { wrapper.setError(issue.msg || 'Check this value.'); focusAfterTask ||= wrapper.controlElement; mapped = true; }
        }
        if (mapped) note('Check the highlighted profile fields. Your changes are still here.');
        return mapped;
      });
    } }, profileNote,
      h('div', { class: 'onboarding-field-grid' }, fields.map(([key, label, type]) => {
        const isList = ['titles', 'skills', 'preferred_locations'].includes(key);
        const required = requiredProfile.includes(key);
        const input = h('input', { class: 'input', type, required, autocomplete: ({ full_name: 'name', email: 'email', phone: 'tel', current_location: 'address-level2' })[key] || 'off',
          value: isList ? listValue(profileDraft[key]) : profileDraft[key] ?? (key === 'email' ? S.user?.email || '' : ''),
          ...(type === 'number' ? { min: 0, max: key === 'notice_period_days' ? 730 : 80, step: key === 'notice_period_days' ? 1 : 0.1 } : { maxLength: isList ? 1500 : 254 }),
          oninput: e => { profileDraft[key] = isList ? listInput(e.target.value) : type === 'number' ? e.target.value === '' ? null : Number(e.target.value) : e.target.value; note(profileDirty() ? 'Unsaved profile changes.' : 'Your saved profile is unchanged.'); updateProfileState(); },
        });
        if (key === 'email' && !profileDraft.email) profileDraft.email = input.value;
        const wrapper = field(label + (required ? ' *' : ''), input, isList ? 'Separate items with commas.' : null, { deferButtonBlur: true, validate: control => {
          if (required && (!control.value.trim() || isList && !listInput(control.value).length)) return `Enter ${label.toLowerCase()}.`;
          if (key === 'email' && control.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(control.value)) return 'Enter a complete email address, like name@example.com.';
          return '';
        } });
        wrapper.dataset.profileField = key;
        wrapper.querySelector('.field-label').append(h('span', { class: 'onboarding-field-state', 'aria-hidden': 'true' }));
        controls.set(key, wrapper);
        return wrapper;
      })), h('p', { class: 'onboarding-help', text: 'Use accurate details. Your crew will ask for missing screening answers instead of inventing them. * Required.' }), actions('Save profile & continue'));
    form.noValidate = true;
    updateProfileState();
    return panel('01 · Tell your crew about you', { sub: 'These details become your reusable application profile.' }, form,
      h('a', { class: 'text-link', href: '#/files/profile', text: 'Open the full profile editor' }));
  }
  function resumeStep() {
    const heading = h('h3'), detail = h('p'), fileState = h('p', { class: 'onboarding-section-state' });
    function updateResumeCard() {
      const selected = selectedResume(), existing = savedResumes();
      const saved = selected && resumeId === data.resume_artifact_id && data.readiness?.resume_ready;
      heading.textContent = selected?.filename || (existing.length ? 'Your saved resumes are ready to choose.' : 'Your experience, ready to share.');
      detail.textContent = selected ? `${Math.ceil(selected.size_bytes / 1024 || 1)} KB · Stored privately in your account` : existing.length ? `${existing.length} saved PDF${existing.length === 1 ? '' : 's'} found. Choose one below; uploading again is optional.` : 'PDF · up to 10 MB · replace it whenever your experience changes';
      fileState.textContent = saved ? 'Already saved as your setup resume.' : selected ? 'Unsaved selection. Save to use this resume in setup.' : data.resume_artifact_id ? 'The previously selected resume is no longer available. Choose a replacement.' : existing.length ? 'No resume selected for setup yet.' : 'Add a resume to continue.';
      fileState.dataset.state = saved ? 'saved' : selected ? 'draft' : 'needed';
      updateOverview();
    }
    const input = h('input', { type: 'file', accept: '.pdf,application/pdf', class: 'input', 'aria-label': 'Upload resume PDF', onchange: () => {
      uploadField.clearError();
      task(async () => {
      const file = input.files[0]; if (!file) return;
      if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 10 * 1024 * 1024 || !file.size) throw new Error('Choose a PDF resume up to 10 MB.');
      const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (String.fromCharCode(...signature) !== '%PDF-') throw new Error('This file is not a PDF. Export your resume as a PDF and try again.');
      const artifact = await accountRequest('/artifacts?' + new URLSearchParams({ filename: file.name, category: 'resumes' }), { method: 'POST', binary: true, body: file });
      if (!current()) return;
      resumeId = artifact.id; artifacts.unshift(artifact);
      updateResumeCard();
      await savePreferences(); if (current()) draw();
      }, cause => { uploadField.setError(cause.message); focusAfterTask = input; input.value = ''; note('Check the message beside the upload field before continuing.'); return true; });
    } });
    const uploadField = field('Upload or replace resume', input);
    const existing = savedResumes();
    const select = h('select', { class: 'input', 'aria-label': 'Choose a saved resume', onchange: e => {
      resumeId = e.target.value || null; selectField.clearError(); uploadField.clearError(); note('Resume selection changed. Save to continue.'); updateResumeCard();
    } },
      h('option', { value: '', text: 'Choose a saved PDF' }), ...existing.map(file => h('option', { value: file.id, text: file.filename, selected: file.id === resumeId })));
    const selectField = field('Use a saved resume', select);
    const resumeError = cause => { const target = existing.length ? selectField : uploadField; target.setError(cause.message); focusAfterTask = target.controlElement; return true; };
    const olderFiles = moreArtifacts ? h('div', { class: 'onboarding-older-files' },
      h('p', { class: 'onboarding-help', text: 'This is your recent file list. If your resume is older, load more saved files before uploading it again.' }),
      h('button', { class: 'btn', type: 'button', dataset: { save: '' }, text: 'Find older saved resumes', onclick: () => task(async () => {
        const files = await accountRequest('/artifacts?' + new URLSearchParams({ limit: 100, offset: artifactOffset }));
        if (!current()) return;
        artifactOffset += files.items.length; moreArtifacts = files.items.length === 100;
        artifacts.push(...files.items.filter(file => !artifacts.some(existing => existing.id === file.id)));
        draw(); note(moreArtifacts ? 'More saved files loaded. You can look further back if needed.' : 'All your saved files have been checked for resumes.');
      }) })) : null;
    updateResumeCard();
    return panel('02 · Add your resume', { sub: 'Upload a current PDF. It stays private in your account.' },
      h('div', { class: 'onboarding-resume' }, avatar(43, 'onboarding-resume-art'), h('div', {}, heading, detail, fileState)),
      existing.length ? selectField : null, olderFiles, uploadField,
      h('p', { class: 'onboarding-help', text: 'Choose an unlocked PDF with selectable text, up to 20 pages. Workflows attach this PDF as uploaded; resume tailoring requires a LaTeX source. Existing files are kept when you select a replacement.' }),
      actions('Save resume & continue', () => {
        if (!selectedResume()) { const target = existing.length ? selectField : uploadField; target.setError('Upload or choose a resume before continuing.'); target.controlElement.focus(); return; }
        task(async () => { await savePreferences(); if (current()) setStep(2); }, resumeError);
      }));
  }
  function platformsStep() {
    const choicesError = h('p', { class: 'field-error', id: 'onboarding-platform-error', role: 'status', hidden: true });
    const choicesNote = h('p', { class: 'onboarding-section-state' });
    const picker = h('fieldset', { class: 'onboarding-provider-fieldset', 'aria-describedby': choicesError.id },
      h('legend', { class: 'field-label', text: 'Accounts for your setup' }), h('div', { class: 'onboarding-platforms' }, PROVIDERS.map(([id, label, art]) => {
      const input = h('input', { type: 'checkbox', checked: selectedPlatforms.includes(id), onchange: e => {
        selectedPlatforms = e.target.checked ? [...selectedPlatforms, id] : selectedPlatforms.filter(value => value !== id);
        if (selectedPlatforms.length) { choicesError.hidden = true; choicesError.textContent = ''; picker.removeAttribute('aria-invalid'); }
        note('Account selection changed. Save to continue.'); drawConnections(); updateChoiceState();
      } });
      return h('label', { class: 'onboarding-platform' }, input, avatar(art, 'onboarding-platform-art'), h('span', { text: label }));
    })), choicesError);
    const target = h('div');
    function updateChoiceState() {
      const dirty = !same([...selectedPlatforms].sort(), [...data.platforms].sort()) || !same(cleanHints(hints), cleanHints(data.account_hints));
      choicesNote.textContent = dirty ? 'Unsaved account choices. Save them before continuing.' : data.platforms.length ? `${data.platforms.length} account choice${data.platforms.length === 1 ? '' : 's'} already saved. Each sign-in has its own status below.` : 'Choose at least one account. Saved choices and checked browser sign-ins are shown separately.';
      choicesNote.dataset.state = dirty ? 'draft' : data.platforms.length ? 'saved' : 'needed';
      updateOverview();
    }
    function drawConnections() {
      activeConnection?.dispose();
      activeConnection = connectionPanel({ providers: selectedPlatforms, hints, onHint: (id, value) => { hints[id] = value; updateChoiceState(); }, onUpdate: receiveConnections });
      target.replaceChildren(activeConnection);
    }
    drawConnections(); updateChoiceState();
    return panel('03 · Connect the accounts you use', { sub: 'Choose your job sites. Google / Gmail is optional for sites that use Google sign-in.' }, choicesNote, picker,
      h('p', { class: 'onboarding-help', text: 'Passwords and verification codes are entered directly into each site in the automation browser. Morrow does not ask you to paste them here.' }), target,
      actions('Save connections & review', () => {
        if (!selectedPlatforms.length) { choicesError.textContent = 'Select at least one account to continue.'; choicesError.hidden = false; picker.setAttribute('aria-invalid', 'true'); picker.querySelector('input')?.focus(); return; }
        if (!activeConnection.validate()) return;
        task(async () => { Object.assign(hints, activeConnection.getHints()); await savePreferences(); if (current()) setStep(3); });
      }));
  }
  function reviewStep() {
    const readiness = data.readiness || {};
    const profileCheck = checkRow('Profile details', readiness.profile_complete && !profileDirty(), profileDirty() ? 'Unsaved profile changes. Return to Your profile and save them before finishing.' : readiness.profile_complete ? 'Required application facts are saved.' : 'Still needed: ' + (readiness.missing_profile_fields || requiredProfile).map(key => profileLabels[key] || key).join(', '), 0);
    const resumeCheck = checkRow('Private resume', readiness.resume_ready && resumeId === data.resume_artifact_id, selectedResume() ? selectedResume().filename + (resumeId !== data.resume_artifact_id ? ' · Unsaved selection' : ' · Saved for setup') : 'Choose a current PDF resume.', 1);
    const accountCheck = checkRow('Account selection', selectedPlatforms.length > 0 && same([...selectedPlatforms].sort(), [...data.platforms].sort()), selectedPlatforms.map(id => PROVIDERS.find(([key]) => key === id)?.[1]).join(', ') + (!same([...selectedPlatforms].sort(), [...data.platforms].sort()) ? ' · Unsaved choices' : '') || 'Choose the sites you use.', 2);
    const checks = h('div', { class: 'onboarding-checks' },
      profileCheck, resumeCheck, accountCheck);
    const live = h('div', { class: 'onboarding-runtime-review' });
    activeConnection = connectionPanel({ providers: selectedPlatforms, hints, onHint: (id, value) => { hints[id] = value; updateOverview(); }, onUpdate: value => {
      receiveConnections(value);
      const relevant = value.connections.filter(row => selectedPlatforms.includes(row.id));
      const verified = relevant.filter(row => row.state === 'connected').length;
      live.replaceChildren(h('p', { class: 'onboarding-help', text: verified + ' of ' + relevant.length + ' sign-ins checked in this browser group. Complete any remaining sign-ins, then close the browser before a run.' }),
        !value.automation_available ? h('p', { class: 'onboarding-runtime-note', text: 'Your account’s setup and browser sessions are private. Workflow execution for this account is not connected to the local runner yet; shared owner workflows remain restricted.' }) : h('p', { class: 'onboarding-runtime-note', text: 'Your local runner is available. Check that your own Claude or Kiro CLI is signed in before running AI-assisted work.' }));
    } });
    const browserDetails = h('details', { class: 'onboarding-review-connections' }, h('summary', { text: 'Review browser connections' }), activeConnection);
    return panel('04 · Review your setup', { sub: 'Saved setup makes runs easier. Sites can still require a new sign-in, OTP or CAPTCHA.' }, checks, live,
      browserDetails,
      actions('Finish setup', () => {
        if (profileDirty() || !profileReady()) { profileCheck.setError(profileDirty() ? 'Save your unsaved profile changes before finishing setup.' : 'Complete and save the required profile fields before finishing setup.'); return; }
        if (!selectedResume()) { resumeCheck.setError('Choose and save a resume before finishing setup.'); return; }
        if (!selectedPlatforms.length) { accountCheck.setError('Select at least one account before finishing setup.'); return; }
        // Invalid email fields must be visible when validation moves focus to them.
        const wasOpen = browserDetails.open; browserDetails.open = true;
        if (!activeConnection.validate()) return;
        browserDetails.open = wasOpen;
        task(async () => {
        Object.assign(hints, activeConnection?.getHints()); await savePreferences(false, true);
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
      }, cause => {
        if (/pdf|resume/i.test(cause.message)) { resumeCheck.setError(cause.message); focusAfterTask = resumeCheck.querySelector('button'); return true; }
        return false;
      });
    }));
  }
  function checkRow(title, ready, description, index) {
    const message = h('p', { class: 'field-error', id: `onboarding-check-error-${index}`, role: 'status', hidden: true });
    const button = h('button', { class: 'btn', type: 'button', onclick: () => setStep(index), text: ready ? 'Edit' : 'Complete', 'aria-label': (ready ? 'Edit ' : 'Complete ') + title.toLowerCase(), 'aria-describedby': message.id });
    const row = h('div', { class: 'onboarding-check', dataset: { ready: String(Boolean(ready)) } }, icon(ready ? 'check' : 'alert-triangle'), h('div', {}, h('strong', { text: title }), h('p', { text: description }), message), button);
    row.setError = text => { message.textContent = text; message.hidden = false; row.dataset.ready = 'false'; button.focus(); };
    return row;
  }
  function draw() { drawRail(); content.replaceChildren([profileStep, resumeStep, platformsStep, reviewStep][step]()); content.querySelector('h2')?.setAttribute('tabindex', '-1'); updateOverview(); }
  async function load() {
    try {
      const [saved, files] = await Promise.all([accountRequest('/onboarding'), accountRequest('/artifacts?limit=100')]);
      if (!current()) return;
      data = saved; S.onboarding = saved; artifacts = files.items || []; selectedPlatforms = [...saved.platforms]; hints = { ...saved.account_hints }; resumeId = saved.resume_artifact_id;
      artifactOffset = artifacts.length; moreArtifacts = artifacts.length === 100;
      if (saved.resume && !artifacts.some(item => item.id === saved.resume.id)) artifacts.unshift(saved.resume);
      draw(); note(saved.completed_at ? 'Setup was saved. You can review or update it.' : saved.version || savedProfileCount() ? 'Your saved details are loaded. Continue with any unfinished step.' : 'Save each step to keep your progress.');
      // Read existing browser state without opening or changing a browser.
      api('/api/connections?scope=main', undefined, { fresh: true }).then(value => { if (current()) receiveConnections(value); }).catch(cause => {
        if (current() && cause.name !== 'AbortError') note('Your saved details are available. Browser status could not load; open Connect accounts to retry.');
      });
    } catch (cause) { if (current() && cause.name !== 'AbortError') content.replaceChildren(errorState(cause.message, load)); }
  }
  queueMicrotask(load); return page;
}

export function renderConnections() {
  disposeCurrent?.();
  const signal = accountRequestSignal();
  const focusProvider = PROVIDERS.find(([id]) => id === S.route.arg)?.[0] || '';
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
      manager = connectionPanel({ hints: saved.account_hints, focusProvider, scope: 'main' });
      content.replaceChildren(manager);
    } catch (cause) { if (current() && cause.name !== 'AbortError') content.replaceChildren(errorState(cause.message, load)); }
  }
  queueMicrotask(load); return page;
}
