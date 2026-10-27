<script>
  // Quick capture, Google Keep style. Collapsed it is one line; focus expands it. Enter in the title saves,
  // Shift+Enter adds a line. Images and videos can be picked, dropped or pasted in: they wait as thumbnails and
  // upload once the note is saved (a note has to reach the server before files can hang off it).
  // Every note is a feature (on the board, in the agent queue), so there is no Note / Feature toggle. The lightbulb
  // Feature button beside the paperclip unfolds the feature details: priority, difficulty, project, a pull request and
  // a status. Left closed, the note saves with the defaults (no priority, unrated, this page's project).
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import Play from '@lucide/svelte/icons/play';
  import X from '@lucide/svelte/icons/x';
  import { fade, scale, slide } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { store } from '../lib/store.svelte.js';
  import { DIFFICULTY_LABELS, IMAGE_TYPES, MAX_ATTACHMENTS_PER_NOTE, MAX_BODY, MAX_IMAGE_BYTES, MAX_STATUS, MAX_TITLE, MAX_VIDEO_BYTES, PRIORITY_LABELS, VIDEO_TYPES, parsePullRequestUrl } from '../lib/models.js';
  import { markdownKeys } from '../lib/markdown-input.js';
  import MarkdownToolbar from './MarkdownToolbar.svelte';
  import LevelWheel from './LevelWheel.svelte';

  /** @type {{ projectId?: string | null, labelId?: string | null }} */
  let { projectId = null, labelId = null } = $props();

  const FLASH_MS = 400;
  const PANEL_MS = 150;
  const THUMB_MS = 150;
  const ACCEPT = [...IMAGE_TYPES, ...VIDEO_TYPES].join(',');
  // Waiting for a just-saved note to reach the server before uploading: retries back off from the first delay up to
  // the cap, for as long as the note is still unsynced (a sync in flight may not carry it, or the server is unreachable).
  const SYNC_RETRY_MS = 500;
  const SYNC_RETRY_MAX_MS = 8_000;
  // Priority and difficulty share the 0..5 scale; 0 is None / Unrated.
  const LEVELS = PRIORITY_LABELS.map((_, level) => level);
  const LOUD_DIFFICULTY = DIFFICULTY_LABELS.indexOf('Hard');
  const ERROR_TYPE = 'Only images and videos can be attached.';
  const ERROR_SIZE = 'Some files were too large to attach.';
  const ERROR_COUNT = `A note holds up to ${MAX_ATTACHMENTS_PER_NOTE} files.`;
  const ERROR_PR = 'That pull request link should look like https://github.com/owner/repo/pull/123';
  const FIELD = 'h-9 min-w-0 border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent focus:outline-none tv:h-12 tv:text-lg';
  const LABEL = 'mb-1 block text-[0.6875rem] font-semibold tracking-wide text-ink-faint uppercase tv:text-sm';

  let expanded = $state(false);
  let title = $state('');
  let body = $state('');
  let flash = $state(false);
  /** Files waiting for the note to be saved, each with a preview URL. @type {{ id: string, file: File, url: string }[]} */
  let queued = $state([]);
  let fileError = $state('');
  /** Notes this composer saved with files, so their upload progress and errors show here. @type {string[]} */
  let sentNoteIds = $state([]);
  // Feature details, unfolded by the Feature button
  let detailsOpen = $state(false);
  let priority = $state(0);
  let difficulty = $state(0);
  /** null = this page's project */
  let chosenProject = $state(/** @type {string | null} */ (null));
  let prUrl = $state('');
  let status = $state('');
  let prError = $state('');
  /** @type {HTMLElement | undefined} */
  let root = $state();
  /** @type {HTMLTextAreaElement | undefined} */
  let details = $state();
  /** @type {HTMLInputElement | undefined} */
  let picker = $state();
  // Focus parks on this before the focused control disappears, so the composer doesn't read it as focus leaving.
  /** @type {HTMLButtonElement | undefined} */
  let attachButton = $state();

  const projects = $derived(store.projects.filter((project) => !project.deleted_at).sort((a, b) => a.name.localeCompare(b.name)));
  const projectChoice = $derived(chosenProject ?? projectId ?? '');
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
   * Uploads files to a freshly saved note once the note has reached the server, however long that takes.
   * store.sync() returns at once when a sync is already running or the store thinks it is offline, so this keeps
   * asking with a growing pause: offline it waits for the browser to come back online first.
   * @param {string} noteId
   * @param {File[]} files
   */
  async function uploadWhenReady(noteId, files) {
    let delay = SYNC_RETRY_MS;
    while (store.isPending('notes', noteId)) {
      if (!navigator.onLine) await new Promise((resolve) => addEventListener('online', resolve, { once: true }));
      await store.sync();
      if (!store.isPending('notes', noteId)) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, SYNC_RETRY_MAX_MS);
    }
    await store.upload(noteId, files);
  }

  function save() {
    if (!canSave) return;
    const pr = prUrl.trim() ? parsePullRequestUrl(prUrl) : null;
    if (prUrl.trim() && !pr) {
      prError = ERROR_PR;
      detailsOpen = true;
      return;
    }
    const note = store.create('notes', {
      title: title.trim(),
      body: body.trim(),
      project_id: projectChoice || null,
      label_ids: labelId ? [labelId] : [],
      priority_level: priority,
      difficulty,
      status: status.trim(),
      pull_requests: pr ? [{ ...pr, title: '', state: 'open', merged_at: null }] : [],
    });
    if (queued.length) {
      sentNoteIds = [...sentNoteIds, note.id];
      uploadWhenReady(note.id, queued.map((item) => item.file));
      for (const item of queued) URL.revokeObjectURL(item.url);
    }
    title = '';
    body = '';
    queued = [];
    fileError = '';
    priority = 0;
    difficulty = 0;
    chosenProject = null;
    prUrl = '';
    status = '';
    prError = '';
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
    detailsOpen = false;
  }

  /** @param {KeyboardEvent} event */
  function onTitleKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      save();
    }
    if (event.key === 'Escape') /** @type {HTMLElement} */ (event.currentTarget).blur();
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

