// Svelte action: fades and lifts an element in the first time it scrolls into view. Pass the index to stagger siblings.
// Styles live in src/styles/motion.css (.reveal / .is-revealed).

const STAGGER_MS = 35;
const MAX_DELAY_MS = 350;
const ROOT_MARGIN = '0px 0px -5% 0px';

/** @type {IntersectionObserver | null} */
let observer = null;

function sharedObserver() {
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-revealed');
      observer?.unobserve(entry.target);
    }
  }, { rootMargin: ROOT_MARGIN });
  return observer;
}

/**
 * @param {HTMLElement} node
 * @param {number} [index]
 */
export function reveal(node, index = 0) {
  node.classList.add('reveal');
  node.style.setProperty('--reveal-delay', `${Math.min(index * STAGGER_MS, MAX_DELAY_MS)}ms`);
  sharedObserver().observe(node);
  return { destroy: () => observer?.unobserve(node) };
}
