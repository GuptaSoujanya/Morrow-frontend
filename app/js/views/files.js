import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';
import { S, hooks } from '../state.js';
import { panel, loadingState, errorState } from '../components/panel.js';
import { confirmDialog } from '../components/dialog.js';
import { toast } from '../components/toast.js';
import { field } from '../forms.js';
import { journeyBanner } from '../components/journey.js';
import { richIcon, workspaceAvatar } from '../components/identity.js';
import { avatarPickerButton } from '../components/avatar-picker.js';
import {profileForm} from '../components/profile-form.js';
import { icon } from '../icons.js';

export const FILES = { profile: 'Your profile', answers: 'Screening answers', automation_answers: 'Agent answer sheet', company_sites: 'Company follow-ups', env: 'Settings' };
const fileEndpoint = name => name === 'automation_answers' ? '/api/run/answers' : `/api/file?name=${encodeURIComponent(name)}`;
let pending = new Set();
let failures = new Map();
let fileSession;
function ensureFileSession(){
  const signal=accountRequestSignal();
  if(signal!==fileSession){fileSession=signal;pending=new Set();failures=new Map();}
}

async function load(name) {
  ensureFileSession();
  if (pending.has(name)) return;
  const loads=pending,errors=failures;
  loads.add(name);
  errors.delete(name);
  const update = S.answerUpdates[0]?.id;
  try { const file = await api(fileEndpoint(name)); S.loadedFiles[name] = { ...file, draft: file.text, externalUpdates:name==='automation_answers'&&update!==S.answerUpdates[0]?.id }; }
  catch (error) { if(error.name!=='AbortError')errors.set(name, error.message); }
  finally { loads.delete(name); }
  if (['files', 'setup'].includes(S.route.name)) hooks.requestRender();
}

