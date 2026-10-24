import { h } from '../dom.js';
import { icon } from '../icons.js';
import { avatar } from '../components/identity.js';
import { SECTIONS } from '../router.js';

const FEATURES = {
  automations: { name: 'Automations', image: 38, heading: 'Meet your application crew.', description: 'Bring your application tools, workflows, and next steps together.', benefits: ['Application tools', 'Connected workflows', 'Follow-up planning'] },
  resumes: { name: 'Resume studio', image: 43, heading: 'Make your experience stand out.', description: 'Prepare your experience for the opportunities you want to pursue.', benefits: ['Reusable experience', 'Role-specific resumes', 'Private documents'] },
  research: { name: 'Research', image: 47, heading: 'Know more before your next move.', description: 'Give company research, role preparation, and your own notes a home.', benefits: ['Research library', 'Company preparation', 'Saved notes'] },
  learning: { name: 'Learning', image: 35, heading: 'Build toward your next opportunity.', description: 'Keep your learning and preparation alongside your job search.', benefits: ['Focused learning', 'Interview preparation', 'Saved progress'] },
  outreach: { name: 'Outreach', image: 39, heading: 'Make the right introduction.', description: 'Prepare thoughtful introductions and organize your next follow-up.', benefits: ['Introduction drafts', 'Follow-up preparation', 'LinkedIn tools'] },
  analytics: { name: 'Insights', image: 45, heading: 'Find the story in your search.', description: 'Understand your saved application activity and the patterns behind it.', benefits: ['Application outcomes', 'Activity overview', 'Search patterns'] },
};

const ROUTE_HEADINGS = {
  pipeline: 'Give your search a clear flow.',
  todo: 'Keep your next steps in one place.',
};

function workspaceEssentials() {
  return h('section', { class: 'access-essentials', 'aria-labelledby': 'access-essentials-title' },
    h('div', { class: 'access-section-heading' },
      h('h2', { id: 'access-essentials-title', text: 'Your essentials are ready' }),
      h('span', { class: 'access-ready-label' }, icon('check', 'icon icon-sm'), 'Included in your access')),
    h('div', { class: 'access-essential-grid' }, [
      [35, 'My profile', 'Keep your experience up to date', '#/files/profile', 'mint'],
      [43, 'Applications', 'Pick up where your search left off', '#/records', 'lavender'],
      [44, 'Private files', 'Your documents, neatly together', '#/data', 'peach'],
    ].map(([image, title, description, href, tone]) => h('a', { class: `access-essential access-essential-${tone}`, href },
      avatar(image, 'access-essential-art'),
      h('span', { class: 'access-essential-copy' }, h('strong', { text: title }), h('small', { text: description })),
      icon('arrow-up-right', 'icon icon-sm')))),
  );
}

function accessSummary({ feature, forbidden, upgrade, user, plan }) {
  const current = user?.role === 'admin' ? 'Administrator' : plan;
  return h('aside', { class: 'access-summary', 'aria-label': 'Access requirements' },
    h('div', { class: 'access-art', 'aria-hidden': 'true' },
      h('span', { class: 'access-art-halo' }),
      avatar(forbidden ? 46 : feature.image, 'access-character'),
      h('span', { class: 'access-art-stamp' }, icon(forbidden || upgrade ? 'lock' : 'check', 'icon icon-sm'))),
    h('dl', { class: 'access-requirements' },
      h('div', {}, h('dt', { text: user?.role === 'admin' ? 'Your access' : 'Your plan' }), h('dd', { text: current })),
      h('div', {}, h('dt', { text: forbidden || upgrade ? 'Needed' : 'Tool access' }), h('dd', { text: forbidden ? 'Administrator role' : upgrade ? feature.name : 'Included', class: forbidden || upgrade ? '' : 'access-included' }))),
    h('p', { class: 'access-summary-note', text: forbidden ? 'Roles are managed by an administrator.' : upgrade ? 'Choose a plan that includes this module.' : 'Personal connection unavailable' }),
  );
}

export function renderAccessState({ route, kind, user, module }) {
  const upgrade = kind === 'upgrade', forbidden = kind === 'forbidden';
  const title = SECTIONS.find(([name]) => name === route.name)?.[1] || 'Workspace access';
  const feature = FEATURES[module] || FEATURES.automations;
  const plan = user?.plan_name || 'Current plan';
  const heading = forbidden ? 'A space for administrators.' : upgrade ? ROUTE_HEADINGS[route.name] || feature.heading : `${title} needs a connection.`;
  const description = forbidden ? 'Members, plans, and workspace controls are managed here. Your account keeps its own private workspace.'
    : upgrade ? `${feature.description} This module isn’t included in your ${plan} plan.`
      : 'Your account includes this tool. Personal connections aren’t available yet, so it can’t run in this workspace.';
  const status = forbidden ? 'Administrator only' : upgrade ? 'Not included in your plan' : 'Included · connection needed';
  const connectionRequired = upgrade && ['automations', 'resumes', 'learning', 'outreach'].includes(module);
  return h('div', { class: 'page access-state', dataset: { accessState: kind } },
    h('a', { class: 'access-back', href: '#/overview' }, icon('chevron-left', 'icon icon-sm'), 'Back to workspace'),
    h('header', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'YOUR WORKSPACE' }), h('h1', { text: title }))),
    h('section', { class: 'access-hero', 'aria-labelledby': 'access-state-title' },
      h('div', { class: 'access-hero-main' },
        h('div', { class: 'access-copy' },
          h('span', { class: 'access-status' }, icon(forbidden || upgrade ? 'lock' : 'check', 'icon icon-sm'), status),
          h('h2', { id: 'access-state-title', text: heading }),
          h('p', { class: 'access-description', text: description }),
          h('div', { class: 'access-actions' },
            h('a', { class: 'btn btn-primary', href: upgrade ? '#/plans?' + new URLSearchParams({ module: module || 'automations' }) : '#/overview' }, upgrade ? 'Compare plans' : 'Go to workspace', icon('arrow-up-right', 'icon icon-sm')),
            h('a', { class: 'btn access-secondary', href: '#/account', text: 'View my access' }))),
        accessSummary({ feature, forbidden, upgrade, user, plan })),
      upgrade ? h('ul', { class: 'access-benefits', 'aria-label': `${feature.name} features` }, feature.benefits.map(text => h('li', {}, icon('check', 'icon icon-sm'), text))) :
        h('div', { class: 'access-hero-footer' }, icon('info', 'icon icon-sm'), h('p', { text: forbidden ? 'Contact your workspace administrator if you need a different role.' : 'Changing your plan won’t enable this connection. Your other included tools are ready to use.' }))),
    h('div', { class: 'access-context-note' }, icon(connectionRequired ? 'info' : 'lock', 'icon icon-sm'),
      h('p', { text: connectionRequired ? 'Personal connections for this tool are not available yet, including on paid plans. Claude or Kiro is a separate subscription.' : upgrade ? 'Your profile, applications, and files stay with you on every plan. Claude or Kiro is a separate subscription.' : 'Your profile, applications, and files remain private to your workspace.' })),
    workspaceEssentials(),
  );
}
