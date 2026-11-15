<script>
  // Tapes: every voice recording you've imported, newest first, searchable (titles, notes, transcripts) and filtered by
  // rating, each one playable, with notes and a transcript. The desktop apps transcribe on the device ("Transcribe all",
  // src/lib/tape-transcribe.svelte.js). Import
  // with the buttons (a whole recorder folder at once is fine) or by dropping files or folders anywhere on the page;
  // the queue (src/lib/tapes.svelte.js) shrinks and uploads them in the background, and keeps going if you leave.
  // Layout: one column everywhere, capped at max-w-7xl (spread on ultra-wide). The toolbar and the player hold their
  // rows; only the list scrolls, and it draws its rows a page at a time so thousands of tapes stay quick.
  import { onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import Upload from '@lucide/svelte/icons/upload';
  import FolderUp from '@lucide/svelte/icons/folder-up';
  import Search from '@lucide/svelte/icons/search';
  import CassetteTape from '@lucide/svelte/icons/cassette-tape';
  import AudioLines from '@lucide/svelte/icons/audio-lines';
  import TapeRow from './TapeRow.svelte';
  import TapeImportPanel from './TapeImportPanel.svelte';
  import TapePlayerBar from './TapePlayerBar.svelte';
  import DesktopAppNudge from './DesktopAppNudge.svelte';
  import { store } from '../lib/store.svelte.js';
  import { tapeImport } from '../lib/tapes.svelte.js';
  import { transcriber } from '../lib/tape-transcribe.svelte.js';
  import { speech } from '../lib/speech.svelte.js';
  import { AUDIO_TYPES, TAPE_RATINGS } from '../lib/models.js';
  import { player } from './tape-player.svelte.js';
  import TEXT from './tapes.json';

  const CONTENT = 'mx-auto w-full max-w-7xl ultrawide:max-w-none';
  const BUTTON = 'spring press inline-flex shrink-0 items-center gap-2 border border-line-strong px-3 py-2 text-sm text-ink hover:border-accent';
  const PAGE_SIZE = 100;
  const SEARCH_FIELDS = ['title', 'body', 'transcript', 'source_name'];
  // Rating filters, best first; ALL_RATINGS shows every tape.
  const ALL_RATINGS = -1;
  const FILTERS = [ALL_RATINGS, ...['Gold', 'Maybe', 'Unrated', 'Trash'].map((label) => TAPE_RATINGS.indexOf(label))];
  const CHIP = 'spring press shrink-0 border px-2.5 py-1 text-xs';
  const ACCEPT = ['audio/*', ...Object.values(AUDIO_TYPES).flat()].join(',');
  const FADE = { duration: 150 };

  let query = $state('');
  let rating = $state(ALL_RATINGS);
  let openId = $state('');
  let shown = $state(PAGE_SIZE);
  let dragging = $state(false);
  let panel = $state(tapeImport.active || tapeImport.total > 0);
  /** @type {HTMLInputElement | undefined} */ let filePicker = $state();
  /** @type {HTMLInputElement | undefined} */ let folderPicker = $state();

  const tapes = $derived(store.tapes.filter((tape) => !tape.deleted_at).sort((a, b) => (b.recorded_at ?? b.created_at) - (a.recorded_at ?? a.created_at)));
  const matches = $derived.by(() => {
    const words = query.trim().toLowerCase();
    const rated = rating === ALL_RATINGS ? tapes : tapes.filter((tape) => (tape.rating ?? 0) === rating);
    if (!words) return rated;
    return rated.filter((tape) => SEARCH_FIELDS.some((field) => String(tape[field] || '').toLowerCase().includes(words)));
  });
  const visible = $derived(matches.slice(0, shown));

  // Next and previous follow the list as you see it.
  $effect(() => {
    player.order = matches;
  });
  // A new search or filter starts from the top.
  $effect(() => {
    query;
    rating;
    shown = PAGE_SIZE;
  });
  onDestroy(() => player.pause());
  speech.init();

  const transcribeLine = $derived.by(() => {
    if (transcriber.error) return transcriber.error;
    if (transcriber.waiting) return TEXT.transcribeWaiting;
    if (transcriber.running) return TEXT.transcribeProgress.replace('{done}', String(transcriber.done)).replace('{left}', String(transcriber.remaining));
    return transcriber.done ? TEXT.transcribeDone : '';
  });

  /** @param {File[]} files */
  function start(files) {
    if (!files.length) return;
    panel = true;
    tapeImport.add(files);
  }

  /** @param {Event & { currentTarget: HTMLInputElement }} event */
  function picked(event) {
    start([...(event.currentTarget.files || [])]);
    event.currentTarget.value = '';
  }

  /**
   * Every file in a dropped folder, however deep (the drop only hands over its top entries).
   * @param {FileSystemEntry} entry @returns {Promise<File[]>}
   */
  async function filesIn(entry) {
    if (entry.isFile) return [await new Promise((resolve, reject) => /** @type {FileSystemFileEntry} */ (entry).file(resolve, reject))];
    if (!entry.isDirectory) return [];
    const reader = /** @type {FileSystemDirectoryEntry} */ (entry).createReader();
    /** @type {FileSystemEntry[]} */
    const entries = [];
    // readEntries answers in batches (about 100 at a time) until it hands back none.
    for (let batch = await readBatch(reader); batch.length; batch = await readBatch(reader)) entries.push(...batch);
    return (await Promise.all(entries.map(filesIn))).flat();
  }

  /** @param {FileSystemDirectoryReader} reader @returns {Promise<FileSystemEntry[]>} */
  const readBatch = (reader) => new Promise((resolve, reject) => reader.readEntries(resolve, reject));

  /** @param {DragEvent} event */
  async function ondrop(event) {
    event.preventDefault();
    dragging = false;
    const items = [...(event.dataTransfer?.items || [])].map((item) => item.webkitGetAsEntry?.()).filter((entry) => entry !== null && entry !== undefined);
    const files = items.length ? (await Promise.all(items.map(filesIn))).flat() : [...(event.dataTransfer?.files || [])];
    start(files);
  }

  /** @param {DragEvent} event */
  function ondragover(event) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dragging = true;
  }

  /** Draws the next page of rows once the end of the list scrolls into view. @param {HTMLElement} node */
  function more(node) {
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && (shown += PAGE_SIZE));
    observer.observe(node);
    return () => observer.disconnect();
  }