export function fileEditor(name, settings = false) {
  ensureFileSession();
  const file = S.loadedFiles[name];
  if (!file) {
    if (!failures.has(name)) load(name);
    return failures.has(name) ? errorState(failures.get(name), () => load(name)) : loadingState('Opening your file…');
  }
  const feedback = h('div',{class:'inline-feedback',role:'alert',hidden:true});
  const statusText = () => file.draft !== file.text ? 'Unsaved changes' : file.externalUpdates ? 'New saved answers available' : 'All changes saved';
  const status = h('span', { class: 'small muted', role: 'status', text: statusText() });
  const save = h('button', { class: 'btn btn-primary', type: 'button', text: 'Save changes', disabled: file.draft === file.text, onclick: store });
  const changed = () => { status.textContent = statusText(); save.disabled = file.draft === file.text; };
  async function store() {
    if (file.draft === file.text) return;
    if(editor?.validate && !editor.validate())return;
    const privateFile=S.accountMode==='accounts'&&!['env','automation_answers'].includes(name);
    if (!(await confirmDialog({ title: `Save ${FILES[name].toLowerCase()}?`, body: privateFile?'Save these changes to your private account. The previous version will be kept.':name==='automation_answers'?'Your agents use this saved sheet. A backup of the previous file will be kept.':'The next run will use these changes. A backup of the previous file will be kept.', ok: 'Save changes' }))) return;
    save.disabled = true;save.textContent='Saving…';feedback.hidden=true;
    const text = file.draft;
    try {
      const reply = await api(fileEndpoint(name), { ...(name==='automation_answers'?{}:{name}), text, revision: file.revision });
      file.text = text; file.revision = reply.revision;
      file.externalUpdates = false;
      hooks.refreshAnswerReview();
      toast(privateFile?'Changes saved to your account.':'Changes saved. Previous version backed up.', 'ok');
      await hooks.refreshStatus();
    } catch (error) { feedback.textContent=`Could not save. ${error.message} Your edits are still here.`;feedback.hidden=false; }
    finally { save.textContent='Save changes';changed(); }
  }
  let editor;
  if (settings) {
    const lines = file.draft.split('\n');
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Find a setting…', 'aria-label': 'Find a setting' });
    const rows = h('div', { class: 'settings-list' });
    const groups=['Search & matching','Accounts','AI & tools','Automation','All settings'];
    S.settingGroup ||= 'Search & matching';
    const groupFor=key=>/PASSWORD|EMAIL|TOKEN|SECRET|CREDENTIAL|(?:^|_)KEY(?:_|$)/i.test(key)?'Accounts':/KEYWORDS|SCORE|LOCATION|EXPERIENCE|SALARY|JOB|SEARCH|TITLE/i.test(key)?'Search & matching':/LLM|CLAUDE|KIRO|MODEL|AI_|BACKEND|PROVIDER/i.test(key)?'AI & tools':'Automation';
    lines.forEach((line, i) => {
      const match = line.match(/^(\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=)(.*)$/);
      if (!match) return;
      const secret = /PASSWORD|TOKEN|SECRET|CREDENTIAL|(?:^|_)KEY(?:_|$)/i.test(match[2]);
      const friendly=({MIN_SCORE:'Minimum match score',KEYWORDS:'Search keywords',NAUKRI_EMAIL:'Naukri email',NAUKRI_PASSWORD:'Naukri password',LOCATION:'Preferred location',MAX_APPLY_PER_DAY:'Daily application limit'})[match[2]]||match[2].toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
      const input = h('input', { class: 'input', type: secret ? 'password' : 'text', value: match[3], autocomplete: 'off', spellcheck: 'false', 'aria-label': `${friendly} (${match[2]})`, oninput: e => { lines[i] = match[1] + e.target.value; file.draft = lines.join('\n'); changed(); } });
      const reveal = secret ? h('button', { class: 'btn', type: 'button', 'aria-label': `Show ${match[2]}`, onclick: () => {
        const show = input.type === 'password'; input.type = show ? 'text' : 'password';
        reveal.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${match[2]}`); reveal.replaceChildren(icon(show ? 'eye-off' : 'eye'));
      } }, icon('eye')) : null;
      rows.append(h('div', { class: 'setting-row', dataset: { search: match[2].toLowerCase().replaceAll('_',' '), group:groupFor(match[2]) } }, h('div',{class:'setting-label'},h('label', { class: 'field-label', text: friendly, for: `setting-${i}` }),h('span',{class:'field-hint',text:match[2]+(secret?' · Private, stored locally':'')})), h('div', { class: 'secret-row' }, input, reveal)));
      input.id = `setting-${i}`;
    });
    const none = h('p', { class: 'panel-empty', text: 'No matching settings.', hidden: true });
    const tabs=h('div',{class:'settings-tabs',role:'group','aria-label':'Setting categories'});
    const filter=()=>{let visible=0;for(const row of rows.children){row.hidden=!row.dataset.search.includes(search.value.toLowerCase().replaceAll('_',' '))||(!search.value&&S.settingGroup&&S.settingGroup!=='All settings'&&row.dataset.group!==S.settingGroup);if(!row.hidden)visible++;}none.hidden=visible>0;[...tabs.children].forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.group===(S.settingGroup||'All settings'))));};
    groups.forEach(group=>tabs.append(h('button',{class:'filter-chip',type:'button',dataset:{group},text:group,onclick:()=>{S.settingGroup=group;filter();}})));
    search.addEventListener('input',filter);filter();
    editor = h('div', {}, field('Search settings', search), tabs, rows, none,
      !rows.children.length ? h('p', { class: 'panel-note', text: 'No settings yet. Open the Settings file to add configuration from .env.example.' }) : null);
  } else {
    editor = h('textarea', { class: 'textarea file-text', 'aria-label': FILES[name], spellcheck: 'false', value: file.draft, oninput: e => { file.draft = e.target.value; changed(); }, onkeydown: e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); store(); } } });
    if(name==='profile'){
      const source=editor;
      const structured=profileForm(file,changed);
      if(structured){
        const content=h('div',{},structured);
        const formButton=h('button',{class:'filter-chip',type:'button',text:'Profile details','aria-pressed':'true',onclick:()=>switchMode(false)});
        const sourceButton=h('button',{class:'filter-chip',type:'button',text:'Source file','aria-pressed':'false',onclick:()=>switchMode(true)});
        let form=structured,sourceMode=false;
        function switchMode(raw){
          if(raw){source.value=file.draft;content.replaceChildren(source);}
          else {form=profileForm(file,changed);if(!form){feedback.hidden=false;feedback.textContent='The source has a formatting error. Correct it before returning to the profile form.';return;}feedback.hidden=true;content.replaceChildren(form);}
          sourceMode=raw;formButton.setAttribute('aria-pressed',String(!raw));sourceButton.setAttribute('aria-pressed',String(raw));
        }
        editor=h('div',{},h('div',{class:'editor-mode',role:'group','aria-label':'Profile editor mode'},formButton,sourceButton),content);
        editor.validate=()=>sourceMode?true:form.validate();
      }
    }
    if (name === 'env') {
      const area = editor;
      area.hidden = true;
      editor = h('div', {}, h('p', { class: 'panel-note', text: 'This file contains credentials. Reveal it only when you are ready to edit.' }),
        h('button', { class: 'btn', type: 'button', text: 'Reveal settings file', onclick: e => { area.hidden = !area.hidden; e.currentTarget.textContent = area.hidden ? 'Reveal settings file' : 'Hide settings file'; } }), area);
    }
  }
  const review = name==='automation_answers' ? answerReview(file) : null;
  if(review){const refreshReview=hooks.refreshAnswerReview;hooks.refreshAnswerReview=()=>{refreshReview();changed();};}
  return h('div', {class:'file-editor'}, review, h('div', { class: 'panel-foot editor-savebar' }, h('div',{class:'editor-save-meta'},h('span', { class: 'editor-path', text: file.path }),status),save, h('button', { class: 'btn', type: 'button', text: 'Reload file', onclick: async () => {
      if (file.draft !== file.text && !(await confirmDialog({ title: 'Discard your unsaved changes?', body: 'This loads the latest saved version.', ok: 'Reload file', tone: 'danger' }))) return;
      await load(name);
    } })), editor, feedback);
}

function answerReview(file) {
  const scope = accountRequestSignal();
  const box = h('section', {class:'answer-review', 'aria-label':'Recent agent answer changes'});
  const refresh = () => {
    if(scope.aborted)return;
    const changes = S.answerUpdates.slice(0,10);
    const enable = h('button', {class:'btn',type:'button',text:S.desktopAnswerAlerts?'Desktop alerts enabled':'Enable desktop alerts',
      disabled:!globalThis.Notification||S.desktopAnswerAlerts,onclick:async()=>{
        enable.disabled=true;
        try {
          const permission=await Notification.requestPermission();scope.throwIfAborted();
          S.desktopAnswerAlerts=permission==='granted';
          toast(S.desktopAnswerAlerts?'Desktop alerts enabled for this session.':'Desktop alerts are blocked. Changes will still appear here.',S.desktopAnswerAlerts?'ok':'info');
        } catch(error) { if(error.name!=='AbortError')toast('Desktop alerts are unavailable. Changes will still appear here.'); }
        refresh();
      }});
    box.replaceChildren(h('div',{class:'answer-review-head'},h('div',{},h('h3',{text:'Recent agent changes'}),
      h('p',{class:'muted',text:'Review or edit answers saved by your agents.'})),enable),
      file.externalUpdates ? h('p',{class:'answer-review-notice',role:'status',text:file.draft!==file.text?
        'New answers were saved while you were editing. Your draft is unchanged. Copy any edits you want to keep, then use Reload file to review the saved sheet.':
        'New answers have been saved. Use Reload file to update the editor below.'}) : null,
      changes.length ? h('ol',{class:'answer-review-list'},changes.map(item=>h('li',{class:'answer-review-entry'},
        h('p',{class:'answer-review-question',text:item.question}),h('p',{class:'answer-review-answer',text:item.answer}),
        h('p',{class:'small muted',text:`Saved by ${item.label||'your agent'} · ${item.source||'saved answer'}${item.at?' · '+new Date(item.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}`})))) :
      h('p',{class:'muted',text:'New answers saved during agent runs will appear here.'}));
  };
  hooks.refreshAnswerReview=refresh;
  refresh();
  return box;
}

export function renderFiles(arg) {
  const visibleFiles = Object.fromEntries(Object.entries(FILES).filter(([key]) => !['env','automation_answers'].includes(key)||S.legacyAccess));
  const name = Object.hasOwn(visibleFiles, arg) ? arg : 'profile';
  return h('div', { class: 'page profile-page' }, h('header', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'Your source of truth' }), h('h1', { text: 'My profile & files' }), h('p', { class: 'lead', text: 'Manage the facts, answers and settings your automations use.' }))),
    journeyBanner({image:workspaceAvatar(),eyebrow:'YOUR PERSONAL WORKSPACE',title:S.status.name||'Your profile, your story.',body:'Your saved facts power your crew.',action:avatarPickerButton()}),
    h('nav', { class: 'file-tabs profile-tiles', 'aria-label': 'Workspace files' }, Object.entries(visibleFiles).map(([key, title]) => h('a', { class: `file-tile ${name === key ? 'is-current' : ''}`, href: `#/files/${key}`, 'aria-current': name === key ? 'page' : null },richIcon(({profile:'person',answers:'check',automation_answers:'check',company_sites:'folder',env:'sliders'})[key]),h('strong',{text:title}),h('span',{text:({profile:'Facts & experience',answers:'Reusable responses',automation_answers:'Live answers from your agents',company_sites:'Next steps',env:'Local configuration'})[key]})))),
    panel(FILES[name], {sub:name==='profile'?'The facts your crew uses. Edit a field or open the source file for advanced changes.':name==='automation_answers'?(S.accountMode==='accounts'?'The answer sheet used by agents on this computer. It is separate from your private account files.':'The answer sheet your agents read and update on this computer.'):name==='env'?'Advanced editing · configuration format is preserved':'Your saved workspace file'}, fileEditor(name)));
}
