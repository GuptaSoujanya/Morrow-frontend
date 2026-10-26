/** A finite entrance, only on navigation. Refreshes keep their place and focus. */
export function revealPage(page) {
  if (!page || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const easing = 'cubic-bezier(.22,1,.36,1)';
  const sections = [...page.children].filter(node => !node.hidden).slice(0, 7);
  sections.forEach((section, index) => {
    section.animate([
      { opacity: 0, transform: 'translateY(12px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 420, delay: Math.min(index * 35, 175), easing, fill: 'backwards' });
  });
}
