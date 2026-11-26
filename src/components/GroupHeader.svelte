<script>
  // Header of one note group, on the board and the notes page: a check box that selects (or clears) the notes shown
  // under it, then the arrow, color dot, name and count that fold the group away or open it, and a pencil to edit it.
  // Folding is saved on the group, so it stays folded on every device. On the board (column set) each column folds its
  // own copy of the group (note_groups.folded_columns); on the notes page the group is one band (note_groups.collapsed).
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Square from '@lucide/svelte/icons/square';
  import SquareCheck from '@lucide/svelte/icons/square-check';
  import SquareMinus from '@lucide/svelte/icons/square-minus';
  import GroupDialog from './GroupDialog.svelte';
  import { store } from '../lib/store.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { DOT_BG } from '../lib/colors.js';

  /** @type {{ group: any, notes: any[], total: number, column?: string, class?: string }} */
  let { group, notes, total, column = '', class: className = '' } = $props();

  // Arrow line weight folded and open (Lucide's default is 2).
  const STROKE = 2;
  const STROKE_OPEN = 3;

  let editing = $state(false);
  const foldedColumns = $derived(group.folded_columns ?? []);
  const collapsed = $derived(column ? foldedColumns.includes(column) : group.collapsed);
  const picked = $derived(notes.filter((note) => ui.selected.has(note.id)).length);
  // "3" when every note in the group is shown here; "2 of 5" when a column or filter shows only some of them.
  const count = $derived(notes.length === total ? String(total) : `${notes.length} of ${total}`);

  function toggleFold() {
    if (!column) store.update('note_groups', group.id, { collapsed: !group.collapsed });
    else store.update('note_groups', group.id, { folded_columns: collapsed ? foldedColumns.filter((id) => id !== column) : [...foldedColumns, column] });
  }

  function toggleSelection() {
    if (picked === notes.length) for (const note of notes) ui.selected.delete(note.id);
    else ui.selectAll(notes.map((note) => note.id));
  }
</script>

<div class="flex min-w-0 items-center gap-1 {className}">
  <button class="spring press -m-1 shrink-0 p-1 disabled:opacity-40 {picked ? 'text-accent' : 'text-ink-faint hover:text-ink'}" role="checkbox" disabled={!notes.length}
    aria-checked={picked && picked === notes.length ? 'true' : picked ? 'mixed' : 'false'} aria-label="Select all in {group.name}" title="Select all in {group.name}" onclick={toggleSelection}>
    {#if picked && picked === notes.length}<SquareCheck class="size-3.5 tv:size-5" />{:else if picked}<SquareMinus class="size-3.5 tv:size-5" />{:else}<Square class="size-3.5 tv:size-5" />{/if}
  </button>
  <!-- No press squash here: the arrow only turns in place. Open groups read bold and bright, folded ones muted -->
  <button class="spring group/fold flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-1 text-left" aria-expanded={!collapsed}
    title={collapsed ? `Show ${group.name}` : `Fold ${group.name} away`} onclick={toggleFold}>
    <ChevronRight strokeWidth={collapsed ? STROKE : STROKE_OPEN}
      class="size-3.5 shrink-0 transition-[rotate,color] duration-200 ease-out-soft tv:size-5 {collapsed ? 'text-ink-faint group-hover/fold:text-ink-muted' : 'rotate-90 text-ink'}" />
    <span class="size-2 shrink-0 rounded-full {DOT_BG[/** @type {keyof typeof DOT_BG} */ (group.color)] || DOT_BG.default}" aria-hidden="true"></span>
    <span class="min-w-0 truncate transition-colors duration-200 {collapsed ? 'font-medium text-ink-muted group-hover/fold:text-ink' : 'font-bold text-ink'}">{group.name}</span>
    <span class="shrink-0 font-mono text-ink-faint" aria-label="{count} notes">{count}</span>
  </button>
  <button class="spring press -m-1 shrink-0 p-1 text-ink-faint hover:text-ink" aria-label="Edit {group.name}" title="Rename, recolor or ungroup" onclick={() => (editing = true)}>
    <Pencil class="size-3.5 tv:size-5" />
  </button>
</div>
<GroupDialog bind:open={editing} projectId={group.project_id} {group} />
