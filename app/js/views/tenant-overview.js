import { h } from '../dom.js';
import { api } from '../api.js';
import { S, hooks, setOverviewDays } from '../state.js';
import { icon } from '../icons.js';
import { num, rangeText } from '../format.js';
import { avatar, workspaceAvatar } from '../components/identity.js';
import { journeyBanner } from '../components/journey.js';
import { kpiCard } from '../components/kpi.js';
import { panel, empty, loadingState, errorState } from '../components/panel.js';
import { segmented } from '../components/segmented.js';
import { recordTable } from './records.js';

const RANGES = [[7, '7 days'], [14, '14 days'], [30, '30 days'], [0, 'All time']];
const TOOLKIT = [
  { module: 'automations', name: 'Bot Crew', image: 0, route: 'bots', runtime: true,
    description: 'Your specialists for finding roles and keeping applications moving.' },
  { module: 'research', name: 'Research Studio', image: 11, route: 'research',
    description: 'Keep your company research, preparation, and saved documents close.' },
  { module: 'learning', name: 'Learning path', image: 30, route: 'study', runtime: true,
    description: 'Build a learning routine around your next career move.' },
  { module: 'resumes', name: 'Resume studio', image: 9, route: 'resume', runtime: true,
    description: 'Prepare tailored resumes from your saved experience and the roles you want.' },
  { module: 'outreach', name: 'Outreach', image: 8, route: 'outreach', runtime: true,
    description: 'Prepare introductions and follow up on opportunities with your own voice.' },
  { module: 'analytics', name: 'Insights', image: 7, route: 'analytics',
    description: 'Review the application outcomes recorded in your private workspace.' },
];

let pending = null;

function privateData() {
  const overview = S.overview;
  // Never render the owner's shared workspace if an old view remains in memory.
  if (overview?.userId && overview.userId !== S.user?.id) return null;
  return overview?.data?.source?.database === 'Private account' ? overview.data : null;
}

async function refreshOverview(fresh = true) {
  const userId = S.user?.id;
  if (!userId) return;
  const days = S.overviewDays;
  const key = `${userId}:${days}`;
  if (pending?.key === key) return pending.promise;
  const promise = (async () => {
    try {
      const data = await api(`/api/overview?days=${days}`, undefined, { fresh });
      if (S.user?.id !== userId || S.overviewDays !== days) return;
      S.overview = { days, data, userId, at: Date.now(), error: '' };
    } catch (error) {
      if (S.user?.id !== userId || S.overviewDays !== days) return;
      S.overview = { days, data: privateData(), userId, at: Date.now(), error: error.message };
    } finally {
      if (pending?.key === key) pending = null;
      if (S.user?.id === userId && ['overview', 'analytics'].includes(S.route.name)) {
        hooks.requestRender(false);
      }
    }
  })();
  pending = { key, promise };
  return promise;
}

function chooseRange(days) {
  setOverviewDays(days);
  refreshOverview();
  hooks.requestRender(false);
}

function metrics(data) {
  return h('div', { class: 'kpis compact-kpis' },
    kpiCard({ label: 'Application attempts', value: num(data.attempts), sub: 'All recorded outcomes in this period' }),
    kpiCard({ label: 'Confirmed submissions', value: num(data.sent.total), sub: 'Applications recorded as sent' }),
    kpiCard({ label: 'Opportunities found', value: num(data.found.total), sub: 'Jobs saved in this period' }),
    kpiCard({ label: 'Saved documents', value: num(data.workspace?.research_count ?? 0), sub: 'Your private research library · all time' }),
  );
}

function workspaceLinks() {
  const links = [
    ['person', 'My profile & files', 'Your experience and reusable answers', '#/files/profile'],
    ['file', 'Applications', 'Your recorded attempts and outcomes', '#/records'],
    ['folder', 'Data hub', 'Find your private files and documents', '#/data'],
    ['sliders', 'Account settings', 'Your sign-in and AI preference', '#/account'],
  ];
  return panel('Your workspace', { sub: 'Keep the essentials close.' },
    h('div', { class: 'attention-list' }, links.map(([name, title, description, href]) =>
      h('a', { class: 'attention-item', href },
        h('span', { class: 'attention-icon' }, icon(name)),
        h('span', { class: 'attention-copy' }, h('strong', { text: title }), h('small', { text: description })),
        icon('arrow-up-right', 'icon icon-sm'),
      ),
    )),
  );
}

function accountPlan(user) {
  const provider = user.ai_provider === 'claude' ? 'Claude' : user.ai_provider === 'kiro' ? 'Kiro' : '';
  const admin = user.role === 'admin';
  return panel('Your workspace access', { sub: admin ? 'Administrator · All modules' : `${user.plan_name || 'Free'} plan` },
    h('div', { class: 'growth-illustration' }, avatar(11, 'growth-avatar'),
      h('div', {}, h('strong', { text: admin ? 'All modules' : user.plan_name || 'Free' }), h('span', { text: admin ? 'Administrator access' : 'Your current plan' }))),
    h('p', { class: 'muted', text: user.role === 'admin'
      ? 'You can manage people, plans, and access. Views of another account are recorded in the audit log.'
      : 'Your plan determines which tools you can use. Your profile, applications, and private files stay with you.' }),
    h('div', { class: 'panel-foot' }, h('a', { class: 'btn', href: '#/plans', text: 'View plans' })),
    h('div', { class: 'attention-bottom' }, icon('info', 'icon icon-sm'),
      h('span', { text: provider
        ? `${provider} is your preference. Use your own subscription; no AI session is connected yet.`
        : 'Bring your own Claude or Kiro subscription. AI access is not included in your plan.' })),
  );
}

