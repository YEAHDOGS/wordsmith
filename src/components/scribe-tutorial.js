// Where the Scribe tutorial (ScribeTutorial.svelte) puts its spotlight and card: the spotlight hugs the visible element
// marked data-tour="<target>", padded a little; the card sits under it when there's room, above it otherwise, and
// in the middle of the screen when the target isn't on screen at all. Always kept inside the window.

// Breathing room around the spotlit element, and between it and the card (px).
const SPOT_PAD = 8;
const CARD_GAP = 14;
// The card never comes closer than this to the window's edges (px).
const EDGE = 8;

/** @typedef {{ x: number, y: number, width: number, height: number }} Box */

/** The first element marked with this target that's actually on screen. @param {string} target @returns {DOMRect | null} */
export function targetBox(target) {
  for (const element of document.querySelectorAll(`[data-tour="${target}"]`)) {
    const box = element.getBoundingClientRect();
    if (box.width && box.height && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth) return box;
  }
  return null;
}

/**
 * The spotlight and the card's top-left corner for a target.
 * @param {DOMRect | null} box the target, or null to center the card with no spotlight
 * @param {{ width: number, height: number }} card the card's size
 * @returns {{ spot: Box | null, card: { x: number, y: number } }}
 */
export function place(box, card) {
  const centered = { x: (innerWidth - card.width) / 2, y: (innerHeight - card.height) / 2 };
  if (!box) return { spot: null, card: clamp(centered, card) };
  const spot = { x: box.left - SPOT_PAD, y: box.top - SPOT_PAD, width: box.width + SPOT_PAD * 2, height: box.height + SPOT_PAD * 2 };
  const below = spot.y + spot.height + CARD_GAP;
  const above = spot.y - CARD_GAP - card.height;
  const x = spot.x + spot.width / 2 - card.width / 2;
  // Below when it fits, else above when that fits, else whichever side has more room.
  const y = below + card.height <= innerHeight - EDGE ? below : above >= EDGE ? above : innerHeight - spot.y - spot.height > spot.y ? below : above;
  return { spot, card: clamp({ x, y }, card) };
}

/** @param {{ x: number, y: number }} at @param {{ width: number, height: number }} card */
function clamp(at, card) {
  return {
    x: Math.max(EDGE, Math.min(innerWidth - card.width - EDGE, at.x)),
    y: Math.max(EDGE, Math.min(innerHeight - card.height - EDGE, at.y)),
  };
}
