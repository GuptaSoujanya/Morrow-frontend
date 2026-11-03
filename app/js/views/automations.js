import { h } from '../dom.js';
import { S } from '../state.js';
import { avatar } from '../components/identity.js';
import { selectControl } from '../components/controls.js';
import { panel } from '../components/panel.js';
import { field, selectInput, textInput, toggle, previewBox, runButton, liveRunConfirm, schedulePreview } from '../forms.js';

const choices = entries => entries.map(([value, label]) => ({ value, label }));
const boardNames={naukri:'Naukri',linkedin:'LinkedIn',hirist:'Hirist',instahyre:'Instahyre',cutshort:'Cutshort',wellfound:'Wellfound'};
export const stageChoices=[['learn','Learning'],['research:resume','Resume research'],...Object.entries(boardNames).map(([key,name])=>['profile:'+key,name+' profile']),...Object.entries(boardNames).filter(([key])=>key!=='linkedin').map(([key,name])=>['apply:'+key,name+' applications']),['apply:startups','YC & startup applications'],...Object.entries({goal:'Career goals','system-design':'System design',papers:'Research papers','tech-news':'Technology news',companies:'Company radar briefing',repositories:'GitHub discoveries'}).map(([key,name])=>['brief:'+key,name]),['research:companies','Company intelligence · after applications']];
export const stageName=key=>stageChoices.find(([id])=>id===key)?.[1] || key.replaceAll(':',' / ');
export function renderBoards(arg='') {
  const [board,mode]=arg.split('/');
  const focused = ['hirist', 'instahyre', 'cutshort', 'wellfound'].includes(board);
  const profileOnly = mode === 'profile';
  if (focused) {
    // A bot-specific route always owns the board and action, even after using
    // the generic board selectors elsewhere in this session.
    S.forms.boards = { ...(S.forms.boards || {}), board, mode:mode==='profile'?'profile':'apply' };
    S.boardRouteArg = arg;
  } else if (!board) S.boardRouteArg = '';
  const name = boardNames[board];
  const applyOptions=focused&&profileOnly?null:h('div',{hidden:S.forms.boards.mode==='profile'},
    field('Application limit per board',textInput('boards','limit',{type:'number',min:1,max:500,placeholder:'Use configured limit'}),
      'Your job-board bots share this limit. Leave blank to use the saved limit.'),
    h('details',{class:'run-details'},h('summary',{text:'Advanced options'}),
      toggle('boards','update_profile','Refresh profile before applying','Update the saved board profile at the beginning of an application run.')));
  const modeInput=focused?null:selectControl({label:'Action',options:choices([['apply','Find & apply'],['profile','Create or refresh profile']]),value:S.forms.boards.mode||'apply',onChange:value=>{S.forms.boards.mode=value;applyOptions.hidden=value==='profile';schedulePreview('boards');}});
  const settings = panel(focused?'Run settings':'Configure a run', { cls: focused?'':'span-7' },
      focused?null:
      h('div', { class: 'form-grid' }, field('Job board', selectInput('boards', 'board', choices([['all', 'All boards'], ['hirist', 'Hirist'], ['instahyre', 'Instahyre'], ['cutshort', 'Cutshort'], ['wellfound', 'Wellfound']]), 'all')),
        field('Action',modeInput)),applyOptions,
      toggle('boards', 'dry_run', 'Practice run', 'Preview the selected action without saving profile changes or submitting applications.'),
      previewBox('boards'),
      runButton('boards', 'Start run', { confirm: () => S.forms.boards.dry_run ? null : liveRunConfirm(focused
        ? profileOnly ? `This updates your live ${name} profile.` : `This submits real applications on ${name}.`
        : 'This can submit applications or update your profiles on the selected boards.') }));
  const header = h('header', { class: 'page-head' },
    h('div', {}, focused?null:h('p', { class: 'eyebrow', text: 'Explore more opportunities' }),
      h('h1', { text: focused?name+(profileOnly?' profile':''):'Job boards' }),
      h('p', { class: 'lead', text: focused
        ? profileOnly ? `Update your ${name} profile using your saved facts and resume.` : `Find matching jobs and submit applications on ${name}.`
        : 'One place to run applications and refresh profiles across your boards.' })),
    focused?h('a',{class:'text-link',href:'#/bots',text:'Back to Bot Crew'}):null);
  return h('div', { class: focused?'page bot-config-page':'page' }, header, focused?settings:
    h('div', { class: 'dash' }, settings,
      panel('Your job boards', { cls: 'span-5', sub: 'Sign-in is checked when a run starts.' },
        h('ul', { class: 'plain-list board-list' }, ['Hirist', 'Instahyre', 'Cutshort', 'Wellfound'].map((name, i) => h('li', {}, avatar(16+i,'board-avatar'), h('div', {}, h('strong', { text: name }), h('p', { class: 'muted small', text: 'Applications & profile updates' })), h('a', { class: 'text-link', href:'#/boards/'+name.toLowerCase()+'/profile', text: 'Edit profile' })))))));
}
