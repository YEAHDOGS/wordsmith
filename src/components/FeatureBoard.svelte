<script>
  // Feature requests as board columns. The columns come from the page's board (src/lib/board.js): by default
  // Requested (in the order agents will claim them), In progress and Complete, but any number of renamed columns, each
  // playing one of those three roles. Desktop and tablet: side by side. Phones: swipe sideways or tap the tabs.
  // Hold and slide a card (or drag it with a mouse) to move it: within a Requested-role column it sets the claim order,
  // taking the priority of where it lands; into another column it moves there (and changes state if the role differs).
  // Alt+Up/Down reorders, Alt+Left/Right changes column. Each column header has a check box that selects (or clears)
  // every card in it, like the bands on the notes page.
  import { tick } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import Square from '@lucide/svelte/icons/square';
  import SquareCheck from '@lucide/svelte/icons/square-check';
  import SquareMinus from '@lucide/svelte/icons/square-minus';
  import NoteCard from './NoteCard.svelte';
  import DragGhost from './DragGhost.svelte';
  import { store } from '../lib/store.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { STATE_STYLE } from '../lib/colors.js';
  import { columnOf } from '../lib/models.js';
  import { columnsFor } from '../lib/board.js';
  import { measure, play } from '../lib/flip.js';
  import { drag, dropzone, orderKey, placeNote } from '../lib/reorder.svelte.js';

  /** @type {{ features: any[], scope: string, showProject?: boolean }} */
  let { features, scope, showProject = true } = $props();

  const COMPLETE_PAGE = 30;
  const REQUESTED = 'requested';
  const COMPLETE = 'complete';
  const BOARD_GROUP = 'board';
  const FADE_MS = 150;
  // Requested runs in claim order: priority first, then manual order (oldest first until moved), the same order the
  // agent API uses for /features/next. The other two roles follow what agents did, newest first.
  const SORTS = {
    requested: (/** @type {any} */ a, /** @type {any} */ b) => b.priority_level - a.priority_level || orderKey(a) - orderKey(b),
    in_progress: (/** @type {any} */ a, /** @type {any} */ b) => (b.started_at || 0) - (a.started_at || 0),
    complete: (/** @type {any} */ a, /** @type {any} */ b) => (b.completed_at || 0) - (a.completed_at || 0),
  };
  const EMPTY = { requested: 'Nothing queued. Add a feature above.', in_progress: 'No agent is working on anything.', complete: 'Nothing shipped yet.' };

  let activeTab = $state('');
  let completeLimit = $state(COMPLETE_PAGE);
  /** @type {HTMLElement | undefined} */
  let lanes = $state();
  /** @type {HTMLElement | undefined} */
  let root = $state();

  const boardColumns = $derived(columnsFor(scope));
  const columns = $derived(boardColumns.map((column) => {
    const all = features.filter((note) => columnOf(note, boardColumns).id === column.id).sort(SORTS[/** @type {keyof typeof SORTS} */ (column.state)]);
    return { ...column, all, shown: column.state === COMPLETE ? all.slice(0, completeLimit) : all };
  }));
  // The feature an agent would claim next: claim order across every Requested-role column.
  const nextUp = $derived(features.filter((note) => note.state === REQUESTED).sort(SORTS.requested)[0]?.id);
  const currentTab = $derived(columns.some((column) => column.id === activeTab) ? activeTab : columns[0]?.id);

  // FLIP across every column, so a card changing column slides there instead of popping. First render stays still.
  let mounted = false;
  $effect.pre(() => {
    columns;
    drag.zone;
    drag.index;
    if (!mounted) {
      mounted = true;
      return;
    }
    const before = measure(root);
    tick().then(() => play(root, before));
  });

  /** Where a note lands in a column when no slot is picked: its sorted spot in a Requested column, else the top (newest). @param {{ id: string, state: string, all: any[] }} column @param {any} note */
  function naturalIndex(column, note) {
    const rest = column.all.filter((other) => other.id !== note.id);
    if (column.state !== REQUESTED) return column.all.some((other) => other.id === note.id) ? column.all.findIndex((other) => other.id === note.id) : 0;
    const at = rest.findIndex((other) => SORTS.requested(note, other) < 0);
    return at === -1 ? rest.length : at;
  }

  /** Saves a drop into a column: its id, its state if the role differs, and the claim order in Requested columns. @param {{ id: string, state: string, all: any[] }} column @param {any} note @param {number} index */
  function drop(column, note, index) {
    const move = { column_id: column.id, ...(note.state === column.state ? {} : { state: column.state }) };
    if (column.state !== REQUESTED) {
      if (columnOf(note, boardColumns).id !== column.id) store.update('notes', note.id, move);
      return;
    }
    const list = column.all.filter((other) => other.id !== note.id);
    for (const { id, patch } of placeNote(list, note, index, true)) store.update('notes', id, id === note.id ? { ...patch, ...move } : patch);
  }

  /** The drop zone for one column. @param {{ id: string, name: string, state: string, all: any[] }} column */
  function zoneFor(column) {
    return {
      key: column.id,
      group: BOARD_GROUP,
      label: column.name,
      list: () => column.all,
      sortable: column.state === REQUESTED,
      naturalIndex: (/** @type {any} */ note) => naturalIndex(column, note),
      ondrop: (/** @type {any} */ note, /** @type {number} */ index) => drop(column, note, index),
    };
  }

  /** A column's check box: picks every card in it, or clears them when all are picked already. @param {any[]} list */
  function toggleColumn(list) {
    if (list.every((note) => ui.selected.has(note.id))) for (const note of list) ui.selected.delete(note.id);
    else ui.selectAll(list.map((note) => note.id));
  }

  /** Phones: tap a tab to slide to its lane. @param {string} id */
  function showLane(id) {
    activeTab = id;
    const index = columns.findIndex((column) => column.id === id);
    lanes?.scrollTo({ left: index * lanes.clientWidth, behavior: 'smooth' });
  }

  /** Keep the tab in step while swiping. */
  function onscroll() {
    if (!lanes) return;
    activeTab = columns[Math.round(lanes.scrollLeft / Math.max(1, lanes.clientWidth))]?.id ?? activeTab;
  }
