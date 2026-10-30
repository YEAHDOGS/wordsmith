<script>
  // A vertical scroll wheel for one 0..5 level (priority by default, difficulty with labels={DIFFICULTY_LABELS}). Three
  // levels show at once; the middle row, under a fixed band, is the choice. Scroll, swipe or drag to turn it (it snaps
  // to a row), click a row to jump there, or use the arrow keys, Page Up/Down, Home and End (keyboards and TV remotes).
  // Loud levels (from `loud` up) turn the accent when chosen. No scrollend event: Safari 15.4 lacks it, so a short
  // pause after the last scroll settles the choice.
  import { LOUD_PRIORITY, PRIORITY_LABELS } from '../lib/models.js';

  /** @type {{ value: number, levels: number[], onselect: (level: number) => void, labels?: string[], name?: string, loud?: number, class?: string, active?: boolean }} */
  let { value, levels, onselect, labels = PRIORITY_LABELS, name = 'Priority', loud = LOUD_PRIORITY, class: className = '', active = true } = $props();

  const SETTLE_MS = 120;
  /** Key -> how far the choice moves; Home and End jump to the ends. */
  const KEY_STEPS = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, PageDown: 2, PageUp: -2 };

  /** @type {HTMLElement | undefined} */
  let list = $state();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let settle;
  let scrolling = false;
  let positioning = false;

  const index = $derived(Math.max(0, levels.indexOf(value)));
  const rowHeight = () => /** @type {HTMLElement | undefined} */ (list?.firstElementChild)?.offsetHeight || 1;

  // Keep the wheel on the chosen row when the value changes from outside (sync, another control), unless the user is
  // turning it right now.
  $effect(() => {
    if (!list || !active || scrolling) return;
    const height = rowHeight();
    // A dialog's contents have no layout until showModal(). Never select from a hidden wheel's zero-height position.
    if (height <= 1) return;
    const top = index * height;
    if (Math.abs(list.scrollTop - top) <= 1) return;
    // The initial/programmatic scroll positions the control; it is not a user choice.
    positioning = true;
    clearTimeout(settle);
    list.scrollTo({ top, behavior: 'auto' });
    settle = setTimeout(() => { positioning = false; }, SETTLE_MS);
  });

  function onscroll() {
    if (!active || positioning) {
      clearTimeout(settle);
      settle = setTimeout(() => { positioning = false; }, SETTLE_MS);
      return;
    }
    scrolling = true;
    clearTimeout(settle);
    settle = setTimeout(() => {
      scrolling = false;
      if (!list) return;
      const next = levels[Math.min(levels.length - 1, Math.max(0, Math.round(list.scrollTop / rowHeight())))];
      if (next !== value) onselect(next);
    }, SETTLE_MS);
  }

  /** @param {number} at */
  function choose(at) {
    positioning = false;
    const next = levels[Math.min(levels.length - 1, Math.max(0, at))];
    if (next !== value) onselect(next);
    list?.scrollTo({ top: levels.indexOf(next) * rowHeight(), behavior: 'smooth' });
  }

  /** @param {KeyboardEvent} event */
  function onkeydown(event) {
    positioning = false;
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      choose(event.key === 'Home' ? 0 : levels.length - 1);
      return;
    }
    const step = KEY_STEPS[/** @type {keyof typeof KEY_STEPS} */ (event.key)];
    if (!step) return;
    event.preventDefault();
    choose(index + step);
  }

  function onuserinput() {
    positioning = false;
  }
</script>

<div class="relative min-w-0 {className}">
  <span class="mb-1 block text-[0.6875rem] font-semibold tracking-wide text-ink-faint uppercase tv:text-sm">{name}</span>
  <!-- The band marks the middle row; the list scrolls under it. Padding of one row above and below lets the ends reach it. -->
  <div class="relative h-24 overflow-hidden rounded-ui-sm border border-line bg-surface focus-within:border-accent tv:h-36">
    <span class="pointer-events-none absolute inset-x-0 top-8 h-8 border-y border-line-strong bg-surface-raised tv:top-12 tv:h-12" aria-hidden="true"></span>
    <div bind:this={list} {onscroll} {onkeydown} onwheel={onuserinput} onpointerdown={onuserinput} ontouchstart={onuserinput} tabindex="0" role="slider" aria-label={name} aria-valuemin={levels[0]} aria-valuemax={levels.at(-1)}
      aria-valuenow={value} aria-valuetext={labels[value]}
      class="relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain py-8 scrollbar-none focus:outline-none tv:py-12">
      {#each levels as level, slot (level)}
        {@const on = slot === index}
        <button type="button" tabindex="-1" onclick={() => choose(slot)}
          class="spring flex h-8 w-full snap-center items-center justify-center gap-1.5 px-2 text-xs tv:h-12 tv:text-lg {on ? `font-semibold ${level >= loud ? 'text-accent' : 'text-ink'}` : 'text-ink-faint hover:text-ink-muted'}">
          <span class="font-mono text-[0.625rem] tv:text-sm">{level || '–'}</span><span class="truncate">{labels[level]}</span>
        </button>
      {/each}
    </div>
  </div>
</div>
