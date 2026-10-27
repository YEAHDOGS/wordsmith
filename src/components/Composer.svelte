<script>
  // Quick capture, Google Keep style. Collapsed it is one line; focus expands it. Enter in the title saves,
  // Shift+Enter adds a line. Images and videos can be picked, dropped or pasted in: they wait as thumbnails and
  // upload once the note is saved (a note has to reach the server before files can hang off it).
  // Outside a project a Note / Feature toggle picks the kind. Inside a project the composer only takes notes, and the
  // lightbulb beside Save unfolds a small "Create a feature request" form with its own title, details and priority.
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import Play from '@lucide/svelte/icons/play';
  import StickyNote from '@lucide/svelte/icons/sticky-note';
  import X from '@lucide/svelte/icons/x';
  import { fade, scale, slide } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { store } from '../lib/store.svelte.js';
  import { IMAGE_TYPES, MAX_ATTACHMENTS_PER_NOTE, MAX_BODY, MAX_IMAGE_BYTES, MAX_TITLE, MAX_VIDEO_BYTES, PRIORITY_LABELS, VIDEO_TYPES } from '../lib/models.js';
  import { markdownKeys } from '../lib/markdown-input.js';
  import MarkdownToolbar from './MarkdownToolbar.svelte';

  /** @type {{ projectId?: string | null, labelId?: string | null, defaultKind?: 'note' | 'feature' }} */
  let { projectId = null, labelId = null, defaultKind = 'note' } = $props();

  const FLASH_MS = 400;
  const PANEL_MS = 150;
  const THUMB_MS = 150;
  const ACCEPT = [...IMAGE_TYPES, ...VIDEO_TYPES].join(',');
  // Waiting for a just-saved note to reach the server before uploading: a sync already in flight may not carry it.
  const SYNC_RETRY_MS = 500;
  const SYNC_TRIES = 20;
  // The feature form offers priorities 1..5 (0 "None" is left to the note editor); new requests start at Normal.
  const REQUEST_PRIORITIES = PRIORITY_LABELS.map((label, value) => ({ label, value })).slice(1);
  const DEFAULT_PRIORITY = PRIORITY_LABELS.indexOf('Normal');
  const ERROR_TYPE = 'Only images and videos can be attached.';
  const ERROR_SIZE = 'Some files were too large to attach.';
  const ERROR_COUNT = `A note holds up to ${MAX_ATTACHMENTS_PER_NOTE} files.`;

  let expanded = $state(false);
  let title = $state('');
  let body = $state('');
  let kind = $state(/** @type {'note' | 'feature'} */ ('note'));
  let flash = $state(false);
  /** Files waiting for the note to be saved, each with a preview URL. @type {{ id: string, file: File, url: string }[]} */
  let queued = $state([]);
  let fileError = $state('');
  /** Notes this composer saved with files, so their upload progress and errors show here. @type {string[]} */
  let sentNoteIds = $state([]);
  // Feature request form (projects only)
  let requesting = $state(false);
  let requestTitle = $state('');
  let requestBody = $state('');
  let requestPriority = $state(DEFAULT_PRIORITY);
  /** @type {HTMLElement | undefined} */
  let root = $state();
  /** @type {HTMLTextAreaElement | undefined} */
  let details = $state();
  /** @type {HTMLInputElement | undefined} */
  let picker = $state();
  // Focus parks on these before the focused control disappears, so the composer doesn't read it as focus leaving.
  /** @type {HTMLButtonElement | undefined} */
  let attachButton = $state();
  /** @type {HTMLButtonElement | undefined} */
  let ideaButton = $state();

  const inProject = $derived(Boolean(projectId));
  $effect.pre(() => {
    kind = projectId ? 'note' : defaultKind;
  });

  const placeholder = $derived(kind === 'feature' ? 'Request a feature for your agents…' : 'Take a note…');
  const canSave = $derived(Boolean(title.trim() || body.trim() || queued.length));
  const uploads = $derived(store.uploads.filter((upload) => sentNoteIds.includes(upload.noteId)));
  const failedUploads = $derived(uploads.filter((upload) => upload.error));

  /** Queues picked, dropped or pasted files, keeping only images and videos under the size limits. @param {File[]} list */
  function addFiles(list) {
    fileError = '';
    const media = list.filter((file) => IMAGE_TYPES.includes(file.type) || VIDEO_TYPES.includes(file.type));
    if (media.length < list.length) fileError = ERROR_TYPE;
    const fitting = media.filter((file) => file.size <= (IMAGE_TYPES.includes(file.type) ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES));
    if (fitting.length < media.length) fileError = ERROR_SIZE;
    const room = MAX_ATTACHMENTS_PER_NOTE - queued.length;
    if (fitting.length > room) fileError = ERROR_COUNT;
    const accepted = fitting.slice(0, Math.max(room, 0));
    queued = [...queued, ...accepted.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))];
  }

  /** @param {string} id */
  function unqueue(id) {
    const entry = queued.find((item) => item.id === id);
    if (entry) URL.revokeObjectURL(entry.url);
    attachButton?.focus();
    queued = queued.filter((item) => item.id !== id);
  }

  /**
   * Uploads files to a freshly saved note: waits for a connection, then for the note to reach the server.
   * The store pushes unsynced notes too, but returns early when a sync is already running.
   * @param {string} noteId
   * @param {File[]} files
   */
  async function uploadWhenReady(noteId, files) {
    if (!navigator.onLine) await new Promise((resolve) => addEventListener('online', resolve, { once: true }));
    for (let tries = 0; tries < SYNC_TRIES && store.isPending('notes', noteId); tries++) {
      await store.sync();
      if (store.isPending('notes', noteId)) await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_MS));
    }
    await store.upload(noteId, files);
  }

  function save() {
    if (!canSave) return;
    const note = store.create('notes', { kind, title: title.trim(), body: body.trim(), project_id: projectId, label_ids: labelId ? [labelId] : [] });
    if (queued.length) {
      sentNoteIds = [...sentNoteIds, note.id];
      uploadWhenReady(note.id, queued.map((item) => item.file));
      for (const item of queued) URL.revokeObjectURL(item.url);
    }
    title = '';
    body = '';
    queued = [];
    fileError = '';
    flash = true;
    setTimeout(() => (flash = false), FLASH_MS);
  }

  function request() {
    if (!requestTitle.trim() && !requestBody.trim()) return;
    store.create('notes', { kind: 'feature', title: requestTitle.trim(), body: requestBody.trim(), priority: requestPriority, project_id: projectId, label_ids: labelId ? [labelId] : [] });
    requestTitle = '';
    requestBody = '';
    requestPriority = DEFAULT_PRIORITY;
    ideaButton?.focus();
    requesting = false;
    flash = true;
    setTimeout(() => (flash = false), FLASH_MS);
  }

  /** Collapse once focus leaves the whole composer, saving what was typed. @param {FocusEvent} event */
  function onfocusout(event) {
    if (root?.contains(/** @type {Node | null} */ (event.relatedTarget))) return;
    // The window lost focus (the file picker opened, or another app): focus comes back here, so stay open.
    if (!document.hasFocus()) return;
    save();
    expanded = false;
    requesting = false;
  }

  /** @param {KeyboardEvent} event */
  function onTitleKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      save();
    }
    if (event.key === 'Escape') /** @type {HTMLElement} */ (event.currentTarget).blur();
  }

  /** @param {KeyboardEvent} event */
  function onRequestKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      request();
    }
    if (event.key !== 'Escape') return;
    ideaButton?.focus();
    requesting = false;
  }

  /** Files pasted into the title or details join the queue. @param {ClipboardEvent} event */
  function onpaste(event) {
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    expanded = true;
    addFiles(files);
  }

  /** @param {DragEvent} event */
  function ondrop(event) {
    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    expanded = true;
    addFiles(files);
  }
