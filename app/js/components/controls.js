import { h } from '../dom.js';
import { icon } from '../icons.js';

let uid = 0;
function anchorMenu(menu, trigger, width) {
  if (innerWidth <= 600 && menu.classList.contains('calendar-menu')) {
    Object.assign(menu.style,{width:`${innerWidth-24}px`,left:'12px',top:'auto',bottom:'12px',maxHeight:`${innerHeight-24}px`});
    return;
  }
  const r = trigger.getBoundingClientRect();
  const w = Math.min(width || Math.max(r.width, 240), innerWidth - 24);
  const roomBelow = innerHeight - r.bottom - 16;
  const above = roomBelow < Math.min(menu.scrollHeight, menu.classList.contains('calendar-menu') ? 520 : 270) && r.top > roomBelow;
  Object.assign(menu.style, { width: `${w}px`, left: `${Math.max(12, Math.min(r.left, innerWidth - w - 12))}px`,
    top: above ? 'auto' : `${r.bottom + 8}px`, bottom: above ? `${innerHeight - r.top + 8}px` : 'auto',
    maxHeight: `${Math.min(menu.classList.contains('select-menu') ? 380 : Infinity, Math.max(120, above ? r.top - 24 : roomBelow))}px` });
}

// Reveal a focused item inside its popup without scrolling the workspace behind it.
function revealMenuItem(menu, item, topInset = 14, bottomInset = 14) {
  if (!item) return;
  const bounds = menu.getBoundingClientRect(), row = item.getBoundingClientRect();
  if (row.bottom > bounds.bottom - bottomInset) menu.scrollTop += row.bottom - bounds.bottom + bottomInset;
  else if (row.top < bounds.top + topInset) menu.scrollTop -= bounds.top + topInset - row.top;
}

