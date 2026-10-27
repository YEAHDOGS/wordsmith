<script>
  // Row of color dots for notes and projects. Collapsed to the current color until hovered or focused.
  import Palette from '@lucide/svelte/icons/palette';
  import { DOT_BG } from '../lib/colors.js';
  import { COLORS } from '../lib/models.js';

  /** @type {{ value: string, onchange: (color: string) => void }} */
  let { value, onchange } = $props();
  let open = $state(false);
</script>

<div class="relative flex items-center" role="group" aria-label="Color">
  <button class="spring press flex items-center gap-1.5 px-2.5 py-2 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink" aria-expanded={open} onclick={() => (open = !open)} title="Color">
    <Palette class="size-4" />
    <span class="size-2.5 rounded-full {DOT_BG[/** @type {keyof typeof DOT_BG} */ (value)] || DOT_BG.default}"></span>
  </button>
  {#if open}
    <div class="flex items-center gap-1 px-1">
      {#each COLORS as color, index (color)}
        <button class="spring press size-5 rounded-full border-2 {value === color ? 'border-ink' : 'border-transparent'} {DOT_BG[/** @type {keyof typeof DOT_BG} */ (color)]}"
          style="transition-delay: {index * 15}ms" aria-label="Color {color}" aria-pressed={value === color}
          onclick={() => { onchange(color); open = false; }}></button>
      {/each}
    </div>
  {/if}
</div>
