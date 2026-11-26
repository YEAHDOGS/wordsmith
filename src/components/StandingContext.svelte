<script>
  // Settings card for the owner's standing context: one Markdown doc every agent reads before it starts
  // (GET /api/v1/context, the MCP get_context tool). Saved on the server; agent tokens can read it but never write it.
  import Check from '@lucide/svelte/icons/check';
  import { fade, slide } from 'svelte/transition';
  import { api } from '../lib/api.js';
  import { markdownKeys } from '../lib/markdown-input.js';
  import { MAX_CONTEXT } from '../lib/models.js';
  import { BOX, BUTTON, HEADING, HINT } from './settings-styles.js';
  import TEXT from './settings.json';

  const SAVED_MS = 1600;
  const SWAP = { duration: 150 };

  let body = $state('');
  let saved = $state('');
  let loaded = $state(false);
  let saving = $state(false);
  let flash = $state(false);
  let error = $state('');
  const dirty = $derived(loaded && body !== saved);

  $effect(() => {
    api('/api/v1/context').then((result) => {
      body = saved = result.body;
      loaded = true;
    }).catch((failure) => (error = failure.message));
  });

  async function save() {
    saving = true;
    error = '';
    try {
      saved = (await api('/api/v1/context', { method: 'PUT', body: { body } })).body;
      flash = true;
      setTimeout(() => (flash = false), SAVED_MS);
    } catch (failure) {
      error = /** @type {Error} */ (failure).message;
    }
    saving = false;
  }

  /** Ctrl/Cmd+S saves, like the note editor. @param {KeyboardEvent} event */
  function onkeydown(event) {
    if (event.key.toLowerCase() !== 's' || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    if (dirty) save();
  }
</script>

<h2 class={HEADING}>{TEXT.standingContext}</h2>
<p class={HINT}>{TEXT.standingContextHint}</p>
<textarea bind:value={body} use:markdownKeys {onkeydown} maxlength={MAX_CONTEXT} rows="8" disabled={!loaded} aria-label={TEXT.standingContext}
  placeholder={TEXT.standingContextPlaceholder}
  class="block max-h-96 min-h-32 w-full resize-y px-3 py-2 font-mono text-xs leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-60 tv:text-base {BOX}"></textarea>
<div class="mt-3 flex flex-wrap items-center gap-3">
  <button class={BUTTON} onclick={save} disabled={!dirty || saving}>{TEXT.save}</button>
  {#if flash}<span class="inline-flex items-center gap-1 text-xs text-complete" role="status" transition:fade={SWAP}><Check class="size-3.5" />{TEXT.saved}</span>{/if}
  <span class="ml-auto font-mono text-[0.6875rem] tabular-nums text-ink-faint">{body.length.toLocaleString()} / {MAX_CONTEXT.toLocaleString()}</span>
</div>
{#if error}<p class="mt-2 text-xs text-accent" role="alert" transition:slide={SWAP}>{error}</p>{/if}
