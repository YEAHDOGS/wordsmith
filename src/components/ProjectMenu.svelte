<script>
  // Phone overflow menu for the project header: the less-used actions (rename, copy agent prompt, color, delete) fold
  // in here so the header stays one icon row. Arrow keys move between items, Escape or a click outside closes it and
  // focus returns to the ⋯ button.
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import Trash from '@lucide/svelte/icons/trash';
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { DOT_BG } from '../lib/colors.js';
  import { COLORS } from '../lib/models.js';

  /** @type {{ color: string, copied: boolean, onrename: () => void, oncopy: () => void, oncolor: (color: string) => void, ondelete: () => void, class?: string }} */
  let { color, copied, onrename, oncopy, oncolor, ondelete, class: className = '' } = $props();

  const MENU_IN = { start: 0.92, duration: 160, easing: backOut };
  const MENU_OUT = { duration: 100 };
  const DOT_STAGGER_MS = 15;
  const ITEM_SELECTOR = '[role^="menuitem"]';
  /** Arrow key -> how far focus moves through the items. */
  const KEY_STEPS = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
  const ITEM = 'spring press flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface-raised focus-visible:bg-surface-raised';

  let open = $state(false);
  /** @type {HTMLElement | undefined} */
  let root = $state();
  /** @type {HTMLButtonElement | undefined} */
  let button = $state();

  /** @param {boolean} [refocus] */
  function close(refocus = false) {
    open = false;
    if (refocus) button?.focus();
  }

  /** Runs an action from the menu and closes it. @param {() => void} action */
  function run(action) {
    close();
    action();
  }

  /** @param {KeyboardEvent & { currentTarget: HTMLElement }} event */
  function onMenuKey(event) {
    const items = /** @type {HTMLElement[]} */ ([...event.currentTarget.querySelectorAll(ITEM_SELECTOR)]);
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
      return;
    }
    const step = KEY_STEPS[/** @type {keyof typeof KEY_STEPS} */ (event.key)];
    if (!step) return;
    event.preventDefault();
    const at = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    items[(at + step + items.length) % items.length]?.focus();
  }

  /** Clicks outside close it. @param {PointerEvent} event */
  function onWindowPointer(event) {
    if (open && !root?.contains(/** @type {Node} */ (event.target))) close();
  }

  /** @param {KeyboardEvent} event */
  function onWindowKey(event) {
    if (open && event.key === 'Escape') close(true);
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onWindowKey} />

<div bind:this={root} class="relative {className}">
  <button bind:this={button} class="spring press flex size-9 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink {open ? 'bg-surface-raised text-ink' : ''}"
    aria-label="More project actions" title="More" aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}>
    <span class="flex spring {open ? 'rotate-90' : ''}"><Ellipsis class="size-5" /></span>
  </button>
  {#if open}
    <div data-popover role="menu" aria-label="Project actions" tabindex="-1" onkeydown={onMenuKey}
      class="absolute top-full right-0 z-30 mt-1 w-60 max-w-[calc(100vw-1rem)] origin-top-right border border-line-strong bg-surface py-1 shadow-2xl"
      {@attach (node) => /** @type {HTMLElement | null} */ (node.querySelector(ITEM_SELECTOR))?.focus()}
      in:scale={MENU_IN} out:fade={MENU_OUT}>
      <button role="menuitem" class="{ITEM} text-ink" onclick={() => run(onrename)}><Pencil class="size-4 text-ink-muted" />Rename project</button>
      <!-- Copy keeps the menu open for a moment, so the "Copied" confirmation is visible -->
      <button role="menuitem" class="{ITEM} text-ink" onclick={oncopy}>
        {#key copied}<span class="icon-swap flex">{#if copied}<Check class="size-4 text-complete" />{:else}<Copy class="size-4 text-ink-muted" />{/if}</span>{/key}
        {copied ? 'Copied agent prompt' : 'Copy agent prompt'}
      </button>
      <div class="border-y border-line px-3 py-2" role="group" aria-label="Project color">
        <p class="pb-1.5 font-mono text-[0.6875rem] tracking-widest text-ink-faint uppercase">Color</p>
        <div class="grid grid-cols-9 gap-1">
          {#each COLORS as option, index (option)}
            <button role="menuitemradio" aria-checked={color === option} aria-label="Color {option}"
              class="spring press aspect-square w-full rounded-full border-2 {color === option ? 'border-ink' : 'border-transparent hover:border-line-strong'} {DOT_BG[/** @type {keyof typeof DOT_BG} */ (option)]}"
              in:scale|global={{ start: 0.5, duration: 150, delay: index * DOT_STAGGER_MS }} onclick={() => oncolor(option)}></button>
          {/each}
        </div>
      </div>
      <button role="menuitem" class="{ITEM} text-accent" onclick={() => run(ondelete)}><Trash class="size-4" />Delete project</button>
    </div>
  {/if}
</div>
