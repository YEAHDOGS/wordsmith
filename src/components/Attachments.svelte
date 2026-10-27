<script>
  // Images and videos on a note: pick, drop or paste files in; thumbnails with upload progress; click to view full size.
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import Play from '@lucide/svelte/icons/play';
  import Trash from '@lucide/svelte/icons/trash';
  import X from '@lucide/svelte/icons/x';
  import { fade, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import AttachmentMedia from './AttachmentMedia.svelte';
  import { store } from '../lib/store.svelte.js';
  import { IMAGE_TYPES, MAX_ATTACHMENTS_PER_NOTE, VIDEO_TYPES } from '../lib/models.js';

  /** @type {{ noteId: string }} */
  let { noteId } = $props();

  const ACCEPT = [...IMAGE_TYPES, ...VIDEO_TYPES].join(',');
  const KB = 1024;
  const MB = KB * KB;

  /** @type {HTMLInputElement | undefined} */
  let picker = $state();
  /** @type {any} */
  let viewing = $state(null);
  let error = $state('');

  const files = $derived(store.attachmentsFor(noteId));
  const uploads = $derived(store.uploads.filter((upload) => upload.noteId === noteId));

  /** Called by the editor too, for drops and pastes anywhere on the note. @param {File[]} list */
  export function add(list) {
    error = '';
    const allowed = list.filter((file) => IMAGE_TYPES.includes(file.type) || VIDEO_TYPES.includes(file.type));
    if (allowed.length < list.length) error = 'Only images and videos can be attached.';
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
</script>

<section aria-label="Attachments">
  <div class="mb-2 flex items-center gap-2">
    <button class="spring press inline-flex items-center gap-1.5 border border-line px-2.5 py-1.5 text-xs text-ink-muted hover:border-accent hover:text-ink" onclick={() => picker?.click()}>
      <Paperclip class="size-3.5" />Attach image or video
    </button>
    <span class="font-mono text-[11px] text-ink-faint">or drop / paste onto the note</span>
    <input bind:this={picker} type="file" accept={ACCEPT} multiple class="hidden" onchange={(event) => { add([...(event.currentTarget.files || [])]); event.currentTarget.value = ''; }} />
  </div>

  {#if files.length || uploads.length}
    <div class="flex flex-wrap gap-2">
      {#each files as file (file.id)}
        <div class="group relative size-24 overflow-hidden border border-line bg-app sm:size-28 tv:size-40" animate:flip={{ duration: 200 }} in:scale={{ start: 0.9, duration: 150 }}>
          <button class="block size-full" onclick={() => (viewing = file)} aria-label="View {file.name}">
            <AttachmentMedia {file} class="size-full object-cover" />
            {#if file.type.startsWith('video/')}
              <span class="absolute inset-0 flex items-center justify-center"><span class="flex size-9 items-center justify-center rounded-full bg-scrim text-ink"><Play class="size-4" /></span></span>
            {/if}
          </button>
          <button class="spring press absolute top-1 right-1 bg-scrim p-1 text-ink opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-accent" aria-label="Delete {file.name}" onclick={() => remove(file)}>
            <Trash class="size-3.5" />
          </button>
        </div>
      {/each}
      {#each uploads as upload (upload.id)}
        <div class="relative flex size-24 flex-col justify-end border border-line bg-surface p-2 sm:size-28 tv:size-40" transition:fade={{ duration: 150 }}>
          <p class="truncate text-[11px] text-ink-muted">{upload.name}</p>
          {#if upload.error}
            <p class="text-[11px] text-accent">{upload.error}</p>
            <button class="absolute top-1 right-1 p-1 text-ink-faint hover:text-ink" aria-label="Dismiss" onclick={() => store.dismissUpload(upload.id)}><X class="size-3.5" /></button>
          {:else}
            <div class="mt-1 h-1 w-full overflow-hidden bg-line">
              <div class="h-full origin-left bg-accent transition-transform duration-150" style="transform: scaleX({upload.progress})"></div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
  {#if error}<p class="mt-1 text-xs text-accent" role="alert">{error}</p>{/if}
</section>

{#if viewing}
  <!-- data-lightbox tells the note dialog not to close on Escape while this is open -->
  <div data-lightbox class="fixed inset-0 z-50 flex flex-col bg-scrim" transition:fade={{ duration: 150 }} role="dialog" aria-modal="true" aria-label={viewing.name}>
    <div class="flex items-center gap-3 bg-app px-4 py-2">
      <p class="min-w-0 flex-1 truncate text-sm">{viewing.name}</p>
      <span class="font-mono text-[11px] text-ink-faint">{viewing.size < MB ? `${Math.ceil(viewing.size / KB)} KB` : `${(viewing.size / MB).toFixed(1)} MB`}</span>
      <button class="spring press p-1 text-ink-muted hover:text-ink" aria-label="Close" onclick={() => (viewing = null)}><X class="size-5" /></button>
    </div>
    <div class="relative flex min-h-0 flex-1 items-center justify-center p-4">
      <button class="absolute inset-0 cursor-default" aria-label="Close" tabindex="-1" onclick={() => (viewing = null)}></button>
      <div class="relative flex max-h-full max-w-full" in:scale={{ start: 0.95, duration: 200 }}>
        <AttachmentMedia file={viewing} controls class="max-h-[calc(100dvh-6rem)] max-w-full object-contain" />
      </div>
    </div>
  </div>
{/if}

<svelte:window onkeydown={(event) => viewing && event.key === 'Escape' && (viewing = null)} />
