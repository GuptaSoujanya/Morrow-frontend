import { h } from '../dom.js';
import { api, accountRequestSignal } from '../api.js';
import { setConsoleSize } from './console.js';
import { hooks } from '../state.js';

export function prepareLearningButton(refreshLearning) {
  const scope = accountRequestSignal();
  const feedback = h('p', { class: 'daily-feed-feedback', role: 'status', hidden: true });
  const button = h('button', { class: 'btn', type: 'button', text: 'Prepare today’s lesson & discoveries', onclick: async () => {
    button.disabled = true; feedback.hidden = false; feedback.textContent = 'Starting daily preparation…';
    try {
      const result = await api('/api/learning/feed/run', {});
      if (scope.aborted || !button.isConnected) return;
      feedback.textContent = result.started ? 'Preparation started. Follow progress in Activity.' : result.status?.message || 'Daily preparation is already running.';
      if (result.started || result.status?.running) setConsoleSize('normal');
      await Promise.allSettled([refreshLearning(), hooks.refreshStatus?.()]);
    } catch (error) {
      if (!scope.aborted && button.isConnected && error.name !== 'AbortError') feedback.textContent = `Could not prepare learning. ${error.message}`;
    } finally { if (button.isConnected) button.disabled = false; }
  } });
  return h('div', { class: 'research-fetch-control' }, button, feedback);
}

export function learningFeed(day, refreshLearning) {
  const scope = accountRequestSignal();
  let data, disposed = false, busy = false, ticket = 0;
  const summary = h('span', { class: 'daily-feed-state', text: 'Loading…' });
  const message = h('p', { class: 'muted', text: 'Checking your daily fetch settings…' });
  const feedback = h('p', { class: 'daily-feed-feedback', role: 'status', hidden: true });
  const toggle = h('input', { type: 'checkbox', disabled: true, onchange: () => save(toggle.checked) });
  const control = h('label', { class: 'daily-feed-toggle' }, toggle, h('span', {},
    h('strong', { text: 'Fetch new learning each day' }),
    h('small', { text: 'While the dashboard is running, prepare your next lesson and fresh papers, tech news, and GitHub projects.' })));
  const root = h('details', { class: 'daily-feed' },
    h('summary', {}, h('span', { text: 'Daily fetch' }), summary),
    h('div', { class: 'daily-feed-body' },
      h('p', { text: 'Your course keeps its order. Each fetch uses completed lessons to prepare the next one and adds current discoveries.' }),
      control, message, feedback,
      prepareLearningButton(async () => { await refresh(); await refreshLearning(); })));
  const current = () => !disposed && !scope.aborted && root.isConnected;
  function draw() {
    summary.textContent = data?.automatic ? 'On' : 'Off';
    toggle.checked = Boolean(data?.automatic);
    toggle.disabled = busy || !data?.configured;
    message.textContent = data?.message || (data?.running ? 'Preparing new learning. Follow progress in Activity.' : data?.automatic
      ? 'Daily fetching is on. Your next unfinished lesson stays at the front of your course.'
      : 'Automatic fetching is off. Your saved course lessons are ready to read.');
  }
  async function refresh() {
    if (!current() || busy) return;
    const request = ++ticket;
    try {
      const result = await api('/api/learning/feed', undefined, { fresh: true });
      if (!current() || request !== ticket || busy) return;
      data = result; feedback.hidden = true; draw();
    } catch (error) {
      if (!current() || request !== ticket || error.name === 'AbortError') return;
      summary.textContent = 'Unavailable';
      message.replaceChildren(document.createTextNode('Daily fetch settings could not load. '),
        h('button', { class: 'text-link', type: 'button', text: 'Retry', onclick: refresh }));
    }
  }
  async function save(automatic) {
    if (!current() || busy) return;
    busy = true; ++ticket; toggle.disabled = true; feedback.hidden = false;
    feedback.textContent = 'Saving daily fetch settings…';
    try {
      const result = await api('/api/learning/feed', { automatic });
      if (!current()) return;
      data = typeof result.automatic === 'boolean' ? result : await api('/api/learning/feed', undefined, { fresh: true });
      if (!current()) return;
      feedback.textContent = automatic ? 'Daily fetching is on.' : 'Daily fetching is off.';
    } catch (error) {
      if (current() && error.name !== 'AbortError') feedback.textContent = `Your setting was not saved. ${error.message}`;
    } finally { busy = false; if (current()) draw(); }
  }
  root.refresh = refresh;
  root.day = day;
  root.dispose = () => { disposed = true; ++ticket; };
  return root;
}
