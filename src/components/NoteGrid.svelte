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
  import { groupsIn, splitByGroup } from '../lib/groups.js';
  import { store } from '../lib/store.svelte.js';
  import ArrowDownWideNarrow from '@lucide/svelte/icons/arrow-down-wide-narrow';
  import Layers from '@lucide/svelte/icons/layers';
  import Square from '@lucide/svelte/icons/square';
  import SquareCheck from '@lucide/svelte/icons/square-check';
  import SquareMinus from '@lucide/svelte/icons/square-minus';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import { ui, GROUPS, ORDERS, STATE_FILTERS, TIME_ORDERS } from '../lib/ui.svelte.js';
  import { STATE_STYLE } from '../lib/colors.js';
  import { reveal } from '../lib/reveal.js';
  import { measure, play } from '../lib/flip.js';
  import { drag, dropzone, orderKey, placeNote } from '../lib/reorder.svelte.js';

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
  // Toolbar toggles: equal columns at one height on phones (labels truncate), natural width from sm up.
  const TOGGLE = 'spring press flex h-8 min-w-0 items-center justify-center gap-1.5 bg-app px-2 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink sm:justify-start sm:px-2.5 tv:h-11 tv:text-base';
  const NO_PROJECT = 'No project';
  const STATE_FILTER_LABELS = { all: 'All', requested: STATE_STYLE.requested.label, in_progress: STATE_STYLE.in_progress.label, complete: STATE_STYLE.complete.label };
  const FILTERED_EMPTY = 'No features in this state.';
  const GROUP_PREFIX = 'group:';
  const FOLD_MS = 200;

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

  /** Band a note belongs to when it isn't pinned (a grouped note is in its group, pinned or not). @param {any} note */
  function bandOf(note) {
    if (groupIds.has(note.group_id)) return GROUP_PREFIX + note.group_id;
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
        const key = bandOf(note);
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
    if (!width) return;
    if (!mounted) {
      mounted = true;
      return;
    }
    const before = measure(root);
    tick().then(() => play(root, before));
  });

  /**
   * Saves a drop. Into the pinned band pins the note; out of it unpins. In a time order the slot was picked among notes
   * sorted by time, so the note goes right after the one shown before it (or before the one shown after it, at the
   * top) in manual order, and only then does the grid switch to manual so the drop sticks. Picking a card up,
   * cancelling, or letting go on its own slot never reaches here, so none of those touch the chosen sort.
   * Priority order only moves features between levels: plain notes have no priority control to undo it.
   * @param {{ key: string, notes: any[] }} section @param {any} note @param {number} index
   */
  function drop(section, note, index) {
    const others = section.notes.filter((other) => other.id !== note.id);
    const pinned = section.key === 'pinned';
    const timeOrder = TIME_ORDERS.includes(/** @type {any} */ (ui.order));
    const list = timeOrder ? [...others].sort(COMPARE.manual) : others;
    const [before, after] = [others[index - 1], others[index]];
    const slot = !timeOrder ? index : before ? list.indexOf(before) + 1 : after ? list.indexOf(after) : list.length;
    for (const { id, patch } of placeNote(list, note, slot, ui.order === 'priority' && note.kind === 'feature')) {
      store.update('notes', id, id === note.id && Boolean(note.pinned) !== pinned ? { ...patch, pinned } : patch);
    }
    if (timeOrder) ui.setOrder('manual');
  }

  /** The drop zone for one band. @param {{ key: string, title: string, notes: any[] }} section */
  function zoneFor(section) {
    return {
      key: section.key,
      label: section.title || 'notes',
      list: () => section.notes,
      // Pinned and the plain list trade ungrouped notes freely; a group, project or season band only takes its own.
      accepts: (/** @type {any} */ note) => (section.key === 'pinned' ? !groupIds.has(note.group_id) : bandOf(note) === section.key),
      ondrop: (/** @type {any} */ note, /** @type {number} */ index) => drop(section, note, index),
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

<div bind:clientWidth={width} bind:this={root} class="px-2 sm:px-0">
  {#if notes.length}
    <!-- Phones: Select all as an icon, then the toggles split the rest of the row evenly. From sm up: label, toggles on the right -->
    <div class="flex items-stretch gap-2 pt-2 pb-2 sm:pt-4">
      <button class="spring press flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border border-line text-xs text-ink-muted hover:border-line-strong hover:text-ink sm:w-auto sm:px-2.5 tv:h-11 tv:text-base"
        onclick={() => ui.selectAll(shown.map((note) => note.id))} disabled={!shown.length} title="Select every note here to copy or archive them together" aria-label="Select all">
        <CheckCheck class="size-3.5 shrink-0" /><span class="hidden sm:inline">Select all</span>
      </button>
      <div class="grid min-w-0 flex-1 auto-cols-fr grid-flow-col gap-px border border-line bg-line sm:ml-auto sm:flex sm:flex-none" role="group" aria-label="Sort notes">
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
        <div class="flex items-start gap-2" use:dropzone={zoneFor(section)} transition:slide={{ duration: FOLD_MS }}>
          {#each columnsFor(drag.arrange(section.notes, section.key)) as column, columnIndex (columnIndex)}
            <div class="flex min-w-0 flex-1 flex-col gap-2">
              {#each column as note, index (note.id)}
                <!-- The card being dragged stays here as a dimmed placeholder; the ghost follows the pointer -->
                <div class="overflow-hidden rounded-ui border bg-app spring {drag.id === note.id ? 'border-dashed border-accent' : 'border-line hover:border-line-strong'}"
                  data-flip-id={note.id} use:reveal={index * columnCount + columnIndex}>
                  <!-- Dimmed on an inner layer: the reveal styles own the wrapper's opacity -->
                  <div class="spring h-full {drag.id === note.id ? 'opacity-40' : ''}"><NoteCard {note} {showProject} /></div>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    {/each}
  {/if}
  <DragGhost {showProject} />
</div>
