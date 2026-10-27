<script>
  // Feature requests as three columns: Requested (in the order agents will claim them), In progress, Complete.
  // Desktop and tablet: side by side, drag cards between columns. Phones: swipe sideways or tap the tabs.
  import { flip } from 'svelte/animate';
  import { fade, scale } from 'svelte/transition';
  import NoteCard from './NoteCard.svelte';
  import { store } from '../lib/store.svelte.js';
  import { STATE_STYLE } from '../lib/colors.js';
  import { FEATURE_STATES } from '../lib/models.js';

  /** @type {{ features: any[], showProject?: boolean }} */
  let { features, showProject = true } = $props();

  const DRAG_TYPE = 'text/wordsmith-note';
  const COMPLETE_PAGE = 30;
  // Same order the agent API uses for /features/next, so column order = claim order.
  const SORTS = {
    requested: (/** @type {any} */ a, /** @type {any} */ b) => b.priority - a.priority || a.created_at - b.created_at,
    in_progress: (/** @type {any} */ a, /** @type {any} */ b) => (b.started_at || 0) - (a.started_at || 0),
    complete: (/** @type {any} */ a, /** @type {any} */ b) => (b.completed_at || 0) - (a.completed_at || 0),
  };
  const EMPTY = { requested: 'Nothing queued. Add a feature above.', in_progress: 'No agent is working on anything.', complete: 'Nothing shipped yet.' };

  let dragOver = $state('');
  let activeTab = $state('requested');
  let completeLimit = $state(COMPLETE_PAGE);
  /** @type {HTMLElement | undefined} */
  let lanes = $state();

  const columns = $derived(FEATURE_STATES.map((state) => {
    const all = features.filter((note) => note.state === state).sort(SORTS[/** @type {keyof typeof SORTS} */ (state)]);
    return { state, all, shown: state === 'complete' ? all.slice(0, completeLimit) : all };
  }));

  /** @param {DragEvent} event @param {string} state */
  function ondrop(event, state) {
    event.preventDefault();
    dragOver = '';
    const id = event.dataTransfer?.getData(DRAG_TYPE);
    if (id && store.find('notes', id)?.state !== state) store.update('notes', id, { state });
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

<div class="flex h-full min-h-0 flex-col">
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

  <div bind:this={lanes} {onscroll}
    class="grid min-h-0 flex-1 snap-x snap-mandatory auto-cols-[100%] grid-flow-col gap-px overflow-x-auto overflow-y-hidden bg-line scrollbar-none md:snap-none md:auto-cols-auto md:grid-flow-row md:grid-cols-3 md:overflow-x-hidden tallscreen:grid-cols-1 tallscreen:grid-flow-row tallscreen:overflow-y-auto">
    {#each columns as column (column.state)}
      {@const style = STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (column.state)]}
      <section class="flex min-h-0 snap-start flex-col bg-app spring {dragOver === column.state ? 'bg-surface-raised' : ''}" aria-label={style.label}
        ondragover={(event) => { event.preventDefault(); dragOver = column.state; }}
        ondragleave={() => (dragOver = '')}
        ondrop={(event) => ondrop(event, column.state)}>
        <header class="hidden items-center gap-2 border-b border-line px-4 py-2.5 md:flex">
          <span class="size-2 rounded-full {style.dot}"></span>
          <h2 class="text-sm tv:text-xl font-semibold {style.text}">{style.label}</h2>
          <span class="ml-auto font-mono text-xs text-ink-faint">{column.all.length}</span>
        </header>
        <div class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto bg-line">
          {#each column.shown as note, index (note.id)}
            <div class="relative bg-app" animate:flip={{ duration: 220 }} in:fade={{ duration: 150 }}>
              {#if column.state === 'requested' && index === 0}
                <span class="absolute top-0 right-0 z-10 bg-accent px-1.5 font-mono text-[10px] text-accent-ink">next up</span>
              {/if}
              <NoteCard {note} {showProject} draggable />
            </div>
          {/each}
          {#if !column.all.length}
            <p class="flex-1 bg-app px-4 py-10 text-center text-xs text-ink-faint">{EMPTY[/** @type {keyof typeof EMPTY} */ (column.state)]}</p>
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
</div>
