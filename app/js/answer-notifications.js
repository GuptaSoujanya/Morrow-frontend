import { S, hooks } from './state.js';
import { accountRequestSignal } from './api.js';
import { toast } from './components/toast.js';

let scope;
let seen = new Set();
let desktop = new Set();
export function resetAnswerNotifications() {
  seen = new Set();
  scope = accountRequestSignal();
  for (const alert of desktop) alert.close();
  desktop.clear();
  document.querySelectorAll('.answer-update-toast').forEach(node=>node.remove());
  hooks.refreshAnswerReview = () => {};
}

export function receiveAnswerNotifications(run, {announce = true} = {}) {
  if (!S.legacyAccess) return;
  if (scope !== accountRequestSignal()) resetAnswerNotifications();
  const fresh = (Array.isArray(run.notifications) ? run.notifications : []).filter(item => {
    const valid=item?.kind === 'answer_saved' && typeof item.id === 'string' && item.id &&
      typeof item.question === 'string' && typeof item.answer === 'string' &&
      typeof item.run_id === 'string' && !seen.has(item.id);
    if(valid){seen.add(item.id);if(seen.size>2000)seen.delete(seen.values().next().value);}
    return valid;
  });
  for (const item of fresh) {
    S.answerUpdates = [item, ...S.answerUpdates.filter(old=>old.id!==item.id)].slice(0,100);
  }
  if (!fresh.length) return;
  const file = S.loadedFiles.automation_answers;
  if (file) file.externalUpdates = true;
  hooks.refreshAnswerReview();
  if (!announce) return;
  document.querySelectorAll('.answer-update-toast').forEach(node=>node.remove());
  toast(fresh.length === 1 ? 'Answer sheet updated' : `Answer sheet updated · ${fresh.length} answers saved`,
    'ok', 12000, {className:'answer-update-toast', action:{label:'Review changes',href:'#/files/automation_answers'}});
  if (S.desktopAnswerAlerts && document.hidden && globalThis.Notification?.permission === 'granted') {
    try {
      const currentScope=scope;
      const alert = new Notification('Answer sheet updated', {body:'Your agent saved an answer. Open Morrow to review it.', tag:'morrow-answer-updates'});
      desktop.add(alert);
      alert.onclose=()=>desktop.delete(alert);
      alert.onclick=()=>{if(!currentScope.aborted){window.focus();location.hash='#/files/automation_answers';}alert.close();};
    } catch { /* In-app review remains available if the browser disallows desktop alerts. */ }
  }
}
