import { h } from '../dom.js';
import { icon } from '../icons.js';

const enhanced = new WeakMap();
const LANGUAGES = {
  python: 'Python', py: 'Python', javascript: 'JavaScript', js: 'JavaScript',
  typescript: 'TypeScript', ts: 'TypeScript', jsx: 'React / JSX', tsx: 'React / TSX',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', html: 'HTML', css: 'CSS', sql: 'SQL',
  bash: 'Shell', sh: 'Shell', shell: 'Shell', console: 'Terminal', terminal: 'Terminal',
  cpp: 'C++', 'c++': 'C++', c: 'C', java: 'Java', go: 'Go', rust: 'Rust',
  ruby: 'Ruby', rb: 'Ruby', dockerfile: 'Dockerfile', diff: 'Changes',
  text: 'Plain text', plaintext: 'Plain text',
};

function languageLabel(pre) {
  const code = pre.querySelector(':scope > code');
  const marker = [...(code?.classList || []), ...pre.classList]
    .find(name => /^language-[a-z0-9+#.-]+$/i.test(name));
  return LANGUAGES[marker?.slice(9).toLowerCase()] || 'Code example';
}

/** Add controls around existing code nodes; their text and whitespace stay intact. */
export function enhanceLessonCode(root) {
  if (!root?.querySelectorAll) return root;
  const examples = [...(root.matches?.('pre') ? [root] : []), ...root.querySelectorAll('pre')];
  for (const pre of examples) {
    if (pre.closest('.learning-diagram') || pre.classList.contains('language-mermaid')
      || pre.querySelector('code.language-mermaid')) continue;

    let wrapper = pre.parentElement;
    if (!wrapper?.matches('[data-lesson-code-example]')) {
      // Move the same pre into a visual frame. Do not clone or replace authored
      // code, since whitespace, focus attributes and text selections matter.
      wrapper = h('div', { class: 'lesson-code-example', 'data-lesson-code-example': '' });
      pre.before(wrapper); wrapper.append(pre);
    }
    const existing = enhanced.get(pre);
    if (existing?.wrapper === wrapper && existing.toolbar.parentElement === wrapper) continue;
    // A full-day reader can clone an already enhanced chapter. Cloning copies
    // markup, not button listeners; replace only our copied toolbar in that case.
    wrapper.querySelectorAll(':scope > [data-lesson-code-toolbar]').forEach(toolbar => toolbar.remove());
    const status = h('span', { class: 'lesson-code-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const label = h('span', { class: 'lesson-code-copy-label', text: 'Copy code' });
    const copy = h('button', {
      type: 'button', class: 'lesson-code-copy', style: { minHeight: '44px', minWidth: '44px' },
      onclick: async () => {
        if (copy.disabled) return;
        copy.disabled = true; copy.setAttribute('aria-busy', 'true');
        status.dataset.state = 'pending'; status.textContent = 'Copying code…';
        try {
          const clipboard = pre.ownerDocument.defaultView?.navigator.clipboard;
          if (typeof clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable');
          // Read at click time and never trim, reformat or add the toolbar text.
          await clipboard.writeText(pre.querySelector(':scope > code')?.textContent ?? pre.textContent);
          status.dataset.state = 'success'; status.textContent = 'Code copied.';
        } catch {
          status.dataset.state = 'error';
          status.textContent = 'Could not copy. Select the code and copy it yourself.';
        } finally {
          copy.disabled = false; copy.removeAttribute('aria-busy');
        }
      },
    }, icon('copy', 'icon icon-sm'), label);
    const toolbar = h('div', { class: 'lesson-code-toolbar', 'data-lesson-code-toolbar': '' },
      h('span', { class: 'lesson-code-language' }, icon('code', 'icon icon-sm'), languageLabel(pre)), status, copy);
    wrapper.prepend(toolbar);
    enhanced.set(pre, { wrapper, toolbar });
  }
  return root;
}
