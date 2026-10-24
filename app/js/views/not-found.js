import { h } from '../dom.js';
import { icon } from '../icons.js';
import { avatar, brandMark } from '../components/identity.js';
import { routeAccess } from '../access-policy.js';

/** A missing address is public. Recovery links still respect the current identity. */
export function renderNotFound(route, context = {}) {
  const workspace = routeAccess('overview', context).kind === 'allowed';
  const account = routeAccess('account', context).kind === 'allowed';
  // Query values can contain account action tokens. Never echo them into the page.
  const path = `#/${String(route.arg || '').split('?')[0].replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160)}`;
  return h('div', { class: 'page not-found-page' },
    h('div', { class: 'not-found-brand', 'aria-label': 'Morrow' }, brandMark(), h('span', { text: 'morrow' })),
    h('section', { class: 'not-found-card', 'aria-labelledby': 'not-found-title' },
      h('p', { class: 'eyebrow not-found-eyebrow', text: '404 · PAGE NOT FOUND' }),
      h('div', { class: 'not-found-scene', 'aria-hidden': 'true' },
        h('span', { class: 'not-found-orbit not-found-orbit-one' }),
        h('span', { class: 'not-found-orbit not-found-orbit-two' }),
        h('span', { class: 'not-found-spark not-found-spark-one' }),
        h('span', { class: 'not-found-spark not-found-spark-two' }),
        h('span', { class: 'not-found-number', text: '4' }),
        h('span', { class: 'not-found-explorer' }, avatar(34, 'not-found-character')),
        h('span', { class: 'not-found-number', text: '4' })),
      h('div', { class: 'not-found-copy' },
        h('h1', { id: 'not-found-title', text: 'A little off course.' }),
        h('p', { class: 'not-found-description', text: 'This page doesn’t exist, or its link has changed. Let’s get you somewhere familiar.' }),
        h('div', { class: 'not-found-path', 'aria-label': 'Requested page' }, icon('globe', 'icon icon-sm'), h('code', { text: path })),
        h('div', { class: 'not-found-actions' },
          h('a', { class: 'btn btn-primary', href: workspace ? '#/overview' : '#/login' }, icon(workspace ? 'chevron-left' : 'person', 'icon icon-sm'), workspace ? 'Back to workspace' : 'Sign in'),
          account ? h('a', { class: 'not-found-secondary', href: '#/account' }, 'View my account', icon('arrow-up-right', 'icon icon-sm')) : null))),
    h('p', { class: 'not-found-footnote', text: 'A different route. The same next chapter.' }));
}
