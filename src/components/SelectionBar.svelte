<script>
  // Bulk actions while notes are selected. It covers the top bar in place (absolute, so nothing below moves):
  // select all, archive, group (inside a project: see src/lib/groups.js), copy everything as one Markdown document (made for
  // pasting into Claude Code), clear.
  // Escape clears the selection; Ctrl/Cmd+A selects everything in view (handled in Shell).
  import X from '@lucide/svelte/icons/x';
  import CheckCheck from '@lucide/svelte/icons/check-check';
  import ClipboardCopy from '@lucide/svelte/icons/clipboard-copy';
  import Check from '@lucide/svelte/icons/check';
  import Archive from '@lucide/svelte/icons/archive';
  import Group from '@lucide/svelte/icons/group';
  import GroupDialog from './GroupDialog.svelte';
  import { fly } from 'svelte/transition';
  import { store } from '../lib/store.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { copyText, notesMarkdown } from '../lib/export.js';

  /** @type {{ notes: any[], archiveView?: boolean, projectId?: string | null }} */
  let { notes, archiveView = false, projectId = null } = $props();

  const COPIED_MS = 1600;
  const TOOL = 'spring press flex h-9 tv:h-12 shrink-0 items-center gap-1.5 px-2 sm:px-2.5 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink disabled:opacity-40';

  let copied = $state(0);
  let grouping = $state(false);
  const count = $derived(ui.selected.size);
  const allSelected = $derived(notes.length > 0 && notes.every((note) => ui.selected.has(note.id)));
  /** Selected notes in the order they appear on screen, then any picked elsewhere. */
  const picked = $derived.by(() => {
    const inView = notes.filter((note) => ui.selected.has(note.id));
    const seen = new Set(inView.map((note) => note.id));
    const elsewhere = [...ui.selected].filter((id) => !seen.has(id)).map((id) => store.find('notes', id)).filter((note) => note && !note.deleted_at);
    return [...inView, ...elsewhere];
  });

  async function copy() {
    const ok = await copyText(notesMarkdown(picked));
    copied = ok ? picked.length : 0;
    setTimeout(() => (copied = 0), COPIED_MS);
  }

  function archive() {
    for (const note of picked) store.update('notes', note.id, { archived: !archiveView });
    ui.selected.clear();
  }

  /** @param {KeyboardEvent} event */
  function onkeydown(event) {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    ui.selected.clear();
  }
</script>

<svelte:window {onkeydown} />

<div class="absolute inset-0 z-20 flex items-center gap-1 border-b border-accent bg-surface px-1 sm:px-3" role="toolbar" aria-label="Selected notes"
  transition:fly={{ y: -12, duration: 180 }}>
  <button class="{TOOL} px-2" onclick={() => ui.selected.clear()} aria-label="Clear selection" title="Clear selection (Esc)"><X class="size-5" /></button>
  {#key count}
    <p class="min-w-0 shrink truncate text-fluid-base font-bold tracking-tight" in:fly={{ y: 6, duration: 150 }} aria-live="polite">{count} <span class="hidden font-normal text-ink-muted sm:inline">selected</span></p>
  {/key}
  <span class="flex-1"></span>
  <button class={TOOL} onclick={() => ui.selectAll(notes.map((note) => note.id))} disabled={allSelected} title="Select all ({navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}A)">
    <CheckCheck class="size-4" /><span class="hidden sm:inline">Select all</span>
  </button>
  <button class={TOOL} onclick={archive} title={archiveView ? 'Unarchive selected' : 'Archive selected'}>
    <Archive class="size-4" /><span class="hidden md:inline">{archiveView ? 'Unarchive' : 'Archive'}</span>
  </button>
  {#if projectId && !archiveView}
    <button class={TOOL} onclick={() => (grouping = true)} title="Group the selected notes under a name and color you can fold away">
      <Group class="size-4" /><span class="hidden md:inline">Group</span>
    </button>
  {/if}
  <button class="spring press flex h-9 tv:h-12 shrink-0 items-center gap-1.5 px-2 text-xs font-semibold sm:px-3 sm:text-sm {copied ? 'bg-complete text-accent-ink' : 'bg-accent text-accent-ink hover:bg-accent-hover'}"
    onclick={copy} title="Copy all selected notes as Markdown">
    {#if copied}<Check class="size-4" />Copied {copied}{:else}<ClipboardCopy class="size-4" /><span class="whitespace-nowrap">Copy As Markdown</span>{/if}
  </button>
</div>
{#if projectId}<GroupDialog bind:open={grouping} {projectId} notes={picked} ondone={() => ui.selected.clear()} />{/if}
