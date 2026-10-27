<script>
  // Share button for the note editor. Every note starts private; flipping the switch to public makes it readable by
  // anyone with its link (/n/<id>), served with link-preview tags for the note and its author.
  // The panel floats in a fixed layer (the toolbar it lives in scrolls sideways and would clip it); phones get a
  // bottom sheet in thumb reach.
  import Share2 from '@lucide/svelte/icons/share-2';
  import Globe from '@lucide/svelte/icons/globe';
  import Lock from '@lucide/svelte/icons/lock';
  import Link from '@lucide/svelte/icons/link';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import X from '@lucide/svelte/icons/x';
  import { fade, fly } from 'svelte/transition';
  import { store } from '../lib/store.svelte.js';
  import { apiUrl } from '../lib/api.js';
  import { copyText } from '../lib/export.js';
  import { SHARE_PATH } from '../lib/models.js';

  /** @type {{ note: any, class?: string }} */
  let { note, class: className = '' } = $props();

  const COPIED_MS = 1400;
  const PANEL_WIDTH_PX = 352;
  const GAP_PX = 6;
  const EDGE_PX = 8;
  const SHEET_BREAKPOINT_PX = 640;

  let open = $state(false);
  let copied = $state(false);
  /** @type {{ top: number, left: number } | null} */
  let anchor = $state(null);
  /** @type {HTMLButtonElement | undefined} */
  let button = $state();
  /** @type {HTMLElement | undefined} */
  let panel = $state();

  const link = $derived(apiUrl(`${SHARE_PATH}${note.id}`));
  const syncing = $derived(note.public && store.isPending('notes', note.id));
  const canShare = typeof navigator.share === 'function';

  /** Pins the panel under the button, or makes it a bottom sheet on narrow screens. */
  function place() {
    const rect = button?.getBoundingClientRect();
    anchor = !rect || innerWidth < SHEET_BREAKPOINT_PX ? null
      : { top: rect.bottom + GAP_PX, left: Math.max(EDGE_PX, Math.min(rect.right - PANEL_WIDTH_PX, innerWidth - PANEL_WIDTH_PX - EDGE_PX)) };
  }

  function toggle() {
    if (!open) place();
    open = !open;
  }

  async function copyLink() {
    copied = await copyText(link);
    setTimeout(() => (copied = false), COPIED_MS);
  }

  /** Clicks outside the panel close it. @param {PointerEvent} event */
  function onWindowPointer(event) {
    const target = /** @type {Node} */ (event.target);
    if (open && !panel?.contains(target) && !button?.contains(target)) open = false;
  }

  /** Escape closes the panel; the editor sees [data-popover] and keeps the note open. @param {KeyboardEvent} event */
  function onWindowKey(event) {
    if (!open || event.key !== 'Escape') return;
    open = false;
    button?.focus();
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onWindowKey} onresize={() => open && place()} />

<button bind:this={button} class="{className} {note.public ? 'text-accent' : ''}" aria-expanded={open} aria-haspopup="dialog" onclick={toggle} title="Share">
  {#if note.public}<Globe class="size-4" />{:else}<Share2 class="size-4" />{/if}<span class="hidden sm:inline">Share</span>
</button>

{#if open}
  <div bind:this={panel} data-popover role="dialog" aria-label="Share note" tabindex="-1"
    class="fixed z-50 flex flex-col gap-3 border border-line-strong bg-surface p-4 text-ink shadow-2xl {anchor ? 'w-88' : 'inset-x-0 bottom-0 border-x-0 border-b-0 pb-[max(1rem,env(safe-area-inset-bottom))]'}"
    style={anchor ? `top: ${anchor.top}px; left: ${anchor.left}px` : ''}
    in:fly={{ y: anchor ? -6 : 24, duration: 180 }} out:fade={{ duration: 100 }}>
    <div class="flex items-center justify-between">
      <h2 class="font-mono text-[11px] uppercase tracking-widest text-ink-faint">Share</h2>
      <button class="spring press -m-1 p-1 text-ink-muted hover:text-ink" aria-label="Close share" onclick={() => (open = false)}><X class="size-4" /></button>
    </div>

    <button role="switch" aria-checked={Boolean(note.public)} onclick={() => store.update('notes', note.id, { public: !note.public })}
      class="spring press flex items-center gap-3 border border-line p-3 text-left hover:border-line-strong">
      <span class="flex size-9 shrink-0 items-center justify-center {note.public ? 'bg-accent-soft text-accent' : 'bg-surface-raised text-ink-muted'}">
        {#if note.public}<Globe class="size-4" />{:else}<Lock class="size-4" />{/if}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-semibold">{note.public ? 'Public' : 'Private'}</span>
        <span class="block text-xs text-ink-muted">{note.public ? 'Anyone with the link can read it.' : 'Only you can see this note.'}</span>
      </span>
      <span class="relative h-5 w-9 shrink-0 border {note.public ? 'border-accent bg-accent' : 'border-line-strong bg-surface-raised'} spring" aria-hidden="true">
        <span class="spring absolute top-0.5 left-0.5 size-3.5 {note.public ? 'translate-x-4 bg-accent-ink' : 'bg-ink-faint'}"></span>
      </span>
    </button>

    {#if note.public}
      <div class="flex flex-col gap-2" transition:fade={{ duration: 120 }}>
        <div class="flex border border-line">
          <input class="selectable min-w-0 flex-1 bg-transparent px-2.5 py-2 font-mono text-xs text-ink-muted focus:outline-none" value={link} readonly aria-label="Public link"
            onfocus={(event) => event.currentTarget.select()} />
          <button class="spring press flex items-center gap-1.5 border-l border-line px-3 text-xs font-semibold text-accent hover:bg-surface-raised" onclick={copyLink}>
            <Link class="size-3.5" />{copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div class="flex gap-2">
          {#if canShare}
            <button class="spring press flex flex-1 items-center justify-center gap-1.5 bg-accent px-3 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
              onclick={() => navigator.share({ title: note.title || 'wordsmith note', url: link }).catch(() => {})}><Share2 class="size-4" />Share…</button>
          {/if}
          <a class="spring press flex flex-1 items-center justify-center gap-1.5 border border-line px-3 py-2 text-sm text-ink-muted hover:border-line-strong hover:text-ink"
            href={link} target="_blank" rel="noopener noreferrer"><ExternalLink class="size-4" />Open</a>
        </div>
        <p class="text-[11px] leading-snug text-ink-faint">
          {syncing ? 'Publishing… the link works once this note syncs.' : 'Link previews show the title, the first lines and your name and avatar. Attachments stay private.'}
        </p>
      </div>
    {/if}
  </div>
{/if}
