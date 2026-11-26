<script>
  // The quiet update notice: a small pill in the bottom corner once a new version is downloaded (desktop) or out
  // (Android), clear of the phone's bottom nav. One press restarts into it; the X hides it until the next version.
  // Nothing else ever interrupts: no dialog, no forced restart. State lives in src/lib/updates.svelte.js.
  import { scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import ArrowUpCircle from '@lucide/svelte/icons/circle-arrow-up';
  import X from '@lucide/svelte/icons/x';
  import { updates } from '../lib/updates.svelte.js';
  import TEXT from './updates.json';

  const PILL = { start: 0.6, duration: 200, easing: backOut };

  const message = $derived(updates.status === 'available' ? TEXT.available.replace('{version}', updates.version) : TEXT.ready);
  const action = $derived(updates.status === 'installing' ? TEXT.restarting : updates.status === 'available' ? TEXT.get : TEXT.restart);
</script>

{#if updates.showPill}
  <div class="fixed right-2 bottom-20 z-30 flex max-w-[calc(100vw-1rem)] items-stretch border border-accent bg-surface text-xs text-ink shadow-md sm:right-4 md:bottom-4 tv:text-lg"
    role="status" aria-label={TEXT.pillLabel} transition:scale={PILL}>
    <button class="spring press group flex min-w-0 items-center gap-2 py-1.5 pr-2 pl-2.5 hover:bg-accent-soft disabled:opacity-60"
      onclick={() => updates.apply()} disabled={updates.status === 'installing'}>
      <ArrowUpCircle class="size-4 shrink-0 text-accent spring group-hover:-translate-y-0.5" />
      <span class="min-w-0 truncate">{message}</span>
      <span class="shrink-0 font-semibold text-accent">{action}</span>
    </button>
    {#if updates.status !== 'installing'}
      <button class="spring press flex items-center border-l border-line px-2 text-ink-faint hover:text-ink" aria-label={TEXT.later} title={TEXT.later}
        onclick={() => updates.dismiss()}><X class="size-3.5" /></button>
    {/if}
  </div>
{/if}
