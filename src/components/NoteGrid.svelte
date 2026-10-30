<script>
  // Notes as a staggered masonry (Google Keep style): two columns on phones, more as the screen widens.
  // Toolbar: select all, then three toggles: order, grouping, and a feature-state filter (All, Requested, In progress,
  // Complete) that shows up once the list holds features.
  // Reading order runs left to right; each note goes into the currently shortest column. Heights are estimated from
  // content, not measured, so cards never jump after they render. Two toggles: the order (newest updated, newest
  // created, highest priority, or manual) and grouping by nothing, project, or season (winter is December to February).
  // Hold and slide a card to move it: each band is a drop zone (src/lib/reorder.svelte.js); a drop in a time order
  // switches to manual so it sticks. Every reorder, sort change and resize slides cards with FLIP.
  // Inside a project, its note groups (src/lib/groups.js) come right after Pinned, one band each, and fold away under their header.
  import { tick, untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import { router } from '../lib/router.svelte.js';
  import CheckCheck from '@lucide/svelte/icons/check-check';
  import NoteCard from './NoteCard.svelte';
  import DragGhost from './DragGhost.svelte';
  import GroupHeader from './GroupHeader.svelte';
  import { groupsIn, pruneGroups, splitByGroup } from '../lib/groups.js';
  import { store } from '../lib/store.svelte.js';
  import ArrowDownWideNarrow from '@lucide/svelte/icons/arrow-down-wide-narrow';
  import Layers from '@lucide/svelte/icons/layers';
  import Square from '@lucide/svelte/icons/square';
  import SquareCheck from '@lucide/svelte/icons/square-check';
  import SquareMinus from '@lucide/svelte/icons/square-minus';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import { ui, GROUPS, ORDERS, STATE_FILTERS, TIME_ORDERS } from '../lib/ui.svelte.js';
  import { RAIL_BORDER, STATE_STYLE } from '../lib/colors.js';
  import { reveal } from '../lib/reveal.js';
  import { measure, play } from '../lib/flip.js';
  import { drag, dropzone, orderKey, placeNotes, respace } from '../lib/reorder.svelte.js';

  /** @type {{ notes: any[], showProject?: boolean, empty?: string, projectId?: string | null }} */
  let { notes, showProject = true, empty = 'Nothing here yet.', projectId = null } = $props();

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
  // Card titles clamp at this many lines (NoteCard's line-clamp-4).
  const TITLE_MAX_LINES = 4;
  // While a card is dragged the others glide slower, so the preview reads as calm rather than twitchy.
  const DRAG_MOVE_MS = 400;
  const CARD_CHROME_PX = 64;
  const CARD_MIN_PX = 112;
  const META_ROW_PX = 26;
  const COVER_RATIO = 9 / 16;
  const ORDER_LABELS = { updated: 'Updated', created: 'Created', priority: 'Priority', manual: 'Manual' };
  const ORDER_HINTS = {
    updated: 'Newest updated first',
    created: 'Newest created first',
    priority: 'Highest priority first, then your order',
    manual: 'Your order: hold a note and slide it, or Alt+Arrow keys',
  };
  /** @type {Record<string, (a: any, b: any) => number>} */
  const COMPARE = {
    updated: (a, b) => b.updated_at - a.updated_at,
    created: (a, b) => b.created_at - a.created_at,
    priority: (a, b) => b.priority_level - a.priority_level || orderKey(a) - orderKey(b),
    manual: (a, b) => orderKey(a) - orderKey(b),
  };
  const GROUP_LABELS = { all: 'All', project: 'Projects', season: 'Seasons' };
  // Month index (0 = January) -> season. Winter runs December through February.
  const SEASONS = ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Fall', 'Fall', 'Fall', 'Winter'];
  const DECEMBER = 11;
  // Toolbar toggles: equal columns at one height. Phones split the row (labels truncate); from sm up every toggle takes
  // the width of the widest one's longest label, so cycling a label never resizes it or its neighbours.
  const TOGGLE = 'spring press flex h-8 min-w-0 items-center justify-center gap-1.5 bg-app px-2 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink sm:px-2.5 tv:h-11 tv:text-base';
  const NO_PROJECT = 'No project';
  const STATE_FILTER_LABELS = { all: 'All', requested: STATE_STYLE.requested.label, in_progress: STATE_STYLE.in_progress.label, complete: STATE_STYLE.complete.label };
  const FILTERED_EMPTY = 'No features in this state.';
  const GROUP_PREFIX = 'group:';
  const FOLD_MS = 200;
  // How far a group's notes sit in from the ungrouped ones, with a rail in the group's color on the left.
  const GROUP_INDENT = 'ml-1.5 border-l-2 pl-2.5 sm:pl-4 tv:pl-6';

  let width = $state(0);
  const columnCount = $derived.by(() => {
    const min = width >= TV_WIDTH_PX ? TV_MIN_COLUMN_PX : MIN_COLUMN_PX;
    return Math.max(1, Math.min(MAX_COLUMNS, Math.floor((width + GAP_PX) / (min + GAP_PX))));
  });
  const columnWidth = $derived((width - GAP_PX * (columnCount - 1)) / columnCount);
  // Inside one project, grouping by project means nothing, so that step is skipped.
  const groupOptions = $derived(GROUPS.filter((option) => showProject || option !== 'project'));
  const group = $derived(groupOptions.includes(/** @type {any} */ (ui.group)) ? ui.group : 'all');
  // Seasons follow the edit time only in "updated" order; otherwise creation, which a drop never changes.
  const timeField = $derived(ui.order === 'updated' ? 'updated_at' : 'created_at');
  /** @type {HTMLElement | undefined} */
  let root = $state();

  /** "Winter 2025–26", "Spring 2026" for a timestamp. @param {number} at */
  function seasonOf(at) {
    const date = new Date(at);
    const month = date.getMonth();
    const year = date.getFullYear();
    if (SEASONS[month] !== 'Winter') return `${SEASONS[month]} ${year}`;
    const start = month === DECEMBER ? year : year - 1;
    return `Winter ${start}–${String(start + 1).slice(-2)}`;
  }

  /** @param {any} note */
  function projectName(note) {
    return (note.project_id && store.find('projects', note.project_id)?.name) || NO_PROJECT;
  }

  const noteGroups = $derived(groupsIn(projectId));
  const groupIds = $derived(new Set(noteGroups.map((row) => row.id)));
  // Every live note in each group, before the state filter: the header's total.
  const groupTotals = $derived(new Map(noteGroups.map((row) => [row.id, notes.filter((note) => note.group_id === row.id).length])));

  /** Band an unpinned note sits in outside any note group: Others, its project, or its season. @param {any} note */
  function looseBand(note) {
    if (group === 'all') return 'others';
    return `${group}:${group === 'project' ? projectName(note) : seasonOf(note[timeField])}`;
  }

  // The state filter only matters once there are features to filter; it stays visible while set, so it can be undone.
  const hasFeatures = $derived(ui.stateFilter !== 'all' || notes.some((note) => note.kind === 'feature'));
  const shown = $derived(notes.filter((note) => ui.showsState(note)));

  const naturalOrder = $derived.by(() => {
    const compare = COMPARE[ui.order] ?? COMPARE.updated;
    if (group !== 'project') return [...shown].sort(compare);
    return [...shown].sort((a, b) => {
      const [nameA, nameB] = [projectName(a), projectName(b)];
      if (nameA !== nameB) return nameA === NO_PROJECT ? 1 : nameB === NO_PROJECT ? -1 : nameA.localeCompare(nameB);
      return compare(a, b);
    });
  });

  // While a note is open in the editor the grid keeps the order it had when the note opened, so editing doesn't send
  // the note to the top behind the editor. Closing it releases the order and the FLIP below slides it to its new place,
  // so you see where it was and where it went. Notes that appear meanwhile go first.
  /** @type {Map<string, number> | null} */
  let frozenRanks = $state(null);
  $effect.pre(() => {
    const open = Boolean(router.route.note);
    if (open && !frozenRanks) frozenRanks = new Map(untrack(() => naturalOrder).map((note, index) => [note.id, index]));
    else if (!open && frozenRanks) frozenRanks = null;
  });
  const sorted = $derived(frozenRanks
    ? [...naturalOrder].sort((a, b) => (frozenRanks?.get(a.id) ?? -1) - (frozenRanks?.get(b.id) ?? -1))
    : naturalOrder);

  /** Pinned first, then each note group, then one "Others" band, or one band per project or per season. */
  const sections = $derived.by(() => {
    const { members, rest: ungrouped } = splitByGroup(sorted, noteGroups);
    const pinned = ungrouped.filter((note) => note.pinned);
    const rest = ungrouped.filter((note) => !note.pinned);
    /** @type {{ key: string, title: string, notes: any[], group?: any }[]} */
    const list = [];
    if (pinned.length) list.push({ key: 'pinned', title: 'Pinned', notes: pinned });
    for (const row of noteGroups) {
      const inGroup = members.get(row.id) ?? [];
      if (inGroup.length) list.push({ key: GROUP_PREFIX + row.id, title: row.name, notes: inGroup, group: row });
    }
    if (group !== 'all') {
      // Notes arrive already ordered by project or by time, so each band is one consecutive run.
      // In priority or manual order seasons can interleave, so bands are gathered by key instead.
      /** @type {Map<string, { key: string, title: string, notes: any[] }>} */
      const bands = new Map();
      for (const note of rest) {
        const key = looseBand(note);
        if (!bands.has(key)) bands.set(key, { key, title: key.slice(group.length + 1), notes: [] });
        bands.get(key)?.notes.push(note);
      }
      const ordered = [...bands.values()];
      // Seasons run newest first whatever the order inside them.
      if (group === 'season') ordered.sort((a, b) => Math.max(...b.notes.map((note) => note[timeField])) - Math.max(...a.notes.map((note) => note[timeField])));
      list.push(...ordered);
    } else if (rest.length) {
      list.push({ key: 'others', title: list.length ? 'Others' : '', notes: rest });
    }
    return list;
  });

  // FLIP: note where every card is before the DOM changes, slide them after. Covers sorting, regrouping, syncs,
  // resizes and the live preview while a card is dragged. The first render is left to the reveal action.
  // The first render waits for the grid's width: before it's measured every card would sit in one column, and the next
  // layout would FLIP them all across the page (the jump on page changes).
  let mounted = false;
  $effect.pre(() => {
    sections;
    columnCount;
    drag.zone;
    drag.index;
    drag.anchor;
    if (!width) return;
    if (!mounted) {
      mounted = true;
      return;
    }
    const before = measure(root);
    const duration = drag.id ? DRAG_MOVE_MS : undefined;
    tick().then(() => play(root, before, duration));
  });

  /**
   * Saves a drop. Into the pinned band pins the note; out of it unpins. Into a note group's band puts it in that group
   * (pinned or not); into any other band takes it out of its group, and a group left empty goes. In a time order the slot was picked among notes
   * sorted by time, so the note goes right after the one shown before it (or before the one shown after it, at the
   * top) in manual order, and only then does the grid switch to manual so the drop sticks. Picking a card up,
   * cancelling, or letting go on its own slot never reaches here, so none of those touch the chosen sort.
   * Priority order only moves features between levels: plain notes have no priority control to undo it.
   * Several selected notes dropped together go in as one block, in the order they were shown, each taking its own pin
   * and group change.
   * @param {{ key: string, notes: any[] }} section @param {any[]} notes @param {number} index
   */
  function drop(section, notes, index) {
    const moving = new Set(notes.map((note) => note.id));
    const others = section.notes.filter((other) => !moving.has(other.id));
    const groupId = section.group?.id ?? null;
    const timeOrder = TIME_ORDERS.includes(/** @type {any} */ (ui.order));
    const list = timeOrder ? [...others].sort(COMPARE.manual) : others;
    const [before, after] = [others[index - 1], others[index]];
    const slot = !timeOrder ? index : before ? list.indexOf(before) + 1 : after ? list.indexOf(after) : list.length;
    // Each dropped note's own write also carries its pin and group, when those change.
    /** @type {Map<string, Record<string, any>>} */
    const own = new Map();
    /** @type {(string | null)[]} */
    const leftGroups = [];
    for (const note of notes) {
      const pinned = section.group ? Boolean(note.pinned) : section.key === 'pinned';
      const leftGroup = groupIds.has(note.group_id) ? note.group_id : null;
      own.set(note.id, {
        ...(Boolean(note.pinned) !== pinned ? { pinned } : {}),
        // Compared with the group shown here, so a drop on a page without groups never ungroups a note.
        ...(leftGroup !== groupId ? { group_id: groupId } : {}),
      });
      if (leftGroup !== groupId) leftGroups.push(leftGroup);
    }
    // A masonry drop saves the whole order the preview showed, so the note stays in the column it was dropped in.
    // Priority order moves only features between levels: plain notes have no priority control to undo it.
    const shown = previewOrder(section);
    const writes = shown ? respace(shown) : placeNotes(list, notes, slot, (note) => ui.order === 'priority' && note.kind === 'feature');
    for (const note of notes) if (!writes.some((write) => write.id === note.id)) writes.push({ id: note.id, patch: {} });
    for (const { id, patch } of writes) {
      const change = { ...patch, ...own.get(id) };
      if (Object.keys(change).length) store.update('notes', id, change);
    }
    if (leftGroups.length) pruneGroups(leftGroups);
    if (timeOrder) ui.setOrder('manual');
  }

  /** The drop zone for one band. @param {{ key: string, title: string, notes: any[] }} section */
  function zoneFor(section) {
    return {
      key: section.key,
      label: section.title || 'notes',
      list: () => section.notes,
      // Notes move freely in and out of note groups and Pinned; a project or season band only takes its own.
      accepts: (/** @type {any} */ note) => Boolean(section.group) || section.key === 'pinned' || looseBand(note) === section.key,
      ondrop: (/** @type {any[]} */ notes, /** @type {number} */ index) => drop(section, notes, index),
      unchanged: () => previewOrder(section)?.every((note, index) => section.notes[index]?.id === note.id),
    };
  }

  /** A band's check box: picks every note in it, or clears them when all are picked already. @param {any[]} list */
  function toggleBand(list) {
    if (list.every((note) => ui.selected.has(note.id))) for (const note of list) ui.selected.delete(note.id);
    else ui.selectAll(list.map((note) => note.id));
  }

  /** Estimated rendered height of a card at the current column width. @param {any} note */
  function estimate(note) {
    const chars = Math.max(12, columnWidth / CHAR_PX);
    let height = CARD_CHROME_PX;
    if (note.title) height += TITLE_LINE_PX * Math.min(TITLE_MAX_LINES, Math.ceil(note.title.length / chars));
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

  /**
   * The order a section takes while a card is dragged over it, or null to use the plain slot. The other cards keep the
   * columns they had and the carried ones open a gap beside the card under the pointer, in its column; the order is
   * then interleaved so the shortest-column layout rebuilds exactly those columns, and saving it keeps them after the drop.
   * Priority order is left to the plain slot: it re-sorts by level anyway.
   * @param {{ key: string, notes: any[] }} section
   */
  function previewOrder(section) {
    const anchor = drag.anchor;
    if (drag.zone !== section.key || !anchor || ui.order === 'priority') return null;
    const arranged = drag.arrange(section.notes, section.key);
    const start = Math.min(drag.index, arranged.length - drag.taking);
    const block = arranged.slice(start, start + drag.taking);
    const moving = new Set(block.map((note) => note.id));
    const columns = columnsFor(section.notes).map((column) => column.filter((note) => !moving.has(note.id)));
    const column = columns.find((notes) => notes.some((note) => note.id === anchor.id));
    if (!column) return null;
    column.splice(column.findIndex((note) => note.id === anchor.id) + (anchor.below ? 1 : 0), 0, ...block);
    // Replay the shortest-column rule, taking each column's next note; a column that runs out early hands its turn on.
    const heights = columns.map(() => 0);
    const order = [];
    const shortest = (/** @type {number[]} */ list) => list.reduce((best, at) => (heights[at] < heights[best] ? at : best), list[0]);
    while (columns.some((notes) => notes.length)) {
      const all = columns.map((_, at) => at);
      let at = shortest(all);
      if (!columns[at].length) at = shortest(all.filter((index) => columns[index].length));
      const note = columns[at].shift();
      order.push(note);
      heights[at] += estimate(note) + GAP_PX;
    }
    return order;
  }

</script>

<div bind:clientWidth={width} bind:this={root} class="px-2 sm:px-0">
  {#if notes.length}
    <!-- Phones: Select all as an icon, then the toggles split the rest of the row evenly. From sm up: label, toggles on the right -->
    <div class="flex items-stretch gap-2 pt-2 pb-2 sm:pt-4">
      <button class="spring press flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border border-line text-xs text-ink-muted hover:border-line-strong hover:text-ink sm:w-auto sm:px-2.5 tv:h-11 tv:text-base"
        onclick={() => ui.selectAll(shown.map((note) => note.id))} disabled={!shown.length} title="Select every note here to copy or archive them together" aria-label="Select all">
        <CheckCheck class="size-3.5 shrink-0" /><span class="hidden sm:inline">Select all</span>
      </button>
      <div class="grid min-w-0 flex-1 auto-cols-fr grid-flow-col gap-px border border-line bg-line sm:ml-auto sm:flex-none" role="group" aria-label="Sort notes">
        <!-- Every label sits in one grid cell, so the button keeps the width of its longest label and never jumps -->
        <button class="{TOGGLE}" onclick={() => ui.setOrder(ORDERS[(ORDERS.indexOf(ui.order) + 1) % ORDERS.length])}
          title="{ORDER_HINTS[ui.order]}. Tap to cycle {ORDERS.map((option) => ORDER_LABELS[option]).join(', ')}" aria-label="Order: {ORDER_HINTS[ui.order]}">
          <ArrowDownWideNarrow class="size-3.5 shrink-0" />
          <span class="grid min-w-0">
            {#each Object.entries(ORDER_LABELS) as [value, label] (value)}
              <span class="spring col-start-1 row-start-1 truncate {ui.order === value ? 'opacity-100' : 'translate-y-1 opacity-0'}" aria-hidden={ui.order !== value}>{label}</span>
            {/each}
          </span>
        </button>
        <button class="{TOGGLE}" onclick={() => ui.setGroup(groupOptions[(groupOptions.indexOf(group) + 1) % groupOptions.length])}
          title="Grouped by {GROUP_LABELS[group].toLowerCase()}. Tap to cycle {groupOptions.map((option) => GROUP_LABELS[option]).join(', ')}" aria-label="Group: {GROUP_LABELS[group]}">
          <Layers class="size-3.5 shrink-0" />
          <span class="grid min-w-0">
            {#each groupOptions as option (option)}
              <span class="spring col-start-1 row-start-1 truncate {group === option ? 'opacity-100' : 'translate-y-1 opacity-0'}" aria-hidden={group !== option}>{GROUP_LABELS[option]}</span>
            {/each}
          </span>
        </button>
        {#if hasFeatures}
          {@const style = ui.stateFilter === 'all' ? null : STATE_STYLE[ui.stateFilter]}
          <button class="{TOGGLE} {style ? style.text : ''}" onclick={() => ui.setStateFilter(STATE_FILTERS[(STATE_FILTERS.indexOf(ui.stateFilter) + 1) % STATE_FILTERS.length])}
            title="Showing {STATE_FILTER_LABELS[ui.stateFilter].toLowerCase()}. Tap to cycle {STATE_FILTERS.map((option) => STATE_FILTER_LABELS[option]).join(', ')}" aria-label="Feature state: {STATE_FILTER_LABELS[ui.stateFilter]}">
            <ListFilter class="size-3.5 shrink-0" />
            <span class="grid min-w-0">
              {#each STATE_FILTERS as option (option)}
                <span class="spring col-start-1 row-start-1 truncate {ui.stateFilter === option ? 'opacity-100' : 'translate-y-1 opacity-0'}" aria-hidden={ui.stateFilter !== option}>{STATE_FILTER_LABELS[option]}</span>
              {/each}
            </span>
          </button>
        {/if}
      </div>
    </div>
  {/if}

  {#if !shown.length}
    <p class="px-4 py-16 text-center text-fluid-sm text-ink-faint">{notes.length ? FILTERED_EMPTY : empty}</p>
  {:else if width}
    {#each sections as section (section.key)}
      <!-- The whole band, header included, takes drops: a folded group still catches a note dropped on its header -->
      <div class="spring {section.group && drag.id && drag.zone === section.key ? 'bg-surface-raised' : ''}" use:dropzone={zoneFor(section)}>
        {#if section.group}
          <GroupHeader group={section.group} notes={section.notes} total={groupTotals.get(section.group.id) ?? section.notes.length} class="pt-4 pb-2 text-fluid-sm" />
        {:else if section.title}
          {@const picked = section.notes.filter((note) => ui.selected.has(note.id)).length}
          <h2 class="flex items-center gap-1.5 pt-4 pb-2 font-mono text-[0.6875rem] tv:text-sm uppercase tracking-widest text-ink-faint">
            <button class="spring press -m-1 p-1 {picked ? 'text-accent' : 'hover:text-ink'}" role="checkbox" aria-checked={picked === section.notes.length ? 'true' : picked ? 'mixed' : 'false'}
              aria-label="Select all in {section.title}" title="Select all in {section.title}" onclick={() => toggleBand(section.notes)}>
              {#if picked === section.notes.length}<SquareCheck class="size-3.5 tv:size-5" />{:else if picked}<SquareMinus class="size-3.5 tv:size-5" />{:else}<Square class="size-3.5 tv:size-5" />{/if}
            </button>
            {section.title} <span class="text-ink-faint">· {section.notes.length}</span>
          </h2>
        {/if}
        {#if !section.group?.collapsed}
          <!-- A group's notes sit indented behind a rail in the group's color, set apart from ungrouped notes -->
          <div class="flex items-start gap-2 {section.group ? `${GROUP_INDENT} ${RAIL_BORDER[/** @type {keyof typeof RAIL_BORDER} */ (section.group.color)] || RAIL_BORDER.default}` : ''}" transition:slide={{ duration: FOLD_MS }}>
            {#each columnsFor(previewOrder(section) ?? drag.arrange(section.notes, section.key)) as column, columnIndex (columnIndex)}
              <div class="flex min-w-0 flex-1 flex-col gap-2">
                {#each column as note, index (note.id)}
                  <!-- The card being dragged stays here as a dimmed placeholder; the ghost follows the pointer -->
                  <div class="overflow-hidden rounded-ui border bg-app transition-colors duration-150 ease-out {drag.carries(note.id) ? 'border-dashed border-accent' : 'border-line hover:border-line-strong'}"
                    data-flip-id={note.id} use:reveal={index * columnCount + columnIndex}>
                    <!-- Dimmed on an inner layer: the reveal styles own the wrapper's opacity -->
                    <div class="spring h-full {drag.carries(note.id) ? 'opacity-40' : ''}"><NoteCard {note} {showProject} /></div>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
  <DragGhost {showProject} />
</div>
