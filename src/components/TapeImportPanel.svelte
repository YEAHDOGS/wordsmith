<script>
  // How an import is going, above the Tapes list: one progress bar for the whole batch, what's being worked on now,
  // and anything that failed with a Retry. Finished files are counted, not listed, so a thousand-file import stays
  // one short panel. The queue itself is src/lib/tapes.svelte.js.
  import { fade, fly } from 'svelte/transition';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import X from '@lucide/svelte/icons/x';
  import { tapeImport } from '../lib/tapes.svelte.js';
  import TEXT from './tapes.json';

  const PERCENT = 100;
  const ENTER = { y: -6, duration: 180 };
  const FADE = { duration: 150 };
  const WORKING = ['reading', 'encoding', 'uploading'];

  /** @type {{ onclose: () => void }} */
  let { onclose } = $props();

  const finished = $derived(tapeImport.done + tapeImport.skipped + tapeImport.failed);
  const fraction = $derived(tapeImport.total ? finished / tapeImport.total : 0);
  const working = $derived(tapeImport.items.filter((item) => WORKING.includes(item.status)));
  const failures = $derived(tapeImport.items.filter((item) => item.status === 'failed'));
  const saved = $derived(tapeImport.sourceBytes ? Math.round((1 - tapeImport.storedBytes / tapeImport.sourceBytes) * PERCENT) : 0);
  const headline = $derived((tapeImport.active ? TEXT.importing : TEXT.imported).replace('{done}', String(finished)).replace('{total}', String(tapeImport.total)));
</script>

<section class="border-b border-line bg-surface px-2 py-3 sm:px-4" aria-live="polite" transition:fly={ENTER}>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
    <span class="font-semibold text-ink">{headline}</span>
    {#if tapeImport.skipped}<span class="text-xs text-ink-muted">{TEXT.skipped.replace('{count}', String(tapeImport.skipped))}</span>{/if}
    {#if tapeImport.failed}<span class="text-xs text-accent">{TEXT.failed.replace('{count}', String(tapeImport.failed))}</span>{/if}
    {#if saved > 0}<span class="text-xs text-complete">{TEXT.saved.replace('{percent}', String(saved))}</span>{/if}
    <span class="ml-auto flex items-center gap-1">
      {#if tapeImport.failed && !tapeImport.active}
        <button class="spring press inline-flex items-center gap-1.5 px-2 py-1 text-xs text-ink hover:text-accent" onclick={() => tapeImport.retry()}><RotateCcw class="size-3.5" />{TEXT.retry}</button>
      {/if}
      {#if tapeImport.active}
        <button class="spring press px-2 py-1 text-xs text-ink-muted hover:text-ink" onclick={() => tapeImport.cancel()}>{TEXT.cancel}</button>
      {:else}
        <button class="spring press p-1 text-ink-faint hover:text-ink" aria-label={TEXT.dismiss} title={TEXT.dismiss} onclick={onclose}><X class="size-4" /></button>
      {/if}
    </span>
  </div>
  <!-- The whole batch: a bar that scales, so it never reflows -->
  <div class="mt-2 h-1 overflow-hidden bg-line" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(fraction * PERCENT)}>
    <div class="h-full origin-left bg-accent transition-transform duration-300 ease-out" style="transform: scaleX({fraction})"></div>
  </div>
  {#if tapeImport.stopped}<p class="mt-2 text-xs text-accent" in:fade={FADE}>{tapeImport.stopped}</p>{/if}
  {#if working.length || failures.length}
    <ul class="mt-2 grid max-h-32 gap-1 overflow-y-auto overscroll-contain text-xs short:max-h-16">
      {#each [...working, ...failures] as item (item.id)}
        <li class="flex min-w-0 items-center gap-2" in:fade={FADE}>
          <span class="w-20 shrink-0 {item.status === 'failed' ? 'text-accent' : 'text-ink-faint'}">{TEXT.status[/** @type {keyof typeof TEXT.status} */ (item.status)]}{item.status === 'uploading' ? ` ${Math.round(item.progress * PERCENT)}%` : ''}</span>
          <span class="min-w-0 truncate text-ink-muted" title={item.error || item.name}>{item.name}{item.error ? ` · ${item.error}` : ''}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
