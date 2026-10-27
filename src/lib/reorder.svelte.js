// Hold-and-slide reordering for note cards, shared by the note grid and the feature board. One drag at a time.
// Lists register as drop zones (use:dropzone). While a card is up, every zone shows a live preview of where it would
// land (drag.arrange), the list auto-scrolls near its edges, and letting go hands the zone (note, index) to save.
// Keyboard: Alt+Arrow on a focused card moves it one step (or one board column sideways).
// Order is stored in notes.position (REAL, lower first) with fractional indexing: a moved note takes the midpoint of
// its new neighbours, so a drop writes one row. Notes never placed by hand sort by a key implied by their age.
import { tick } from 'svelte';
import { MAX_PRIORITY } from './models.js';
import { buzz } from './press.js';

const ZONE_ATTR = 'data-drop-zone';
const CARD_SELECTOR = '[data-flip-id]';
const POSITION_STEP = 1024;
// Auto-scroll: within EDGE_PX of a list's edge it scrolls, faster the closer the pointer, up to MAX_SCROLL_PX a frame.
const EDGE_PX = 64;
const MAX_SCROLL_PX = 18;
// Phone board lanes snap, so near a side edge the board jumps one lane, then waits before the next jump.
const LANE_JUMP_MS = 700;
// Pointer travel needed before the preview slot is worked out again; stops the slot flickering between two cards.
const RETARGET_PX = 4;
// Horizontal distance weighs this much more than vertical when picking the card under the pointer (stay in the column).
const COLUMN_WEIGHT = 1000;
const LAND_MS = 160;
const SCROLLABLE = ['auto', 'scroll'];
/** Alt+Arrow steps. Up/Left = earlier, Down/Right = later; in board columns Left/Right hop columns instead. */
export const NUDGE_KEYS = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 };
const SIDEWAYS_KEYS = ['ArrowLeft', 'ArrowRight'];

/**
 * @typedef {object} Zone
 * @property {string} key unique among the zones on screen
 * @property {() => any[]} list the zone's notes in display order, without any drag preview
 * @property {(note: any, index: number) => void} ondrop save `note` at `index` of list() minus the note
 * @property {(note: any) => boolean} [accepts] which notes may land here (default: all)
 * @property {boolean} [sortable] false = the zone keeps its own order (time); a drop only moves the note into it
 * @property {(note: any) => number} [naturalIndex] where a note lands when the slot isn't chosen by hand
 * @property {string} [group] zones sharing a group are side by side (board columns): Alt+Left/Right hops between them
 * @property {string} [label] spoken after a keyboard move into this zone
 * @property {() => void} [onlift] runs when a card from this zone is picked up (the grid switches to manual order)
 */

/**
 * Sort key for manual order: the stored position, else one implied by age in the same number space. Features run
 * oldest first (claim order; matches COALESCE(position, created_at) in api/lib/agent.js), notes newest first.
 * @param {any} note
 */
export function orderKey(note) {
  return note.position ?? (note.kind === 'feature' ? note.created_at : -note.created_at);
}

/**
 * The writes for dropping `note` at `index` of `list` (the zone's order without it). With byPriority the list runs
 * highest priority first: the note keeps its priority when that fits between its neighbours, else takes the nearest
 * one that does, then gets a position among the notes of that priority. When the doubles between two neighbours have
 * run out, the whole zone is respaced in its new order (rare).
 * @param {any[]} list
 * @param {any} note
 * @param {number} index
 * @param {boolean} [byPriority]
 * @returns {{ id: string, patch: Record<string, any> }[]}
 */
