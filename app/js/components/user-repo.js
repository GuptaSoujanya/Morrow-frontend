import { h } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { field } from '../forms.js';

// Status card for the private user repo on this computer (user/ by default).
// Reads GET /api/runner/repo, connects with POST /api/runner/repo and, when a
// `sync` function is given (accounts mode), copies the saved account profile and
// resume into the repo with POST /api/runner/repo/sync.
export function repoPanel({ sync, onChange } = {}) {
  let status = null, busy = false;
  const state = h('p', { class: 'onboarding-section-state', role: 'status', text: 'Checking this computer for your private repo…' });
  const detail = h('p', { class: 'onboarding-help' });
  const output = h('pre', { class: 'repo-output', hidden: true });
  const input = h('input', { class: 'input', placeholder: 'owner/Morrow-user-you', 'aria-label': 'Existing private repo (optional)', maxLength: 201 });
  const repoField = field('Use a repo you already created (optional)', input);
  const connectButton = h('button', { class: 'btn btn-primary', type: 'button', text: 'Connect repo' });
  const syncButton = h('button', { class: 'btn', type: 'button', text: 'Copy saved details into repo' });
  const actions = h('div', { class: 'onboarding-actions' });
  const root = h('div', { class: 'user-repo', dataset: { state: 'loading' } }, state, detail, repoField, actions, output);

  function setBusy(value) { busy = value; connectButton.disabled = syncButton.disabled = input.disabled = value; }
  function fail(cause) { state.textContent = cause.message; state.dataset.state = 'needed'; }
  async function run(work, label) {
    if (busy) return;
    setBusy(true); state.textContent = label; state.dataset.state = 'draft';
    try { await work(); } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  connectButton.onclick = () => run(async () => {
    const repo = input.value.trim();
    if (repo && !/^(?!\.)[A-Za-z0-9_.-]{1,100}\/(?!\.)[A-Za-z0-9_.-]{1,100}$/.test(repo)) { repoField.setError('Use the form owner/name.'); input.focus(); return; }
    repoField.clearError();
    status = await api('/api/runner/repo', repo ? { repo } : {});
    output.textContent = status.output || ''; output.hidden = !status.output;
    draw(); onChange?.(status);
  }, 'Creating or cloning your private repo with the GitHub CLI…');
  syncButton.onclick = () => run(async () => {
    const result = await sync();
    status = await api('/api/runner/repo', undefined, { fresh: true });
    draw(); onChange?.(status);
    state.textContent = result.updated_fields?.length ? `Copied ${result.updated_fields.length} profile field${result.updated_fields.length === 1 ? '' : 's'}${result.resume_path ? ' and your resume' : ''} into ${result.profile_path.replace(/\/[^/]+$/, '')}.` : `Your repo already had these details${result.resume_path ? ' and this resume' : ''}.`;
    state.dataset.state = 'saved';
  }, 'Copying your saved profile and resume into the repo…');

  function draw() {
    const connected = Boolean(status?.is_repo);
    root.dataset.state = connected ? 'connected' : 'missing';
    state.dataset.state = connected ? 'saved' : 'needed';
    state.textContent = connected ? `Connected: ${status.remote || status.user_dir + '/'}` : status?.exists ? `${status.user_dir}/ exists but is not a git clone yet.` : 'No private repo on this computer yet.';
    detail.textContent = connected
      ? `Your inputs, resume, memory and research live in ${status.user_dir}/ and push with scripts/sync_data.sh. ${status.database_ready ? 'The shared course is in database/.' : 'The shared course (database/) is missing; connect again to clone it.'}${status.profile_exists ? '' : ' inputs/profile.yaml is still empty.'}`
      : `Connect creates a private GitHub repo from the Morrow-user template (or clones one you name) into ${status?.user_dir || 'user'}/ and clones the shared course into database/. ${status?.gh_available === false ? 'Install the GitHub CLI and run gh auth login on this computer first.' : 'Needs the GitHub CLI signed in on this computer.'}`;
    repoField.hidden = connected;
    actions.replaceChildren(connected ? null : connectButton, connected && sync ? syncButton : null, connected ? h('a', { class: 'btn', href: '#/files/profile', text: 'Open profile file' }) : null);
    actions.prepend(icon(connected ? 'check' : 'folder', 'icon icon-sm'));
  }
  api('/api/runner/repo', undefined, { fresh: true }).then(value => { status = value; draw(); onChange?.(status); }).catch(fail);
  root.refresh = draw;
  root.status = () => status;
  return root;
}
