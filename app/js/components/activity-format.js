/** Activity summaries are deliberately conservative. Only runner metadata determines
 * whether a run succeeded; a successful individual step is not a completed run. */
export function activityRuns(snapshot = {}) {
  if (Array.isArray(snapshot.runs)) return snapshot.runs.map(run => ({
    ...run,
    status: run.status || (run.running ? (run.stopping ? 'stopping' : 'running') : run.stopped ? 'stopped' : run.exit === 0 ? 'completed' : 'failed'),
  }));
  if (snapshot.running) return [{...snapshot, id: 'legacy', status: snapshot.stopping ? 'stopping' : 'running'}];
  if (snapshot.last) return [{...snapshot.last, id: 'legacy', running: false, status: snapshot.last.stopped ? 'stopped' : snapshot.last.exit === 0 ? 'completed' : 'failed'}];
  return [];
}

export function activityState(run) {
  return {running: 'Running', stopping: 'Stopping', completed: 'Completed', failed: 'Needs attention', stopped: 'Stopped'}[run?.status] || 'Standby';
}

const naukriSignInDetail = 'Open Connections → Naukri, sign in and check the connection. Close the sign-in browser, then retry this run. Google and Naukri use separate sign-ins.';

/** Recovery links are fixed application routes, never destinations from agent output. */
export function activityRecovery(run, events = []) {
  if (!run || run.status === 'completed') return null;
  const needsNaukri = events.some(event => event?.recovery === 'sign-in' &&
    (event.provider === 'naukri' || (!event.provider && ['naukri', 'profile'].includes(run.action))));
  return needsNaukri ? {provider: 'naukri', label: 'Connect Naukri', href: '#/connections/naukri', detail: naukriSignInDetail} : null;
}

