import { h } from '../dom.js';
import { icon } from '../icons.js';
import { avatar } from '../components/identity.js';
import { SECTIONS } from '../router.js';

const FEATURES = {
  automations: { name: 'Automations', image: 38, description: 'Bring your application tools together and keep the next step in sight.', benefits: ['A place for your application tools', 'Connected steps in your workflow', 'Follow-ups in your action inbox'] },
  resumes: { name: 'Resume studio', image: 43, description: 'Keep your experience ready for the opportunities you want to pursue.', benefits: ['Your experience, ready to reuse', 'Resumes tailored to a role', 'Documents kept in your workspace'] },
  research: { name: 'Research', image: 47, description: 'Give your company research and preparation a place of their own.', benefits: ['Your private research library', 'Company and role preparation', 'Notes you can return to'] },
  learning: { name: 'Learning', image: 35, description: 'Make space for the skills and preparation behind your next move.', benefits: ['A focused learning routine', 'Preparation alongside your search', 'Your progress in one place'] },
  outreach: { name: 'Outreach', image: 39, description: 'Prepare thoughtful introductions and keep your outreach organized.', benefits: ['Recruiter introduction drafts', 'Follow-ups in your own voice', 'LinkedIn preparation tools'] },
  analytics: { name: 'Insights', image: 45, description: 'See the story behind your saved application activity.', benefits: ['Your application outcomes', 'A clearer view of your activity', 'Patterns across your job search'] },
};

function workspaceEssentials() {
  return h('section', { class: 'access-essentials', 'aria-labelledby': 'access-essentials-title' },
    h('div', { class: 'access-section-heading' }, h('h2', { id: 'access-essentials-title', text: 'Keep moving with your essentials' }), h('p', { text: 'These are ready in your workspace.' })),
    h('div', { class: 'access-essential-grid' }, [
      ['person', 'My profile', 'Keep your experience up to date.', '#/files/profile'],
      ['file', 'Applications', 'Pick up where your search left off.', '#/records'],
      ['folder', 'Private files', 'Your documents, in one place.', '#/data'],
    ].map(([glyph, title, description, href]) => h('a', { class: 'access-essential', href },
      h('span', { class: 'access-essential-icon' }, icon(glyph)),
      h('span', {}, h('strong', { text: title }), h('small', { text: description })),
      icon('chevron-right', 'icon icon-sm')))),
  );
}

export function renderAccessState({ route, kind, user, module }) {
  const upgrade = kind === 'upgrade', forbidden = kind === 'forbidden';
  const title = SECTIONS.find(([name]) => name === route.name)?.[1] || 'Workspace access';
  const feature = FEATURES[module] || FEATURES.automations;
  const plan = user?.plan_name || 'current';
  const heading = forbidden ? 'This space is for administrators.' : upgrade ? 'More room for your next move.' : 'Your tools, with a little setup.';
  const description = forbidden ? 'Your account has its own workspace. Managing members, plans, and access requires an administrator role.'
    : upgrade ? `${feature.name} is not included in your ${plan} plan. Compare the available plans to find the tools you need.`
      : `${title} is included in your access. It needs a personal connection before you can use it. Personal connections are not available yet.`;
  const status = forbidden ? 'Administrator access' : upgrade ? `Not in your ${plan} plan` : 'Included · connection needed';
  return h('div', { class: 'page access-state', dataset: { accessState: kind } },
    h('a', { class: 'access-back', href: '#/overview' }, icon('chevron-left', 'icon icon-sm'), 'Back to workspace'),
    h('header', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'YOUR WORKSPACE' }), h('h1', { text: title }))),
    h('section', { class: 'access-hero', 'aria-labelledby': 'access-state-title' },
      h('div', { class: 'access-copy' },
        h('span', { class: 'access-status' }, icon(forbidden || upgrade ? 'lock' : 'check', 'icon icon-sm'), status),
        h('h2', { id: 'access-state-title', text: heading }),
        h('p', { class: 'access-description', text: description }),
        upgrade ? h('ul', { class: 'access-benefits' }, feature.benefits.map(text => h('li', {}, icon('check', 'icon icon-sm'), text))) : null,
        h('div', { class: 'access-actions' },
          h('a', { class: 'btn btn-primary', href: upgrade ? '#/plans?' + new URLSearchParams({ module: module || 'automations' }) : '#/overview' }, upgrade ? 'Compare plans' : 'Go to workspace', icon('chevron-right', 'icon icon-sm')),
          h('a', { class: 'btn', href: '#/account', text: 'View my access' })),
        h('p', { class: 'access-fine-print', text: forbidden ? 'Contact your workspace administrator if you need a different role.' : upgrade ? 'Your profile, applications, and files stay with you. Claude or Kiro is a separate subscription.' : 'A different plan won’t enable this connection. Your other included tools remain available.' })),
      h('div', { class: 'access-visual', 'aria-hidden': 'true' },
        h('div', { class: 'access-art-orbit' }),
        avatar(forbidden ? 46 : feature.image, 'access-character'),
        h('span', { class: 'access-visual-label' }, icon(forbidden ? 'person' : 'grid', 'icon icon-sm'), forbidden ? 'Your account, your space' : feature.name),
        h('span', { class: 'access-visual-dot' }))),
    upgrade && ['automations', 'resumes', 'learning', 'outreach'].includes(module)
      ? h('div', { class: 'access-connection-note' }, icon('info', 'icon icon-sm'), h('p', { text: 'Personal connections for this tool are not available yet, including on paid plans.' })) : null,
    workspaceEssentials(),
  );
}
