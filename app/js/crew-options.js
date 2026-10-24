/** One live command definition for both card actions and multi-agent starts. */
import {browserRunOptions} from './browser-mode.js';
const pick = (values, keys) => Object.fromEntries(keys.filter(key => values[key] !== undefined).map(key => [key, values[key]]));

export function crewRunSpec(bot, forms = {}, browserMode = 'background') {
  const action = bot.action || bot.id;
  const values = forms[action] || {};
  let options = {dry_run: false}, effect = '', reason = '', label = 'Run now';
  if (bot.pipeline) {
    options = {...pick(values, ['agents', 'bots', 'cli', 'date', 'containers']), group: bot.pipeline, dry_run: false};
    effect = {learn: 'Generate and save your learning material.', brief: 'Research and save your daily briefing.', research: 'Research your resume skills and save the notes.'}[bot.pipeline];
  } else if (action === 'boards') {
    options = {...pick(values, ['limit']), board: bot.board || bot.id, ...(bot.mode ? {mode: bot.mode} : {}), dry_run: false};
    effect = bot.mode === 'profile' ? `Create or update your ${bot.name.replace(/ profile$/, '')} profile using saved facts.` : `Submit matching job applications on ${bot.name}, using your configured limits.`;
  } else if (action === 'naukri') {
    options = {...pick(values, ['keywords', 'location', 'limit', 'headless', 'answer_mode', 'min_score', 'max_days_old', 'llm_backend']), dry_run: false};
    effect = 'Submit matching job applications on Naukri, using your configured limits.';
  } else if (action === 'profile') {
    options = {...pick(values, ['headless', 'review']), dry_run: false};
    effect = 'Refresh your Naukri profile and upload your resume when due.';
  } else if (action === 'linkedin_profile') {
    effect = 'Update your LinkedIn profile using your saved facts.';
  } else if (action === 'linkedin') {
    options = {...pick(values, ['headless']), mode: 'propose'};
    label = 'Create draft';
    effect = 'Save a LinkedIn draft and send its preview through your configured Telegram alerts. Publish it from the writer settings after review.';
  } else if (action === 'cold_email') {
    options = {...pick(values, ['days', 'pages', 'limit', 'to', 'company', 'title', 'url', 'scan_naukri']), dry_run: false};
    label = 'Create drafts';
    effect = 'Save recruiter email drafts locally and in Gmail Drafts when connected. Emails remain drafts.';
  } else if (action === 'external') {
    options = {...pick(values, ['url', 'title', 'company', 'no_tailor', 'headless']), dry_run: false};
    if (!String(options.url || '').trim()) reason = 'Add an application URL in settings first.';
    effect = 'Fill and submit the configured company application using your saved profile.';
  } else if (action === 'resume') {
    options = pick(values, ['jd_text', 'jd_file', 'title', 'company', 'headless']);
    if (!String(options.jd_text || options.jd_file || '').trim()) reason = 'Add a job description in settings first.';
    effect = 'Build and save a resume tailored to your configured job description.';
  } else reason = 'Open this agent’s settings before running it.';
  return {key: bot.id, name: bot.name, action, options: browserRunOptions(action, {...options, browser_mode: browserMode}), effect, label, reason, ready: !reason};
}
