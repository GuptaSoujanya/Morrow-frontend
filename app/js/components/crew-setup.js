import { h } from '../dom.js';
import { field } from '../forms.js';
import { S } from '../state.js';

/** Relevant run inputs only. Editing never previews or starts a command. */
export function crewSetup(bots, onChange = () => {}, { forms = S.forms } = {}) {
  const entries = [];
  const required = h('div', { class: 'crew-required-settings' });
  const optional = h('div', { class: 'crew-setup-fields form-grid' });
  const adjustments = h('details', { class: 'crew-adjust-options run-details' },
    h('summary', { text: 'Optional settings' }), optional);

  function inputField(action, key, label, hint, attributes = {}, { multiline = false, check, prepare } = {}) {
    const values = forms[action] ||= {};
    const control = h(multiline ? 'textarea' : 'input', {
      class: multiline ? 'textarea' : 'input',
      ...(multiline ? { rows: 6 } : { type: 'text' }),
      ...attributes,
      value: values[key] ?? '',
    });
    // Keep custom validation in the shared field lifecycle. Its change handler
    // must not clear a protocol error between pointerdown and the submit click.
    const wrapper = field(label, control, hint, { deferButtonBlur: true, validate: target => {
      prepare?.(target);
      return target.value.trim() ? check?.(target) || '' : '';
    } });
    const entry = { wrapper, control, touched: false, validate: () => {
      prepare?.(control);
      wrapper.clearError();
      return wrapper.validate();
    } };
    const save = () => {
      // Empty pasted text must allow an existing description file to be used.
      const value = control.value;
      values[key] = key === 'url' ? value.trim() : key === 'jd_text' && !value.trim() ? '' : value;
    };
    control.addEventListener('input', () => {
      save();
      if (entry.touched) entry.validate();
      onChange();
    });
    control.addEventListener('blur', event => {
      entry.touched = true;
      if (!event.relatedTarget?.closest?.('button')) entry.validate();
    });
    entries.push(entry);
    return wrapper;
  }

  const hasAction = action => bots.some(bot => (bot.action || bot.id) === action);
  if (hasAction('external')) {
    required.append(inputField('external', 'url', 'Application URL',
      'Paste the job application page you want the bot to complete.',
      { type: 'url', required: true, placeholder: 'https://company.com/careers/job' },
      { check: control => {
        try {
          const url = new URL(control.value.trim());
          if (['http:', 'https:'].includes(url.protocol) && url.hostname) return '';
        } catch { /* Show the same actionable message for malformed addresses. */ }
        return 'Enter a complete application URL beginning with http:// or https://.';
      } }));
  }
  if (hasAction('resume')) {
    const hasFile = () => Boolean(String(forms.resume?.jd_file || '').trim());
    required.append(inputField('resume', 'jd_text', 'Job description',
      hasFile() ? 'Leave blank to use your saved job description file, or paste a different description.'
        : 'Paste the job description so your resume can be tailored to this role.',
      { required: !hasFile(), placeholder: 'Paste the role, responsibilities and requirements…' },
      { multiline: true, prepare: control => { control.required = !hasFile(); } }));
  }
  if (hasAction('naukri')) {
    optional.append(
      inputField('naukri', 'keywords', 'Keywords', 'Leave blank to use your saved search keywords.', { placeholder: 'e.g. AI Engineer' }),
      inputField('naukri', 'location', 'Location', 'Leave blank to use your saved location.', { placeholder: 'e.g. Bengaluru' }),
      inputField('naukri', 'limit', 'Naukri job limit', 'How many jobs to consider. Leave blank for no limit.',
        { type: 'number', min: 1, step: 1, inputmode: 'numeric', placeholder: 'No limit' }),
    );
  }
  const boards = bots.filter(bot => (bot.action || bot.id) === 'boards' && bot.mode !== 'profile');
  if (hasAction('startups')) {
    optional.append(inputField('startups', 'limit', 'Startup job limit',
      'How many YC and Hacker News jobs to consider. Leave blank to use 10.',
      { type:'number', min:1, max:50, step:1, inputmode:'numeric', placeholder:'10' }));
  }
  if (boards.length) {
    optional.append(inputField('boards', 'limit', 'Application limit per board',
      `Shared by ${boards.map(bot => bot.name).join(', ')}. Each selected board uses this limit. Leave blank to use its saved limit.`,
      { type: 'number', min: 1, max: 500, step: 1, inputmode: 'numeric', placeholder: 'Use saved limit' }));
  }
  if (hasAction('cold_email')) {
    optional.append(inputField('cold_email', 'limit', 'Maximum email drafts',
      'Leave blank to use your saved limit. Emails remain drafts.',
      { type: 'number', min: 1, max: 100, step: 1, inputmode: 'numeric', placeholder: 'Use saved limit' }));
  }

  const element = h('div', { class: 'crew-setup' },
    h('p', { class: 'muted', text: required.childElementCount
      ? 'Check the details below. Your other saved settings will be used.'
      : 'You can start with your saved settings.' }),
    required.childElementCount ? required : null,
    adjustments);

  return { element, options: adjustments, validate() {
    let firstInvalid;
    for (const entry of entries) {
      entry.touched = true;
      if (!entry.validate()) {
        if (adjustments.contains(entry.control)) adjustments.open = true;
        firstInvalid ||= entry.control;
      }
    }
    firstInvalid?.focus();
    return !firstInvalid;
  } };
}
