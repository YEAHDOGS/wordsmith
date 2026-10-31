<script>
  // Feature requests as board columns. The columns come from the page's board (src/lib/board.js): by default
  // Requested (in the order agents will claim them), In progress and Complete, but any number of renamed columns, each
  // playing one of those three roles. Desktop and tablet: side by side. Phones: swipe sideways or tap the tabs.
  // Hold and slide a card (or drag it with a mouse) to move it: within a Requested-role column it sets the claim order,
  // taking the priority of where it lands; into another column it moves there (and changes state if the role differs).
  // Alt+Up/Down reorders, Alt+Left/Right changes column. Each column header has a check box that selects (or clears)
  // every card in it, like the bands on the notes page. In a project, cards in a note group (src/lib/groups.js) sit at the
  // top of their column, indented under the group's header, which folds them away. Each group is its own drop zone:
  // drag a card onto a group (its header too, folded or not) to put it in, or onto the rest of the column to take it out.
  import { tick } from 'svelte';
  import { fade, scale, slide } from 'svelte/transition';
  import Square from '@lucide/svelte/icons/square';
  import SquareCheck from '@lucide/svelte/icons/square-check';
  import SquareMinus from '@lucide/svelte/icons/square-minus';
  import NoteCard from './NoteCard.svelte';
  import DragGhost from './DragGhost.svelte';
  import GroupHeader from './GroupHeader.svelte';
  import { groupsIn, pruneGroups, splitByGroup } from '../lib/groups.js';
  import { store } from '../lib/store.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { RAIL_BORDER, STATE_STYLE } from '../lib/colors.js';
  import { columnOf } from '../lib/models.js';
  import { columnsFor } from '../lib/board.js';
  import { measure, play } from '../lib/flip.js';
  import { drag, dropzone, orderKey, placeNotes } from '../lib/reorder.svelte.js';

  /** @type {{ features: any[], scope: string, showProject?: boolean }} */
  let { features, scope, showProject = true } = $props();

  const COMPLETE_PAGE = 30;
  const REQUESTED = 'requested';
  const COMPLETE = 'complete';
  const BOARD_GROUP = 'board';
  const FADE_MS = 150;
  const FOLD_MS = 200;
  // Drop zone key of a note group inside a column: column id, this, group id.
  const GROUP_KEY = '|group:';
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
  // Groups belong to a project; the all-projects Features page (scope FEATURES_SCOPE) has none.
  const noteGroups = $derived(groupsIn(scope));
  const groupIds = $derived(new Set(noteGroups.map((group) => group.id)));
  const groupTotals = $derived(new Map(noteGroups.map((group) => [group.id, features.filter((note) => note.group_id === group.id).length])));
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

  /** A column's notes in one note group, or (null) in none of them. @param {{ all: any[] }} column @param {string | null} groupId */
  function membersOf(column, groupId) {
    return column.all.filter((note) => (groupIds.has(note.group_id) ? note.group_id : null) === groupId);
  }

  /** Where a note lands in a list when no slot is picked: its sorted spot in a Requested column, else the top (newest). @param {any[]} list @param {string} state @param {any} note */
  function naturalIndex(list, state, note) {
    const rest = list.filter((other) => other.id !== note.id);
    if (state !== REQUESTED) return Math.max(0, list.findIndex((other) => other.id === note.id));
    const at = rest.findIndex((other) => SORTS.requested(note, other) < 0);
    return at === -1 ? rest.length : at;
  }

  /**
   * Saves a drop into a column, inside one of its note groups or (null) outside them: its column, its state if the role
   * differs, its group if that changes (a group left empty goes), and the claim order in Requested columns.
   * Several selected cards dropped together move as one block, in the order they were shown.
   * @param {{ id: string, state: string, all: any[] }} column @param {any[]} notes @param {number} index @param {string | null} groupId
   */
  function drop(column, notes, index, groupId) {
    /** @type {Map<string, Record<string, any>>} */
    const moves = new Map();
    /** @type {(string | null)[]} */
    const leftGroups = [];
    for (const note of notes) {
      const leftGroup = groupIds.has(note.group_id) ? note.group_id : null;
      const changed = columnOf(note, boardColumns).id !== column.id || note.state !== column.state || leftGroup !== groupId;
      moves.set(note.id, changed ? {
        column_id: column.id,
        ...(note.state === column.state ? {} : { state: column.state }),
        ...(leftGroup === groupId ? {} : { group_id: groupId }),
      } : {});
      if (leftGroup !== groupId) leftGroups.push(leftGroup);
    }
    // Requested columns keep the claim order, so the block is placed there; other columns sort by time.
    const writes = column.state === REQUESTED
      ? placeNotes(membersOf(column, groupId).filter((other) => !moves.has(other.id)), notes, index, true)
      : [];
    for (const note of notes) if (!writes.some((write) => write.id === note.id)) writes.push({ id: note.id, patch: {} });
    for (const { id, patch } of writes) {
      const change = { ...patch, ...moves.get(id) };
      if (Object.keys(change).length) store.update('notes', id, change);
    }
    if (leftGroups.length) pruneGroups(leftGroups);
  }

  /**
   * The drop zone for a column's ungrouped cards (the whole column, groups aside), or with a group, for that group's
   * cards in the column. Group zones sit inside the column's, so the card under the pointer decides which one takes it.
   * @param {{ id: string, name: string, state: string, all: any[] }} column @param {any} [group]
   */
  function zoneFor(column, group = null) {
    const groupId = group?.id ?? null;
    return {
      key: group ? column.id + GROUP_KEY + group.id : column.id,
      // Only the column zones are side by side; Alt+Left/Right from a group's card hops columns through its column.
      group: group ? undefined : BOARD_GROUP,
      label: group ? `${group.name} in ${column.name}` : column.name,
      list: () => membersOf(column, groupId),
      sortable: column.state === REQUESTED,
      naturalIndex: (/** @type {any} */ note) => naturalIndex(membersOf(column, groupId), column.state, note),
      ondrop: (/** @type {any[]} */ notes, /** @type {number} */ index) => drop(column, notes, index, groupId),
    };
  }

  /**
   * One column as it looks right now, drag preview included: each note group with cards here (or the card being dragged
   * over it), then the ungrouped rest. A group keeps its header while its last card is dragged out, so it can come back.
   * @param {{ id: string, shown: any[] }} column
   */
  function laneOf(column) {
    const split = splitByGroup(column.shown, noteGroups);
    const groups = noteGroups.map((group) => {
      const own = split.members.get(group.id) ?? [];
      return { group, own, members: drag.arrange(own, column.id + GROUP_KEY + group.id) };
    }).filter((entry) => entry.own.length || entry.members.length);
    const rest = drag.arrange(split.rest, column.id);
    return { groups, rest, count: rest.length + groups.reduce((sum, entry) => sum + entry.members.length, 0) };
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

{#snippet card(/** @type {any} */ note)}
  <div class="relative bg-app {drag.carries(note.id) ? 'outline-1 -outline-offset-1 outline-dashed outline-accent' : ''}" data-flip-id={note.id}>
    <div class="spring h-full {drag.carries(note.id) ? 'opacity-40' : ''}"><NoteCard {note} {showProject} /></div>
  </div>
{/snippet}

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
      {@const lane = laneOf(column)}
      {@const picked = column.all.filter((note) => ui.selected.has(note.id)).length}
      <section class="flex min-h-0 min-w-0 snap-start flex-col bg-app spring {drag.id && (drag.zone === column.id || drag.zone.startsWith(column.id + GROUP_KEY)) ? 'bg-surface-raised' : ''}" aria-label={column.name}
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
          {#each lane.groups as { group, own, members } (group.id)}
            {@const over = drag.id && drag.zone === column.id + GROUP_KEY + group.id}
            <!-- One drop zone per group, header included; its cards sit indented behind a rail in the group's color -->
            <div class="flex flex-col gap-px" use:dropzone={zoneFor(column, group)}>
              <GroupHeader {group} column={column.id} notes={own} total={groupTotals.get(group.id) ?? own.length} class="spring px-3 py-1.5 text-xs tv:px-4 tv:text-base {over ? 'bg-surface-raised' : 'bg-app'}" />
              <!-- Each column folds its own copy of the group -->
              {#if !(group.folded_columns ?? []).includes(column.id)}
                <div class="bg-app pl-3 tv:pl-5" transition:slide={{ duration: FOLD_MS }}>
                  <div class="flex flex-col gap-px border-l-2 bg-line {RAIL_BORDER[/** @type {keyof typeof RAIL_BORDER} */ (group.color)] || RAIL_BORDER.default}">
                    {#each members as note (note.id)}{@render card(note)}{/each}
                  </div>
                </div>
              {/if}
            </div>
          {/each}
          {#each lane.rest as note (note.id)}{@render card(note)}{/each}
          <!-- Fills the rest of the lane; the empty message floats in it, so it fades in and out without moving anything -->
          <div class="relative flex-1 bg-app">
            {#if !lane.count}
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
