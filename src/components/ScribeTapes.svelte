<script>
  // Scribe and Tapes share one tab. The switch in the top-left corner flips between them (#/scribe and #/tapes, so a
  // link to either still lands on its side) without leaving the page: the sides slide past each other, Scribe on the
  // left. Scribe's mic can also record straight to a tape ("Just record", src/lib/recorder.svelte.js); while it
  // records, a live timer sits beside the switch on both sides. Tapes loads on first visit, as before.
  import { fade, fly } from 'svelte/transition';
  import { cubicIn, quintOut } from 'svelte/easing';
  import Segmented from './Segmented.svelte';
  import Scribe from './Scribe.svelte';
  import LazyPage from './LazyPage.svelte';
  import { recorder } from '../lib/recorder.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { clock } from '../lib/time.js';
  import SCRIBE_TEXT from './scribe.json';
  import TAPES_TEXT from './tapes.json';

  /** @type {{ mode: 'scribe' | 'tapes' }} */
  let { mode } = $props();

  const MODES = ['scribe', 'tapes'];
  const LABELS = { scribe: SCRIBE_TEXT.title, tapes: TAPES_TEXT.title };
  const loadTapes = () => import('./Tapes.svelte');
  const SLIDE_PERCENT = 12;
  const SIDE_IN_MS = 260;
  const SIDE_OUT_MS = 160;
  const MS_PER_SECOND = 1_000;
  const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');

  // Tapes sits to the right of Scribe: going to Tapes slides the page left, coming back slides it right.
  const direction = $derived(mode === 'tapes' ? 1 : -1);
  /** @param {number} ms */
  const motion = (ms) => (REDUCED_MOTION.matches ? 0 : ms);
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="flex shrink-0 items-center gap-3 border-b border-line px-2 py-1.5 sm:px-4 tv:py-3">
    <div class="w-44 shrink-0 tv:w-72">
      <Segmented options={MODES} value={mode} labels={LABELS} label={SCRIBE_TEXT.sides} onselect={(side) => router.replace(side)} />
    </div>
    {#if recorder.recording}
      <button class="spring press flex min-w-0 items-center gap-2 text-xs text-ink-muted hover:text-ink tv:text-lg" title={SCRIBE_TEXT.recorder.back}
        onclick={() => router.replace('scribe')} transition:fade={{ duration: motion(SIDE_OUT_MS) }}>
        <span class="live-dot size-2 shrink-0 rounded-full bg-accent" aria-hidden="true"></span>
        <span class="truncate">{SCRIBE_TEXT.recorder.recordingShort}</span>
        <span class="font-mono tabular-nums text-ink">{clock(recorder.elapsed / MS_PER_SECOND)}</span>
      </button>
    {/if}
  </div>

  <!-- One grid cell: the leaving side slides out over the arriving one, so nothing below the switch moves -->
  <div class="relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden">
    {#key mode}
      <div class="col-start-1 row-start-1 flex min-h-0 flex-col bg-app"
        in:fly={{ x: `${direction * SLIDE_PERCENT}%`, duration: motion(SIDE_IN_MS), easing: quintOut }}
        out:fly={{ x: `${-direction * SLIDE_PERCENT}%`, duration: motion(SIDE_OUT_MS), easing: cubicIn }}>
        {#if mode === 'scribe'}
          <Scribe />
        {:else}
          <LazyPage load={loadTapes} />
        {/if}
      </div>
    {/key}
  </div>
</div>
