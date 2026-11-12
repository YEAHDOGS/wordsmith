<script>
  // Full-screen media carousel: one attachment on the stage, every attachment as a thumbnail in a strip underneath.
  // Left / Right (also Home / End, the edge buttons, a swipe, or a thumbnail) move through them; Escape closes.
  // Used by a note's attachments and by a project's Media tab. The stage and the strip have fixed boxes and slides
  // are positioned absolutely inside the stage, so moving between media never shifts the layout.
  // An open image can be copied to the clipboard where the browser supports writing images.
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Play from '@lucide/svelte/icons/play';
  import X from '@lucide/svelte/icons/x';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import { fade, fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import AttachmentMedia from './AttachmentMedia.svelte';
  import DocumentPreview from './DocumentPreview.svelte';
  import DocumentTile from './DocumentTile.svelte';
  import AudioTile from './AudioTile.svelte';
  import { mediaUrl } from '../lib/api.js';
  import { attachmentKind } from '../lib/models.js';
  import { fileSize } from '../lib/documents.js';

  /**
   * @type {{
   *   files: any[],
   *   id: string,
   *   onclose: () => void,
   *   caption?: (file: any) => string,
   *   onopen?: (file: any) => void,
   *   openLabel?: string,
   * }}
   * files: what the carousel walks through, in order. id (bindable): the attachment on the stage.
   * caption: a line shown before the file name (the Media tab passes the note's title).
   * onopen + openLabel: an extra header button for the current file (the Media tab's "Open note").
   */
  let { files, id = $bindable(), onclose, caption, onopen, openLabel = '' } = $props();

  const PNG = 'image/png';
  const COPIED_MS = 1400;
  // A horizontal drag on the stage this long counts as a swipe.
  const SWIPE_PX = 48;
  const SLIDE_PX = 48;
  const SLIDE_IN_MS = 240;
  const SLIDE_OUT_MS = 120;
  const OVERLAY_MS = 150;
  // Keys the stage leaves to whatever has focus: players seek with the arrows, fields move the caret.
  const KEY_OWNERS = 'input, textarea, select, video, audio, [contenteditable]';
  // A press on these is never the start of a swipe.
  const SWIPE_IGNORED = 'video, audio, a, button, pre';
  // Crossfade for the copy button's icon, so the swap to the check mark never changes its size
  const SWAP = 'transition-[opacity,scale] duration-150 ease-(--ease-spring)';
  const ICON_BUTTON = 'spring press flex size-9 shrink-0 items-center justify-center text-ink-muted hover:text-ink disabled:opacity-30 tv:size-14';
  const EDGE_BUTTON = 'spring press absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center border border-line bg-app text-ink hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-0 short:size-8 tv:size-16';
  // Browsers only accept PNG images on the clipboard; the button hides where image writes aren't supported
  const CAN_COPY_IMAGE = typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function'
    && (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports(PNG));
  const COPY_LABEL = { idle: 'Copy image', copying: 'Copy image', copied: 'Copied', failed: "Couldn't copy" };

  // +1 when the last move went forward, -1 back: the side the new slide comes in from.
  let direction = $state(1);
  /** @type {'idle' | 'copying' | 'copied' | 'failed'} */
  let copyState = $state('idle');
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let copyTimer;
  /** @type {HTMLElement | undefined} */
  let strip = $state();
  /** Where a possible swipe started. @type {{ x: number, y: number } | null} */
  let press = null;

  const index = $derived(files.findIndex((file) => file.id === id));
  const current = $derived(files[index]);
  const canCopy = $derived(CAN_COPY_IMAGE && Boolean(current?.type.startsWith('image/')));

  // The attachment on the stage was deleted (here or on another device): nothing left to show.
  $effect(() => {
    if (!current) onclose();
  });

  // Keep the current thumbnail in view, centered when the strip can scroll that far.
  $effect(() => {
    const thumb = /** @type {HTMLElement | undefined} */ (strip?.children[index]);
    if (!strip || !thumb) return;
    strip.scrollTo({ left: thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2, behavior: 'smooth' });
  });

  /** Puts another attachment on the stage. @param {number} target index into files */
  function show(target) {
    const next = Math.max(0, Math.min(files.length - 1, target));
    if (next === index) return;
    direction = next > index ? 1 : -1;
    clearTimeout(copyTimer);
    copyState = 'idle';
    id = files[next].id;
  }

  /** @param {KeyboardEvent} event */
  function onkeydown(event) {
    if (event.key === 'Escape') return onclose();
    if (/** @type {HTMLElement} */ (event.target).closest?.(KEY_OWNERS)) return;
    const target = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: files.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    show(target);
  }

  /** @param {PointerEvent} event */
  function swipeStart(event) {
    press = /** @type {HTMLElement} */ (event.target).closest(SWIPE_IGNORED) ? null : { x: event.clientX, y: event.clientY };
  }

  /** @param {PointerEvent} event */
  function swipeEnd(event) {
    if (!press) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    press = null;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
  }

  /** A mouse wheel moves the strip sideways. @param {WheelEvent & { currentTarget: HTMLElement }} event */
  function stripWheel(event) {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
  }

  /**
   * The attachment as a PNG blob. PNGs pass straight through; other formats are decoded and redrawn on a canvas.
   * @param {any} file
   * @returns {Promise<Blob>}
   */
  async function pngBlob(file) {
    const url = await mediaUrl(file.url);
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error('Could not load the image');
    const blob = await response.blob();
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    if (blob.type === PNG) return blob;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise((resolve, reject) => canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('Could not convert the image'))), PNG));
  }

  /** Copies the open image. The ClipboardItem gets a promise, so Safari still counts the write as part of the click. */
  async function copyImage() {
    if (!canCopy || copyState === 'copying') return;
    clearTimeout(copyTimer);
    copyState = 'copying';
    try {
      await navigator.clipboard.write([new ClipboardItem({ [PNG]: pngBlob(current) })]);
      copyState = 'copied';
    } catch {
      copyState = 'failed';
    }
    copyTimer = setTimeout(() => (copyState = 'idle'), COPIED_MS);
  }
