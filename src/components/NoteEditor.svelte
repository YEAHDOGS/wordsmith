<script>
  // Full editor for one note, opened from #...?note=<id>. Autosaves as you type. Features get state, status,
  // priority, difficulty, assignee, pull requests and any agent analysis; the right side (below on phones) is the timestamped timeline.
  import X from '@lucide/svelte/icons/x';
  import Pin from '@lucide/svelte/icons/pin';
  import Archive from '@lucide/svelte/icons/archive';
  import Trash from '@lucide/svelte/icons/trash';
  import Copy from '@lucide/svelte/icons/copy';
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import ClipboardCopy from '@lucide/svelte/icons/clipboard-copy';
  import Check from '@lucide/svelte/icons/check';
  import Save from '@lucide/svelte/icons/save';
  import Bot from '@lucide/svelte/icons/bot';
  import { fly, fade, slide } from 'svelte/transition';
  import Timeline from './Timeline.svelte';
  import LabelPicker from './LabelPicker.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import Attachments from './Attachments.svelte';
  import ShareMenu from './ShareMenu.svelte';
  import MarkdownToolbar from './MarkdownToolbar.svelte';
  import LevelWheel from './LevelWheel.svelte';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { PR_STYLE, STATE_STYLE } from '../lib/colors.js';
  import { DIFFICULTY_LABELS, FEATURE_STATES, MAX_BODY, MAX_NAME, MAX_STATUS, PRIORITY_LABELS, MAX_TITLE, parsePullRequestUrl } from '../lib/models.js';
  import { fullTime } from '../lib/time.js';
  import { copyText, noteMarkdown } from '../lib/export.js';
  import { renderMarkdown } from '../lib/markdown.js';
  import { markdownKeys } from '../lib/markdown-input.js';
  import { LINE_BREAKS, autosize } from '../lib/autosize.js';

  /** @type {{ id: string }} */
  let { id } = $props();

  const SAVE_DEBOUNCE_MS = 400;
  const COPIED_MS = 1200;
  // How long the Save button shows its "Saved" check before the editor closes
  const SAVED_MS = 360;
  const SAVE_KEY = 's';
  const FIELD = 'w-full border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent focus:outline-none';
  const TOOL = 'spring press flex items-center gap-1.5 px-2.5 py-2 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink';
  // Crossfade for icons and labels that swap in place (copy -> copied)
  const SWAP = 'transition-[opacity,scale] duration-150 ease-(--ease-spring)';
  // Priority and difficulty share the 0..5 scale.
  const LEVELS = PRIORITY_LABELS.map((_, level) => level);
  const LOUD_DIFFICULTY = DIFFICULTY_LABELS.indexOf('Hard');
  // Feature-only blocks open and close their height (slide), so the rows below glide instead of jumping
  const BLOCK_MS = 180;

  const note = $derived(store.find('notes', id));
  const projects = $derived(store.projects.filter((project) => !project.deleted_at));

  /** @type {HTMLDialogElement | undefined} */
  let dialog = $state();
  let dialogOpen = $state(false);
  /** @type {Attachments | undefined} */
  let attachments = $state();
  let dropping = $state(false);
  let title = $state('');
  let body = $state('');
  let status = $state('');
  let prInput = $state('');
  let prError = $state('');
  let copied = $state(false);
  let copiedNote = $state(false);
  let preview = $state(false);
  let saved = $state(false);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let savedTimer;
  /** @type {HTMLTextAreaElement | undefined} */
  let bodyField = $state();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let loadedId = '';

  // Load the note into local fields once per note, so remote syncs don't clobber what you're typing.
  $effect.pre(() => {
    if (!note || loadedId === note.id) return;
    loadedId = note.id;
    title = note.title;
    body = note.body;
    status = note.status;
  });

  $effect(() => {
    if (!dialog) return;
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
    dialogOpen = true;
  });

  function flush() {
    clearTimeout(timer);
    if (!note) return;
    if (title !== note.title || body !== note.body || status !== note.status) store.update('notes', id, { title, body, status });
  }

  function queueSave() {
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }

  /** @param {Record<string, any>} patch */
  function set(patch) {
    flush();
    store.update('notes', id, patch);
  }

  function close() {
    flush();
    router.closeNote();
  }

  /** Save is the X button with a confirmation: commit the fields now, flash "Saved", then close (which syncs). */
  function save() {
    if (saved) return;
    flush();
    // Typing stops here, so "Saved" describes everything that's saved.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    saved = true;
    savedTimer = setTimeout(close, SAVED_MS);
  }

  /** Ctrl/Cmd+S saves instead of opening the browser's save-page dialog. @param {KeyboardEvent} event */
  function onSaveKey(event) {
    if (!note || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== SAVE_KEY) return;
    event.preventDefault();
    save();
  }

  // However the editor closes (button, Escape, back-swipe, another note opening), it syncs right away, and a note left completely empty is
  // discarded: no title, body or status, and no files, uploads or pull requests. Mostly blank notes from the "+" button.
  $effect(() => () => {
    clearTimeout(savedTimer);
    flush();
    const current = store.find('notes', id);
    if (!current || current.deleted_at) return;
    const hasContent = [current.title, current.body, current.status].some((text) => text.trim()) || current.pull_requests.length;
    const hasFiles = store.attachmentsFor(id).length || store.uploads.some((upload) => upload.noteId === id);
    if (!hasContent && !hasFiles) store.remove('notes', id);
    // Sync as soon as a note closes (push and pull), instead of waiting for the typing pause or the next poll.
    store.sync(true);
  });

  function addPr() {
    const parsed = parsePullRequestUrl(prInput);
    if (!parsed) {
      prError = 'Paste a link like https://github.com/owner/repo/pull/123';
      return;
    }
    prError = '';
    prInput = '';
    if (note.pull_requests.some((/** @type {any} */ pr) => pr.url === parsed.url)) return;
    set({ pull_requests: [...note.pull_requests, { ...parsed, title: '', state: 'open', merged_at: null }] });
  }

  async function copyId() {
    await navigator.clipboard?.writeText(id);
    copied = true;
    setTimeout(() => (copied = false), COPIED_MS);
  }

  /** The whole note as Markdown, including edits still waiting for autosave. */
  async function copyNote() {
    copiedNote = await copyText(noteMarkdown({ ...note, title, body, status }));
    setTimeout(() => (copiedNote = false), COPIED_MS);
  }

  /** Files dropped anywhere on the note, or pasted into it, become attachments. @param {DragEvent} event */
  function ondrop(event) {
    dropping = false;
    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    attachments?.add(files);
  }

  /** @param {ClipboardEvent} event */
  function onpaste(event) {
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    attachments?.add(files);
  }

  /** Escape closes the attachment viewer or share panel first, not the whole note. @param {Event} event */
  function oncancel(event) {
    if (document.querySelector('[data-lightbox], [data-popover]')) event.preventDefault();
  }

  /** Double-clicking the backdrop closes; a single stray click outside the note does nothing. @param {MouseEvent} event */
  function onBackdrop(event) {
    if (event.target === dialog) close();
  }
