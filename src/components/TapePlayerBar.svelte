<script>
  // The player under the Tapes list, while a tape is loaded: previous, play/pause, next, a seek bar and the time.
  // Its space is held by the page's grid row, so it slides in without pushing the list.
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import SkipBack from '@lucide/svelte/icons/skip-back';
  import SkipForward from '@lucide/svelte/icons/skip-forward';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import X from '@lucide/svelte/icons/x';
  import { player } from './tape-player.svelte.js';
  import { clock } from '../lib/time.js';
  import TEXT from './tapes.json';

  const ENTER = { y: 24, duration: 220, easing: quintOut };
  const BUTTON = 'spring press flex size-9 shrink-0 items-center justify-center text-ink hover:text-accent tv:size-14';

  const title = $derived(player.tape?.title || player.tape?.source_name || TEXT.untitled);
</script>

{#if player.tape}
  <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-surface px-2 py-2 short:py-1 sm:flex-nowrap sm:px-4 tv:py-4" transition:fly={ENTER}>
    <div class="flex shrink-0 items-center">
      <button class={BUTTON} aria-label={TEXT.previous} title={TEXT.previous} onclick={() => player.previous()}><SkipBack class="size-4" /></button>
      <button class="{BUTTON} border border-accent text-accent" aria-label={player.playing ? TEXT.pause : TEXT.play.replace('{title}', title)} onclick={() => player.toggle()}>
        {#if player.loading}<LoaderCircle class="size-4 animate-spin" />{:else if player.playing}<Pause class="size-4" />{:else}<Play class="size-4 translate-x-px" />{/if}
      </button>
      <button class={BUTTON} aria-label={TEXT.next} title={TEXT.next} onclick={() => player.next()}><SkipForward class="size-4" /></button>
    </div>
    <!-- Phones show the title on its own line above the controls; short windows drop it to keep the list in view -->
    <p class="order-first w-full min-w-0 truncate text-sm font-semibold text-ink short:hidden sm:order-none sm:w-48 sm:shrink-0 lg:w-64 tv:text-xl">
      {player.error ? TEXT.loadError : title}
    </p>
    <div class="flex min-w-0 flex-1 items-center gap-2 font-mono text-xs text-ink-muted tabular-nums tv:text-base">
      <span class="shrink-0">{clock(player.time)}</span>
      <input type="range" class="min-w-0 flex-1 accent-accent" min="0" max={player.duration || 0} step="0.1" value={player.time}
        aria-label={TEXT.seek.replace('{title}', title)} oninput={(event) => player.seek(Number(event.currentTarget.value))} />
      <span class="shrink-0">{clock(player.duration)}</span>
    </div>
    <button class="{BUTTON} text-ink-faint" aria-label={TEXT.close} title={TEXT.close} onclick={() => player.close()}><X class="size-4" /></button>
  </div>
{/if}