</script>

<!-- --lanes: how many columns this board has, read by the grid templates below -->
<div class="flex h-full min-h-0 flex-col" bind:this={root} style:--lanes={columns.length}>
  <!-- Phone lane tabs -->
  <div class="grid grid-cols-[repeat(var(--lanes),minmax(0,1fr))] border-b border-line md:hidden" role="tablist" aria-label="Board columns">
    {#each columns as column (column.id)}
      {@const style = STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (column.state)]}
      <button role="tab" aria-selected={currentTab === column.id} class="spring relative truncate px-1 py-1.5 text-xs {currentTab === column.id ? style.text : 'text-ink-muted'}" onclick={() => showLane(column.id)}>
        {column.name} <span class="font-mono">{column.all.length}</span>
        {#if currentTab === column.id}<span class="absolute inset-x-0 bottom-0 h-0.5 {style.dot}" in:scale={{ duration: 150 }}></span>{/if}
      </button>
    {/each}
  </div>

  <!-- Rows are pinned to the space available (minmax(0,1fr)), so every lane ends on screen and scrolls inside itself -->
  <div bind:this={lanes} {onscroll}
    class="grid min-h-0 flex-1 snap-x snap-mandatory auto-cols-[100%] grid-flow-col grid-rows-[minmax(0,1fr)] gap-px overflow-x-auto overflow-y-hidden border-y border-line bg-line scrollbar-none sm:border md:snap-none md:auto-cols-auto md:grid-flow-row md:grid-cols-[repeat(var(--lanes),minmax(0,1fr))] md:overflow-x-hidden tallscreen:grid-cols-1 tallscreen:grid-flow-row tallscreen:grid-rows-[repeat(var(--lanes),minmax(0,1fr))]">
    {#each columns as column (column.id)}
      {@const style = STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (column.state)]}
      {@const shown = drag.arrange(column.shown, column.id)}
      {@const picked = column.all.filter((note) => ui.selected.has(note.id)).length}
      <section class="flex min-h-0 min-w-0 snap-start flex-col bg-app spring {drag.id && drag.zone === column.id ? 'bg-surface-raised' : ''}" aria-label={column.name}
        use:dropzone={zoneFor(column)}>
        <header class="hidden min-w-0 items-center gap-2 border-b border-line px-4 py-2.5 md:flex">
          <button class="spring press -m-1 p-1 disabled:opacity-40 {picked ? 'text-accent' : 'text-ink-faint hover:text-ink'}" role="checkbox" disabled={!column.all.length}
            aria-checked={picked && picked === column.all.length ? 'true' : picked ? 'mixed' : 'false'} aria-label="Select all in {column.name}" title="Select all in {column.name}" onclick={() => toggleColumn(column.all)}>
            {#if picked && picked === column.all.length}<SquareCheck class="size-3.5 tv:size-5" />{:else if picked}<SquareMinus class="size-3.5 tv:size-5" />{:else}<Square class="size-3.5 tv:size-5" />{/if}
          </button>
          <span class="size-2 shrink-0 rounded-full {style.dot}" title={style.label}></span>
          <h2 class="min-w-0 truncate text-sm tv:text-xl font-semibold {style.text}" title="{column.name} ({style.label})">{column.name}</h2>
          <span class="ml-auto font-mono text-xs text-ink-faint">{column.all.length}</span>
        </header>
        <div class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto bg-line">
          {#each shown as note (note.id)}
            <div class="relative bg-app {drag.id === note.id ? 'outline-1 -outline-offset-1 outline-dashed outline-accent' : ''}" data-flip-id={note.id}>
              {#if note.id === nextUp}
                <span class="absolute top-0 right-0 z-10 bg-accent px-1.5 font-mono text-[0.625rem] text-accent-ink" transition:scale={{ start: 0.8, duration: 150 }}>next up</span>
              {/if}
              <div class="spring h-full {drag.id === note.id ? 'opacity-40' : ''}"><NoteCard {note} {showProject} /></div>
            </div>
          {/each}
          <!-- Fills the rest of the lane; the empty message floats in it, so it fades in and out without moving anything -->
          <div class="relative flex-1 bg-app">
            {#if !shown.length}
              <p class="absolute inset-x-0 top-0 px-4 py-10 text-center text-xs text-ink-faint" transition:fade={{ duration: FADE_MS }}>{EMPTY[/** @type {keyof typeof EMPTY} */ (column.state)]}</p>
            {/if}
          </div>
          {#if column.all.length > column.shown.length}
            <button class="spring bg-app py-3 text-xs text-ink-muted hover:text-accent" onclick={() => (completeLimit += COMPLETE_PAGE)}>Show older</button>
          {/if}
        </div>
      </section>
    {/each}
  </div>
  <DragGhost {showProject} />
</div>
