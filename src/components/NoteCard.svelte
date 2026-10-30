<script module>
  // One card's hold menu is open at a time, app-wide.
  const menu = $state({ id: '' });
</script>

<script>
  // One note or feature in a grid or board column. Click opens the editor.
  // Hold (touch-and-hold, a long mouse press, right-click, the context-menu key or Shift+F10) opens a menu on the card:
  // archive, delete, select. Hold and slide (or just drag with a mouse) picks the card up to reorder it; Alt+Arrow moves
  // it from the keyboard (src/lib/reorder.svelte.js). Selecting: the check button, Ctrl/Cmd/Shift+click or the hold
  // menu picks a card; while anything is picked, a plain click or tap toggles cards instead of opening them.
  import { tick } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import Pin from '@lucide/svelte/icons/pin';
  import Bot from '@lucide/svelte/icons/bot';
  import BotMessageSquare from '@lucide/svelte/icons/bot-message-square';
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import Folder from '@lucide/svelte/icons/folder';
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Archive from '@lucide/svelte/icons/archive';
  import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
  import Trash from '@lucide/svelte/icons/trash';
  import AttachmentMedia from './AttachmentMedia.svelte';
  import StateBadge from './StateBadge.svelte';
  import LevelDots from './LevelDots.svelte';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { DOT_BG, DOT_TEXT, PR_STYLE, TINT_BG } from '../lib/colors.js';
  import { ago, duration, fullTime } from '../lib/time.js';
  import { press } from '../lib/press.js';
  import { drag, NUDGE_KEYS } from '../lib/reorder.svelte.js';
  import { exit } from '../lib/flip.js';
  import { renderMarkdown } from '../lib/markdown.js';

  /** @type {{ note: any, showProject?: boolean, inTrash?: boolean }} */
  let { note, showProject = true, inTrash = false } = $props();

  const BODY_PREVIEW_CHARS = 600;
  const FLIP_WRAPPER = '[data-flip-id]';
  // On narrow cards (two columns on a 320px phone) the labels hide and the actions sit icon-only in one row, so the
  // menu fits a title-only card; the label text stays for screen readers.
  const MENU_ITEM = 'spring press flex items-center gap-1.5 border border-line bg-surface px-3 py-2 @max-[12rem]:px-2.5 tv:px-5 tv:py-3 text-xs tv:text-lg font-medium hover:border-line-strong hover:bg-surface-raised';
  const MENU_LABEL = '@max-[12rem]:sr-only';
  /** Arrow key -> step between the menu's actions. */
  const MENU_KEYS = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

  /** @type {HTMLElement | undefined} */
  let card = $state();

  const selected = $derived(ui.selected.has(note.id));
  const selecting = $derived(ui.selected.size > 0);
  const menuOpen = $derived(menu.id === note.id);

  const project = $derived(showProject && note.project_id ? store.find('projects', note.project_id) : null);
  const labels = $derived(note.label_ids.map((/** @type {string} */ id) => store.find('labels', id)).filter((/** @type {any} */ label) => label && !label.purged_at && (inTrash || !label.deleted_at)));
  const isFeature = $derived(note.kind === 'feature');
  const files = $derived(store.attachmentsFor(note.id));
  // Keep-style cover: the first image, else the first video frame. Documents are never a cover.
  const cover = $derived(files.find((file) => file.type.startsWith('image/')) ?? files.find((file) => file.type.startsWith('video/')) ?? null);
  // The latest timestamp in the chain is the one worth showing on a card.
  const stamp = $derived(
    note.completed_at ? { label: 'completed', at: note.completed_at }
      : note.started_at ? { label: 'started', at: note.started_at }
      : { label: isFeature ? 'requested' : 'edited', at: isFeature ? note.created_at : note.updated_at },
  );

  // While the menu is open: a tap anywhere else or Escape closes it.
  $effect(() => {
    if (!menuOpen) return;
    /** @param {PointerEvent} event */
    const outside = (event) => {
      if (!card?.contains(/** @type {Node} */ (event.target))) menu.id = '';
    };
    /** @param {KeyboardEvent} event */
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeMenu();
    };
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', escape, true);
    return () => {
      removeEventListener('pointerdown', outside, true);
      removeEventListener('keydown', escape, true);
    };
  });

  /** @param {MouseEvent | KeyboardEvent} event */
  function activate(event) {
    if (event.target instanceof Element && event.target.closest('a')) return;
    if (inTrash) { router.openNote(note.id); return; }
    if (selecting || event.ctrlKey || event.metaKey || event.shiftKey) ui.toggleSelected(note.id);
    else router.openNote(note.id);
  }

  /** Closes the menu, handing focus back to the card if it was inside it. */
  function closeMenu() {
    const hadFocus = card?.contains(document.activeElement) && document.activeElement !== card;
    menu.id = '';
    if (hadFocus) card?.focus();
  }

  /** Keyboard path to the menu: open it and focus its first action. */
  async function openMenuFromKeys() {
    if (inTrash) return;
    menu.id = note.id;
    await tick();
    /** @type {HTMLElement | null | undefined} */ (card?.querySelector('[role="menuitem"]'))?.focus();
  }

  /** Menu keys: arrows, Home and End move between actions (focus wraps); Tab closes the menu and moves on. @param {KeyboardEvent & { currentTarget: HTMLElement }} event */
  function onMenuKey(event) {
    if (event.key === 'Tab') {
      menu.id = '';
      return;
    }
    const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]')];
    const step = MENU_KEYS[/** @type {keyof typeof MENU_KEYS} */ (event.key)];
    const at = items.indexOf(/** @type {Element} */ (document.activeElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : step ? (Math.max(at, 0) + step + items.length) % items.length : -1;
    if (next < 0) return;
    event.preventDefault();
    /** @type {HTMLElement} */ (items[next]).focus();
  }

  /** Moving after a hold (or dragging with a mouse) picks the card up. @param {PointerEvent} event */
  function lift(event) {
    if (inTrash) return;
    const wrapper = /** @type {HTMLElement | null | undefined} */ (card?.closest(FLIP_WRAPPER));
    menu.id = '';
    if (!wrapper) return;
    drag.begin(note, wrapper, event);
  }

  /** @param {KeyboardEvent} event */
  function onkeydown(event) {
    // Keys on the select and pin buttons or the menu keep their own meaning.
    if (event.target !== card) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(event);
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      openMenuFromKeys();
    } else if (!inTrash && event.altKey && event.key in NUDGE_KEYS) {
      event.preventDefault();
      drag.nudge(note, /** @type {HTMLElement} */ (card), /** @type {keyof typeof NUDGE_KEYS} */ (event.key));
    }
  }

  /** Right-click and the long-press menu of touch browsers open the card's own menu. @param {MouseEvent} event */
  function oncontextmenu(event) {
    event.preventDefault();
    if (!inTrash && !drag.id) menu.id = note.id;
  }

  /** Plays the card out, then archives or deletes it. @param {MouseEvent} event @param {() => void} commit */
  async function leave(event, commit) {
    event.stopPropagation();
    const wrapper = card?.closest(FLIP_WRAPPER) ?? card;
    menu.id = '';
    if (wrapper) await exit(wrapper);
    commit();
  }

  /** @param {MouseEvent} event */
  function toggleSelect(event) {
    event.stopPropagation();
    menu.id = '';
    ui.toggleSelected(note.id);
  }

  /** @param {MouseEvent} event */
  function togglePin(event) {
    event.stopPropagation();
    store.update('notes', note.id, { pinned: !note.pinned });
  }
