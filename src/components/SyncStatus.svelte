<script>
  // Sync icon beside the wordmark. Always the same size and color; it spins while syncing and finishes its turn
  // before stopping, so it never snaps. On a problem it turns yellow with a "?" and opens a plain-words explanation.
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import X from '@lucide/svelte/icons/x';
  import { fly, scale } from 'svelte/transition';
  import { backOut, cubicOut } from 'svelte/easing';
  import { store } from '../lib/store.svelte.js';
  import { ago, fullTime } from '../lib/time.js';
  import { syncProblem } from './sync-problem.js';

  /** @type {{ compact?: boolean }} */
  let { compact = false } = $props();

  const UID = $props.id();
  const PANEL_ID = `sync-panel-${UID}`;
  const PANEL_IN = { y: -6, duration: 180, easing: backOut };
  const PANEL_OUT = { y: -4, duration: 120, easing: cubicOut };
  const BADGE = { start: 0.4, duration: 180, easing: backOut };

  let open = $state(false);
  let spinning = $state(false);
  /** @type {HTMLElement | undefined} */ let root = $state();
  /** @type {HTMLButtonElement | undefined} */ let trigger = $state();

  const problem = $derived(syncProblem(store));
  const label = $derived.by(() => {
    if (problem) return `Sync problem: ${problem.title}. Show details`;
    if (store.syncing) return 'Syncing';
    return store.lastSync ? `Synced ${ago(store.lastSync)}. Sync now` : 'Sync now';
  });

  // Start spinning as soon as a sync starts; stopping waits for the end of a turn (onanimationiteration).
  $effect(() => {
    if (store.syncing) spinning = true;
  });

  // The explanation closes itself once the problem is gone.
  $effect(() => {
    if (!problem) open = false;
  });

  function onclick() {
    if (problem) {
      open = !open;
      return;
    }
    store.sync();
  }

  /** @param {PointerEvent} event */
  function onpointerdown(event) {
    if (!open || root?.contains(/** @type {Node} */ (event.target))) return;
    open = false;
  }

  /** @param {KeyboardEvent} event */
  function onkeydown(event) {
    if (!open || event.key !== 'Escape') return;
    open = false;
    trigger?.focus();
  }
</script>

<svelte:window {onpointerdown} {onkeydown} />

<div class="contents" bind:this={root}>
  <button bind:this={trigger} class="spring press relative flex size-8 tv:size-11 shrink-0 items-center justify-center hover:bg-surface-raised {problem ? 'text-requested' : 'text-ink-faint'}"
    {onclick} aria-label={label} title={store.lastSync ? `Last synced ${fullTime(store.lastSync)}` : 'Not synced yet'}
    aria-expanded={problem ? open : undefined} aria-controls={problem ? PANEL_ID : undefined}>
    <span class="flex {spinning ? 'spinning' : ''}" onanimationiteration={() => !store.syncing && (spinning = false)}>
      <RefreshCw class="size-4 tv:size-6" />
    </span>
    {#if problem}
      <span class="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-requested font-mono text-[9px] leading-none font-bold text-app"
        aria-hidden="true" transition:scale={BADGE}>?</span>
    {/if}
  </button>

  {#if open && problem}
    <div id={PANEL_ID} role="dialog" aria-label="Sync problem"
      class="absolute z-30 max-h-[70dvh] overflow-y-auto border border-line bg-surface-raised shadow-lg {compact ? 'top-0 left-full ml-px w-72' : 'inset-x-0 top-full'}"
      in:fly={PANEL_IN} out:fly={PANEL_OUT}>
      <div class="h-0.5 bg-requested"></div>
      <div class="flex items-start gap-2 p-3 tv:p-5">
        <div class="min-w-0 flex-1">
          <p class="text-sm tv:text-xl font-bold text-requested">{problem.title}</p>
          <p class="mt-1 text-sm tv:text-lg text-ink selectable">{problem.detail}</p>
          <p class="mt-2 text-xs tv:text-base text-ink-muted">{problem.advice}</p>
        </div>
        <button class="spring press -mt-1 -mr-1 p-1 text-ink-faint hover:text-ink" aria-label="Close" onclick={() => (open = false)}><X class="size-4" /></button>
      </div>
      <div class="flex items-center gap-3 border-t border-line px-3 py-2 tv:px-5">
        <button class="spring press flex items-center gap-1.5 bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-60"
          onclick={() => store.sync()} disabled={store.syncing}>
          <RefreshCw class="size-4 {store.syncing ? 'spinning' : ''}" />{store.syncing ? 'Retrying' : 'Retry'}
        </button>
        <span class="min-w-0 truncate font-mono text-[11px] text-ink-faint">{store.lastSync ? `Last synced ${ago(store.lastSync)}` : 'Not synced yet'}</span>
      </div>
    </div>
  {/if}
</div>