</script>

{#snippet copyNoteButton(/** @type {string} */ className)}
  <!-- Icon and label crossfade in place; both labels share one grid cell so the button never changes width -->
  <button class="{className} {copiedNote ? 'text-complete' : ''}" onclick={copyNote} title="Copy the whole note as Markdown">
    <span class="grid *:col-start-1 *:row-start-1" aria-hidden="true">
      <ClipboardCopy class="size-4 {SWAP} {copiedNote ? 'scale-50 opacity-0' : ''}" />
      <Check class="size-4 {SWAP} {copiedNote ? '' : 'scale-50 opacity-0'}" />
    </span>
    <span class="grid *:col-start-1 *:row-start-1">
      <span class="{SWAP} {copiedNote ? 'opacity-0' : ''}" aria-hidden={copiedNote}>Copy</span>
      <span class="{SWAP} {copiedNote ? '' : 'opacity-0'}" aria-hidden={!copiedNote} aria-live="polite">Copied</span>
    </span>
  </button>
{/snippet}

<svelte:window onkeydown={onSaveKey} />

{#if note}
  <dialog bind:this={dialog} aria-label={note.title || 'Note'} onclose={close} {oncancel} ondblclick={onBackdrop}
    class="m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 text-ink backdrop:bg-scrim sm:m-auto sm:h-[min(92dvh,56rem)] sm:w-[min(96vw,72rem)] tv:w-[min(90vw,96rem)]">
    <div class="spring flex h-full flex-col bg-app sm:rounded-ui sm:border {dropping ? 'border-accent' : 'border-line'}" in:fly={{ y: 24, duration: 220 }} out:fade={{ duration: 120 }} role="presentation"
      ondragover={(event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dropping = true; } }}
      ondragleave={(event) => event.currentTarget === event.target && (dropping = false)} {ondrop} {onpaste}>
      <!-- Toolbar: a single wrapping row, never a sideways scroller. Phones keep only pin, color, archive and trash here;
           everything that organizes the note sits under the body in the details panel. -->
      <div class="flex items-start border-b border-line">
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1 px-2 py-1">
          <button class="{TOOL} {note.pinned ? 'text-accent' : ''}" aria-pressed={note.pinned} onclick={() => set({ pinned: !note.pinned })} title={note.pinned ? 'Unpin' : 'Pin'}>
            <Pin class="size-4" />
          </button>
          <ColorPicker value={note.color} onchange={(color) => set({ color })} />
          <span class="flex-1"></span>
          <div class="hidden sm:contents">
            {@render copyNoteButton(TOOL)}
            <ShareMenu {note} class={TOOL} />
          </div>
          <button class={TOOL} onclick={() => { set({ archived: !note.archived }); close(); }} title={note.archived ? 'Unarchive' : 'Archive'}><Archive class="size-4" /><span class="hidden sm:inline">{note.archived ? 'Unarchive' : 'Archive'}</span></button>
          <button class="{TOOL} hover:text-accent" onclick={() => { store.remove('notes', id); close(); }} title="Delete"><Trash class="size-4" /></button>
        </div>
        <!-- Save: icon and label crossfade to a check and "Saved" in place, so the button never changes width; the label is screen-reader only on the narrowest phones -->
        <button class="spring press flex shrink-0 items-center gap-1.5 self-stretch px-3 text-xs font-semibold {saved ? 'bg-complete-soft text-complete' : 'bg-accent text-accent-ink hover:bg-accent-hover'}"
          onclick={save} title="Save and close (Ctrl+S)" aria-keyshortcuts="Control+S Meta+S">
          <span class="grid *:col-start-1 *:row-start-1" aria-hidden="true">
            <Save class="size-4 {SWAP} {saved ? 'scale-50 opacity-0' : ''}" />
            <Check class="size-4 {SWAP} {saved ? '' : 'scale-50 opacity-0'}" />
          </span>
          <span class="sr-only grid *:col-start-1 *:row-start-1 min-[360px]:not-sr-only">
            <span class="{SWAP} {saved ? 'opacity-0' : ''}" aria-hidden={saved}>Save</span>
            <span class="{SWAP} {saved ? '' : 'opacity-0'}" aria-hidden={!saved} aria-live="polite">Saved</span>
          </span>
        </button>
        <button class="{TOOL} shrink-0 self-stretch border-l border-line px-3" onclick={close} aria-label="Close"><X class="size-5" /></button>
      </div>

      <!-- One column on phones, pinned to the screen width (minmax 0), so no field can ever widen the page sideways -->
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto] overflow-x-hidden overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] lg:grid-rows-1 lg:overflow-hidden">
        <!-- Content -->
        <div class="flex min-w-0 flex-col gap-3 p-4 tv:gap-5 tv:p-8 lg:min-h-0 lg:overflow-y-auto">
          <!-- A one-line field that wraps: long titles stay readable on phones. Enter moves on to the body. -->
          <textarea bind:value={title} use:autosize={title} rows="1" maxlength={MAX_TITLE} placeholder="Title" aria-label="Title"
            oninput={() => { title = title.replace(LINE_BREAKS, ' '); queueSave(); }}
            onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); bodyField?.focus(); } }}
            class="block w-full resize-none overflow-hidden bg-transparent text-fluid-xl font-bold leading-tight tracking-tight text-ink placeholder:text-ink-faint focus:outline-none"></textarea>

          <div class="flex min-h-32 flex-1 flex-col border-y border-line lg:min-h-48">
            {#if preview}
              <!-- Rendered by src/lib/markdown.js, which escapes all input -->
              <div class="markdown selectable min-h-0 flex-1 overflow-y-auto py-2 text-fluid-sm text-ink" in:fade={{ duration: 120 }}>
                {#if body.trim()}{@html renderMarkdown(body)}{:else}<p class="text-ink-faint">Nothing to preview yet.</p>{/if}
              </div>
            {:else}
              <textarea bind:this={bodyField} bind:value={body} oninput={queueSave} use:markdownKeys maxlength={MAX_BODY} aria-label="Body" in:fade={{ duration: 120 }}
                placeholder="Write anything. Agents read it verbatim. Markdown works: **bold**, _italic_, # headings, - lists"
                class="min-h-32 flex-1 resize-none bg-transparent py-2 lg:min-h-48 text-fluid-sm leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"></textarea>
            {/if}
            <!-- Formatting lives in the box's bottom-right corner -->
            <div class="flex justify-end border-t border-line">
              <MarkdownToolbar textarea={bodyField} bind:preview showPreview class="-mr-1 py-0.5" />
            </div>
          </div>

          <!-- Details: project, feature fields and labels, as tidy wrapping rows under the body (every note is a feature) -->
          <section class="flex flex-col gap-2 tv:gap-3" aria-label="Details">
            <div class="flex flex-wrap gap-2">
              <select class="spring min-w-0 flex-1 basis-40 border border-line bg-surface px-2 py-2 text-xs text-ink hover:border-line-strong focus:border-accent focus:outline-none sm:max-w-64 sm:flex-none" aria-label="Project"
                value={note.project_id ?? ''} onchange={(event) => set({ project_id: event.currentTarget.value || null })}>
                <option value="">No project</option>
                {#each projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}
              </select>
            </div>

              <div class="flex flex-col gap-2 tv:gap-3" transition:slide={{ duration: BLOCK_MS }}>
                <div class="grid grid-cols-3 gap-px border border-line bg-line" role="radiogroup" aria-label="State">
                  {#each FEATURE_STATES as state (state)}
                    {@const style = STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (state)]}
                    <button role="radio" aria-checked={note.state === state} onclick={() => set({ state })}
                      class="spring press flex min-w-0 items-center justify-center gap-1.5 px-1 py-2 text-xs font-semibold {note.state === state ? `${style.soft} ${style.text}` : 'bg-app text-ink-muted hover:bg-surface-raised'}">
                      <span class="size-1.5 shrink-0 rounded-full {style.dot}"></span><span class="truncate">{style.label}</span>
                    </button>
                  {/each}
                </div>
                <!-- Priority and difficulty 0-5 as two scroll wheels side by side -->
                <div class="grid grid-cols-2 gap-2">
                  <LevelWheel active={dialogOpen} value={note.priority_level} levels={LEVELS} onselect={(level) => set({ priority_level: level })} />
                  <LevelWheel active={dialogOpen} value={note.difficulty ?? 0} levels={LEVELS} labels={DIFFICULTY_LABELS} name="Difficulty" loud={LOUD_DIFFICULTY} onselect={(level) => set({ difficulty: level })} />
                </div>
                <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <textarea bind:value={status} use:autosize={status} rows="1" maxlength={MAX_STATUS} placeholder="Status: what's happening right now" aria-label="Status"
                    oninput={() => { status = status.replace(LINE_BREAKS, ' '); queueSave(); }} onkeydown={(event) => event.key === 'Enter' && event.preventDefault()}
                    class="{FIELD} block resize-none overflow-hidden"></textarea>
                  <input value={note.assignee} maxlength={MAX_NAME} placeholder="Assignee" aria-label="Assignee" class="{FIELD} sm:w-40"
                    onchange={(event) => set({ assignee: event.currentTarget.value.trim() })} />
                </div>
              </div>

            <LabelPicker selected={note.label_ids} onchange={(label_ids) => set({ label_ids })} />

            <!-- On phones, copy and share live here instead of the toolbar -->
            <div class="grid grid-cols-2 divide-x divide-line border border-line sm:hidden">
              {@render copyNoteButton(`${TOOL} justify-center`)}
              <ShareMenu {note} class="{TOOL} justify-center" />
            </div>
          </section>

          <Attachments bind:this={attachments} noteId={id} />

            <section class="border border-line" aria-label="Pull requests" transition:slide={{ duration: BLOCK_MS }}>
              <h3 class="border-b border-line px-3 py-2 font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint">Pull requests</h3>
              {#each note.pull_requests as pr (pr.url)}
                <a href={pr.url} target="_blank" rel="noopener noreferrer" class="spring flex items-center gap-2 border-b border-line px-3 py-2 text-sm hover:bg-surface-raised" transition:fade={{ duration: 150 }}>
                  {#if pr.state === 'merged'}<GitMerge class="size-4 {PR_STYLE.merged}" />{:else}<GitPullRequest class="size-4 {PR_STYLE[/** @type {keyof typeof PR_STYLE} */ (pr.state)]}" />{/if}
                  <span class="min-w-0 flex-1 truncate">{pr.title || `${pr.repo}#${pr.number}`}</span>
                  <span class="font-mono text-[0.6875rem] {PR_STYLE[/** @type {keyof typeof PR_STYLE} */ (pr.state)]}">{pr.state}{pr.merged_at ? ` ${fullTime(pr.merged_at)}` : ''}</span>
                  <ExternalLink class="size-3.5 text-ink-faint" />
                </a>
              {/each}
              <form class="flex" onsubmit={(event) => { event.preventDefault(); addPr(); }}>
                <input bind:value={prInput} placeholder="https://github.com/owner/repo/pull/123" aria-label="Add pull request URL" class="{FIELD} border-0" />
                <button class="spring press border-l border-line px-4 text-sm font-semibold text-accent hover:bg-surface-raised">Link</button>
              </form>
              {#if prError}<p class="px-3 py-1.5 text-xs text-accent" role="alert" in:fly={{ y: -4, duration: 150 }} out:fade={{ duration: 100 }}>{prError}</p>{/if}
            </section>

          <!-- What an agent decided when it triaged this (POST /api/v1/notes/:id/analysis): read-only here -->
          {#if note.analysis || note.batch}
            <section class="border border-line" aria-label="Agent analysis" transition:slide={{ duration: BLOCK_MS }}>
              <h3 class="flex flex-wrap items-center gap-x-2 border-b border-line px-3 py-2 font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint">
                <Bot class="size-3.5" />Agent analysis
                {#if note.batch}<span class="selectable normal-case tracking-normal text-ink-muted">· {note.batch}</span>{/if}
                {#if note.analyzed_at}<span class="ml-auto normal-case tracking-normal" title={fullTime(note.analyzed_at)}>{fullTime(note.analyzed_at)}</span>{/if}
              </h3>
              {#if note.analysis}
                <!-- Rendered by src/lib/markdown.js, which escapes all input -->
                <div class="markdown selectable px-3 py-2 text-fluid-sm text-ink-muted">{@html renderMarkdown(note.analysis)}</div>
              {/if}
            </section>
          {/if}
        </div>

        <!-- Timeline -->
        <aside class="border-t border-line p-4 tv:p-8 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l" aria-label="Timeline">
          <h3 class="mb-3 font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint">Timeline</h3>
          <Timeline {note} />
          <dl class="mt-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line pt-3 font-mono text-[0.6875rem] text-ink-faint">
            <dt>created</dt><dd class="selectable text-ink-muted">{fullTime(note.created_at)}</dd>
            <dt>updated</dt><dd class="selectable text-ink-muted">{fullTime(note.updated_at)}</dd>
            <dt>id</dt>
            <dd class="flex min-w-0 items-center gap-1">
              <span class="selectable min-w-0 truncate text-ink-muted">{id}</span>
              <button class="spring press shrink-0 p-0.5 hover:text-accent" onclick={copyId} aria-label="Copy id for agents" title="Copy id"><Copy class="size-3" /></button>
              {#if copied}<span class="text-complete" transition:fade={{ duration: 100 }}>copied</span>{/if}
            </dd>
          </dl>
        </aside>
      </div>
    </div>
  </dialog>
{/if}
