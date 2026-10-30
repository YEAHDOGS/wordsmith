// FLIP animation for keyed cards that can change parents (masonry columns, board lanes), which svelte's animate:flip
// can't follow. measure() before the DOM updates ($effect.pre), play() after it (tick): every card tagged data-flip-id
// slides from where it was to where it is with transform only. New cards fade and scale in, unless the reveal action
// (src/lib/reveal.js) is about to bring them in itself.

const FLIP_SELECTOR = '[data-flip-id]';
const FLIP_ANIMATION = 'flip';
const MOVE_MS = 240;
const ENTER_MS = 150;
const EXIT_MS = 150;
const EXIT_SCALE = 0.92;
const MIN_SHIFT_PX = 0.5;
// Mirrors --ease-out-soft in src/styles/theme.css (Web Animations can't read CSS variables).
const EASE_OUT_SOFT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const REVEAL = 'reveal';
const REVEALED = 'is-revealed';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Where each card is on screen right now, in-flight animations included. @param {HTMLElement | undefined} root */
export function measure(root) {
  /** @type {Map<string, DOMRect>} */
  const rects = new Map();
  if (!root) return rects;
  for (const card of root.querySelectorAll(FLIP_SELECTOR)) rects.set(/** @type {HTMLElement} */ (card).dataset.flipId ?? '', card.getBoundingClientRect());
  return rects;
}

/**
 * Slides every card from its measured spot to its new one.
 * @param {HTMLElement | undefined} root
 * @param {Map<string, DOMRect>} before from measure()
 */
export function play(root, before) {
  if (!root || reducedMotion.matches) return;
  for (const node of root.querySelectorAll(FLIP_SELECTOR)) {
    const card = /** @type {HTMLElement} */ (node);
    const from = before.get(card.dataset.flipId ?? '');
    if (!from) {
      if (!card.classList.contains(REVEAL) || card.classList.contains(REVEALED)) card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_MS, easing: EASE_OUT_SOFT });
      continue;
    }
    for (const animation of card.getAnimations()) if (animation.id === FLIP_ANIMATION) animation.cancel();
    const to = card.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < MIN_SHIFT_PX && Math.abs(dy) < MIN_SHIFT_PX) continue;
    // A card rebuilt in another column has been seen already: skip its first-reveal fade.
    card.classList.remove(REVEAL);
    const animation = card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: MOVE_MS, easing: EASE_OUT_SOFT });
    animation.id = FLIP_ANIMATION;
  }
}

/** Shrinks and fades a card away before it's removed; resolves when done. @param {Element} card */
export function exit(card) {
  if (reducedMotion.matches) return Promise.resolve();
  const animation = card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `scale(${EXIT_SCALE})` }], { duration: EXIT_MS, easing: EASE_OUT_SOFT, fill: 'forwards' });
  return animation.finished.then(() => undefined, () => undefined);
}
