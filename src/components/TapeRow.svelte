<script>
  // One tape in the Tapes list: play button, title, when it was recorded and how long it runs. Opening it shows its
  // title and notes for editing (saved as you type, synced like notes), what it took to store, and delete.
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { store } from '../lib/store.svelte.js';
  import { MAX_BODY, MAX_TITLE } from '../lib/models.js';
  import { clock, player } from './tape-player.svelte.js';
  import TEXT from './tapes.json';

  /** @type {{ tape: any, open: boolean, ontoggle: () => void }} */
  let { tape, open, ontoggle } = $props();

  const OPEN = { duration: 200, easing: quintOut };
  const MS_PER_SECOND = 1000;
  const BYTES_PER_KB = 1024;
  const BYTES_PER_MB = 1024 * 1024;
  const RECORDED = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  let confirming = $state(false);

  const current = $derived(player.tape?.id === tape.id);
  const title = $derived(tape.title || tape.source_name || TEXT.untitled);
  const when = $derived(tape.recorded_at ?? tape.created_at);

  /** @param {number} bytes */
  const size = (bytes) => (bytes >= BYTES_PER_MB ? `${(bytes / BYTES_PER_MB).toFixed(1)} MB` : `${Math.round(bytes / BYTES_PER_KB)} KB`);
</script>

<li class="border-b border-line {current ? 'bg-accent-soft' : ''} transition-colors duration-150">
  <div class="flex items-center gap-2 px-2 py-1.5 sm:gap-3 sm:px-4 tv:py-3">
    <button class="spring press flex size-9 shrink-0 items-center justify-center border border-line-strong text-ink hover:border-accent hover:text-accent tv:size-14 {current ? 'border-accent text-accent' : ''}"
      aria-label={current && player.playing ? TEXT.pause : TEXT.play.replace('{title}', title)} onclick={() => player.play(tape)}>
      {#if current && player.loading}<LoaderCircle class="size-4 animate-spin" />
      {:else if current && player.playing}<Pause class="size-4" />
      {:else}<Play class="size-4 translate-x-px" />{/if}
    </button>
    <button class="group flex min-w-0 flex-1 items-center gap-3 py-1 text-left" aria-expanded={open} onclick={ontoggle}>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold text-ink tv:text-xl">{title}</span>
        <span class="block truncate text-xs text-ink-faint tv:text-base">{when ? RECORDED.format(when) : ''}{tape.body ? ` · ${tape.body}` : ''}</span>
      </span>
      <span class="shrink-0 font-mono text-xs text-ink-muted tabular-nums tv:text-base">{clock(tape.duration_ms / MS_PER_SECOND)}</span>
      <ChevronDown class="size-4 shrink-0 text-ink-faint spring group-hover:text-ink {open ? 'rotate-180' : ''}" />
    </button>
  </div>

  {#if open}
    <div class="grid gap-3 px-2 pb-4 sm:px-4 sm:pl-16 tv:pl-24" transition:slide={OPEN}>
      <label class="grid gap-1 text-xs text-ink-faint">{TEXT.titleLabel}
        <input class="w-full min-w-0 border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none" maxlength={MAX_TITLE}
          value={tape.title} oninput={(event) => store.update('tapes', tape.id, { title: event.currentTarget.value })} />
      </label>
      <label class="grid gap-1 text-xs text-ink-faint">{TEXT.notes}
        <textarea class="min-h-24 w-full min-w-0 resize-y border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none" maxlength={MAX_BODY}
          placeholder={TEXT.notesPlaceholder} value={tape.body} oninput={(event) => store.update('tapes', tape.id, { body: event.currentTarget.value })}></textarea>
      </label>
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-ink-muted">
        <p class="min-w-0 break-all"><span class="text-ink-faint">{TEXT.original}</span> {tape.source_name} · {size(tape.source_size)}
          <span class="text-ink-faint"> → {TEXT.stored}</span> {size(tape.audio_size)}</p>
        <!-- One grid cell: the button and the confirmation swap in place -->
        <div class="grid">
          {#if confirming}
            <div class="col-start-1 row-start-1 flex flex-wrap items-center gap-2">
              <span class="max-w-xs text-ink">{TEXT.deleteConfirm}</span>
              <button class="spring press bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
                onclick={() => { if (current) player.close(); store.remove('tapes', tape.id); }}>{TEXT.deleteYes}</button>
              <button class="spring press px-3 py-1.5 text-sm text-ink-muted hover:text-ink" {@attach (node) => node.focus()} onclick={() => (confirming = false)}>{TEXT.deleteNo}</button>
            </div>
          {:else}
            <button class="spring press col-start-1 row-start-1 inline-flex items-center gap-1.5 justify-self-end px-2 py-1.5 text-ink-faint hover:text-accent" onclick={() => (confirming = true)}>
              <Trash2 class="size-3.5" />{TEXT.delete}
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</li>
