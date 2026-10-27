<script>
  // Feature requests as three columns: Requested (in the order agents will claim them), In progress, Complete.
  // Desktop and tablet: side by side. Phones: swipe sideways or tap the tabs.
  // Hold and slide a card (or drag it with a mouse) to move it: within Requested it sets the claim order, taking the
  // priority of where it lands; into another column it changes state. Alt+Up/Down reorders, Alt+Left/Right changes column.
  import { tick } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import NoteCard from './NoteCard.svelte';
  import DragGhost from './DragGhost.svelte';
  import { store } from '../lib/store.svelte.js';
  import { STATE_STYLE } from '../lib/colors.js';
  import { FEATURE_STATES } from '../lib/models.js';
  import { measure, play } from '../lib/flip.js';
  import { drag, dropzone, orderKey, placeNote } from '../lib/reorder.svelte.js';

  /** @type {{ features: any[], showProject?: boolean }} */
  let { features, showProject = true } = $props();

  const COMPLETE_PAGE = 30;
  const REQUESTED = 'requested';
  const BOARD_GROUP = 'board';
  // Requested runs in claim order: priority first, then manual order (oldest first until moved), the same order the
  // agent API uses for /features/next. The other two columns follow what agents did, newest first.
  const SORTS = {
    requested: (/** @type {any} */ a, /** @type {any} */ b) => b.priority - a.priority || orderKey(a) - orderKey(b),
    in_progress: (/** @type {any} */ a, /** @type {any} */ b) => (b.started_at || 0) - (a.started_at || 0),
    complete: (/** @type {any} */ a, /** @type {any} */ b) => (b.completed_at || 0) - (a.completed_at || 0),
  };
  const EMPTY = { requested: 'Nothing queued. Add a feature above.', in_progress: 'No agent is working on anything.', complete: 'Nothing shipped yet.' };

  let activeTab = $state(REQUESTED);
  let completeLimit = $state(COMPLETE_PAGE);
  /** @type {HTMLElement | undefined} */
  let lanes = $state();
  /** @type {HTMLElement | undefined} */
  let root = $state();

  const columns = $derived(FEATURE_STATES.map((state) => {
    const all = features.filter((note) => note.state === state).sort(SORTS[/** @type {keyof typeof SORTS} */ (state)]);
    return { state, all, shown: state === 'complete' ? all.slice(0, completeLimit) : all };
  }));

  // FLIP across all three columns, so a card changing column slides there instead of popping. First render stays still.
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

  /** Where a note lands in a column when no slot is picked: its sorted spot in Requested, else the top (newest). @param {{ state: string, all: any[] }} column @param {any} note */
  function naturalIndex(column, note) {
    const rest = column.all.filter((other) => other.id !== note.id);
    if (column.state !== REQUESTED) return note.state === column.state ? column.all.findIndex((other) => other.id === note.id) : 0;
    const at = rest.findIndex((other) => SORTS.requested(note, other) < 0);
    return at === -1 ? rest.length : at;
  }

  /** Saves a drop into a column. @param {{ state: string, all: any[] }} column @param {any} note @param {number} index */
  function drop(column, note, index) {
    const state = note.state === column.state ? {} : { state: column.state };
    if (column.state !== REQUESTED) {
      if (note.state !== column.state) store.update('notes', note.id, state);
      return;
    }
    const list = column.all.filter((other) => other.id !== note.id);
    for (const { id, patch } of placeNote(list, note, index, true)) store.update('notes', id, id === note.id ? { ...patch, ...state } : patch);
  }

  /** The drop zone for one column. @param {{ state: string, all: any[] }} column */
  function zoneFor(column) {
    return {
      key: column.state,
      group: BOARD_GROUP,
      label: STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (column.state)].label,
      list: () => column.all,
      sortable: column.state === REQUESTED,
      naturalIndex: (/** @type {any} */ note) => naturalIndex(column, note),
      ondrop: (/** @type {any} */ note, /** @type {number} */ index) => drop(column, note, index),
    };
  }

  /** Phones: tap a tab to slide to its lane. @param {string} state */
  function showLane(state) {
    activeTab = state;
    const index = FEATURE_STATES.indexOf(state);
    lanes?.scrollTo({ left: index * lanes.clientWidth, behavior: 'smooth' });
  }

  /** Keep the tab in step while swiping. */
  function onscroll() {
    if (!lanes) return;
    activeTab = FEATURE_STATES[Math.round(lanes.scrollLeft / Math.max(1, lanes.clientWidth))] ?? activeTab;
  }
