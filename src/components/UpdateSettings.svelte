<script>
  // Settings → About, native apps only: where updates stand, a "Check for updates" button, and Restart once a new
  // version is downloaded. The checks themselves run in the background (src/lib/updates.svelte.js).
  import { fade } from 'svelte/transition';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import ArrowUpCircle from '@lucide/svelte/icons/circle-arrow-up';
  import { updates } from '../lib/updates.svelte.js';
  import { ago } from '../lib/time.js';
  import { BUTTON, HINT, SUBHEADING } from './settings-styles.js';
  import TEXT from './updates.json';

  const FADE = { duration: 150 };
  const PERCENT = 100;
  const BUSY = ['checking', 'downloading', 'installing'];

  const line = $derived.by(() => {
    switch (updates.status) {
      case 'checking': return TEXT.checking;
      case 'downloading': return TEXT.downloading.replace('{percent}', String(Math.round(updates.progress * PERCENT)));
      case 'ready': return TEXT.readyDetail.replace('{version}', updates.version);
      case 'installing': return TEXT.restarting;
      case 'available': return `${TEXT.available.replace('{version}', updates.version)}. ${TEXT.availableDetail}`;
      case 'current': return TEXT.current;
      case 'error': return TEXT.error.replace('{error}', updates.error);
      default: return '';
    }
  });
  const busy = $derived(BUSY.includes(updates.status));
  const canApply = $derived(updates.status === 'ready' || updates.status === 'available');
</script>

<p class={SUBHEADING}>{TEXT.heading}</p>
<p class={HINT}>{TEXT.hint}</p>
<div class="mb-4 flex flex-wrap items-center gap-2">
  <button class={BUTTON} onclick={() => updates.check({ manual: true })} disabled={busy}>
    <RefreshCw class="size-4 shrink-0 {busy ? 'animate-spin' : ''}" />{busy ? TEXT.checking : TEXT.check}
  </button>
  {#if canApply}
    <button class="{BUTTON} border-accent" onclick={() => updates.apply()} in:fade={FADE}>
      <ArrowUpCircle class="size-4 shrink-0 text-accent" />{updates.status === 'available' ? TEXT.get : TEXT.restart}
    </button>
  {/if}
</div>
<!-- One line that crossfades as the state changes; the space is kept so nothing below jumps -->
<p class="-mt-2 mb-4 grid min-h-5 text-xs {updates.status === 'error' ? 'text-accent' : 'text-ink-muted'}" aria-live="polite">
  {#key line}<span class="col-start-1 row-start-1" transition:fade={FADE}>{line}{#if updates.checkedAt && !busy}<span class="text-ink-faint"> · {TEXT.checked.replace('{time}', ago(updates.checkedAt))}</span>{/if}</span>{/key}
</p>
