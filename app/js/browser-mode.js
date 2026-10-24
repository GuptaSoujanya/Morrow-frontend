/** Browser visibility is selected before a run and shared with its command preview. */
export const BROWSER_MODES = [
  {value: 'visible', label: 'Normal Chrome window'},
  {value: 'background', label: 'Background — no browser window'},
];
export const BROWSER_ACTIONS = new Set(['naukri', 'boards', 'profile', 'external', 'linkedin', 'linkedin_profile', 'cold_email', 'resume', 'assist', 'pipeline']);
export const BROWSER_RUN_MESSAGE = 'Chrome opens normally. Turn on Run in background to hide browser windows for the next run. Logs and progress stay in Activity.';

export function browserRunOptions(action, options = {}) {
  const selected = {...options};
  if (!BROWSER_ACTIONS.has(action)) return selected;
  selected.browser_mode = selected.browser_mode === 'background' ||
    (!selected.browser_mode && selected.headless === true) ? 'background' : 'visible';
  delete selected.headless;
  return selected;
}
