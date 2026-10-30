<script>
  // Images, video, audio and documents on a note: pick, drop or paste files in; thumbnails (file tiles for audio and documents) with
  // upload progress; click to view full size, or a document's preview and its open / download link.
  // The full-size view can copy an image to the clipboard where the browser supports writing images.
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import Play from '@lucide/svelte/icons/play';
  import Trash from '@lucide/svelte/icons/trash';
  import X from '@lucide/svelte/icons/x';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import { fade, fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import AttachmentMedia from './AttachmentMedia.svelte';
  import DocumentPreview from './DocumentPreview.svelte';
  import DocumentTile from './DocumentTile.svelte';
  import { store } from '../lib/store.svelte.js';
  import { mediaUrl } from '../lib/api.js';
  import { ACCEPT_ATTACHMENTS, MAX_ATTACHMENTS_PER_NOTE, attachmentKind, uploadType } from '../lib/models.js';
  import { fileSize } from '../lib/documents.js';

  /** @type {{ noteId: string }} */
  let { noteId } = $props();

  const PNG = 'image/png';
  const COPIED_MS = 1400;
  // Crossfade for the copy button's icon and label, so the swap to "Copied" never changes its size
  const SWAP = 'transition-[opacity,scale] duration-150 ease-(--ease-spring)';
  // Browsers only accept PNG images on the clipboard; the button hides where image writes aren't supported
  const CAN_COPY_IMAGE = typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function'
    && (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports(PNG));

  /** @type {HTMLInputElement | undefined} */
  let picker = $state();
  /** @type {any} */
  let viewing = $state(null);
  let error = $state('');
  /** @type {'idle' | 'copying' | 'copied' | 'failed'} */
  let copyState = $state('idle');
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let copyTimer;

  const files = $derived(store.attachmentsFor(noteId));
  const uploads = $derived(store.uploads.filter((upload) => upload.noteId === noteId));
  const canCopyViewing = $derived(CAN_COPY_IMAGE && Boolean(viewing?.type.startsWith('image/')));

  /** Called by the editor too, for drops and pastes anywhere on the note. @param {File[]} list */
  export function add(list) {
    error = '';
    const allowed = list.filter((file) => uploadType(file));
    if (allowed.length < list.length) error = 'Choose a supported image, video, audio file, or document.';
    if (!allowed.length) return;
    if (!navigator.onLine) {
      error = 'Attachments need a connection. Try again when you are back online.';
      return;
    }
    store.upload(noteId, allowed.slice(0, MAX_ATTACHMENTS_PER_NOTE - files.length));
  }

  /** @param {any} file */
  async function remove(file) {
    if (viewing?.id === file.id) viewing = null;
    await store.deleteAttachment(file.id).catch((failure) => (error = failure.message));
  }

  /** @param {any} file */
  function view(file) {
    clearTimeout(copyTimer);
    copyState = 'idle';
    viewing = file;
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
    if (!canCopyViewing || copyState === 'copying') return;
    clearTimeout(copyTimer);
    copyState = 'copying';
    try {
      await navigator.clipboard.write([new ClipboardItem({ [PNG]: pngBlob(viewing) })]);
      copyState = 'copied';
    } catch {
      copyState = 'failed';
    }
    copyTimer = setTimeout(() => (copyState = 'idle'), COPIED_MS);
  }
</script>

<section aria-label="Attachments">
  <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
    <button class="spring press inline-flex w-full items-center justify-center gap-1.5 border border-dashed border-line-strong px-3 py-2.5 text-xs text-ink-muted hover:border-accent hover:text-ink sm:w-auto sm:justify-start sm:border-solid sm:border-line sm:px-2.5 sm:py-1.5"
      onclick={() => picker?.click()}>
      <Paperclip class="size-3.5" />Attach a file
    </button>
    <span class="hidden font-mono text-[0.6875rem] text-ink-faint sm:inline">or drop / paste onto the note</span>
    <input bind:this={picker} type="file" accept={ACCEPT_ATTACHMENTS} multiple class="hidden" onchange={(event) => { add([...(event.currentTarget.files || [])]); event.currentTarget.value = ''; }} />
  </div>

  {#if files.length || uploads.length}
    <!-- Phones: an even three-column grid of square tiles. Wider screens: fixed-size tiles that wrap. -->
    <div class="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap" transition:fade={{ duration: 150 }}>
      {#each files.filter((file) => attachmentKind(file.type) !== 'audio') as file (file.id)}
        <div class="group relative aspect-square overflow-hidden border border-line bg-app sm:size-28 tv:size-40" animate:flip={{ duration: 200 }} in:scale={{ start: 0.9, duration: 150 }} out:fade={{ duration: 120 }}>
          <button class="block size-full" onclick={() => view(file)} aria-label="View {file.name}">
            {#if attachmentKind(file.type) === 'document'}
              <DocumentTile {file} class="size-full" />

            {:else}
              <AttachmentMedia {file} class="size-full object-cover" />
            {/if}
            {#if file.type.startsWith('video/')}
              <span class="absolute inset-0 flex items-center justify-center"><span class="flex size-9 items-center justify-center rounded-full bg-scrim text-ink"><Play class="size-4" /></span></span>
            {/if}
          </button>
          <button class="spring press absolute top-1 right-1 bg-scrim p-1.5 text-ink opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 hover:text-accent sm:p-1" aria-label="Delete {file.name}" onclick={() => remove(file)}>
            <Trash class="size-3.5" />
          </button>
        </div>
      {/each}
      {#each uploads as upload (upload.id)}
        <div class="relative flex aspect-square flex-col justify-end border border-line bg-surface p-2 sm:size-28 tv:size-40" animate:flip={{ duration: 200 }} in:scale={{ start: 0.9, duration: 150 }} out:fade={{ duration: 150 }}>
          <p class="truncate text-[0.6875rem] text-ink-muted">{upload.name}</p>
          {#if upload.error}
            <p class="text-[0.6875rem] text-accent" in:fade={{ duration: 150 }}>{upload.error}</p>
            <button class="spring press absolute top-1 right-1 p-1 text-ink-faint hover:text-ink" aria-label="Dismiss" onclick={() => store.dismissUpload(upload.id)}><X class="size-3.5" /></button>
          {:else}
            <div class="mt-1 h-1 w-full overflow-hidden bg-line">
              <div class="h-full origin-left bg-accent transition-transform duration-150" style="transform: scaleX({upload.progress})"></div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
  {#each files.filter((file) => attachmentKind(file.type) === 'audio') as file (file.id)}
    <div class="mt-2 flex min-w-0 items-center gap-2 border border-line p-2">
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs text-ink-muted" title={file.name}>{file.name}</p>
        <AttachmentMedia {file} controls class="h-10 w-full min-w-0 max-w-full" />
      </div>
      <button class="spring press shrink-0 p-2 text-ink-muted hover:text-accent" aria-label="Delete {file.name}" onclick={() => remove(file)}><Trash class="size-3.5" /></button>
    </div>
  {/each}
  {#if error}<p class="mt-1 text-xs text-accent" role="alert" in:fly={{ y: -4, duration: 150 }} out:fade={{ duration: 100 }}>{error}</p>{/if}
</section>

{#if viewing}
  <!-- data-lightbox tells the note dialog not to close on Escape while this is open -->
  <div data-lightbox class="fixed inset-0 z-50 flex flex-col bg-scrim" transition:fade={{ duration: 150 }} role="dialog" aria-modal="true" aria-label={viewing.name}>
    <div class="flex items-center gap-3 bg-app px-4 py-2">
      <p class="min-w-0 flex-1 truncate text-sm">{viewing.name}</p>
      <span class="font-mono text-[0.6875rem] text-ink-faint">{fileSize(viewing.size)}</span>
      <button class="spring press p-1 text-ink-muted hover:text-ink" aria-label="Close" onclick={() => (viewing = null)}><X class="size-5" /></button>
    </div>
    <div class="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4">
      <button class="absolute inset-0 cursor-default" aria-label="Close" tabindex="-1" ondblclick={() => (viewing = null)}></button>
      <div class="relative flex min-h-0 max-w-full" in:scale={{ start: 0.95, duration: 200 }}>
        {#if attachmentKind(viewing.type) === 'document'}
          <DocumentPreview file={viewing} />
        {:else}
          <AttachmentMedia file={viewing} controls class="max-w-full object-contain {canCopyViewing ? 'max-h-[calc(100dvh-9rem)]' : 'max-h-[calc(100dvh-6rem)]'}" />
        {/if}
      </div>
      {#if canCopyViewing}
        <!-- Both labels share one grid cell, so the button keeps its width as the label changes -->
        <button class="spring press relative flex shrink-0 items-center gap-2 border border-line-strong bg-app px-4 py-2 text-sm font-semibold hover:border-accent
          {copyState === 'copied' ? 'text-complete' : copyState === 'failed' ? 'text-accent' : 'text-ink'}"
          onclick={copyImage} disabled={copyState === 'copying'} in:fly={{ y: 8, duration: 200, delay: 60 }}>
          <span class="grid *:col-start-1 *:row-start-1" aria-hidden="true">
            <Copy class="size-4 {SWAP} {copyState === 'copied' ? 'scale-50 opacity-0' : ''} {copyState === 'copying' ? 'opacity-50' : ''}" />
            <Check class="size-4 {SWAP} {copyState === 'copied' ? '' : 'scale-50 opacity-0'}" />
          </span>
          <span class="grid *:col-start-1 *:row-start-1" aria-live="polite">
            <span class="{SWAP} {copyState === 'idle' || copyState === 'copying' ? '' : 'opacity-0'}" aria-hidden={copyState === 'copied' || copyState === 'failed'}>Copy image</span>
            <span class="{SWAP} {copyState === 'copied' ? '' : 'opacity-0'}" aria-hidden={copyState !== 'copied'}>Copied</span>
            <span class="{SWAP} {copyState === 'failed' ? '' : 'opacity-0'}" aria-hidden={copyState !== 'failed'}>Couldn't copy</span>
          </span>
        </button>
      {/if}
    </div>
  </div>
{/if}

<svelte:window onkeydown={(event) => viewing && event.key === 'Escape' && (viewing = null)} />