</script>

<!-- The whole page takes drops; the outline shows where they land -->
<div class="relative grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]" role="region" aria-label={TEXT.title}
  {ondragover} ondragleave={(event) => event.currentTarget === event.target && (dragging = false)} {ondrop}>
  <div class="{CONTENT} flex flex-wrap items-center gap-2 border-b border-line px-2 py-2 sm:px-4">
    <!-- Icon-only on phones, so the button and the search share one row down to 320px -->
    <button class={BUTTON} aria-label={TEXT.importFiles} title={TEXT.importFiles} onclick={() => filePicker?.click()}><Upload class="size-4" /><span class="max-sm:hidden">{TEXT.importFiles}</span></button>
    <button class="{BUTTON} max-sm:hidden" onclick={() => folderPicker?.click()}><FolderUp class="size-4" />{TEXT.importFolder}</button>
    <label class="flex min-w-0 flex-1 basis-40 items-center gap-2 border border-line bg-surface px-2 focus-within:border-accent">
      <Search class="size-4 shrink-0 text-ink-faint" />
      <input class="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none" type="search" placeholder={TEXT.search} aria-label={TEXT.search} bind:value={query} />
    </label>
    {#if speech.available && (transcriber.running || transcriber.remaining)}
      <button class={BUTTON} onclick={() => (transcriber.running ? transcriber.stop() : transcriber.start())}>
        <AudioLines class="size-4 {transcriber.running ? 'animate-pulse text-accent' : ''}" />
        <span class="max-sm:hidden">{transcriber.running ? TEXT.transcribeStop : TEXT.transcribeAll.replace('{count}', String(transcriber.remaining))}</span>
      </button>
    {/if}
    <input class="hidden" type="file" multiple accept={ACCEPT} bind:this={filePicker} onchange={picked} />
    <input class="hidden" type="file" multiple webkitdirectory bind:this={folderPicker} onchange={picked} />
  </div>

  <div class={CONTENT}>
    {#if panel && (tapeImport.active || tapeImport.total)}<TapeImportPanel onclose={() => (panel = false)} />{/if}
    <!-- No local engine here: a few free cloud minutes a day, and the desktop app for the rest -->
    {#if speech.checked && !speech.available && store.tapes.length}<DesktopAppNudge />{/if}
    <!-- Rating filters: one row that swipes sideways on narrow screens instead of wrapping -->
    <div class="flex items-center gap-1.5 overflow-x-auto overscroll-x-contain border-b border-line px-2 py-1.5 [scrollbar-width:none] sm:px-4" role="radiogroup" aria-label={TEXT.filterLabel}>
      {#each FILTERS as level (level)}
        <button class="{CHIP} {rating === level ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-muted hover:border-line-strong'}" role="radio" aria-checked={rating === level}
          onclick={() => (rating = level)}>{level === ALL_RATINGS ? TEXT.allRatings : TEXT.ratings[level]}</button>
      {/each}
      {#if transcribeLine}<span class="ml-auto min-w-0 shrink truncate pl-2 text-xs {transcriber.error ? 'text-accent' : 'text-ink-faint'}" aria-live="polite" title={transcribeLine}>{transcribeLine}</span>{/if}
    </div>
  </div>

  <div class="min-h-0 overflow-y-auto overscroll-contain">
    <div class={CONTENT}>
      {#if !tapes.length}
        <div class="flex flex-col items-center gap-3 px-6 py-16 text-center" in:fade={FADE}>
          <CassetteTape class="size-10 text-ink-faint" />
          <p class="max-w-md text-fluid-sm text-ink-muted">{TEXT.empty}</p>
          <p class="max-w-md text-xs text-ink-faint">{TEXT.dropHint}</p>
        </div>
      {:else if !matches.length}
        <p class="px-6 py-16 text-center text-sm text-ink-faint" in:fade={FADE}>{TEXT.noMatches}</p>
      {:else}
        <ul>
          {#each visible as tape (tape.id)}
            <TapeRow {tape} open={openId === tape.id} ontoggle={() => (openId = openId === tape.id ? '' : tape.id)} />
          {/each}
        </ul>
        {#if visible.length < matches.length}
          <!-- Re-made after each page, so a sentinel still in view (a tall screen) asks for the next page too -->
          {#key shown}<p class="px-4 py-4 text-center text-xs text-ink-faint" {@attach more}>{TEXT.showMore.replace('{shown}', String(visible.length)).replace('{total}', String(matches.length))}</p>{/key}
        {/if}
      {/if}
    </div>
  </div>

  <div class={CONTENT}><TapePlayerBar /></div>

  {#if dragging}
    <div class="pointer-events-none absolute inset-2 z-10 flex items-center justify-center border-2 border-dashed border-accent bg-scrim" transition:fade={FADE}>
      <p class="bg-surface px-4 py-2 text-sm font-semibold text-ink">{TEXT.dropHere}</p>
    </div>
  {/if}
</div>
