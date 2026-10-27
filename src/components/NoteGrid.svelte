<script>
  // Notes as a staggered masonry (Google Keep style): two columns on phones, more as the screen widens.
  // Reading order runs left to right; each note goes into the currently shortest column. Heights are estimated from
  // content, not measured, so cards never jump after they render. Sort by updated, created, or group by project.
  import { flip } from 'svelte/animate';
  import { scale } from 'svelte/transition';
  import CheckCheck from '@lucide/svelte/icons/check-check';
  import NoteCard from './NoteCard.svelte';
  import { store } from '../lib/store.svelte.js';
  import { ui, SORTS } from '../lib/ui.svelte.js';
  import { reveal } from '../lib/reveal.js';

  /** @type {{ notes: any[], showProject?: boolean, empty?: string }} */
  let { notes, showProject = true, empty = 'Nothing here yet.' } = $props();

  const GAP_PX = 8;
  const MIN_COLUMN_PX = 160;
  const TV_MIN_COLUMN_PX = 300;
  const TV_WIDTH_PX = 1920;
  const MAX_COLUMNS = 8;
  // Rough type metrics for the card (see NoteCard): chars per px of width, line heights, fixed chrome.
  const CHAR_PX = 7.2;
  const TITLE_LINE_PX = 22;
  const BODY_LINE_PX = 21;
  const BODY_MAX_LINES = 10;
  const CARD_CHROME_PX = 64;
  const CARD_MIN_PX = 112;
  const META_ROW_PX = 26;
  const COVER_RATIO = 9 / 16;
  const SORT_LABELS = { updated: 'Updated', created: 'Created', project: 'Project' };
  const NO_PROJECT = 'No project';

  let width = $state(0);
  const columnCount = $derived.by(() => {
    const min = width >= TV_WIDTH_PX ? TV_MIN_COLUMN_PX : MIN_COLUMN_PX;
    return Math.max(1, Math.min(MAX_COLUMNS, Math.floor((width + GAP_PX) / (min + GAP_PX))));
  });
  const columnWidth = $derived((width - GAP_PX * (columnCount - 1)) / columnCount);
  const sortOptions = $derived(SORTS.filter((sort) => showProject || sort !== 'project'));
  const sort = $derived(!showProject && ui.sort === 'project' ? 'updated' : ui.sort);

  /** @param {any} note */
  function projectName(note) {
    return (note.project_id && store.find('projects', note.project_id)?.name) || NO_PROJECT;
  }

  const sorted = $derived.by(() => {
    const byTime = sort === 'created' ? (/** @type {any} */ a, /** @type {any} */ b) => b.created_at - a.created_at : (/** @type {any} */ a, /** @type {any} */ b) => b.updated_at - a.updated_at;
    if (sort !== 'project') return [...notes].sort(byTime);
    return [...notes].sort((a, b) => {
      const [nameA, nameB] = [projectName(a), projectName(b)];
      if (nameA !== nameB) return nameA === NO_PROJECT ? 1 : nameB === NO_PROJECT ? -1 : nameA.localeCompare(nameB);
      return byTime(a, b);
    });
  });

  /** Pinned first, then either one "Others" band or one band per project. */
  const sections = $derived.by(() => {
    const pinned = sorted.filter((note) => note.pinned);
    const rest = sorted.filter((note) => !note.pinned);
    /** @type {{ key: string, title: string, notes: any[] }[]} */
    const list = [];
    if (pinned.length) list.push({ key: 'pinned', title: 'Pinned', notes: pinned });
    if (sort === 'project') {
      for (const note of rest) {
        const name = projectName(note);
        if (list.at(-1)?.key !== `project:${name}`) list.push({ key: `project:${name}`, title: name, notes: [] });
        list.at(-1)?.notes.push(note);
      }
    } else if (rest.length) {
      list.push({ key: 'others', title: pinned.length ? 'Others' : '', notes: rest });
    }
    return list;
  });

  /** Estimated rendered height of a card at the current column width. @param {any} note */
  function estimate(note) {
    const chars = Math.max(12, columnWidth / CHAR_PX);
    let height = CARD_CHROME_PX;
    if (note.title) height += TITLE_LINE_PX * Math.ceil(note.title.length / chars);
    if (note.body) {
      const lines = note.body.split('\n').reduce((/** @type {number} */ total, /** @type {string} */ line) => total + Math.max(1, Math.ceil(line.length / chars)), 0);
      height += BODY_LINE_PX * Math.min(BODY_MAX_LINES, lines);
    }
    if (store.attachmentsFor(note.id).length) height += columnWidth * COVER_RATIO;
    if (note.kind === 'feature' || note.label_ids.length || (showProject && note.project_id)) height += META_ROW_PX;
    if (note.kind === 'feature' && note.status) height += BODY_LINE_PX;
    return Math.max(CARD_MIN_PX, height);
  }

  /** Greedy masonry: each note into the shortest column so far. @param {any[]} list */
  function columnsFor(list) {
    const columns = Array.from({ length: columnCount }, () => ({ height: 0, notes: /** @type {any[]} */ ([]) }));
    for (const note of list) {
      const shortest = columns.reduce((best, column) => (column.height < best.height ? column : best), columns[0]);
      shortest.notes.push(note);
      shortest.height += estimate(note) + GAP_PX;
    }
    return columns.map((column) => column.notes);
  }
</script>

<div bind:clientWidth={width} class="px-2 sm:px-0">
  {#if notes.length}
    <div class="flex items-center justify-end gap-2 pt-2 pb-1">
      <button class="spring press mr-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap border border-line px-2.5 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
        onclick={() => ui.selectAll(notes.map((note) => note.id))} title="Select every note here to copy or archive them together">
        <CheckCheck class="size-3.5" />Select all
      </button>
      <span class="hidden font-mono text-[11px] uppercase tracking-widest text-ink-faint sm:inline">Sort</span>
      <div class="flex gap-px border border-line bg-line" role="radiogroup" aria-label="Sort notes">
        {#each sortOptions as option (option)}
          <button role="radio" aria-checked={sort === option} onclick={() => ui.setSort(option)}
            class="spring press px-2.5 py-1 text-xs {sort === option ? 'bg-accent-soft text-ink' : 'bg-app text-ink-muted hover:text-ink'}">{SORT_LABELS[option]}</button>
        {/each}
      </div>
    </div>
  {/if}

  {#if !notes.length}
    <p class="px-4 py-16 text-center text-fluid-sm text-ink-faint">{empty}</p>
  {:else}
    {#each sections as section (section.key)}
      {#if section.title}
        <h2 class="pt-4 pb-2 font-mono text-[11px] tv:text-sm uppercase tracking-widest text-ink-faint">{section.title} <span class="text-ink-faint">· {section.notes.length}</span></h2>
      {/if}
      <div class="flex items-start gap-2">
        {#each columnsFor(section.notes) as column, columnIndex (columnIndex)}
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            {#each column as note, index (note.id)}
              <div class="overflow-hidden border border-line bg-app hover:border-line-strong spring" animate:flip={{ duration: 200 }} in:scale={{ start: 0.96, duration: 150 }} use:reveal={index * columnCount + columnIndex}>
                <NoteCard {note} {showProject} />
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>
