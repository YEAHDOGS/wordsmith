// Svelte action for touch-and-hold and hold-and-slide on a card, the same for touch, pen and mouse.
// Holding still for HOLD_MS calls onhold. Moving past the slop after the hold, or at any time with a mouse, calls onlift
// with the pointer event so a drag can take over. A finger that moves before the hold is scrolling: nothing happens.
// The click that ends a hold or a lift is swallowed, so it neither opens the note nor taps what appeared under it.

const HOLD_MS = 450;
const TOUCH_SLOP_PX = 10;
const MOUSE_SLOP_PX = 5;
const HAPTIC_MS = 10;
const PRIMARY_BUTTON = 0;
// Presses that start on these keep their own behaviour (the card's select and pin buttons, its hold menu).
const OWN_CONTROLS = 'button, a, input, textarea, select';

/** @typedef {{ onhold?: () => void, onlift?: (event: PointerEvent) => void }} PressOptions */

/** A short buzz where supported; Chrome refuses (with a console warning) before the first real tap. */
export function buzz() {
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(HAPTIC_MS);
}

/**
 * @param {HTMLElement} node
 * @param {PressOptions} options
 */
export function press(node, options) {
  let current = options;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {{ x: number, y: number, mouse: boolean } | null} */
  let start = null;
  let held = false;
  let lifted = false;
  let swallow = false;

  function end() {
    clearTimeout(timer);
    start = null;
    removeEventListener('pointermove', onmove);
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', end);
  }

  function hold() {
    held = true;
    swallow = true;
    buzz();
    current.onhold?.();
  }

  /** @param {PointerEvent} event */
  function ondown(event) {
    swallow = false;
    const control = /** @type {Element} */ (event.target).closest(OWN_CONTROLS);
    if (event.button !== PRIMARY_BUTTON || !event.isPrimary || (control && control !== node && node.contains(control))) return;
    end();
    start = { x: event.clientX, y: event.clientY, mouse: event.pointerType === 'mouse' };
    held = false;
    lifted = false;
    timer = setTimeout(hold, HOLD_MS);
    addEventListener('pointermove', onmove);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  }

  /** @param {PointerEvent} event */
  function onmove(event) {
    if (!start || lifted) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= (start.mouse ? MOUSE_SLOP_PX : TOUCH_SLOP_PX)) return;
    // A finger moving before the hold is a scroll, not a drag.
    if (!held && !start.mouse) return end();
    clearTimeout(timer);
    lifted = true;
    swallow = true;
    current.onlift?.(event);
  }

  /**
   * Once a hold has fired or a drag has begun, the finger belongs to the card: stop the page from scrolling under it.
   * Being on the card from touchstart is what makes the browser wait for us, so every touchmove stays cancelable;
   * the drag itself (src/lib/reorder.svelte.js) also listens on the touch's target, which outlives this card.
   * @param {TouchEvent} event
   */
  function ontouchmove(event) {
    if ((held || lifted) && event.cancelable) event.preventDefault();
  }

  /** Capture phase on the card, so neither the card nor anything inside it sees the click. @param {MouseEvent} event */
  function onclick(event) {
    if (!swallow) return;
    swallow = false;
    event.stopPropagation();
    event.preventDefault();
  }

  node.addEventListener('pointerdown', ondown);
  node.addEventListener('click', onclick, true);
  node.addEventListener('touchmove', ontouchmove, { passive: false });
  return {
    /** @param {PressOptions} next */
    update: (next) => (current = next),
    destroy() {
      end();
      node.removeEventListener('pointerdown', ondown);
      node.removeEventListener('click', onclick, true);
      node.removeEventListener('touchmove', ontouchmove);
    },
  };
}
