<script>
  // Full editor for one note, opened from #...?note=<id>. Autosaves as you type. Features get state, status,
  // priority, assignee and pull requests; the right side (below on phones) is the timestamped timeline.
  import X from '@lucide/svelte/icons/x';
  import Pin from '@lucide/svelte/icons/pin';
  import Archive from '@lucide/svelte/icons/archive';
  import Trash from '@lucide/svelte/icons/trash';
  import Copy from '@lucide/svelte/icons/copy';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import StickyNote from '@lucide/svelte/icons/sticky-note';
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
  import GitMerge from '@lucide/svelte/icons/git-merge';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import ClipboardCopy from '@lucide/svelte/icons/clipboard-copy';
  import Check from '@lucide/svelte/icons/check';
  import { fly, fade } from 'svelte/transition';
  import Timeline from './Timeline.svelte';
  import LabelPicker from './LabelPicker.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import Attachments from './Attachments.svelte';
  import ShareMenu from './ShareMenu.svelte';
  import MarkdownToolbar from './MarkdownToolbar.svelte';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { PR_STYLE, STATE_STYLE } from '../lib/colors.js';
  import { FEATURE_STATES, MAX_BODY, MAX_NAME, MAX_STATUS, PRIORITY_LABELS, MAX_TITLE, parsePullRequestUrl } from '../lib/models.js';
  import { fullTime } from '../lib/time.js';
  import { copyText, noteMarkdown } from '../lib/export.js';
  import { renderMarkdown } from '../lib/markdown.js';
  import { markdownKeys } from '../lib/markdown-input.js';

  /** @type {{ id: string }} */
  let { id } = $props();

  const SAVE_DEBOUNCE_MS = 400;
  const COPIED_MS = 1200;
  const FIELD = 'w-full border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent focus:outline-none';
  const TOOL = 'spring press flex items-center gap-1.5 px-2.5 py-2 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink';
  // Crossfade for icons and labels that swap in place (copy -> copied)
  const SWAP = 'transition-[opacity,scale] duration-150 ease-(--ease-spring)';
  const HIGH_PRIORITY = PRIORITY_LABELS.indexOf('High');

  const note = $derived(store.find('notes', id));
  const projects = $derived(store.projects.filter((project) => !project.deleted_at));

  /** @type {HTMLDialogElement | undefined} */
  let dialog = $state();
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