function toolkit(user) {
  const tools = TOOLKIT.filter(tool => user.role === 'admin' || user.modules?.includes(tool.module));
  if (!tools.length) return null;
  return h('section', { class: 'fleet-section', 'aria-labelledby': 'tenant-toolkit-title' },
    h('div', { class: 'section-heading' },
      h('div', {}, h('h2', { id: 'tenant-toolkit-title', text: 'Your career toolkit' }),
        h('p', { text: 'The tools included in your workspace, with their current availability.' })),
      h('a', { class: 'text-link', href: '#/plans', text: 'Compare plans' })),
    h('div', { class: 'reading-grid' }, tools.map(tool => {
      const status = tool.runtime ? 'Connection needed' : 'Included';
      return h('article', { class: 'bot-card' },
        h('div', { class: 'bot-top' }, avatar(tool.image, 'bot-icon'), h('span', { class: 'bot-status', text: status })),
        h('h3', { text: tool.name }), h('p', { class: 'bot-description', text: tool.description }),
        h('div', { class: 'bot-record' }, h('span', { text: tool.runtime ? 'Included in your access. Personal connections are not available yet.' : 'Uses your own saved workspace data.' })),
        h('div', { class: 'bot-actions' }, h('a', {
          class: 'btn', href: `#/${tool.route}`,
          text: tool.runtime ? 'View availability' : `Open ${tool.name}`,
          'aria-label': tool.runtime ? `View ${tool.name} availability` : `Open ${tool.name}`,
        }, icon('arrow-up-right', 'icon icon-sm'))),
      );
    })),
  );
}

export function renderTenantOverview() {
  const user = S.user || {};
  const data = privateData();
  const overview = S.overview;
  const name = String(user.name || user.email?.split('@')[0] || '').trim().split(/\s+/)[0];
  const analytics = S.route.name === 'analytics';
  if (!pending && (!overview || (!data && !overview.error))) refreshOverview(false);
  const busy = pending?.key === `${user.id}:${S.overviewDays}`;

  return h('div', { class: 'page page-wide orbit-overview tenant-overview' },
    h('header', { class: 'page-head orbit-head' },
      h('div', {}, h('p', { class: 'eyebrow', text: analytics ? 'YOUR PRIVATE INSIGHTS' : 'YOUR WORKSPACE' }),
        h('h1', { text: analytics ? 'Every move tells a story.' : `Hey${name ? `, ${name}` : ''}. Let’s make moves.` }),
        h('p', { class: 'lead', text: 'Your applications, your tools, your next chapter.' })),
      h('div', { class: 'orbit-utilities' },
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => { refreshOverview(); hooks.requestRender(false); } },
          icon('refresh', 'icon icon-sm'), busy ? 'Refreshing…' : 'Refresh'),
        h('a', { href: '#/files/profile', 'aria-label': 'Open your profile' }, avatar(workspaceAvatar(), 'header-avatar')))),
    h('div', { class: 'range-bar' },
      h('div', { class: 'data-freshness' },
        h('span', { class: 'range-text', text: data ? rangeText(data) : 'Your private application history' }),
        h('span', { class: 'freshness-time', text: user.role === 'admin' ? 'Administrator · All modules' : `${user.plan_name || 'Free'} plan` })),
      segmented('Application period', RANGES, S.overviewDays, chooseRange)),
    overview?.error ? errorState(overview.error, () => refreshOverview()) : null,
    data && data.days !== S.overviewDays ? h('p', { class: 'inline-notice', role: 'status', text: 'Updating the period. The saved results below still show the previous selection.' }) : null,
    journeyBanner({ image: 27, eyebrow: 'YOUR PERSONAL WORKSPACE', title: 'Make room for your next chapter.',
      body: 'Start with your profile. Keep your applications, notes, and private files together as you take the next step.',
      action: h('a', { class: 'btn btn-primary', href: '#/files/profile', text: 'Open my profile' }, icon('arrow-up-right', 'icon icon-sm')) }),
    data ? metrics(data) : !overview?.error ? loadingState('Loading your private activity…') : null,
    h('div', { class: 'orbit-dashboard' },
      h('div', { class: 'orbit-main' },
        panel('Your latest moves', { cls: 'recent-panel', sub: 'Your recent recorded attempts · all outcomes',
          tools: h('a', { class: 'text-link', href: '#/records', text: 'All applications →' }) },
        data?.recent?.length ? recordTable(data.recent, true)
          : data ? empty('No application attempts in this period. Your saved applications will appear here.',
            h('a', { class: 'btn', href: '#/records', text: 'Open applications' }))
            : empty(overview?.error ? 'Your application history is temporarily unavailable.' : 'Reading your private application history…')),
        toolkit(user)),
      h('aside', { class: 'orbit-aside', 'aria-label': 'Your account and workspace' }, accountPlan(user), workspaceLinks())),
    h('div', { class: 'overview-footer' },
      h('span', {}, icon('info', 'icon icon-sm'), 'Counts reflect records in your account.'),
      h('a', { class: 'text-link', href: '#/data', text: 'Explore your private data →' })),
  );
}