/** One tab stop; selection stays on the combobox while arrows move its active descendant. */
export function selectControl({ options, value = '', label, onChange }) {
  const id = `orbit-select-${++uid}`;
  let current = String(value), active = 0, search = '', timer, lifecycle;
  const caption = h('span', { class: 'select-caption' });
  const trigger = h('button', { type: 'button', class: 'input select-trigger', role: 'combobox',
    'aria-label': label, 'aria-expanded': 'false', 'aria-haspopup': 'listbox', 'aria-controls': id }, caption,
    h('span', { class: 'select-chevron', 'aria-hidden': 'true' }, icon('chevron-down', 'icon icon-sm')));
  const menu = h('div', { id, class: 'control-menu select-menu', popover: 'auto', role: 'listbox', 'aria-label': label || 'Options' });
  const root = h('div', { class: 'select-control' }, trigger, menu);
  if(label) trigger.dataset.focusKey = `select:${label}`;
  root.controlElement = trigger;
  const opened = () => menu.matches(':popover-open');
  function highlight(index) {
    active = Math.max(0, Math.min(options.length - 1, index));
    const rows = [...menu.querySelectorAll('[role="option"]')];
    rows.forEach((el, i) => el.classList.toggle('is-active', i === active));
    if (opened() && options.length) {
      trigger.setAttribute('aria-activedescendant', `${id}-${active}`);
      revealMenuItem(menu, rows[active], (menu.querySelector('.select-menu-heading')?.offsetHeight || 0) + 8,
        (menu.querySelector('.select-menu-help')?.offsetHeight || 0) + 8);
    }
  }
  function sync() {
    const chosen = options.find(o => String(o.value) === current);
    const labelledBy = trigger.getAttribute('aria-labelledby');
    const menuLabel = labelledBy?.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ') || trigger.getAttribute('aria-label') || label || 'Choose an option';
    caption.textContent = chosen?.label || 'Choose an option';
    trigger.title = chosen?.label || 'Choose an option';
    trigger.disabled = options.length === 0;
    trigger.dataset.value = current;
    menu.replaceChildren(
      h('div', { class: 'select-menu-heading', role: 'presentation', 'aria-hidden': 'true' },
        h('span', { text: menuLabel }), h('span', { class: 'select-menu-count', text: options.length })),
      ...options.map((o, i) => h('div', { id: `${id}-${i}`, class: 'select-option', role: 'option',
      'aria-selected': String(o.value) === current ? 'true' : 'false', dataset: { value: o.value },
      onpointerdown: e => e.preventDefault(), onpointermove: () => highlight(i), onclick: () => choose(i) },
      h('span', { class: 'select-option-label', text: o.label }),
      h('span', { class: 'select-option-check', 'aria-hidden': 'true' }, String(o.value) === current ? icon('check', 'icon icon-sm') : null))),
      options.length > 5 ? h('div', { class: 'select-menu-help', role: 'presentation', 'aria-hidden': 'true' },
        h('span', {}, h('kbd', { text: '↑' }), h('kbd', { text: '↓' }), ' to move'), h('span', { text: 'Type to jump' })) : document.createTextNode(''));
  }
  function close() { if (opened()) menu.hidePopover(); clearTimeout(timer);search='';trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant'); }
  function choose(index) {
    if (!options[index]) return;
    current = String(options[index].value); sync(); close(); trigger.focus({ preventScroll: true }); onChange?.(current);
  }
  function open() {
    if (opened() || !options.length) return;
    sync(); menu.showPopover(); trigger.setAttribute('aria-expanded','true');anchorMenu(menu, trigger, Math.max(trigger.getBoundingClientRect().width, 270));
    highlight(Math.max(0, options.findIndex(o => String(o.value) === current)));
    const name = trigger.getAttribute('aria-labelledby');
    if (name) menu.setAttribute('aria-labelledby', name);
  }
  menu.addEventListener('toggle', e => {
    trigger.setAttribute('aria-expanded', e.newState === 'open' ? 'true' : 'false');
    lifecycle?.abort();
    if (e.newState === 'open') {
      lifecycle = new AbortController();
      const opts = { signal: lifecycle.signal };
      window.addEventListener('resize', close, opts); window.addEventListener('hashchange', close, opts);
    } else { trigger.removeAttribute('aria-activedescendant'); clearTimeout(timer); search = ''; }
  });
  trigger.addEventListener('click', () => opened() ? close() : open());
  trigger.addEventListener('keydown', e => {
    if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
      e.preventDefault(); const wasOpen = opened(); open();
      highlight(e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : active + (wasOpen ? (e.key === 'ArrowDown' ? 1 : -1) : 0));
    } else if (['Enter',' '].includes(e.key)) { e.preventDefault(); opened() ? choose(active) : open(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close();
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); clearTimeout(timer); search += e.key.toLowerCase();
      const repeated = search.length > 1 && [...search].every(char => char === search[0]);
      const term = repeated ? search[0] : search;
      const ordered = repeated ? [...options.keys()].map(i => (active + i + 1) % options.length) : [...options.keys()];
      const exact = repeated ? -1 : options.findIndex(o => o.label.toLowerCase() === term);
      const index = exact >= 0 ? exact : ordered.find(i => options[i].label.toLowerCase().startsWith(term));
      open(); if (index >= 0) highlight(index); timer = setTimeout(() => { search = ''; }, 700);
    }
  });
  Object.defineProperty(root, 'value', { get: () => current, set: v => { current = String(v); sync(); } });
  root.setOptions = next => { options = next; sync(); if (!options.length) close(); else if (opened()) highlight(Math.min(active, options.length - 1)); };
  sync(); return root;
}

