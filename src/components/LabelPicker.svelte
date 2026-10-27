<script>
  // Toggle labels on a note, or create a new one inline by typing a name that doesn't exist yet.
  import Plus from '@lucide/svelte/icons/plus';
  import Check from '@lucide/svelte/icons/check';
  import { fade, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { store } from '../lib/store.svelte.js';
  import { DOT_BG } from '../lib/colors.js';
  import { MAX_LABELS_PER_NOTE, MAX_NAME } from '../lib/models.js';

  /** @type {{ selected: string[], onchange: (ids: string[]) => void }} */
  let { selected, onchange } = $props();

  // Crossfade between the color dot and the check mark, so toggling never swaps elements abruptly
  const SWAP = 'transition-[opacity,scale] duration-150 ease-(--ease-spring)';

  let draft = $state('');
  const labels = $derived(store.labels.filter((label) => !label.deleted_at).sort((a, b) => a.name.localeCompare(b.name)));

  /** @param {string} id */
  function toggle(id) {
    onchange(selected.includes(id) ? selected.filter((existing) => existing !== id) : [...selected, id].slice(0, MAX_LABELS_PER_NOTE));
  }

  /** @param {SubmitEvent} event */
  function create(event) {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    const existing = labels.find((label) => label.name.toLowerCase() === name.toLowerCase());
    const label = existing ?? store.create('labels', { name });
    if (!selected.includes(label.id)) toggle(label.id);
    draft = '';
  }
</script>

<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Labels">
  {#each labels as label (label.id)}
    {@const on = selected.includes(label.id)}
    <button class="spring press inline-flex items-center gap-1.5 border px-2 py-1 text-xs {on ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-muted hover:border-line-strong'}"
      aria-pressed={on} onclick={() => toggle(label.id)} animate:flip={{ duration: 200 }} in:scale={{ start: 0.85, duration: 150 }} out:fade={{ duration: 100 }}>
      <span class="grid size-3 place-items-center *:col-start-1 *:row-start-1" aria-hidden="true">
        <Check class="size-3 {SWAP} {on ? '' : 'scale-50 opacity-0'}" />
        <span class="size-1.5 rounded-full {SWAP} {on ? 'scale-50 opacity-0' : ''} {DOT_BG[/** @type {keyof typeof DOT_BG} */ (label.color)] || DOT_BG.default}"></span>
      </span>
      {label.name}
    </button>
  {/each}
  <form class="inline-flex items-center border border-dashed border-line-strong" onsubmit={create}>
    <Plus class="ml-1.5 size-3 text-ink-faint" />
    <input bind:value={draft} maxlength={MAX_NAME} placeholder="New label" aria-label="New label"
      class="w-24 bg-transparent px-1.5 py-1 text-xs text-ink placeholder:text-ink-faint focus:outline-none" />
  </form>
</div>
