import {h} from '../dom.js';
import {avatar,workspaceAvatar,avatarStorageKey} from './identity.js';
import {S,hooks} from '../state.js';
import {icon} from '../icons.js';

const names=['Studio headphones','Antenna scout','Peach explorer','Space helmet','Cream robot','Round-ear companion','Peach antenna','Scholar glasses','Caramel listener','Orbit antenna','Pearl blush','Clear visor','Little star','Round glasses','Pearl astronaut','Morrow planet','Sprout scout','Studio pilot','Spark antenna','Scholar','Cream bowtie','Cat companion','Orbit companion','Trail explorer'];
const extras=['Bunny companion','Mushroom companion','Pilot helmet','Professor','Bear companion','Beanie listener','Stargazer','Earmuff explorer'];
const friends=['Fox companion','Aviator','Bookworm','Botanist','Penguin companion','Knitted explorer','Music lover','Owl companion','Frog companion','Navigator','Artist','Cloud companion','Turtle companion','Studio listener','Bunny explorer','Space explorer'];
const choices=[...names.map((name,index)=>({name,index})),...extras.map((name,i)=>({name,index:i+32})),...friends.map((name,i)=>({name,index:i+48}))];
export function openAvatarPicker(){
  const previous=document.activeElement;
  let selected=workspaceAvatar();
  const dialog=h('dialog',{class:'confirm-dialog avatar-dialog','aria-labelledby':'avatar-title'});
  const preview=avatar(selected,'avatar-preview');
  const selectedName=h('p',{class:'avatar-selection-name','aria-live':'polite',text:choices.find(c=>c.index===selected)?.name});
  const grid=h('div',{class:'avatar-grid',role:'group','aria-label':'Workspace avatars'});
  const feedback=h('p',{class:'field-error',role:'alert',hidden:true});
  choices.forEach(({name,index})=>grid.append(h('button',{type:'button',class:'avatar-choice','aria-label':name,title:name,'aria-pressed':String(index===selected),onclick:()=>{
    selected=index;const next=avatar(index,'avatar-preview');preview.className=next.className;preview.style.cssText=next.style.cssText;preview.dataset.avatar=index;
    selectedName.textContent=name;
    [...grid.children].forEach((b,i)=>b.setAttribute('aria-pressed',String(choices[i].index===index)));
  }},avatar(index))));
  const collections=h('div',{class:'avatar-collections',role:'group','aria-label':'Avatar collection'});
  for(const [key,label] of [['all',`All characters · ${choices.length}`],['new',`New friends · ${friends.length}`]]){
    collections.append(h('button',{class:'avatar-collection',type:'button','aria-pressed':String(key==='all'),text:label,onclick:()=>{
      [...collections.children].forEach(button=>button.setAttribute('aria-pressed',String(button.textContent===label)));
      [...grid.children].forEach((button,i)=>{button.hidden=key==='new'&&choices[i].index<48;});
      grid.scrollTop=0;
    }}));
  }
  dialog.append(h('div',{class:'confirm-body'},h('div',{class:'avatar-picker-heading'},preview,h('div',{},h('h2',{id:'avatar-title',text:'Find your Morrow alter ego'}),h('p',{class:'muted',text:'Your workspace, a little more you.'}),selectedName)),
    collections,grid,h('p',{class:'small muted avatar-picker-note',text:'Only changes your avatar in Morrow on this browser. Your platform profile photos stay as they are.'}),feedback,
    h('div',{class:'row end avatar-picker-actions'},h('button',{class:'btn',type:'button',text:'Cancel',onclick:()=>dialog.close()}),h('button',{class:'btn btn-primary',type:'button',text:'Use this avatar',onclick:()=>{
      try{localStorage.setItem(avatarStorageKey(),String(selected));}catch{feedback.hidden=false;feedback.textContent='Browser storage is unavailable. Allow local storage, then try again.';return;}
      S.pendingFocusKey='change-avatar';dialog.close();hooks.requestRender();
    }}))));
  dialog.addEventListener('close',()=>{dialog.remove();requestAnimationFrame(()=>{(previous?.isConnected?previous:document.getElementById('change-avatar'))?.focus({preventScroll:true});});});
  document.body.append(dialog);dialog.showModal();grid.children[choices.findIndex(c=>c.index===selected)].focus();
}
export function avatarPickerButton(){return h('button',{id:'change-avatar',dataset:{focusKey:'change-avatar'},class:'btn',type:'button',onclick:openAvatarPicker},icon('person','icon icon-sm'),'Change avatar');}
