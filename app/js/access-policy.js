/** One account policy for routes, navigation, shortcuts and private prefetches.
 * The API remains authoritative; the UI never assumes access before identity loads.
 */
export const AUTH_ROUTES = new Set(['login', 'signup', 'forgot', 'reset', 'verify', 'resend']);
export const ACCOUNT_ROUTES = new Set([...AUTH_ROUTES, 'plans', 'account', 'admin']);

const ROUTES = {
  overview: {},
  files: { module: 'profile' },
  records: { module: 'applications' },
  data: { module: 'files' },
  bots: { module: 'automations', runtime: true },
  pipeline: { module: 'automations', runtime: true },
  todo: { module: 'automations', runtime: true },
  naukri: { module: 'automations', runtime: true },
  boards: { module: 'automations', runtime: true },
  sites: { module: 'automations', runtime: true },
  profile: { module: 'automations', runtime: true },
  linkedin: { module: 'outreach', runtime: true },
  'linkedin-profile': { module: 'outreach', runtime: true },
  outreach: { module: 'outreach', runtime: true },
  resume: { module: 'resumes', runtime: true },
  research: { module: 'research' },
  study: { module: 'learning', runtime: true },
  analytics: { module: 'analytics' },
  reports: { module: 'analytics', runtime: true },
  setup: {},
  onboarding: { account: true },
  connections: {},
  plans: { account: true },
  account: { account: true },
  admin: { account: true, admin: true },
};
const GROUPS = [
  ['WORKSPACE', ['overview', 'bots', 'pipeline', 'todo', 'records']],
  ['KNOWLEDGE & DATA', ['research', 'data', 'analytics', 'reports', 'study']],
  ['PERSONAL', ['files', 'connections', 'onboarding', 'setup']],
  ['ACCOUNT', ['plans', 'account', 'admin']],
];
const BOT_ROUTES = ['naukri', 'boards', 'sites', 'profile', 'linkedin', 'linkedin-profile', 'outreach', 'resume'];

export function routeAccess(route, context = {}) {
  const name = typeof route === 'string' ? route : route.name;
  if (name === 'not-found') return { kind: 'not-found' };
  if (!context.accountMode) return { kind: 'loading' };
  if (context.accountMode === 'local' && context.legacyAccess && (ACCOUNT_ROUTES.has(name) || name === 'onboarding')) {
    return { kind: 'redirect', route: ['account', 'onboarding'].includes(name)
      ? { name: 'files', arg: 'profile' } : { name: 'overview', arg: '' } };
  }
  if (AUTH_ROUTES.has(name)) return { kind: 'allowed' };
  const rule = ROUTES[name];
  if (!rule) return { kind: 'forbidden' };
  if (context.accountMode === 'local') {
    return { kind: context.legacyAccess && !rule.account ? 'allowed' : 'forbidden', module: rule.module };
  }
  if (context.accountMode !== 'accounts' || !context.user) return { kind: 'login' };
  if (rule.admin && context.user.role !== 'admin') return { kind: 'forbidden' };
  // The combined editor's profile tab and private file tabs use distinct core modules.
  const module = name === 'files' && typeof route === 'object' && route.arg && route.arg !== 'profile'
    ? 'files' : rule.module;
  if (module && context.user.role !== 'admin' && !context.user.modules?.includes(module)) {
    return { kind: 'upgrade', module };
  }
  if (rule.runtime && !context.legacyAccess) return { kind: 'runtime', module };
  return { kind: 'allowed', module };
}

function visibleRoute(name, context) {
  if (name === 'setup' && !context.legacyAccess) return false;
  return ['allowed', 'runtime'].includes(routeAccess(name, context).kind);
}

export function navigationGroups(context = {}, { includeBotControls = false } = {}) {
  const groups = includeBotControls ? [...GROUPS, ['Bot controls', BOT_ROUTES]] : GROUPS;
  return groups.map(([title, names]) => [title, names.filter(name => visibleRoute(name, context))])
    .filter(([, names]) => names.length);
}

export function mobileRoutes(context = {}) {
  const preferred = context.legacyAccess
    ? ['overview', 'bots', 'todo', 'analytics', 'records', 'data', 'files']
    : ['overview', 'records', 'data', 'files', 'bots', 'analytics'];
  return preferred.filter(name => visibleRoute(name, context)).slice(0, 4);
}

export function keyboardRoutes(context = {}) {
  if (AUTH_ROUTES.has(context.route?.name)) return [];
  return navigationGroups(context).flatMap(([, names]) => names).slice(0, 9);
}

export function routeLabel(name, context = {}) {
  return name === 'overview' && context.accountMode === 'accounts' && !context.legacyAccess
    ? 'Workspace' : null;
}

/** Return only a renderer the current account may load. */
export function preloadRoute(route, context = {}) {
  const name = typeof route === 'string' ? route : route.name;
  if (routeAccess(route, context).kind !== 'allowed' || ACCOUNT_ROUTES.has(name)) return null;
  if (!context.legacyAccess && ['overview', 'analytics'].includes(name)) return 'tenant-overview';
  if (!context.legacyAccess && name === 'setup') return null;
  return name;
}
