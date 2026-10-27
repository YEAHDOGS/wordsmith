<script>
  // Quick capture, Google Keep style. Collapsed it is one line; focus expands it. Inside a project it files a
  // feature request by default, which agents can claim right away. Enter in the title saves, Shift+Enter adds a line.
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import StickyNote from '@lucide/svelte/icons/sticky-note';
  import { slide } from 'svelte/transition';
  import { store } from '../lib/store.svelte.js';
  import { MAX_BODY, MAX_TITLE } from '../lib/models.js';

  /** @type {{ projectId?: string | null, labelId?: string | null, defaultKind?: 'note' | 'feature' }} */
  let { projectId = null, labelId = null, defaultKind = 'note' } = $props();

  let expanded = $state(false);
  let title = $state('');
  let body = $state('');
  let kind = $state(/** @type {'note' | 'feature'} */ ('note'));
  let flash = $state(false);
  /** @type {HTMLElement | undefined} */
  let root = $state();
  const FLASH_MS = 400;

  $effect.pre(() => {
    kind = defaultKind;
  });

  const placeholder = $derived(kind === 'feature' ? 'Request a feature for your agents…' : 'Take a note…');

  function save() {
    if (!title.trim() && !body.trim()) return;
    store.create('notes', { kind, title: title.trim(), body: body.trim(), project_id: projectId, label_ids: labelId ? [labelId] : [] });
    title = '';
    body = '';
    flash = true;
    setTimeout(() => (flash = false), FLASH_MS);
  }

  /** Collapse once focus leaves the whole composer, saving what was typed. @param {FocusEvent} event */
  function onfocusout(event) {
    if (root?.contains(/** @type {Node | null} */ (event.relatedTarget))) return;
    save();
    expanded = false;
  }

  /** @param {KeyboardEvent} event */
  function onTitleKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      save();
    }
    if (event.key === 'Escape') /** @type {HTMLElement} */ (event.currentTarget).blur();
  }
</script>

<div bind:this={root} class="spring border bg-surface {flash ? 'border-accent' : 'border-line hover:border-line-strong'} focus-within:border-line-strong" {onfocusout}>
  <div class="flex items-center">
    <input bind:value={title} maxlength={MAX_TITLE} {placeholder} aria-label={placeholder}
      class="min-w-0 flex-1 bg-transparent px-4 py-3 short:py-2 text-fluid-base font-semibold text-ink placeholder:font-normal placeholder:text-ink-faint focus:outline-none"
      onfocus={() => (expanded = true)} onkeydown={onTitleKey} />
    <div class="flex shrink-0 border-l border-line" role="group" aria-label="Kind">
      <button class="spring press flex items-center gap-1.5 px-3 py-3 short:py-2 text-xs {kind === 'note' ? 'bg-surface-raised text-ink' : 'text-ink-faint hover:text-ink'}"
        aria-pressed={kind === 'note'} onclick={() => (kind = 'note')} title="Plain note"><StickyNote class="size-4" /><span class="hidden md:inline">Note</span></button>
      <button class="spring press flex items-center gap-1.5 px-3 py-3 short:py-2 text-xs {kind === 'feature' ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:text-ink'}"
        aria-pressed={kind === 'feature'} onclick={() => (kind = 'feature')} title="Feature request for agents"><Lightbulb class="size-4" /><span class="hidden md:inline">Feature</span></button>
    </div>
  </div>
  {#if expanded}
    <div transition:slide={{ duration: 150 }}>
      <textarea bind:value={body} maxlength={MAX_BODY} rows="3" placeholder={kind === 'feature' ? 'Details, acceptance criteria, links… agents read all of it' : 'Write anything'} aria-label="Details"
        class="block max-h-60 w-full resize-y border-t border-line bg-transparent px-4 py-3 text-fluid-sm text-ink placeholder:text-ink-faint focus:outline-none"></textarea>
      <div class="flex items-center justify-between border-t border-line px-2 py-1.5">
        <span class="px-2 font-mono text-[11px] text-ink-faint">Enter to save · Esc to close</span>
        <button class="spring press bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-40" disabled={!title.trim() && !body.trim()} onclick={save}>
          {kind === 'feature' ? 'Request' : 'Save'}
        </button>
      </div>
    </div>
  {/if}
</div>
