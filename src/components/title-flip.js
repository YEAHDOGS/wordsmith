// Split-flap title changes for TopBar: the old title's letters tip away one after another, then the new title's letters
// flip down into place with a little overshoot. The old letters are edge-on (invisible) before the new ones show, so the
// two titles never pile up in their shared grid cell. Transform and opacity only: nothing around the title moves.
// Reduced motion: a plain fade.
import { backOut, cubicIn } from 'svelte/easing';

const IN_MS = 380;
const OUT_MS = 140;
// The new letters start once the first old ones are already edge-on.
const IN_DELAY_MS = 110;
// Each letter starts this much after the one before, shrinking for long titles so the whole word starts within SPREAD_MS.
const MAX_STAGGER_MS = 28;
const SPREAD_MS = 260;
// The way out runs twice as fast as the way in.
const OUT_STAGGER_SHARE = 0.5;
const FLIP_DEG = 90;
const PERSPECTIVE = '20em';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** A letter of the new title flipping down into place. @param {Element} _node @param {{ index: number, count: number }} params */
export function letterIn(_node, { index, count }) {
  if (reducedMotion.matches) return { duration: OUT_MS, css: (/** @type {number} */ t) => `opacity: ${t}` };
  return {
    delay: IN_DELAY_MS + index * Math.min(MAX_STAGGER_MS, SPREAD_MS / Math.max(1, count)),
    duration: IN_MS,
    easing: backOut,
    css: (/** @type {number} */ t, /** @type {number} */ u) => `transform: perspective(${PERSPECTIVE}) rotateX(${u * -FLIP_DEG}deg); opacity: ${Math.min(1, t)}`,
  };
}

/** A letter of the old title tipping away. @param {Element} _node @param {{ index: number, count: number }} params */
export function letterOut(_node, { index, count }) {
  if (reducedMotion.matches) return { duration: OUT_MS, css: (/** @type {number} */ t) => `opacity: ${t}` };
  return {
    delay: index * Math.min(MAX_STAGGER_MS, SPREAD_MS / Math.max(1, count)) * OUT_STAGGER_SHARE,
    duration: OUT_MS,
    easing: cubicIn,
    css: (/** @type {number} */ t, /** @type {number} */ u) => `transform: perspective(${PERSPECTIVE}) rotateX(${u * FLIP_DEG}deg); opacity: ${t}`,
  };
}