<div bind:this={root} class="spring rounded-ui border bg-surface {flash ? 'border-accent' : 'border-line hover:border-line-strong'} focus-within:border-line-strong" role="group" aria-label="New note" {onfocusout}
  ondragover={(event) => event.dataTransfer?.types.includes('Files') && event.preventDefault()} {ondrop}>
  <div class="flex items-center">
    <input bind:value={title} maxlength={MAX_TITLE} placeholder="Take a note…" aria-label="Take a note"
      class="min-w-0 flex-1 bg-transparent px-3 py-2 sm:px-4 sm:py-3 short:py-2 text-fluid-base font-semibold text-ink placeholder:font-normal placeholder:text-ink-faint focus:outline-none"
      onfocus={() => (expanded = true)} onkeydown={onTitleKey} {onpaste} />
  </div>
  {#if expanded}
    <div transition:slide={{ duration: PANEL_MS }}>
      <textarea bind:this={details} bind:value={body} use:markdownKeys maxlength={MAX_BODY} rows="3" placeholder="Write anything. Agents read all of it." aria-label="Details"
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
        <!-- Feature details: priority, difficulty, project, PR, status. The bulb lights while they are open -->
        <button class="spring press flex h-7 shrink-0 items-center gap-1.5 px-2 text-xs sm:h-8 tv:h-11 tv:text-base {detailsOpen ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface-raised hover:text-ink'}"
          aria-expanded={detailsOpen} aria-controls="feature-details-{projectId ?? labelId ?? 'all'}" onclick={() => (detailsOpen = !detailsOpen)}>
          <Lightbulb class="spring size-4 {detailsOpen ? 'scale-110' : ''}" /><span>Feature</span>
        </button>
        <input bind:this={picker} type="file" accept={ACCEPT} multiple class="hidden" tabindex="-1" onchange={(event) => { addFiles([...(event.currentTarget.files || [])]); event.currentTarget.value = ''; }} />
        <span class="h-5 w-px shrink-0 bg-line" aria-hidden="true"></span>
        <!-- Formatting sits in the bottom-right corner, beside Save -->
        <MarkdownToolbar textarea={details} class="ml-auto" />
        <button class="spring press shrink-0 bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-40" disabled={!canSave} onclick={save}>
          Save
        </button>
      </div>

      {#if detailsOpen}
        <section id="feature-details-{projectId ?? labelId ?? 'all'}" class="border-t border-line bg-app" aria-label="Feature details" transition:slide={{ duration: PANEL_MS }}>
          <div class="grid gap-3 px-3 py-3 sm:px-4 lg:grid-cols-2" in:fade={{ duration: PANEL_MS, delay: PANEL_MS / 2 }}>
            <!-- Priority and difficulty as two scroll wheels side by side -->
            <div class="grid grid-cols-2 gap-2 lg:col-span-2">
              <LevelWheel value={priority} levels={LEVELS} onselect={(level) => (priority = level)} />
              <LevelWheel value={difficulty} levels={LEVELS} labels={DIFFICULTY_LABELS} name="Difficulty" loud={LOUD_DIFFICULTY} onselect={(level) => (difficulty = level)} />
            </div>
            <label class="min-w-0">
              <span class={LABEL}>Project</span>
              <select value={projectChoice} onchange={(event) => (chosenProject = event.currentTarget.value)} class="{FIELD} w-full">
                <option value="">No project</option>
                {#each projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}
              </select>
            </label>
            <label class="min-w-0">
              <span class={LABEL}>Pull request</span>
              <input bind:value={prUrl} oninput={() => (prError = '')} placeholder="https://github.com/owner/repo/pull/123" inputmode="url" class="{FIELD} w-full font-mono text-xs" />
            </label>
            <label class="min-w-0 lg:col-span-2">
              <span class={LABEL}>Status</span>
              <input bind:value={status} maxlength={MAX_STATUS} placeholder="What's happening right now" class="{FIELD} w-full" />
            </label>
            {#if prError}<p class="text-xs text-accent lg:col-span-2" role="alert" transition:slide={{ duration: PANEL_MS }}>{prError}</p>{/if}
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
