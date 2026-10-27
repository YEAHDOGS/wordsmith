<script>
  // Board column editor for one board (scope: the Features page or a project). Rename, reorder, change role, add and
  // remove columns; every change saves straight away and syncs. Rules from models.js: at most MAX_COLUMNS, and every
  // role keeps at least one column, so the only column of a role can't be removed or switched away. Cards in a removed
  // column move to the first column with their state (src/lib/board.js columnOf). Rows slide when reordered.
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import Trash from '@lucide/svelte/icons/trash';
  import Plus from '@lucide/svelte/icons/plus';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import { STATE_STYLE } from '../lib/colors.js';
  import { DEFAULT_COLUMNS, FEATURE_STATES, MAX_COLUMNS, MAX_NAME } from '../lib/models.js';
  import { columnsFor, saveColumns } from '../lib/board.js';
  import TEXT from './board-settings.json';

  /** @type {{ scope: string }} */
  let { scope } = $props();

  const MOTION = { duration: 180 };
  const ICON_BUTTON = 'spring press flex size-8 shrink-0 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink disabled:pointer-events-none disabled:opacity-30 tv:size-11';

  const columns = $derived(columnsFor(scope));
  /** How many columns play each role: a role's last column is locked. */
  const perRole = $derived(Object.fromEntries(FEATURE_STATES.map((state) => [state, columns.filter((column) => column.state === state).length])));

  /** @param {number} index @param {Partial<import('../lib/board.js').Column>} patch */
  function edit(index, patch) {
    saveColumns(scope, columns.map((column, at) => (at === index ? { ...column, ...patch } : column)));
  }

  /** @param {number} index @param {number} step */
  function move(index, step) {
    const next = [...columns];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    saveColumns(scope, next);
  }

  /** Renames on commit; an empty name puts the old one back. @param {number} index @param {Event & { currentTarget: HTMLInputElement }} event */
  function rename(index, event) {
    const name = event.currentTarget.value.trim();
    if (!name) {
      event.currentTarget.value = columns[index].name;
      return;
    }
    if (name !== columns[index].name) edit(index, { name });
  }
</script>

<ol class="grid gap-px border border-line bg-line">
  {#each columns as column, index (column.id)}
    {@const style = STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (column.state)]}
    {@const locked = perRole[column.state] === 1}
    <li class="flex min-w-0 flex-wrap items-center gap-2 bg-app p-2 sm:flex-nowrap tv:p-4" animate:flip={MOTION} transition:slide={MOTION}>
      <span class="w-5 shrink-0 text-center font-mono text-xs text-ink-faint tv:text-base">{index + 1}</span>
      <span class="size-2 shrink-0 rounded-full {style.dot}" aria-hidden="true"></span>
      <input value={column.name} maxlength={MAX_NAME} aria-label="{TEXT.columnName} {index + 1}" onchange={(event) => rename(index, event)}
        class="h-8 min-w-0 flex-1 basis-32 border border-line bg-surface px-2 text-sm font-semibold text-ink hover:border-line-strong focus:border-accent focus:outline-none tv:h-11 tv:text-lg" />
      <select value={column.state} aria-label="{TEXT.role}: {column.name}" disabled={locked} title={locked ? TEXT.lastOfRole.replace('{role}', style.label) : TEXT.role}
        onchange={(event) => edit(index, { state: event.currentTarget.value })}
        class="spring h-8 shrink-0 border border-line bg-surface px-2 text-xs {style.text} hover:border-line-strong focus:border-accent focus:outline-none disabled:opacity-70 tv:h-11 tv:text-base">
        {#each FEATURE_STATES as state (state)}<option value={state}>{STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (state)].label}</option>{/each}
      </select>
      <div class="ml-auto flex shrink-0 items-center">
        <button class={ICON_BUTTON} disabled={index === 0} aria-label="{TEXT.moveUp}: {column.name}" title={TEXT.moveUp} onclick={() => move(index, -1)}><ArrowUp class="size-4" /></button>
        <button class={ICON_BUTTON} disabled={index === columns.length - 1} aria-label="{TEXT.moveDown}: {column.name}" title={TEXT.moveDown} onclick={() => move(index, 1)}><ArrowDown class="size-4" /></button>
        <button class="{ICON_BUTTON} hover:text-accent" disabled={locked} aria-label="{TEXT.remove}: {column.name}" title={locked ? TEXT.lastOfRole.replace('{role}', style.label) : TEXT.remove}
          onclick={() => saveColumns(scope, columns.filter((_, at) => at !== index))}><Trash class="size-4" /></button>
      </div>
    </li>
  {/each}
</ol>

<div class="mt-3 flex flex-wrap gap-2">
  <button class="spring press inline-flex items-center gap-2 border border-line-strong px-3 py-2 text-sm text-ink hover:border-accent disabled:opacity-40"
    disabled={columns.length >= MAX_COLUMNS} onclick={() => saveColumns(scope, [...columns, { id: crypto.randomUUID(), name: TEXT.newColumn, state: FEATURE_STATES[0] }])}>
    <Plus class="size-4" />{TEXT.add} <span class="font-mono text-xs text-ink-faint">{columns.length}/{MAX_COLUMNS}</span>
  </button>
  <button class="spring press inline-flex items-center gap-2 px-3 py-2 text-sm text-ink-muted hover:text-ink" onclick={() => saveColumns(scope, DEFAULT_COLUMNS)}>
    <RotateCcw class="size-4" />{TEXT.reset}
  </button>
</div>