const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y,m,d] = value.split('-').map(Number), date = new Date(y,m-1,d);
  return iso(date) === value ? date : null;
}
export function dateControl({ value = '', label, buttonLabel, onChange, marked = [], markedLabel = 'Saved content available', commitOnly = false, min = '', max = '', required = false }) {
  const id = `orbit-calendar-${++uid}`;
  const minimum = parseDate(min), maximum = parseDate(max);
  const inRange = date => (!minimum || date >= minimum) && (!maximum || date <= maximum);
  const clampDate = date => minimum && date < minimum ? new Date(minimum) : maximum && date > maximum ? new Date(maximum) : date;
  let selected = value, cursor = clampDate(parseDate(value) || parseDate(iso(new Date()))), month = new Date(cursor.getFullYear(),cursor.getMonth(),1), lifecycle;
  let view = 'days', pickerYear = month.getFullYear(), yearPage = Math.floor(pickerYear / 12) * 12;
  const error = h('span', { id: `${id}-error`, class: 'field-error', role: 'status', hidden: true });
  const input = h('input', { class: 'input date-input', type: 'text', placeholder: 'YYYY-MM-DD', value, inputmode: 'numeric',
    'aria-label': label, 'aria-describedby': error.id, autocomplete: 'off', min: minimum ? min : null, max: maximum ? max : null, required });
  const button = h('button', { class: 'date-open', type: 'button', 'aria-label': buttonLabel || (label ? `Choose ${label.toLowerCase()}` : 'Choose date'),
    'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': id }, icon('calendar', 'icon'));
  const menu = h('div', { id, class: 'control-menu calendar-menu', popover: 'auto', role: 'dialog', 'aria-label': label ? `${label} calendar` : 'Choose a date' });
  const root = h('div', { class: 'date-control' }, h('div', { class: 'date-entry' }, input, button), error, menu);
  root.controlElement = input;
  function validate() {
    const date = parseDate(input.value);
    const message = !input.value ? required ? 'Choose a date.' : ''
      : !date ? 'Enter a real date as YYYY-MM-DD, or choose one from the calendar.'
      : minimum && date < minimum ? `Choose a date on or after ${min}.`
      : maximum && date > maximum ? `Choose a date on or before ${max}.` : '';
    const invalid = !!message;
    input.setAttribute('aria-invalid', String(invalid)); error.hidden = !invalid;
    error.textContent = message;
    return !invalid;
  }
  function close(focus = true) { if (menu.matches(':popover-open')) menu.hidePopover(); if (focus) button.focus({ preventScroll: true }); }
  function choose(date) {
    if (date && !inRange(parseDate(iso(date))) || !date && required) return;
    selected = date ? iso(date) : ''; input.value = selected; validate(); close(); onChange?.(selected);
  }
  function moveMonth(delta) { cursor = clampDate(new Date(month.getFullYear(),month.getMonth()+delta,1)); month = new Date(cursor.getFullYear(),cursor.getMonth(),1); draw(); }
  const yearAvailable = year => year >= 1 && year <= 9999 && (!minimum || year >= minimum.getFullYear()) && (!maximum || year <= maximum.getFullYear());
  const monthAvailable = (year, index) => yearAvailable(year) && (!minimum || new Date(year,index+1,0) >= minimum) && (!maximum || new Date(year,index,1) <= maximum);
  function openMonthPicker() { view = 'months'; pickerYear = month.getFullYear(); draw(); focusPicker(); }
  function focusItem(item) { item?.focus({ preventScroll: true }); revealMenuItem(menu, item); }
  function focusPicker() { focusItem(menu.querySelector('.calendar-picker-button[tabindex="0"]')); }
  function pickerGrid(items, activeValue, ariaLabel, onPick) {
    const enabled = items.filter(item => !item.disabled);
    const tabValue = enabled.some(item => item.value === activeValue) ? activeValue : enabled[0]?.value;
    const grid = h('div', { class: 'calendar-picker-grid', role: 'group', 'aria-label': ariaLabel });
    items.forEach((item, index) => grid.append(h('button', {
      class: 'calendar-picker-button', type: 'button', disabled: item.disabled, tabindex: item.value === tabValue ? '0' : '-1',
      'aria-pressed': String(item.value === activeValue), 'aria-label': item.label, text: item.text,
      onclick: () => onPick(item.value), onkeydown: event => {
        const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, ...(view === 'years' ? { PageUp: -12, PageDown: 12 } : {}) };
        if (!Object.hasOwn(moves,event.key) && !['Home','End'].includes(event.key)) return;
        event.preventDefault();
        const step = moves[event.key] || (event.key === 'Home' ? 1 : -1);
        let next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index + step;
        while (next >= 0 && next < items.length && items[next].disabled) next += step;
        const target = grid.children[next];
        if (!target && view === 'years') {
          const targetYear = item.value + step;
          if (!yearAvailable(targetYear)) return;
          yearPage = Math.floor(targetYear / 12) * 12; draw();
          const nextGrid = menu.querySelector('.calendar-picker-grid');
          const nextButton = nextGrid.querySelector(`[aria-label="${targetYear}"]`);
          [...nextGrid.children].forEach(button => { button.tabIndex = button === nextButton ? 0 : -1; });
          focusItem(nextButton);
          return;
        }
        if (!target || target.disabled) return;
        [...grid.children].forEach(button => { button.tabIndex = button === target ? 0 : -1; });
        focusItem(target);
      },
    })));
    return grid;
  }
  function periodHead() {
    if (view === 'days') return h('div', { class: 'calendar-head' },
      h('button', { class: 'calendar-period', type: 'button', 'aria-label': 'Choose month and year', onclick: openMonthPicker },
        h('span', { 'aria-live': 'polite', text: month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }), icon('chevron-down','icon icon-sm')),
      h('div', { class: 'calendar-nav' },
        h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Previous month', disabled: !!minimum && month <= new Date(minimum.getFullYear(),minimum.getMonth(),1), onclick: () => { moveMonth(-1); const nav = menu.querySelector('[aria-label="Previous month"]'); nav.disabled ? focusCursor() : focusItem(nav); } }, icon('chevron-left')),
        h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Next month', disabled: !!maximum && month >= new Date(maximum.getFullYear(),maximum.getMonth(),1), onclick: () => { moveMonth(1); const nav = menu.querySelector('[aria-label="Next month"]'); nav.disabled ? focusCursor() : focusItem(nav); } }, icon('chevron-right'))));
    const years = view === 'years';
    function move(delta) {
      if (years) yearPage += delta * 12; else pickerYear += delta;
      draw();
      const nav = menu.querySelector(`[aria-label="${delta < 0 ? 'Previous' : 'Next'} ${years ? '12 years' : 'year'}"]`);
      nav?.disabled ? focusPicker() : focusItem(nav);
    }
    return h('div', { class: 'calendar-head' },
      years ? h('strong', { class: 'calendar-year-range', 'aria-live':'polite', text: `${Math.max(1,yearPage)} – ${Math.min(9999,yearPage+11)}` }) :
        h('button', { class: 'calendar-period', type: 'button', 'aria-label': 'Choose year', onclick: () => { view='years'; yearPage=Math.floor(pickerYear/12)*12; draw(); focusPicker(); } }, h('span', { text: pickerYear }), icon('chevron-down','icon icon-sm')),
      h('div', { class: 'calendar-nav' },
        h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': `Previous ${years?'12 years':'year'}`, disabled: years ? yearPage <= (minimum?.getFullYear() || 1) : !yearAvailable(pickerYear-1), onclick: () => move(-1) }, icon('chevron-left')),
        h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': `Next ${years?'12 years':'year'}`, disabled: years ? yearPage+11 >= (maximum?.getFullYear() || 9999) : !yearAvailable(pickerYear+1), onclick: () => move(1) }, icon('chevron-right'))));
  }
  function pickerBody() {
    if (view === 'years') return pickerGrid(Array.from({ length:12 }, (_,i) => ({ value:yearPage+i, text:yearPage+i, label:String(yearPage+i), disabled:!yearAvailable(yearPage+i) })), pickerYear, 'Choose a year', year => {
      pickerYear=year; view='months'; draw(); focusPicker();
    });
    return pickerGrid(Array.from({ length:12 }, (_,i) => ({ value:i, text:new Date(2026,i,1).toLocaleDateString(undefined,{month:'short'}),
      label:new Date(pickerYear,i,1).toLocaleDateString(undefined,{month:'long',year:'numeric'}), disabled:!monthAvailable(pickerYear,i) })), month.getMonth(), 'Choose a month', index => {
      const day = Math.min(cursor.getDate(),new Date(pickerYear,index+1,0).getDate());
      cursor=clampDate(new Date(pickerYear,index,day)); month=new Date(cursor.getFullYear(),cursor.getMonth(),1); view='days'; draw(); focusCursor();
    });
  }
  function focusCursor() {
    const day = menu.querySelector(`[data-date="${iso(cursor)}"]`);
    if (!day) return;
    focusItem(day);
  }
  function draw() {
    const title = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const selectedDate = parseDate(selected);
    const selection = selectedDate ? selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : 'Choose your date';
    const grid = h('div', { class: 'calendar-grid', role: 'grid', 'aria-label': title });
    grid.append(h('div', { class: 'calendar-week', role: 'row' }, ['Mo','Tu','We','Th','Fr','Sa','Su'].map(d => h('span', { role: 'columnheader', text: d }))));
    const start = new Date(month); start.setDate(1 - (start.getDay()+6)%7);
    for (let w = 0; w < 6; w++) {
      const row = h('div', { class: 'calendar-week', role: 'row' });
      for (let j = 0; j < 7; j++) {
        const day = new Date(start); day.setDate(start.getDate()+w*7+j);
        const key = iso(day), outside = day.getMonth() !== month.getMonth();
        const b = h('button', { type: 'button', class: `calendar-day${outside?' is-outside':''}${key===selected?' is-selected':''}${marked.includes(key)?' has-report':''}`,
          tabindex: key === iso(cursor) ? '0' : '-1', disabled: !inRange(day), dataset: { date: key }, 'aria-label': day.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'}) + (marked.includes(key)?`, ${markedLabel.toLowerCase()}`:''),
          'aria-current': key===iso(new Date())?'date':null, onclick: () => choose(day), text: String(day.getDate()),
          onkeydown: e => {
            const offset = { ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7 }[e.key];
            if (offset || ['Home','End','PageUp','PageDown'].includes(e.key)) {
              e.preventDefault(); cursor = new Date(day);
              if (offset) cursor.setDate(cursor.getDate()+offset);
              else if (e.key === 'Home') cursor.setDate(cursor.getDate()-(cursor.getDay()+6)%7);
              else if (e.key === 'End') cursor.setDate(cursor.getDate()+6-(cursor.getDay()+6)%7);
              else {
                const wanted=cursor.getDate(),next=cursor.getMonth()+(e.key==='PageUp'?-1:1)*(e.shiftKey?12:1);
                cursor=new Date(cursor.getFullYear(),next,1);
                cursor.setDate(Math.min(wanted,new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate()));
              }
              cursor = clampDate(cursor);
              month = new Date(cursor.getFullYear(),cursor.getMonth(),1); draw(); focusCursor();
            }
          } });
        row.append(h('div', { role: 'gridcell', 'aria-selected': String(key===selected) }, b));
      }
      grid.append(row);
    }
    menu.replaceChildren(...[
      h('div', { class: 'calendar-selection' },
        h('div', { class: 'calendar-date-stamp', 'aria-hidden': 'true' },
          h('span', { text: selectedDate ? selectedDate.toLocaleDateString(undefined,{month:'short'}) : 'DATE' }),
          selectedDate ? h('b', { text: selectedDate.getDate() }) : icon('calendar')),
        h('div', { class: 'calendar-selection-copy' }, h('span', { class: 'calendar-eyebrow', text: selectedDate ? 'Selected date' : label || 'Date picker' }), h('strong', { text: selection }),
          h('span', { class: 'calendar-selection-year', text: selectedDate ? String(selectedDate.getFullYear()) : 'Choose a day below' })),
        h('button', { class: 'btn btn-icon calendar-close', type: 'button', 'aria-label': 'Close calendar', onclick: () => close() }, icon('x', 'icon icon-sm'))),
      periodHead(),
      view === 'days' ? grid : pickerBody(),
      view !== 'days' ? h('button', { class:'calendar-back', type:'button', onclick:()=>{view='days';draw();focusItem(menu.querySelector('.calendar-period'));} }, icon('chevron-left','icon icon-sm'), 'Back to calendar') : null,
      marked.length ? h('p', { class: 'calendar-legend' }, h('span', { 'aria-hidden': 'true' }), markedLabel) : null,
      h('div', { class: 'calendar-foot' },
        h('button', { class: 'btn btn-sm calendar-clear', type: 'button', 'aria-label':'Clear date', disabled: required || !selected, onclick: () => choose(null) }, icon('x','icon icon-sm'), 'Clear date'),
        h('button', { class: 'btn btn-sm btn-primary calendar-today', type: 'button', 'aria-label':'Today', 'aria-pressed':String(selected===iso(new Date())), disabled: !inRange(parseDate(iso(new Date()))), onclick: () => choose(new Date()) },
          icon(selected===iso(new Date())?'check':'sun','icon icon-sm'), 'Today', h('span', { 'aria-hidden':'true', text:new Date().toLocaleDateString(undefined,{day:'numeric',month:'short'}) })))].filter(Boolean));
  }
  input.addEventListener('input', () => {
    selected = input.value;
    if (input.getAttribute('aria-invalid') === 'true') validate();
    if (!commitOnly && (!(minimum || maximum || required) || validate())) onChange?.(selected);
  });
  input.addEventListener('blur', () => { if(validate()&&commitOnly)onChange?.(input.value); });
  input.addEventListener('keydown', e=>{if(e.key==='Enter'&&validate()&&commitOnly){e.preventDefault();onChange?.(input.value);}});
  button.addEventListener('click', () => {
    if (menu.matches(':popover-open')) return close();
    cursor=clampDate(parseDate(input.value)||parseDate(iso(new Date()))); month=new Date(cursor.getFullYear(),cursor.getMonth(),1);
    selected = input.value;
    view = 'days';
    draw(); menu.showPopover(); anchorMenu(menu, button, 360); focusCursor();
  });
  menu.addEventListener('toggle', e => {
    button.setAttribute('aria-expanded', String(e.newState === 'open'));
    lifecycle?.abort();
    if (e.newState === 'open') {
      lifecycle = new AbortController();
      const opts = { signal: lifecycle.signal };
      window.addEventListener('resize', () => close(false), opts);
      window.addEventListener('hashchange', () => close(false), opts);
    }
  });
  menu.addEventListener('keydown', e => {
    if(e.key==='Escape'){
      e.preventDefault();
      if(view!=='days'){view=view==='years'?'months':'days';draw();focusItem(menu.querySelector('.calendar-period'));}
      else close();
    }
    if(e.key==='Tab'){
      const tabs=[...menu.querySelectorAll('button:not([tabindex="-1"]):not(:disabled)')];
      if(e.shiftKey&&document.activeElement===tabs[0]){e.preventDefault();focusItem(tabs.at(-1));}
      else if(!e.shiftKey&&document.activeElement===tabs.at(-1)){e.preventDefault();focusItem(tabs[0]);}
    }
  });
  Object.defineProperty(root, 'value', { get: () => input.value, set: value => {
    selected = String(value || ''); input.value = selected; validate();
    if (menu.matches(':popover-open')) {
      cursor = clampDate(parseDate(selected) || parseDate(iso(new Date())));
      month = new Date(cursor.getFullYear(),cursor.getMonth(),1); draw();
    }
  } });
  return root;
}