</script>

<div class="flex h-full min-h-0 flex-col" bind:this={root}>
  <!-- Phone lane tabs -->
  <div class="grid grid-cols-3 border-b border-line md:hidden" role="tablist" aria-label="Feature states">
    {#each columns as column (column.state)}
      {@const style = STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (column.state)]}
      <button role="tab" aria-selected={activeTab === column.state} class="spring relative py-2 text-xs {activeTab === column.state ? style.text : 'text-ink-muted'}" onclick={() => showLane(column.state)}>
        {style.label} <span class="font-mono">{column.all.length}</span>
        {#if activeTab === column.state}<span class="absolute inset-x-0 bottom-0 h-0.5 {style.dot}" in:scale={{ duration: 150 }}></span>{/if}
      </button>
    {/each}
  </div>

  <!-- Rows are pinned to the space available (minmax(0,1fr)), so every lane ends on screen and scrolls inside itself -->
  <div bind:this={lanes} {onscroll}
    class="grid min-h-0 flex-1 snap-x snap-mandatory auto-cols-[100%] grid-flow-col grid-rows-[minmax(0,1fr)] gap-px overflow-x-auto overflow-y-hidden border-y border-line bg-line scrollbar-none sm:border md:snap-none md:auto-cols-auto md:grid-flow-row md:grid-cols-3 md:overflow-x-hidden tallscreen:grid-cols-1 tallscreen:grid-flow-row tallscreen:grid-rows-3">
    {#each columns as column (column.state)}
      {@const style = STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (column.state)]}
      {@const shown = drag.arrange(column.shown, column.state)}
      <section class="flex min-h-0 snap-start flex-col bg-app spring {drag.id && drag.zone === column.state ? 'bg-surface-raised' : ''}" aria-label={style.label}
        use:dropzone={zoneFor(column)}>
        <header class="hidden items-center gap-2 border-b border-line px-4 py-2.5 md:flex">
          <span class="size-2 rounded-full {style.dot}"></span>
          <h2 class="text-sm tv:text-xl font-semibold {style.text}">{style.label}</h2>
          <span class="ml-auto font-mono text-xs text-ink-faint">{column.all.length}</span>
        </header>
        <div class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto bg-line">
          {#each shown as note, index (note.id)}
            <div class="relative bg-app {drag.id === note.id ? 'outline-1 -outline-offset-1 outline-dashed outline-accent' : ''}" data-flip-id={note.id}>
              {#if column.state === REQUESTED && index === 0}
                <span class="absolute top-0 right-0 z-10 bg-accent px-1.5 font-mono text-[10px] text-accent-ink" transition:scale={{ start: 0.8, duration: 150 }}>next up</span>
              {/if}
              <div class="spring h-full {drag.id === note.id ? 'opacity-40' : ''}"><NoteCard {note} {showProject} /></div>
            </div>
          {/each}
          {#if !shown.length}
            <p in:fade={{ duration: 150 }} class="flex-1 bg-app px-4 py-10 text-center text-xs text-ink-faint">{EMPTY[/** @type {keyof typeof EMPTY} */ (column.state)]}</p>
          {:else}
            <div class="flex-1 bg-app"></div>
          {/if}
          {#if column.all.length > column.shown.length}
            <button class="spring bg-app py-3 text-xs text-ink-muted hover:text-accent" onclick={() => (completeLimit += COMPLETE_PAGE)}>Show older</button>
          {/if}
        </div>
      </section>
    {/each}
  </div>
  <DragGhost {showProject} />
</div>
