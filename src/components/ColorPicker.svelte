<script>
  // Color button for notes and projects. The dots float in a small popover under it, so opening it never pushes
  // the surrounding toolbar around; the popover slides sideways if it would run off the right edge.
  import Palette from '@lucide/svelte/icons/palette';
  import { scale } from 'svelte/transition';
  import { DOT_BG } from '../lib/colors.js';
  import { COLORS } from '../lib/models.js';

  /** @type {{ value: string, onchange: (color: string) => void }} */
  let { value, onchange } = $props();

  const POPOVER_WIDTH_PX = 160;
  const EDGE_PX = 8;
  const DOT_STAGGER_MS = 15;

  let open = $state(false);
  let shift = $state(0);
  /** @type {HTMLElement | undefined} */
  let root = $state();
  /** @type {HTMLButtonElement | undefined} */
  let button = $state();

  function toggle() {
    const rect = button?.getBoundingClientRect();
    if (!open && rect) shift = Math.min(0, innerWidth - EDGE_PX - (rect.left + POPOVER_WIDTH_PX));
    open = !open;
  }

  /** @param {string} color */
  function pick(color) {
    onchange(color);
    open = false;
  }

  /** Clicks outside close it. @param {PointerEvent} event */
  function onWindowPointer(event) {
    if (open && !root?.contains(/** @type {Node} */ (event.target))) open = false;
  }

  /** Escape closes the popover; the note editor sees [data-popover] and stays open. @param {KeyboardEvent} event */
  function onWindowKey(event) {
    if (!open || event.key !== 'Escape') return;
    open = false;
    button?.focus();
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onWindowKey} />

<div bind:this={root} class="relative flex items-center" role="group" aria-label="Color">
  <button bind:this={button} class="spring press flex items-center gap-1.5 px-2.5 py-2 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink {open ? 'bg-surface-raised text-ink' : ''}"
    aria-expanded={open} onclick={toggle} title="Color">
    <Palette class="size-4" />
    <span class="spring size-2.5 rounded-full {DOT_BG[/** @type {keyof typeof DOT_BG} */ (value)] || DOT_BG.default}"></span>
  </button>
  {#if open}
    <div data-popover class="absolute top-full z-30 mt-1 grid w-40 origin-top-left grid-cols-5 gap-1.5 border border-line-strong bg-surface p-2 shadow-2xl"
      style="left: {shift}px" transition:scale={{ start: 0.9, duration: 150 }}>
      {#each COLORS as color, index (color)}
        <button class="spring press size-6 rounded-full border-2 {value === color ? 'border-ink' : 'border-transparent hover:border-line-strong'} {DOT_BG[/** @type {keyof typeof DOT_BG} */ (color)]}"
          in:scale|global={{ start: 0.5, duration: 150, delay: index * DOT_STAGGER_MS }} aria-label="Color {color}" aria-pressed={value === color} onclick={() => pick(color)}></button>
      {/each}
    </div>
  {/if}
</div>