</script>

<div bind:this={root} class="spring border bg-surface {flash ? 'border-accent' : 'border-line hover:border-line-strong'} focus-within:border-line-strong" role="group" aria-label="New note" {onfocusout}
  ondragover={(event) => event.dataTransfer?.types.includes('Files') && event.preventDefault()} {ondrop}>
  <div class="flex items-center">
    <input bind:value={title} maxlength={MAX_TITLE} {placeholder} aria-label={placeholder}
      class="min-w-0 flex-1 bg-transparent px-4 py-3 short:py-2 text-fluid-base font-semibold text-ink placeholder:font-normal placeholder:text-ink-faint focus:outline-none"
      onfocus={() => (expanded = true)} onkeydown={onTitleKey} {onpaste} />
    {#if !inProject}
      <div class="flex shrink-0 border-l border-line" role="group" aria-label="Kind">
        <button class="spring press flex items-center gap-1.5 px-3 py-3 short:py-2 text-xs {kind === 'note' ? 'bg-surface-raised text-ink' : 'text-ink-faint hover:text-ink'}"
          aria-pressed={kind === 'note'} onclick={() => (kind = 'note')} title="Plain note"><StickyNote class="size-4" /><span class="hidden md:inline">Note</span></button>
        <button class="spring press flex items-center gap-1.5 px-3 py-3 short:py-2 text-xs {kind === 'feature' ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:text-ink'}"
          aria-pressed={kind === 'feature'} onclick={() => (kind = 'feature')} title="Feature request for agents"><Lightbulb class="size-4" /><span class="hidden md:inline">Feature</span></button>
      </div>
    {/if}
  </div>
  {#if expanded}
    <div transition:slide={{ duration: PANEL_MS }}>
      <textarea bind:this={details} bind:value={body} use:markdownKeys maxlength={MAX_BODY} rows="3" placeholder={kind === 'feature' ? 'Details, acceptance criteria, links… agents read all of it' : 'Write anything'} aria-label="Details"
        class="block max-h-60 w-full resize-y border-t border-line bg-transparent px-4 py-3 text-fluid-sm text-ink placeholder:text-ink-faint focus:outline-none" {onpaste}></textarea>

      {#if queued.length}
        <ul class="flex flex-wrap gap-2 border-t border-line px-4 py-2" aria-label="Files to attach" transition:slide={{ duration: PANEL_MS }}>
          {#each queued as item (item.id)}
            <li class="group relative size-16 overflow-hidden border border-line bg-app sm:size-20 tv:size-32" animate:flip={{ duration: THUMB_MS }} transition:scale={{ start: 0.85, duration: THUMB_MS }}>
              {#if item.file.type.startsWith('video/')}
                <!-- Local preview of a recording the user just picked; there are no captions to show -->
                <!-- svelte-ignore a11y_media_has_caption -->
                <video src={item.url} class="size-full object-cover" preload="metadata" playsinline muted></video>
                <span class="pointer-events-none absolute inset-0 flex items-center justify-center"><span class="flex size-7 items-center justify-center rounded-full bg-scrim text-ink"><Play class="size-3.5" /></span></span>
              {:else}
                <img src={item.url} alt={item.file.name} class="size-full object-cover" decoding="async" />
              {/if}
              <button class="spring press absolute top-0.5 right-0.5 bg-scrim p-1 text-ink hover:text-accent" aria-label="Remove {item.file.name}" title="Remove" onclick={() => unqueue(item.id)}>
                <X class="size-3.5" />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if fileError}<p class="border-t border-line px-4 py-1.5 text-xs text-accent" role="alert" transition:slide={{ duration: PANEL_MS }}>{fileError}</p>{/if}

      <div class="flex items-center gap-1 border-t border-line px-1 py-1">
        <button bind:this={attachButton} class="spring press flex size-7 shrink-0 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink sm:size-8 tv:size-11" title="Attach image or video" aria-label="Attach image or video"
          onclick={() => picker?.click()}><Paperclip class="size-4" /></button>
        <input bind:this={picker} type="file" accept={ACCEPT} multiple class="hidden" tabindex="-1" onchange={(event) => { addFiles([...(event.currentTarget.files || [])]); event.currentTarget.value = ''; }} />
        <span class="h-5 w-px shrink-0 bg-line" aria-hidden="true"></span>
        <!-- Formatting sits in the bottom-right corner, beside Save -->
        <MarkdownToolbar textarea={details} class="ml-auto" />
        {#if inProject}
          <button bind:this={ideaButton} class="spring press flex size-7 shrink-0 items-center justify-center sm:size-8 tv:size-11 {requesting ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface-raised hover:text-ink'}"
            title="Create a feature request" aria-label="Create a feature request" aria-expanded={requesting} aria-controls="feature-request-{projectId}" onclick={() => (requesting = !requesting)}>
            <Lightbulb class="spring size-4 {requesting ? 'scale-110' : ''}" />
          </button>
        {/if}
        <button class="spring press shrink-0 bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-40" disabled={!canSave} onclick={save}>
          {kind === 'feature' ? 'Request' : 'Save'}
        </button>
      </div>

      {#if inProject && requesting}
        <section id="feature-request-{projectId}" class="border-t border-line bg-app" aria-label="Create a feature request" transition:slide={{ duration: PANEL_MS }}>
          <div class="flex flex-col gap-2 px-4 py-3" in:fade={{ duration: PANEL_MS, delay: PANEL_MS / 2 }}>
            <h3 class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-accent uppercase"><Lightbulb class="size-3.5" />Create a feature request</h3>
            <input bind:value={requestTitle} maxlength={MAX_TITLE} placeholder="What should your agents build?" aria-label="Feature title" onkeydown={onRequestKey}
              class="border border-line bg-surface px-3 py-2 text-fluid-sm font-semibold text-ink placeholder:font-normal placeholder:text-ink-faint focus:border-line-strong focus:outline-none" />
            <textarea bind:value={requestBody} use:markdownKeys maxlength={MAX_BODY} rows="2" placeholder="Details, acceptance criteria, links… agents read all of it" aria-label="Feature details"
              class="block max-h-48 w-full resize-y border border-line bg-surface px-3 py-2 text-fluid-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none"></textarea>
            <div class="flex flex-wrap items-center gap-2">
              <div class="flex min-w-0 flex-1 flex-wrap gap-px border border-line bg-line" role="radiogroup" aria-label="Priority">
                {#each REQUEST_PRIORITIES as option (option.value)}
                  <button role="radio" aria-checked={requestPriority === option.value} title="{option.label} priority"
                    class="spring press flex-1 basis-14 px-2 py-1.5 text-xs {requestPriority === option.value ? 'bg-accent-soft font-semibold text-accent' : 'bg-surface text-ink-muted hover:text-ink'}"
                    onclick={() => (requestPriority = option.value)}>{option.label}</button>
                {/each}
              </div>
              <button class="spring press shrink-0 bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-40" disabled={!requestTitle.trim() && !requestBody.trim()} onclick={request}>
                Request
              </button>
            </div>
          </div>
        </section>
      {/if}
    </div>
  {/if}

  {#if uploads.length}
    <div class="flex items-center gap-2 border-t border-line px-4 py-1.5 text-xs" role="status" transition:slide={{ duration: PANEL_MS }}>
      {#if failedUploads.length}
        <span class="min-w-0 flex-1 truncate text-accent">Couldn't upload {failedUploads[0].name}: {failedUploads[0].error}</span>
        <button class="spring press shrink-0 p-1 text-ink-faint hover:text-ink" aria-label="Dismiss" onclick={() => store.dismissUpload(failedUploads[0].id)}><X class="size-3.5" /></button>
      {:else}
        <span class="min-w-0 flex-1 truncate text-ink-muted">Uploading {uploads.length} {uploads.length === 1 ? 'file' : 'files'}…</span>
      {/if}
    </div>
  {/if}
</div>