export function readableActivity(raw) {
  const source = String(raw || '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').trim();
  if (!source) return null;
  const text = source
    .replace(/^\d{4}-\d\d-\d\d[ T][\d:.,+Z-]+\s*[-|]?\s*/, '')
    .replace(/^\[?\d\d:\d\d:\d\d(?:\.\d+)?\]?\s*/, '')
    .replace(/^\[?(?:INFO|DEBUG|WARNING|WARN|ERROR|CRITICAL)\]?\s*[:|\-]?\s*/i, '')
    .replace(/^\[(?:agent|pipeline|lanes)[^\]]*\]\s*/i, '');
  const event = (kind, title, detail) => ({kind, title, detail});

  if (/^→ .*\$ /.test(source)) return event('info', 'Run started', 'The agent is working on your request.');
  // Lifecycle endings are displayed from the server's run status, not guessed from output.
  if (/^[✓○×] .*\(\d+s\)$/.test(source)) return null;
  if (/Naukri is blocking access to this browser/i.test(text)) return event('attention',
    'Naukri denied browser access', /open Chrome window.*Waiting up to/i.test(text)
      ? 'Naukri is showing Access Denied in Chrome. The bot is waiting and can continue only if the site allows access and sign-in is verified.'
      : 'Naukri blocked this browser. The bot did not continue past sign-in. Check that Naukri is accessible before trying again.');
  if (/Finish sign-in in the open Chrome window.*Waiting up to/i.test(text)) return event('attention',
    'Naukri is waiting for you', 'Finish signing in directly in the open Chrome window. Keep it open; the bot waits up to 5 minutes and resumes after verification. Use Stop in Activity to cancel.');
  if (/Open browser in Activity.*Waiting up to/i.test(text)) return event('attention',
    'Naukri is waiting for you', 'This older background run is waiting for sign-in. Stop it, turn off Run in background, then start again to sign in directly in Chrome.');
  if (/Naukri sign-in verified\. Resuming/i.test(text)) return event('info',
    'Naukri sign-in confirmed', 'The bot has verified sign-in and is continuing its work.');
  const signInRequired = /sign[- ]?in (?:required|needed|expired)|login (?:required|expired)|not logged in|session expired|please (?:log|sign) in/i.test(text);
  const naukriSignIn = /\bnaukri (?:is not connected|needs you to sign in again|needs a security check)\b|\b(?:reconnect|connect) naukri in connections\b/i.test(text)
    || (signInRequired && /\bnaukri\b/i.test(text));
  if (naukriSignIn) return {...event('attention', 'Naukri sign-in needed', naukriSignInDetail), recovery: 'sign-in', provider: 'naukri'};
  if (signInRequired) return {...event('attention', 'Sign-in required.', 'Open this platform’s account connection, sign in, then try the run again.'), recovery: 'sign-in',
    provider: text.match(/\b(google|gmail|linkedin|hirist|instahyre|cutshort|wellfound|kiro|claude)\b/i)?.[1].toLowerCase()};
  if (/captcha|verification (?:required|challenge)|verify (?:that )?you are human/i.test(text)) return event('attention', 'The platform needs your help', 'Check the open Chrome window and Technical details for the next step. For a background run, finish verification in Connections after the run stops, then retry.');
  if (/waiting for you|click your answer|type your answer|unknown (?:radio|text) question/i.test(text)) return event('attention', 'Your input is needed', 'Review the question in Technical details and follow its instructions in the open Chrome window.');
  if (/quota (?:expired|exceeded)|daily (?:quota|limit).*(?:reached|exceeded)|rate limit|too many requests|\b429\b/i.test(text)) return event('attention', 'A usage limit was reached', 'Wait for the platform’s limit to reset before trying this step again.');
  if (/(?:missing|invalid|not set|not configured).*(?:api.?key|credentials)|(?:api.?key|credentials).*(?:missing|invalid|not set|not configured)/i.test(text)) return event('attention', 'Check your connection settings', 'The agent needs valid credentials. Review Settings before starting another run.');
  if (/timed? ?out|TimeoutError/i.test(text)) return event('attention', 'A step took too long', 'The agent reported a timeout. Check its final status before retrying.');
  if (/connection (?:refused|reset|failed)|network (?:error|unreachable)|name resolution|failed to fetch/i.test(text)) return event('attention', 'A service could not be reached', 'Check the connection. The agent’s final status will show whether it recovered.');
  if (/could not (?:load|read) (?:your )?(?:profile|settings)|no resume PDF|file not found|FileNotFoundError/i.test(text)) return event('attention', 'A required file is missing or unreadable', 'Check your profile, resume, and file settings. Technical details show the affected file.');
  if (/^× Could not start:/.test(source)) return event('attention', 'The agent could not start', 'Review Technical details for the launch error, then try again.');
  if (/\b(?:ERROR|CRITICAL)\b/.test(source) || /^(?:Traceback \(most recent call last\)|[A-Za-z]+Error:|could not |failed to )/i.test(text)) return event('attention', 'A step needs attention', 'The agent reported a problem. Open Technical details for the exact message.');
  if (/^\s*(?:File "|[{}\[\]]\s*$|[=─━-]{4,}|at \S+\(|\^+$)/.test(text)) return null;
  if (/dry[- ]run|practice (?:run|mode)|preview (?:mode|only)/i.test(text)) return event('info', 'Practice mode', 'Check the detailed output to see which actions this run is previewing.');
  if (/logging in|signing in|checking (?:the )?(?:login|session)/i.test(text)) return event('info', 'Connecting to your account', 'The agent is checking the platform session.');
  if (/opening.*(?:browser|profile|page)|launching.*browser|copying.*(?:chrome )?profile/i.test(text)) return event('info', 'Opening the workspace', 'The agent is preparing the browser or page it needs.');
  if (/searching|collecting job|selecting jobs|finding.*(?:job|role)|visiting job/i.test(text)) return event('info', 'Looking for opportunities', 'The agent is reviewing jobs that may match your profile.');
  if (/found \d+ (?:job|role)|unique job links (?:collected|found)/i.test(text)) return event('info', 'Jobs found', 'The agent found opportunities to review. See Technical details for the reported count.');
  if (/reading|fetching|researching|gathering|collecting.*(?:news|article)|working\.\.\./i.test(text)) return event('info', 'Gathering information', 'The agent is collecting material for this task.');
  if (/writing|generating|drafting|merges? the \d+ drafts|tailoring/i.test(text)) return event('info', 'Preparing your content', 'The agent is creating or updating the material for this task.');
  if (/saved (?:to|results)|results saved|\bwrote\b|checkpoint:/i.test(text)) return event('info', 'Progress saved', 'The agent reported saving work. The full run may still be in progress.');
  if (/\b(?:WARNING|WARN)\b/.test(source)) return event('attention', 'The agent reported a warning', 'It may still continue. Check Technical details if the result needs attention.');
  return null;
}

export function activityDescription(run, event) {
  if (!run) return 'Run a bot to follow its progress here.';
  if (run.status === 'stopping') return 'Closing this run safely. Other agents can keep working.';
  if (run.status === 'completed') return 'The run finished. Review its results before your next step.';
  if (run.status === 'stopped') return 'This run was stopped. Any work already saved is still available.';
  if (run.status === 'failed') return event?.kind === 'attention' ? event.detail : 'This run could not finish. Open Technical details to review the problem before retrying.';
  return event?.detail || 'The agent is working. New progress will appear as it reports back.';
}