export function placeNote(list, note, index, byPriority = false) {
  const before = list[index - 1] ?? null;
  const after = list[index] ?? null;
  const priority = byPriority ? Math.min(Math.max(note.priority, after?.priority ?? 0), before?.priority ?? MAX_PRIORITY) : note.priority;
  // A neighbour bounds the position only when it sorts in the same run (same priority, when sorting by priority).
  const bounds = (/** @type {any} */ neighbour) => neighbour && (!byPriority || neighbour.priority === priority);
  const low = bounds(before) ? orderKey(before) : null;
  const high = bounds(after) ? orderKey(after) : null;
  /** @type {number | null} */
  let position = orderKey(note);
  if (low !== null && high !== null) {
    const middle = low + (high - low) / 2;
    position = middle > low && middle < high ? middle : null;
  } else if (low !== null) {
    position = low + POSITION_STEP;
  } else if (high !== null) {
    position = high - POSITION_STEP;
  }
  const extra = byPriority && priority !== note.priority ? { priority } : {};
  if (position !== null) return [{ id: note.id, patch: { ...extra, position } }];
  const order = [...list.slice(0, index), note, ...list.slice(index)];
  return order.map((entry, slot) => ({ id: entry.id, patch: entry.id === note.id ? { ...extra, position: slot * POSITION_STEP } : { position: slot * POSITION_STEP } }));
}

/**
 * Nearest element up the tree that scrolls along `axis`.
 * @param {Element | null} start
 * @param {'x' | 'y'} axis
 */
function scrollParent(start, axis) {
  for (let node = start; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const room = axis === 'y' ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
    if (room > 1 && SCROLLABLE.includes(axis === 'y' ? style.overflowY : style.overflowX)) return /** @type {HTMLElement} */ (node);
  }
  return null;
}

/**
 * Preview slot inside a zone: the card nearest the pointer (preferring the column under it), before or after it.
 * @param {Element} zoneEl
 * @param {string[]} ids the zone's order without the dragged note
 * @param {string} id the dragged note
 * @param {number} x
 * @param {number} y
 */
function slotAt(zoneEl, ids, id, x, y) {
  let best = { id: '', below: false, score: Infinity };
  for (const node of zoneEl.querySelectorAll(CARD_SELECTOR)) {
    const cardId = /** @type {HTMLElement} */ (node).dataset.flipId ?? '';
    if (cardId === id) continue;
    const rect = node.getBoundingClientRect();
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    const score = dx * COLUMN_WEIGHT + dy;
    if (score < best.score) best = { id: cardId, below: y > rect.top + rect.height / 2, score };
  }
  const at = ids.indexOf(best.id);
  return at === -1 ? ids.length : at + (best.below ? 1 : 0);
}

/** @type {HTMLElement | null} */
let liveRegion = null;

/** Screen reader update after a keyboard move. @param {string} message */
function announce(message) {
  if (!liveRegion) {
    liveRegion = document.body.appendChild(document.createElement('p'));
    liveRegion.className = 'sr-only';
    liveRegion.setAttribute('aria-live', 'polite');
  }
  liveRegion.textContent = message;
}

/** Puts keyboard focus back on a card after a move rebuilt it. @param {string} id */
async function refocus(id) {
  await tick();
  /** @type {HTMLElement | null} */ (document.querySelector(`[data-flip-id="${CSS.escape(id)}"] [tabindex="0"]`))?.focus();
}

class Drag {
  /** The note in the air (a snapshot from when it was picked up), or null. @type {any} */
  note = $state(null);
  /** Zone showing the preview; '' = not placed yet, the card still holds its own slot. */
  zone = $state('');
  /** Preview slot inside that zone, counted without the dragged note. */
  index = $state(0);
  /** Ghost card position (viewport px, top-left) and width. */
  x = $state(0);
  y = $state(0);
  width = $state(0);
  /** True while the ghost glides into its slot after a drop. */
  landing = $state(false);

  /** @type {Map<Element, Zone>} */
  #zones = new Map();
  #grab = { x: 0, y: 0 };
  #pointer = { x: 0, y: 0 };
  #last = { x: -Infinity, y: -Infinity };
  /** @type {HTMLElement | null} */
  #scrollY = null;
  /** @type {HTMLElement | null} */
  #scrollX = null;
  #laneAt = 0;
  #frame = 0;
  #moved = false;

  get id() {
    return this.note?.id ?? '';
  }

  /** @param {Element} node @param {Zone} zone */
  register(node, zone) {
    node.setAttribute(ZONE_ATTR, '');
    this.#zones.set(node, zone);
  }

  /** @param {Element} node */
  unregister(node) {
    this.#zones.delete(node);
  }

