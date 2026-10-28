// Page changes in the Shell. Pages in the sidebar list (All notes, Features, projects, labels, Archive) sit side by
// side like a carousel: going down the list slides the boards left, going up slides them right. The old and new page
// move together as one strip, crossing at most MAX_BOARDS board widths (a longer jump starts as if it were only two
// away), and land with a little overshoot. Other pages (settings) rise in while the old one fades out.
// Transform and opacity only; both pages are absolutely positioned in a clipped box, so nothing shifts or scrolls.
import { fade, fly } from 'svelte/transition';
import { cubicIn, quintOut } from 'svelte/easing';
import { navOrder } from '../lib/nav-order.js';

const CAROUSEL_MS = 220;
const MAX_BOARDS = 2;
// backOut's overshoot constant: 0.8 peaks about 2% past the target, a small bounce rather than a wobble.
const OVERSHOOT = 0.8;
const PAGE_IN = { y: 10, duration: 260, delay: 60, easing: quintOut };
const PAGE_OUT = { duration: 120, easing: cubicIn };
const REDUCED_FADE_MS = 120;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');

/** Back-out easing with a gentle overshoot. @param {number} t */
const settle = (t) => (t - 1) * (t - 1) * ((OVERSHOOT + 1) * (t - 1) + OVERSHOOT) + 1;

/** The current move: how many board widths the strip travels, signed (+ = down the list). 0 = not a carousel move. */
const move = { boards: 0 };
let shown = '';

/**
 * Records a page change before the DOM swaps pages; call from `$effect.pre` with the new page key.
 * @param {string} key `notes`, `project/<id>`, `settings`...
 * @param {{ projects: any[], labels: any[] }} store
 */
export function pageChange(key, store) {
  const order = navOrder(store);
  const from = order.indexOf(shown);
  const to = order.indexOf(key);
  shown = key;
  if (from < 0 || to < 0 || from === to) {
    move.boards = 0;
    return;
  }
  move.boards = Math.sign(to - from) * Math.min(MAX_BOARDS, Math.abs(to - from));
}

/**
 * A page's offset in board widths times `u`: Svelte hands both pages `u` = 1 - t, which goes 1 -> 0 (past 0 while
 * overshooting) on the way in and 0 -> 1 (past 1) on the way out, so the two pages keep the same gap the whole way.
 * @param {number} boards
 */
const slide = (boards) => ({
  duration: CAROUSEL_MS,
  easing: settle,
  css: (/** @type {number} */ _t, /** @type {number} */ u) => `transform: translateX(${(boards * u * 100).toFixed(3)}%)`,
});

/** The incoming page. @param {Element} node */
export function pageIn(node) {
  if (!move.boards) return fly(node, PAGE_IN);
  if (REDUCED_MOTION.matches) return fade(node, { duration: REDUCED_FADE_MS });
  return slide(move.boards);
}

/** The outgoing page: moves with the incoming one, so the pair travel as one strip. @param {Element} node */
export function pageOut(node) {
  if (!move.boards) return fade(node, PAGE_OUT);
  if (REDUCED_MOTION.matches) return fade(node, { duration: REDUCED_FADE_MS });
  return slide(-move.boards);
}
