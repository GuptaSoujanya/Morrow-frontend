/** Browser visibility is explicit in every dashboard run, including previews. */
export const BROWSER_MODES = [
  {value: 'background', label: 'Background — no browser window'},
  {value: 'visible', label: 'Visible — watch Chrome'},
];
export const BROWSER_ACTIONS = new Set(['naukri', 'boards', 'profile', 'external', 'linkedin', 'linkedin_profile', 'cold_email', 'resume', 'assist', 'pipeline']);

export function browserRunOptions(action, options = {}) {
  const selected = {...options};
  if (!BROWSER_ACTIONS.has(action)) return selected;
  selected.browser_mode ??= typeof selected.headless === 'boolean'
    ? (selected.headless ? 'background' : 'visible') : 'background';
  delete selected.headless;
  return selected;
}