  /**
   * A zone's list as it should look right now: the dragged note lifted out of it, or shown at the preview slot.
   * @param {any[]} list
   * @param {string} key
   */
  arrange(list, key) {
    if (!this.note || !this.zone) return list;
    const rest = list.filter((note) => note.id !== this.note.id);
    if (key !== this.zone) return rest;
    rest.splice(Math.min(this.index, rest.length), 0, list.find((note) => note.id === this.note.id) ?? this.note);
    return rest;
  }

  /**
   * Picks a card up under the pointer.
   * @param {any} note
   * @param {HTMLElement} card the card's data-flip-id wrapper
   * @param {PointerEvent} event
   */
  begin(note, card, event) {
    const zoneEl = card.closest(`[${ZONE_ATTR}]`);
    const zone = zoneEl && this.#zones.get(zoneEl);
    if (this.note || !zoneEl || !zone) return;
    const rect = card.getBoundingClientRect();
    this.#grab = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    this.width = rect.width;
    this.note = note;
    this.zone = '';
    this.index = 0;
    this.landing = false;
    this.#last = { x: event.clientX, y: event.clientY };
    this.#follow(event);
    this.#useScrollers(zoneEl);
    zone.onlift?.();
    buzz();
    addEventListener('pointermove', this.#onmove);
    addEventListener('pointerup', this.#ondrop);
    addEventListener('pointercancel', this.#oncancel);
    addEventListener('keydown', this.#onkey, true);
    addEventListener('touchmove', this.#holdScroll, { passive: false });
    this.#frame = requestAnimationFrame(this.#loop);
  }

  /**
   * Alt+Arrow on a focused card.
   * @param {any} note
   * @param {HTMLElement} card
   * @param {keyof typeof NUDGE_KEYS} key
   */
  async nudge(note, card, key) {
    const zoneEl = card.closest(`[${ZONE_ATTR}]`);
    const zone = zoneEl && this.#zones.get(zoneEl);
    if (this.note || !zoneEl || !zone) return;
    const step = NUDGE_KEYS[key];
    if (zone.group && SIDEWAYS_KEYS.includes(key)) return this.#hop(note, zoneEl, zone, step);
    if (zone.sortable === false) return announce(`${zone.label ?? 'This list'} keeps its own order`);
    zone.onlift?.();
    await tick();
    const current = this.#zones.get(zoneEl) ?? zone;
    const list = current.list();
    const from = list.findIndex((entry) => entry.id === note.id);
    const to = from + step;
    if (from === -1 || to < 0 || to >= list.length) return announce(to < 0 ? 'Already first' : 'Already last');
    current.ondrop(list[from], to);
    announce(`Moved to ${to + 1} of ${list.length}`);
    refocus(note.id);
  }

  /** Alt+Left/Right in board columns: into the neighbouring column. @param {any} note @param {Element} zoneEl @param {Zone} zone @param {number} step */
  #hop(note, zoneEl, zone, step) {
    const row = [...document.querySelectorAll(`[${ZONE_ATTR}]`)].filter((node) => this.#zones.get(node)?.group === zone.group);
    const target = this.#zones.get(row[row.indexOf(zoneEl) + step]);
    if (!target || !(target.accepts?.(note) ?? true)) return;
    target.ondrop(note, target.naturalIndex?.(note) ?? 0);
    announce(`Moved to ${target.label ?? 'the next column'}`);
    refocus(note.id);
  }

  /** @param {PointerEvent} event */
  #follow(event) {
    this.#pointer = { x: event.clientX, y: event.clientY };
    this.x = event.clientX - this.#grab.x;
    this.y = event.clientY - this.#grab.y;
  }

  /** @param {Element} zoneEl */
  #useScrollers(zoneEl) {
    this.#scrollY = scrollParent(zoneEl.querySelector(CARD_SELECTOR) ?? zoneEl, 'y');
    this.#scrollX = scrollParent(zoneEl, 'x');
  }

  /** @param {PointerEvent} event */
  #onmove = (event) => {
    this.#follow(event);
    this.#moved = true;
  };

  /** @param {TouchEvent} event */
  #holdScroll = (event) => {
    if (event.cancelable) event.preventDefault();
  };

  /** @param {KeyboardEvent} event */
  #onkey = (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    this.#oncancel();
  };

  #loop = () => {
    const scrolled = this.#autoscroll();
    if (this.#moved || scrolled) this.#locate(scrolled);
    this.#moved = false;
    this.#frame = requestAnimationFrame(this.#loop);
  };