</script>

<div
  bind:this={card}
  class="@container spring group relative flex h-full min-h-28 cursor-pointer flex-col gap-2 p-4 short:p-3 tv:p-6 outline-none hover:bg-surface-raised focus-visible:bg-surface-raised {TINT_BG[/** @type {keyof typeof TINT_BG} */ (note.color)] || TINT_BG.default} {selected ? 'ring-2 ring-inset ring-accent' : ''}"
  role="button"
  tabindex="0"
  aria-label="{note.title || 'Untitled note'}{selected ? ', selected' : ''}"
  aria-haspopup={inTrash ? undefined : 'menu'}
  aria-keyshortcuts="Shift+F10 Alt+ArrowUp Alt+ArrowDown"
  use:press={inTrash ? {} : { onhold: () => (menu.id = note.id), onlift: lift }}
  ondragstart={(event) => event.preventDefault()}
  onclick={activate}
  {onkeydown}
  {oncontextmenu}
  onfocusout={(event) => menuOpen && !card?.contains(/** @type {Node | null} */ (event.relatedTarget)) && (menu.id = '')}
>
  {#if cover}
    <div class="-mx-4 -mt-4 mb-1 short:-mx-3 short:-mt-3 tv:-mx-6 tv:-mt-6 aspect-video overflow-hidden">
      <AttachmentMedia file={cover} class="spring size-full object-cover group-hover:scale-[1.02]" />
    </div>
  {/if}
  <div class="flex items-start gap-2">
    {#if note.priority_level || note.difficulty}<LevelDots priority={note.priority_level} difficulty={note.difficulty} />{/if}
    {#if note.created_by_type === 'agent'}
      <!-- Made by an agent token, not a person: the server stamps who (notes.created_by) -->
      <span class="mt-0.5 shrink-0 text-ink-faint tv:mt-1.5" role="img" aria-label="Created by agent {note.created_by}" title="Created by agent {note.created_by}"><BotMessageSquare class="size-3.5 tv:size-5" /></span>
    {/if}
    {#if note.title}
      <h3 class="min-w-0 flex-1 text-fluid-sm font-semibold leading-snug text-ink">{note.title}</h3>
    {:else}
      <span class="flex-1"></span>
    {/if}
    {#if !inTrash}
    <button class="spring press -m-1 p-1 {selected ? 'text-accent' : selecting ? 'text-ink-faint' : 'text-ink-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}"
      aria-label={selected ? 'Deselect' : 'Select'} aria-pressed={selected} onclick={toggleSelect}><CircleCheck class="size-4" /></button>
    <button class="spring press -m-1 p-1 {note.pinned ? 'text-accent' : 'text-ink-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}"
      aria-label={note.pinned ? 'Unpin' : 'Pin'} aria-pressed={note.pinned} onclick={togglePin}><Pin class="size-4" /></button>
    {/if}
  </div>

  {#if note.body}
    <div class="markdown note-card-preview line-clamp-10 text-ink-muted tv:text-lg">{@html renderMarkdown(note.body.slice(0, BODY_PREVIEW_CHARS))}</div>
  {/if}

  {#if isFeature && note.status}
    <p class="flex items-start gap-1.5 border-l-2 border-progress pl-2 text-xs text-ink"><span class="line-clamp-2">{note.status}</span></p>
  {/if}

  <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
    {#if isFeature}<StateBadge state={note.state} />{/if}
    {#if inTrash && note.created_by_type === 'agent' && note.created_by}
      <span class="inline-flex items-center gap-1 font-mono text-[0.6875rem] text-ink-muted"><BotMessageSquare class="size-3" />{note.created_by}</span>
    {/if}
    {#if files.length}
      <span class="inline-flex items-center gap-1 font-mono text-[0.6875rem] text-ink-muted" title="{files.length} attachment{files.length === 1 ? '' : 's'}"><Paperclip class="size-3" />{files.length}</span>
    {/if}
    {#if note.assignee}
      <span class="inline-flex items-center gap-1 font-mono text-[0.6875rem] text-ink-muted"><Bot class="size-3" />{note.assignee}</span>
    {/if}
    {#each note.pull_requests as pr (pr.url)}
      <span class="inline-flex items-center gap-1 font-mono text-[0.6875rem] {PR_STYLE[/** @type {keyof typeof PR_STYLE} */ (pr.state)]}" title="{pr.repo}#{pr.number} {pr.state}">
        {#if pr.state === 'merged'}<GitMerge class="size-3" />{:else}<GitPullRequest class="size-3" />{/if}#{pr.number}
      </span>
    {/each}
    {#if project}
      <!-- In the project's own color, so it pops out of the meta row -->
      <span class="inline-flex max-w-32 items-center gap-1 truncate text-[0.6875rem] font-semibold {DOT_TEXT[/** @type {keyof typeof DOT_TEXT} */ (project.color)] || DOT_TEXT.default}"><Folder class="size-3 shrink-0" />{project.name}</span>
    {/if}
    {#each labels as label (label.id)}
      <span class="inline-flex items-center gap-1 border border-line px-1.5 text-[0.6875rem] text-ink-muted">
        <span class="size-1.5 rounded-full {DOT_BG[/** @type {keyof typeof DOT_BG} */ (label.color)] || DOT_BG.default}"></span>{label.name}
      </span>
    {/each}
  </div>

  <p class="font-mono text-[0.625rem] tv:text-sm text-ink-faint" title={fullTime(stamp.at)}>
    {stamp.label} {ago(stamp.at)}{#if note.completed_at}&nbsp;· took {duration(note.created_at, note.completed_at)}{/if}
  </p>

  <!-- Hold menu: dims the card in place (absolute, so nothing moves) and floats the actions over it -->
  {#if menuOpen && !inTrash}
    <div class="absolute inset-0 z-10 flex items-center justify-center p-2" transition:fade={{ duration: 150 }}>
      <button class="absolute inset-0 cursor-default bg-scrim" tabindex="-1" aria-label="Close menu" onclick={(event) => { event.stopPropagation(); closeMenu(); }}></button>
      <!-- A real menu: arrow keys, Home and End move between the actions, which stay out of the Tab order -->
      <div class="relative flex flex-wrap justify-center gap-1.5" role="menu" tabindex="-1" aria-label="Note actions" onkeydown={onMenuKey}
        in:scale|global={{ start: 0.85, duration: 180, easing: backOut }} out:scale|global={{ start: 0.9, duration: 120 }}>
        <button class="{MENU_ITEM} text-ink" role="menuitem" tabindex="-1" title={note.archived ? 'Unarchive' : 'Archive'} onclick={(event) => leave(event, () => store.update('notes', note.id, { archived: !note.archived }))}>
          {#if note.archived}<ArchiveRestore class="size-4 shrink-0" /><span class={MENU_LABEL}>Unarchive</span>{:else}<Archive class="size-4 shrink-0" /><span class={MENU_LABEL}>Archive</span>{/if}
        </button>
        <button class="{MENU_ITEM} text-accent" role="menuitem" tabindex="-1" title="Delete" onclick={(event) => leave(event, () => store.remove('notes', note.id))}><Trash class="size-4 shrink-0" /><span class={MENU_LABEL}>Delete</span></button>
        <button class="{MENU_ITEM} text-ink" role="menuitem" tabindex="-1" title={selected ? 'Deselect' : 'Select'} onclick={toggleSelect}><CircleCheck class="size-4 shrink-0" /><span class={MENU_LABEL}>{selected ? 'Deselect' : 'Select'}</span></button>
      </div>
    </div>
  {/if}
</div>
