<script>
  // A project's Media tab: every image, video, and audio attachment on its notes, as a grid of tiles. Filter by state
  // (All, Requested, In progress, Complete) and sort newest or oldest first; a tile opens its note. Attachments sync to
  // every device already (store.attachments), so this costs no extra requests beyond the files themselves, which the
  // browser caches for good. Only the grid scrolls; the controls stay put. Documents are left out on purpose.
  import Play from '@lucide/svelte/icons/play';
  import ArrowDownWideNarrow from '@lucide/svelte/icons/arrow-down-wide-narrow';
  import ArrowUpNarrowWide from '@lucide/svelte/icons/arrow-up-narrow-wide';
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import AttachmentMedia from './AttachmentMedia.svelte';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { STATE_STYLE } from '../lib/colors.js';
  import { FEATURE_STATES, attachmentKind } from '../lib/models.js';
  import { fullTime } from '../lib/time.js';

  /** @type {{ notes: any[] }} */
  let { notes } = $props();

  const ALL = 'all';
  const FILTERS = [ALL, ...FEATURE_STATES];
  const MOTION = { duration: 180 };
  const CHIP = 'spring press flex h-8 shrink-0 items-center gap-1.5 px-3 text-xs tv:h-11 tv:text-base';

  let filter = $state(ALL);
  let newestFirst = $state(true);

  const byId = $derived(new Map(notes.map((note) => [note.id, note])));
  const media = $derived(store.attachments.filter((file) => !file.deleted_at && byId.has(file.note_id) && attachmentKind(file.type) !== 'document'));
  const tiles = $derived(media
    .map((file) => ({ file, note: byId.get(file.note_id) }))
    .filter(({ note }) => filter === ALL || note.state === filter)
    .sort((a, b) => (newestFirst ? b.file.created_at - a.file.created_at : a.file.created_at - b.file.created_at)));
  const counts = $derived(Object.fromEntries(FILTERS.map((state) => [state, media
    .filter((file) => state === ALL || byId.get(file.note_id).state === state).length])));

  /**
   * Tiles show media whole (object-contain) scaled up by --cover to fill the square; hover or focus drops the scale
   * to 1 so the whole picture shows. object-fit can't animate, transform can.
   * @param {Event & { currentTarget: HTMLElement }} event load / loadedmetadata, caught on the tile
   */
  function setCoverScale(event) {
    const media = /** @type {HTMLImageElement & HTMLVideoElement} */ (event.target);
    const width = media.naturalWidth || media.videoWidth;
    const height = media.naturalHeight || media.videoHeight;
    if (!width || !height) return;
    event.currentTarget.style.setProperty('--cover', String(Math.max(width / height, height / width)));
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex flex-wrap items-center gap-2 py-2 sm:py-3">
    <div class="flex min-w-0 gap-px overflow-hidden rounded-ui-sm border border-line bg-line" role="radiogroup" aria-label="Show media from">
      {#each FILTERS as state (state)}
        {@const style = state === ALL ? null : STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (state)]}
        <button role="radio" aria-checked={filter === state} onclick={() => (filter = state)}
          class="{CHIP} {filter === state ? `bg-surface-raised font-semibold ${style ? style.text : 'text-ink'}` : 'bg-app text-ink-muted hover:text-ink'}">
          {#if style}<span class="size-1.5 rounded-full {style.dot}" aria-hidden="true"></span>{/if}
          <span class="hidden sm:inline">{style ? style.label : 'All'}</span><span class="sm:hidden">{style ? style.label.split(' ')[0] : 'All'}</span>
          <span class="font-mono text-[0.625rem] text-ink-faint">{counts[state]}</span>
        </button>
      {/each}
    </div>
    <button class="{CHIP} ml-auto rounded-ui-sm border border-line text-ink-muted hover:text-ink" onclick={() => (newestFirst = !newestFirst)}
      aria-label={newestFirst ? 'Newest first. Switch to oldest first' : 'Oldest first. Switch to newest first'}>
      {#if newestFirst}<ArrowDownWideNarrow class="size-3.5" />{:else}<ArrowUpNarrowWide class="size-3.5" />{/if}
      <span class="grid">
        <span class="spring col-start-1 row-start-1 {newestFirst ? '' : 'translate-y-1 opacity-0'}" aria-hidden={!newestFirst}>Newest</span>
        <span class="spring col-start-1 row-start-1 {newestFirst ? 'translate-y-1 opacity-0' : ''}" aria-hidden={newestFirst}>Oldest</span>
      </span>
    </button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 sm:pb-4">
    {#if tiles.length}
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-px border border-line bg-line sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] tv:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]">
        {#each tiles as { file, note } (file.id)}
          {@const style = STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (note.state)]}
          <li class="bg-app" animate:flip={MOTION} in:fade={MOTION}>
            <button class="group relative block aspect-square w-full overflow-hidden" onclick={() => router.openNote(note.id)}
              onloadcapture={setCoverScale} onloadedmetadatacapture={setCoverScale}
              title="{note.title || 'Untitled'} · {file.name} · {fullTime(file.created_at)}" aria-label="Open {note.title || 'untitled note'} ({file.name})">
              <AttachmentMedia {file} class="spring size-full object-contain duration-300 [transform:scale(var(--cover,1))] group-hover:[transform:none] group-focus-visible:[transform:none]" />
              {#if file.type.startsWith('video/')}
                <span class="pointer-events-none absolute inset-0 flex items-center justify-center"><span class="flex size-8 items-center justify-center rounded-full bg-scrim text-ink"><Play class="size-4" /></span></span>
              {/if}
              <span class="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-scrim px-2 py-1 text-left text-[0.6875rem] text-ink tv:text-sm">
                <span class="size-1.5 shrink-0 rounded-full {style.dot}" aria-hidden="true"></span><span class="truncate">{note.title || 'Untitled'}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="px-4 py-12 text-center text-sm text-ink-muted" in:fade={MOTION}>{counts[ALL] ? 'No media on notes in this state.' : 'No pictures, videos, or audio on this project’s notes yet. Attach them to a note and they show up here.'}</p>
    {/if}
  </div>
</div>