{#if note}
  <dialog bind:this={dialog} aria-label={note.title || 'Note'} onclose={close} {oncancel} ondblclick={onBackdrop}
    class="m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 text-ink backdrop:bg-scrim sm:m-auto sm:h-[min(92dvh,56rem)] sm:w-[min(96vw,72rem)] tv:w-[min(90vw,96rem)]">
    <div class="spring flex h-full flex-col bg-app sm:border {dropping ? 'border-accent' : 'border-line'}" in:fly={{ y: 24, duration: 220 }} out:fade={{ duration: 120 }} role="presentation"
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
        <button class="{TOOL} shrink-0 self-stretch border-l border-line px-3" onclick={close} aria-label="Close"><X class="size-5" /></button>
      </div>

      <div class="grid min-h-0 flex-1 grid-rows-[auto_auto] overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] lg:grid-rows-1 lg:overflow-hidden">
        <!-- Content -->
        <div class="flex flex-col gap-3 p-4 tv:gap-5 tv:p-8 lg:min-h-0 lg:overflow-y-auto">
          <input bind:value={title} oninput={queueSave} maxlength={MAX_TITLE} placeholder="Title" aria-label="Title"
            class="w-full bg-transparent text-fluid-xl font-bold tracking-tight text-ink placeholder:text-ink-faint focus:outline-none" />

          <div class="flex min-h-32 flex-1 flex-col border-y border-line lg:min-h-48">
            {#if preview}
              <!-- Rendered by src/lib/markdown.js, which escapes all input -->
              <div class="markdown selectable min-h-0 flex-1 overflow-y-auto py-2 text-fluid-sm text-ink" in:fade={{ duration: 120 }}>
                {#if body.trim()}{@html renderMarkdown(body)}{:else}<p class="text-ink-faint">Nothing to preview yet.</p>{/if}
              </div>
            {:else}
              <textarea bind:this={bodyField} bind:value={body} oninput={queueSave} use:markdownKeys maxlength={MAX_BODY} aria-label="Body" in:fade={{ duration: 120 }}
                placeholder={note.kind === 'feature' ? 'Describe the feature. Agents read this verbatim. Markdown works: **bold**, - lists, 1. steps' : 'Note. Markdown works: **bold**, _italic_, # headings, - lists'}
                class="min-h-32 flex-1 resize-none bg-transparent py-2 lg:min-h-48 text-fluid-sm leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"></textarea>
            {/if}
            <!-- Formatting lives in the box's bottom-right corner -->
            <div class="flex justify-end border-t border-line">
              <MarkdownToolbar textarea={bodyField} bind:preview showPreview class="-mr-1 py-0.5" />
            </div>
          </div>

          <!-- Details: kind, project, feature fields and labels, as tidy wrapping rows under the body -->
          <section class="flex flex-col gap-2 tv:gap-3" aria-label="Details">
            <div class="flex flex-wrap gap-2">
              <div class="flex border border-line" role="group" aria-label="Kind">
                <button class="{TOOL} {note.kind === 'note' ? 'bg-surface-raised text-ink' : ''}" aria-pressed={note.kind === 'note'} onclick={() => set({ kind: 'note' })}><StickyNote class="size-4" />Note</button>
                <button class="{TOOL} {note.kind === 'feature' ? 'bg-accent-soft text-accent' : ''}" aria-pressed={note.kind === 'feature'} onclick={() => set({ kind: 'feature' })}><Lightbulb class="size-4" />Feature</button>
              </div>
              <select class="spring min-w-0 flex-1 basis-40 border border-line bg-surface px-2 py-2 text-xs text-ink hover:border-line-strong focus:border-accent focus:outline-none sm:max-w-64 sm:flex-none" aria-label="Project"
                value={note.project_id ?? ''} onchange={(event) => set({ project_id: event.currentTarget.value || null })}>
                <option value="">No project</option>
                {#each projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}
              </select>
            </div>

            {#if note.kind === 'feature'}
              <div class="flex flex-col gap-2 tv:gap-3" in:fly={{ y: -8, duration: 180 }} out:fade={{ duration: 100 }}>
                <div class="grid grid-cols-3 gap-px border border-line bg-line" role="radiogroup" aria-label="State">
                  {#each FEATURE_STATES as state (state)}
                    {@const style = STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (state)]}
                    <button role="radio" aria-checked={note.state === state} onclick={() => set({ state })}
                      class="spring press flex min-w-0 items-center justify-center gap-1.5 px-1 py-2 text-xs font-semibold {note.state === state ? `${style.soft} ${style.text}` : 'bg-app text-ink-muted hover:bg-surface-raised'}">
                      <span class="size-1.5 shrink-0 rounded-full {style.dot}"></span><span class="truncate">{style.label}</span>
                    </button>
                  {/each}
                </div>
                <!-- Priority 0-5 as a segmented control: three per row on phones, all six in one row from sm up -->
                <div class="grid grid-cols-3 gap-px border border-line bg-line sm:grid-cols-6" role="radiogroup" aria-label="Priority">
                  {#each PRIORITY_LABELS as label, value (label)}
                    {@const on = note.priority === value}
                    <button role="radio" aria-checked={on} onclick={() => set({ priority: value })} title="{label} priority"
                      class="spring press flex min-w-0 items-center justify-center gap-1 px-1 py-2 text-xs font-semibold {on ? (value >= HIGH_PRIORITY ? 'bg-accent-soft text-accent' : 'bg-surface-raised text-ink') : 'bg-app text-ink-muted hover:bg-surface-raised'}">
                      <span class="font-mono text-[10px] {on ? '' : 'text-ink-faint'}">{value || '–'}</span><span class="truncate">{label}</span>
                    </button>
                  {/each}
                </div>
                <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input bind:value={status} oninput={queueSave} maxlength={MAX_STATUS} placeholder="Status: what's happening right now" aria-label="Status" class={FIELD} />
                  <input value={note.assignee} maxlength={MAX_NAME} placeholder="Assignee" aria-label="Assignee" class="{FIELD} sm:w-40"
                    onchange={(event) => set({ assignee: event.currentTarget.value.trim() })} />
                </div>
              </div>
            {/if}

            <LabelPicker selected={note.label_ids} onchange={(label_ids) => set({ label_ids })} />

            <!-- On phones, copy and share live here instead of the toolbar -->
            <div class="grid grid-cols-2 divide-x divide-line border border-line sm:hidden">
              {@render copyNoteButton(`${TOOL} justify-center`)}
              <ShareMenu {note} class="{TOOL} justify-center" />
            </div>
          </section>

          <Attachments bind:this={attachments} noteId={id} />

          {#if note.kind === 'feature'}
            <section class="border border-line" aria-label="Pull requests" in:fly={{ y: -8, duration: 180 }} out:fade={{ duration: 100 }}>
              <h3 class="border-b border-line px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-ink-faint">Pull requests</h3>
              {#each note.pull_requests as pr (pr.url)}
                <a href={pr.url} target="_blank" rel="noopener noreferrer" class="spring flex items-center gap-2 border-b border-line px-3 py-2 text-sm hover:bg-surface-raised" transition:fade={{ duration: 150 }}>
                  {#if pr.state === 'merged'}<GitMerge class="size-4 {PR_STYLE.merged}" />{:else}<GitPullRequest class="size-4 {PR_STYLE[/** @type {keyof typeof PR_STYLE} */ (pr.state)]}" />{/if}
                  <span class="min-w-0 flex-1 truncate">{pr.title || `${pr.repo}#${pr.number}`}</span>
                  <span class="font-mono text-[11px] {PR_STYLE[/** @type {keyof typeof PR_STYLE} */ (pr.state)]}">{pr.state}{pr.merged_at ? ` ${fullTime(pr.merged_at)}` : ''}</span>
                  <ExternalLink class="size-3.5 text-ink-faint" />
                </a>
              {/each}
              <form class="flex" onsubmit={(event) => { event.preventDefault(); addPr(); }}>
                <input bind:value={prInput} placeholder="https://github.com/owner/repo/pull/123" aria-label="Add pull request URL" class="{FIELD} border-0" />
                <button class="spring press border-l border-line px-4 text-sm font-semibold text-accent hover:bg-surface-raised">Link</button>
              </form>
              {#if prError}<p class="px-3 py-1.5 text-xs text-accent" role="alert" in:fly={{ y: -4, duration: 150 }} out:fade={{ duration: 100 }}>{prError}</p>{/if}
            </section>
          {/if}
        </div>

        <!-- Timeline -->
        <aside class="border-t border-line p-4 tv:p-8 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l" aria-label="Timeline">
          <h3 class="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-faint">Timeline</h3>
          <Timeline {note} />
          <dl class="mt-6 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-line pt-3 font-mono text-[11px] text-ink-faint">
            <dt>created</dt><dd class="selectable text-ink-muted">{fullTime(note.created_at)}</dd>
            <dt>updated</dt><dd class="selectable text-ink-muted">{fullTime(note.updated_at)}</dd>
            <dt>id</dt>
            <dd class="flex items-center gap-1">
              <span class="selectable truncate text-ink-muted">{id}</span>
              <button class="spring press p-0.5 hover:text-accent" onclick={copyId} aria-label="Copy id for agents" title="Copy id"><Copy class="size-3" /></button>
              {#if copied}<span class="text-complete" transition:fade={{ duration: 100 }}>copied</span>{/if}
            </dd>
          </dl>
        </aside>
      </div>
    </div>
  </dialog>
{/if}
