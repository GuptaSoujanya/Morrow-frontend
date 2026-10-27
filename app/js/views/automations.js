import { h } from '../dom.js';
import { S } from '../state.js';
import { avatar } from '../components/identity.js';
import { selectControl } from '../components/controls.js';
import { panel } from '../components/panel.js';
import { field, selectInput, textInput, toggle, previewBox, runButton, liveRunConfirm, schedulePreview } from '../forms.js';

const choices = entries => entries.map(([value, label]) => ({ value, label }));
const boardNames={naukri:'Naukri',linkedin:'LinkedIn',hirist:'Hirist',instahyre:'Instahyre',cutshort:'Cutshort',wellfound:'Wellfound'};
export const stageChoices=[['learn','Learning'],['research:resume','Resume research'],...Object.entries(boardNames).map(([key,name])=>['profile:'+key,name+' profile']),...Object.entries(boardNames).filter(([key])=>key!=='linkedin').map(([key,name])=>['apply:'+key,name+' applications']),...Object.entries({goal:'Career goals','system-design':'System design',papers:'Research papers','tech-news':'Technology news',companies:'Company research',repositories:'GitHub discoveries'}).map(([key,name])=>['brief:'+key,name])];
export const stageName=key=>stageChoices.find(([id])=>id===key)?.[1] || key.replaceAll(':',' / ');
export function renderBoards(arg='') {
  const [board,mode]=arg.split('/');
  if (['hirist', 'instahyre', 'cutshort', 'wellfound'].includes(board) && S.boardRouteArg !== arg) {
    S.forms.boards = { ...(S.forms.boards || {}), board, mode:mode==='profile'?'profile':'apply' };
    S.boardRouteArg = arg;
  } else if (!board) S.boardRouteArg = '';
  const applyOptions=h('div',{hidden:S.forms.boards.mode==='profile'},field('Application limit per board',textInput('boards','limit',{type:'number',min:1,max:500,placeholder:'Use configured limit'})),toggle('boards','update_profile','Refresh profile before applying','Update the saved board profile at the beginning of an application run.'));
  const modeInput=selectControl({label:'Action',options:choices([['apply','Find & apply'],['profile','Create or refresh profile']]),value:S.forms.boards.mode||'apply',onChange:value=>{S.forms.boards.mode=value;applyOptions.hidden=value==='profile';schedulePreview('boards');}});
  return h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'Explore more opportunities' }), h('h1', { text: 'Job boards' }), h('p', { class: 'lead', text: 'One place to run applications and refresh profiles across your boards.' }))),
    h('div', { class: 'dash' }, panel('Configure a run', { cls: 'span-7' },
      h('div', { class: 'form-grid' }, field('Job board', selectInput('boards', 'board', choices([['all', 'All boards'], ['hirist', 'Hirist'], ['instahyre', 'Instahyre'], ['cutshort', 'Cutshort'], ['wellfound', 'Wellfound']]), 'all')),
        field('Action',modeInput)),applyOptions,
      toggle('boards', 'dry_run', 'Practice run', 'Preview the selected action without saving profile changes or submitting applications.'),
      previewBox('boards'),
      runButton('boards', 'Start run', { confirm: () => S.forms.boards.dry_run ? null : liveRunConfirm('This can submit applications or update your profiles on the selected boards.') })),
      panel('Your job boards', { cls: 'span-5', sub: 'Sign-in is checked when a run starts.' },
        h('ul', { class: 'plain-list board-list' }, ['Hirist', 'Instahyre', 'Cutshort', 'Wellfound'].map((name, i) => h('li', {}, avatar(16+i,'board-avatar'), h('div', {}, h('strong', { text: name }), h('p', { class: 'muted small', text: 'Applications & profile updates' })), h('a', { class: 'text-link', href:'#/boards/'+name.toLowerCase()+'/profile', text: 'Edit profile' })))))));
}
