<script>
  // Images, video, audio and documents on a note: pick, drop or paste files in; thumbnails (file tiles for audio and documents) with
  // upload progress; click one to open the carousel (MediaCarousel.svelte) on it and step through the rest.
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import Play from '@lucide/svelte/icons/play';
  import Trash from '@lucide/svelte/icons/trash';
  import { fade, fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import X from '@lucide/svelte/icons/x';
  import AttachmentMedia from './AttachmentMedia.svelte';
  import MediaCarousel from './MediaCarousel.svelte';
  import DocumentTile from './DocumentTile.svelte';
  import AudioTile from './AudioTile.svelte';
  import { store } from '../lib/store.svelte.js';
  import { ACCEPT_ATTACHMENTS, MAX_ATTACHMENTS_PER_NOTE, attachmentKind, uploadType } from '../lib/models.js';

  /** @type {{ noteId: string }} */
  let { noteId } = $props();

  /** @type {HTMLInputElement | undefined} */
  let picker = $state();
  // The attachment open in the carousel, by id ('' = closed).
  let viewingId = $state('');
  let error = $state('');

  const files = $derived(store.attachmentsFor(noteId));
  const uploads = $derived(store.uploads.filter((upload) => upload.noteId === noteId));

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

  /** The carousel closes by itself when the attachment it shows goes away. @param {any} file */
  async function remove(file) {
    await store.deleteAttachment(file.id).catch((failure) => (error = failure.message));
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
      {#each files as file (file.id)}
        <div class="group relative aspect-square overflow-hidden border border-line bg-app sm:size-28 tv:size-40" animate:flip={{ duration: 200 }} in:scale={{ start: 0.9, duration: 150 }} out:fade={{ duration: 120 }}>
          <button class="block size-full" onclick={() => (viewingId = file.id)} aria-label="View {file.name}">
            {#if attachmentKind(file.type) === 'document'}
              <DocumentTile {file} class="size-full" />
            {:else if attachmentKind(file.type) === 'audio'}
              <AudioTile {file} class="size-full" playable />
            {:else}
              <AttachmentMedia {file} class="size-full object-cover" />
            {/if}
            {#if attachmentKind(file.type) === 'video'}
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
  {#if error}<p class="mt-1 text-xs text-accent" role="alert" in:fly={{ y: -4, duration: 150 }} out:fade={{ duration: 100 }}>{error}</p>{/if}
</section>

{#if viewingId}
  <MediaCarousel {files} bind:id={viewingId} onclose={() => (viewingId = '')} />
{/if}