  /** Scrolls the list under the card when the pointer nears its edge. Returns true when anything moved. */
  #autoscroll() {
    const { x, y } = this.#pointer;
    let scrolled = false;
    if (this.#scrollY) {
      const rect = this.#scrollY.getBoundingClientRect();
      const reach = y < rect.top + EDGE_PX ? y - rect.top - EDGE_PX : y > rect.bottom - EDGE_PX ? y - rect.bottom + EDGE_PX : 0;
      const speed = Math.max(-MAX_SCROLL_PX, Math.min(MAX_SCROLL_PX, (reach / EDGE_PX) * MAX_SCROLL_PX));
      const top = this.#scrollY.scrollTop;
      if (speed) this.#scrollY.scrollTop = top + speed;
      scrolled = this.#scrollY.scrollTop !== top;
    }
    if (this.#scrollX && performance.now() - this.#laneAt > LANE_JUMP_MS) {
      const rect = this.#scrollX.getBoundingClientRect();
      const direction = x < rect.left + EDGE_PX ? -1 : x > rect.right - EDGE_PX ? 1 : 0;
      if (direction) {
        this.#scrollX.scrollBy({ left: direction * this.#scrollX.clientWidth, behavior: 'smooth' });
        this.#laneAt = performance.now();
        scrolled = true;
      }
    }
    return scrolled;
  }

  /** Works out the zone and slot under the pointer. Outside every zone the last preview stays. @param {boolean} force */
  #locate(force) {
    const { x, y } = this.#pointer;
    if (!force && this.zone && Math.hypot(x - this.#last.x, y - this.#last.y) < RETARGET_PX) return;
    const zoneEl = document.elementFromPoint(x, y)?.closest(`[${ZONE_ATTR}]`);
    const zone = zoneEl && this.#zones.get(zoneEl);
    if (!zoneEl || !zone || !(zone.accepts?.(this.note) ?? true)) return;
    this.#last = { x, y };
    const ids = zone.list().map((note) => note.id).filter((id) => id !== this.id);
    const index = zone.sortable === false ? zone.naturalIndex?.(this.note) ?? 0 : slotAt(zoneEl, ids, this.id, x, y);
    if (zone.key !== this.zone) this.#useScrollers(zoneEl);
    this.zone = zone.key;
    this.index = index;
  }

  #stop() {
    cancelAnimationFrame(this.#frame);
    removeEventListener('pointermove', this.#onmove);
    removeEventListener('pointerup', this.#ondrop);
    removeEventListener('pointercancel', this.#oncancel);
    removeEventListener('keydown', this.#onkey, true);
    removeEventListener('touchmove', this.#holdScroll);
  }

  #ondrop = () => {
    // A quick flick can end before the next frame has worked out the slot.
    if (this.#moved) this.#locate(true);
    const zone = [...this.#zones.values()].find((entry) => entry.key === this.zone);
    const { note, index } = this;
    this.#stop();
    const list = zone?.list() ?? [];
    // Dropped back on its own slot: nothing to save.
    if (zone && list.findIndex((entry) => entry.id === note.id) !== index) zone.ondrop(note, index);
    this.#land();
  };

  #oncancel = () => {
    this.#stop();
    this.zone = '';
    this.#land();
  };

  /** Glides the ghost onto the card's final slot, then lets go. */
  async #land() {
    await tick();
    const card = document.querySelector(`[data-flip-id="${CSS.escape(this.id)}"]`);
    if (card) {
      const rect = card.getBoundingClientRect();
      this.landing = true;
      this.x = rect.left;
      this.y = rect.top;
      await new Promise((resolve) => setTimeout(resolve, LAND_MS));
    }
    this.note = null;
    this.zone = '';
    this.landing = false;
  }
}

export const drag = new Drag();

/**
 * Svelte action: makes a list a drop zone for dragged cards.
 * @param {HTMLElement} node
 * @param {Zone} zone
 */
export function dropzone(node, zone) {
  drag.register(node, zone);
  return {
    /** @param {Zone} next */
    update: (next) => drag.register(node, next),
    destroy: () => drag.unregister(node),
  };
}
