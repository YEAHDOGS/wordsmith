<script>
  // One note or feature in a grid or board column. Click opens the editor; drag moves it between board columns.
  import Pin from '@lucide/svelte/icons/pin';
  import Bot from '@lucide/svelte/icons/bot';
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import Folder from '@lucide/svelte/icons/folder';
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import AttachmentMedia from './AttachmentMedia.svelte';
  import StateBadge from './StateBadge.svelte';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { DOT_BG, PR_STYLE, TINT_BG } from '../lib/colors.js';
  import { ago, duration, fullTime } from '../lib/time.js';

  /** @type {{ note: any, showProject?: boolean, draggable?: boolean }} */
  let { note, showProject = true, draggable = false } = $props();

  const BODY_PREVIEW_CHARS = 600;
  const PRIORITY_MARKS = ['', '!', '!!', '!!!'];

  const project = $derived(showProject && note.project_id ? store.find('projects', note.project_id) : null);
  const labels = $derived(note.label_ids.map((/** @type {string} */ id) => store.find('labels', id)).filter((/** @type {any} */ label) => label && !label.deleted_at));
  const isFeature = $derived(note.kind === 'feature');
  const files = $derived(store.attachmentsFor(note.id));
  // Keep-style cover: the first image, else the first video frame.
  const cover = $derived(files.find((file) => file.type.startsWith('image/')) ?? files[0] ?? null);
  // The latest timestamp in the chain is the one worth showing on a card.
  const stamp = $derived(
    note.completed_at ? { label: 'completed', at: note.completed_at }
      : note.started_at ? { label: 'started', at: note.started_at }
      : { label: isFeature ? 'requested' : 'edited', at: isFeature ? note.created_at : note.updated_at },
  );

  /** @param {DragEvent} event */
  function ondragstart(event) {
    event.dataTransfer?.setData('text/wordsmith-note', note.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  /** @param {MouseEvent} event */
  function togglePin(event) {
    event.stopPropagation();
    store.update('notes', note.id, { pinned: !note.pinned });
  }
</script>

<div
  class="spring group relative flex h-full min-h-28 cursor-pointer flex-col gap-2 p-4 short:p-3 tv:p-6 outline-none hover:bg-surface-raised focus-visible:bg-surface-raised {TINT_BG[/** @type {keyof typeof TINT_BG} */ (note.color)] || TINT_BG.default}"
  role="button"
  tabindex="0"
  aria-label={note.title || 'Untitled note'}
  {draggable}
  {ondragstart}
  onclick={() => router.openNote(note.id)}
  onkeydown={(event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), router.openNote(note.id))}
>
  {#if cover}
    <div class="-mx-4 -mt-4 mb-1 short:-mx-3 short:-mt-3 tv:-mx-6 tv:-mt-6 aspect-video overflow-hidden">
      <AttachmentMedia file={cover} class="spring size-full object-cover group-hover:scale-[1.02]" />
    </div>
  {/if}
  <div class="flex items-start gap-2">
    {#if note.title}
      <h3 class="min-w-0 flex-1 text-fluid-sm font-semibold leading-snug text-ink">
        {#if note.priority}<span class="mr-1 font-mono text-accent" aria-label="Priority {note.priority}">{PRIORITY_MARKS[note.priority]}</span>{/if}{note.title}
      </h3>
    {:else}
      <span class="flex-1"></span>
    {/if}
    <button class="spring press -m-1 p-1 {note.pinned ? 'text-accent' : 'text-ink-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}"
      aria-label={note.pinned ? 'Unpin' : 'Pin'} aria-pressed={note.pinned} onclick={togglePin}><Pin class="size-4" /></button>
  </div>

  {#if note.body}
    <p class="line-clamp-10 whitespace-pre-wrap wrap-break-word text-[13px] tv:text-lg leading-relaxed text-ink-muted">{note.body.slice(0, BODY_PREVIEW_CHARS)}</p>
  {/if}

  {#if isFeature && note.status}
    <p class="flex items-start gap-1.5 border-l-2 border-progress pl-2 text-xs text-ink"><span class="line-clamp-2">{note.status}</span></p>
  {/if}

  <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
    {#if isFeature}<StateBadge state={note.state} />{/if}
    {#if files.length}
      <span class="inline-flex items-center gap-1 font-mono text-[11px] text-ink-muted" title="{files.length} attachment{files.length === 1 ? '' : 's'}"><Paperclip class="size-3" />{files.length}</span>
    {/if}
    {#if note.assignee}
      <span class="inline-flex items-center gap-1 font-mono text-[11px] text-ink-muted"><Bot class="size-3" />{note.assignee}</span>
    {/if}
    {#each note.pull_requests as pr (pr.url)}
      <span class="inline-flex items-center gap-1 font-mono text-[11px] {PR_STYLE[/** @type {keyof typeof PR_STYLE} */ (pr.state)]}" title="{pr.repo}#{pr.number} {pr.state}">
        {#if pr.state === 'merged'}<GitMerge class="size-3" />{:else}<GitPullRequest class="size-3" />{/if}#{pr.number}
      </span>
    {/each}
    {#if project}
      <span class="inline-flex max-w-32 items-center gap-1 truncate text-[11px] text-ink-muted"><Folder class="size-3 shrink-0" />{project.name}</span>
    {/if}
    {#each labels as label (label.id)}
      <span class="inline-flex items-center gap-1 border border-line px-1.5 text-[11px] text-ink-muted">
        <span class="size-1.5 rounded-full {DOT_BG[/** @type {keyof typeof DOT_BG} */ (label.color)] || DOT_BG.default}"></span>{label.name}
      </span>
    {/each}
  </div>

  <p class="font-mono text-[10px] tv:text-sm text-ink-faint" title={fullTime(stamp.at)}>
    {stamp.label} {ago(stamp.at)}{#if note.completed_at}&nbsp;· took {duration(note.created_at, note.completed_at)}{/if}
  </p>
</div>
