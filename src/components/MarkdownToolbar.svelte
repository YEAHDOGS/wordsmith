<script>
  // Small Markdown formatting buttons for a textarea: bold, italic, text size, lists and code.
  // Buttons keep the textarea's focus and selection (mousedown is cancelled), so a click formats what you selected.
  // With `preview` bound, an extra toggle switches the field to its rendered view.
  import Bold from '@lucide/svelte/icons/bold';
  import Italic from '@lucide/svelte/icons/italic';
  import Heading from '@lucide/svelte/icons/heading';
  import List from '@lucide/svelte/icons/list';
  import ListOrdered from '@lucide/svelte/icons/list-ordered';
  import ListTodo from '@lucide/svelte/icons/list-todo';
  import Code from '@lucide/svelte/icons/code';
  import Eye from '@lucide/svelte/icons/eye';
  import Pencil from '@lucide/svelte/icons/pencil';
  import { MARKERS, applyEdit, cycleHeading, toggleList, wrap } from '../lib/markdown-input.js';

  /** @type {{ textarea: HTMLTextAreaElement | undefined, preview?: boolean, showPreview?: boolean, class?: string }} */
  let { textarea, preview = $bindable(false), showPreview = false, class: className = '' } = $props();

  const BUTTON = 'spring press flex size-7 sm:size-8 tv:size-11 shrink-0 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink disabled:opacity-40';
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const MOD = IS_MAC ? '⌘' : 'Ctrl+';
  const ACTIONS = [
    { label: `Bold (${MOD}B)`, icon: Bold, run: (/** @type {HTMLTextAreaElement} */ area) => applyEdit(area, wrap(area, MARKERS.bold)) },
    { label: `Italic (${MOD}I)`, icon: Italic, run: (/** @type {HTMLTextAreaElement} */ area) => applyEdit(area, wrap(area, MARKERS.italic)) },
    { label: 'Text size: heading 1, 2, 3, normal', icon: Heading, run: cycleHeading },
    { label: 'Bulleted list', icon: List, run: (/** @type {HTMLTextAreaElement} */ area) => toggleList(area, 'bullet') },
    { label: 'Numbered list', icon: ListOrdered, run: (/** @type {HTMLTextAreaElement} */ area) => toggleList(area, 'number') },
    { label: 'Checklist', icon: ListTodo, run: (/** @type {HTMLTextAreaElement} */ area) => toggleList(area, 'check') },
    { label: 'Code', icon: Code, run: (/** @type {HTMLTextAreaElement} */ area) => applyEdit(area, wrap(area, MARKERS.code)) },
  ];
</script>

<div class="flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none {className}" role="toolbar" aria-label="Formatting">
  {#each ACTIONS as action (action.label)}
    <button type="button" class={BUTTON} title={action.label} aria-label={action.label} disabled={preview || !textarea}
      onmousedown={(event) => event.preventDefault()} onclick={() => textarea && action.run(textarea)}>
      <action.icon class="size-4" />
    </button>
  {/each}
  {#if showPreview}
    <span class="mx-0.5 h-5 w-px shrink-0 bg-line" aria-hidden="true"></span>
    <button type="button" class="{BUTTON} w-auto gap-1 px-1.5 text-xs sm:gap-1.5 sm:px-2 {preview ? 'text-accent' : ''}" aria-pressed={preview} onclick={() => (preview = !preview)}
      title={preview ? 'Back to editing' : 'Preview formatting'}>
      {#if preview}<Pencil class="size-4" />Edit{:else}<Eye class="size-4" />Preview{/if}
    </button>
  {/if}
</div>