</script>

<svelte:window {onkeydown} />

{#if current}
  {@const kind = attachmentKind(current.type)}
  {@const lead = caption?.(current) ?? ''}
  <!-- data-lightbox tells the note dialog not to close on Escape while this is open -->
  <div data-lightbox class="fixed inset-0 z-50 flex flex-col bg-scrim" transition:fade={{ duration: OVERLAY_MS }} role="dialog" aria-modal="true" aria-label="Media: {current.name}">
    <header class="flex shrink-0 items-center gap-1 border-b border-line bg-app py-1 pr-1 pl-3 sm:gap-2 sm:pl-4 tv:py-3">
      <p class="min-w-0 flex-1 truncate text-sm tv:text-xl">
        {#if lead}<span class="font-semibold">{lead}</span><span class="text-ink-faint"> · </span>{/if}<span class={lead ? 'text-ink-muted' : ''}>{current.name}</span>
      </p>
      <span class="hidden shrink-0 font-mono text-[0.6875rem] text-ink-faint sm:inline tv:text-base">{fileSize(current.size)}</span>
      <span class="shrink-0 px-1 font-mono text-[0.6875rem] text-ink-muted tv:text-base" aria-live="polite" aria-label="{index + 1} of {files.length}">{index + 1} / {files.length}</span>
      {#if canCopy}
        <button class="{ICON_BUTTON} {copyState === 'copied' ? 'text-complete' : copyState === 'failed' ? 'text-accent' : ''}" onclick={copyImage} disabled={copyState === 'copying'}
          aria-label={COPY_LABEL[copyState]} title={COPY_LABEL[copyState]}>
          <span class="grid *:col-start-1 *:row-start-1" aria-hidden="true">
            <Copy class="size-4 tv:size-6 {SWAP} {copyState === 'copied' ? 'scale-50 opacity-0' : ''}" />
            <Check class="size-4 tv:size-6 {SWAP} {copyState === 'copied' ? '' : 'scale-50 opacity-0'}" />
          </span>
        </button>
      {/if}
      {#if onopen}
        <button class="spring press flex h-9 shrink-0 items-center gap-1.5 border border-line-strong px-2.5 text-xs font-semibold text-ink hover:border-accent tv:h-14 tv:px-4 tv:text-lg" onclick={() => onopen(current)}>
          <span class="hidden sm:inline">{openLabel}</span><ArrowUpRight class="size-4" aria-label={openLabel} />
        </button>
      {/if}
      <button class={ICON_BUTTON} aria-label="Close" onclick={onclose}><X class="size-5 tv:size-7" /></button>
    </header>

    <!-- The stage: slides sit on top of each other, so the one leaving and the one arriving never push anything -->
    <div class="relative min-h-0 flex-1 touch-pan-y overflow-hidden" role="group" aria-roledescription="carousel" aria-label="Media" onpointerdown={swipeStart} onpointerup={swipeEnd} onpointercancel={() => (press = null)}>
      <button class="absolute inset-0 cursor-default" aria-label="Close" tabindex="-1" ondblclick={onclose}></button>
      {#key current.id}
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center p-3 *:pointer-events-auto sm:px-16 sm:py-4 short:py-2"
          in:fly={{ x: direction * SLIDE_PX, duration: SLIDE_IN_MS, easing: quintOut }} out:fade={{ duration: SLIDE_OUT_MS }}>
          {#if kind === 'document'}
            <DocumentPreview file={current} />
          {:else if kind === 'audio'}
            <!-- Audio plays like a video: the tile stands in for the picture, the player sits under it -->
            <div class="flex max-h-full w-[min(100%,28rem)] flex-col gap-3">
              <AudioTile file={current} class="aspect-square min-h-0 w-full flex-1 border border-line short:aspect-auto" />
              <AttachmentMedia file={current} controls class="w-full shrink-0" />
            </div>
          {:else}
            <AttachmentMedia file={current} controls class="max-h-full max-w-full object-contain" />
          {/if}
        </div>
      {/key}
      <button class="{EDGE_BUTTON} left-2 sm:left-3" aria-label="Previous" disabled={index <= 0} onclick={() => show(index - 1)}><ChevronLeft class="size-5 tv:size-8" /></button>
      <button class="{EDGE_BUTTON} right-2 sm:right-3" aria-label="Next" disabled={index >= files.length - 1} onclick={() => show(index + 1)}><ChevronRight class="size-5 tv:size-8" /></button>
    </div>

    <!-- Every attachment, in order. Scrolls sideways by swipe, wheel or trackpad; the current one stays centered. -->
    <div bind:this={strip} class="scrollbar-none relative flex shrink-0 gap-1 overflow-x-auto overscroll-contain border-t border-line bg-app p-1.5 sm:gap-1.5 sm:p-2" role="tablist" aria-label="All media" onwheel={stripWheel}>
      {#each files as file, position (file.id)}
        {@const thumbKind = attachmentKind(file.type)}
        <button role="tab" aria-selected={file.id === id} aria-label="{position + 1} of {files.length}: {file.name}" title={file.name} onclick={() => show(position)}
          class="spring relative size-14 shrink-0 overflow-hidden border bg-app short:size-10 tv:size-24
            {file.id === id ? 'border-accent' : 'border-line opacity-55 hover:border-line-strong hover:opacity-100 focus-visible:opacity-100'}">
          {#if thumbKind === 'document'}
            <DocumentTile {file} compact class="size-full" />
          {:else if thumbKind === 'audio'}
            <AudioTile {file} compact class="size-full" />
          {:else}
            <AttachmentMedia {file} class="size-full object-cover" />
          {/if}
          {#if thumbKind === 'video'}
            <span class="pointer-events-none absolute inset-0 flex items-center justify-center"><span class="flex size-5 items-center justify-center rounded-full bg-scrim text-ink"><Play class="size-3" /></span></span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}
