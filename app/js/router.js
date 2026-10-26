/** Minimal hash router: `#/<section>` or `#/<section>/<arg>`. Pure parsing lives here so it
 * can be unit tested without a DOM/location object. */

export const SECTIONS = [
  ["overview", "Launchpad", "grid"],
  ["bots", "Bot Crew", "bot"],
  ["analytics", "Insights", "chart"],
  ["pipeline", "Flows", "refresh"],
  ["naukri", "Apply on Naukri", "send"],
  ["boards", "Job boards", "globe"],
  ["sites", "Company sites", "globe"],
  ["profile", "Naukri profile", "refresh"],
  ["linkedin", "LinkedIn post", "pen"],
  ["resume", "Tailor resume", "file"],
  ["reports", "Reports", "chart"],
  ["learning", "Learning", "book"],
  ["todo", "Action inbox", "check"],
  ["setup", "Preferences", "sliders"],
  ["onboarding", "Setup checklist", "check"],
  ["connections", "Connections", "globe"],
  ["files", "My profile & files", "folder"],
  ["records", "Applications", "file"],
  ["data", "Data hub", "folder"],
  ["outreach", "Recruiter drafts", "send"],
  ["linkedin-profile", "LinkedIn profile", "person"],
  ["plans", "Plans & billing", "chart"],
  ["account", "My account", "person"],
  ["admin", "Administration", "sliders"],
  ["login", "Sign in", "person"],
  ["signup", "Create account", "person"],
  ["forgot", "Forgot password", "person"],
  ["reset", "Reset password", "person"],
  ["verify", "Verify email", "person"],
  ["resend", "Resend verification", "person"],
];

const NAMES = new Set(SECTIONS.map(([name]) => name));
const DEFAULT_ROUTE = { name: "overview", arg: "" };
const missingRoute = path => ({ name: 'not-found', arg: path.slice(0, 160) });

export function parseHash(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "").split('?')[0];
  if (!raw) return { ...DEFAULT_ROUTE };
  let [name, ...rest] = raw.split("/");
  if (name === 'today') name = 'overview';
  if (name === 'dsa') { name = 'learning'; rest = ['dsa']; }
  if (name === 'study') { name = 'learning'; rest = ['courses']; }
  if (name === 'research') {
    const query = new URLSearchParams(String(hash).split('?')[1] || '');
    const view = query.get('view');
    name = 'learning';
    if (rest.join('/')) rest = ['read', ...rest];
    else if (view === 'resume') rest = ['resume'];
    else if (view === 'progress') rest = ['progress'];
    else if (view === 'learning') rest = ['plan'];
    else if (view === 'library' || query.has('category') || query.has('q') || query.has('date')) rest = ['library'];
    else rest = [];
  }
  if (!NAMES.has(name)) return missingRoute(raw);
  try { return { name, arg: decodeURIComponent(rest.join("/")) }; }
  catch { return missingRoute(raw); }
}

export function parseRoute(loc = window.location) {
  return parseHash(loc.hash);
}

export function routeHref(name, arg = "") {
  if (name === 'research') return arg ? `#/learning/read/${encodeURIComponent(arg)}` : '#/learning';
  if (name === 'study') return '#/learning/courses';
  if (name === 'learning') return arg ? `#/learning/${arg.split('/').map(encodeURIComponent).join('/')}` : '#/learning';
  return arg ? `#/${name}/${encodeURIComponent(arg)}` : `#/${name}`;
}

export function navigate(name, arg = "") {
  window.location.hash = routeHref(name, arg);
}
