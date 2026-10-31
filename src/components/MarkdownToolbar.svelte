<script>
  // Small Markdown formatting buttons for a textarea: bold, italic, text size, code and lists.
  // Every screen shows two buttons: text style (bold, italic, heading) and blocks (lists, code),
  // each opening its options in a small row above it, so the toolbar stays narrow and the Preview switch always fits.
  // Buttons keep the textarea's focus and selection (mousedown is cancelled), so a tap formats what you selected.
  // With `preview` bound, an extra toggle switches the field to its rendered view.
  import Bold from '@lucide/svelte/icons/bold';
  import Italic from '@lucide/svelte/icons/italic';
  import Heading from '@lucide/svelte/icons/heading';
  import List from '@lucide/svelte/icons/list';
  import ListOrdered from '@lucide/svelte/icons/list-ordered';
  import ListTodo from '@lucide/svelte/icons/list-todo';
  import Code from '@lucide/svelte/icons/code';
  import Type from '@lucide/svelte/icons/type';
  import Eye from '@lucide/svelte/icons/eye';
  import Pencil from '@lucide/svelte/icons/pencil';
  import { scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { MARKERS, applyEdit, cycleHeading, toggleList, wrap } from '../lib/markdown-input.js';

  /** @type {{ textarea: HTMLTextAreaElement | undefined, preview?: boolean, showPreview?: boolean, class?: string }} */
  let { textarea, preview = $bindable(false), showPreview = false, class: className = '' } = $props();

  const BUTTON = 'spring press flex size-7 sm:size-8 tv:size-11 shrink-0 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink disabled:opacity-40';
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const MOD = IS_MAC ? '⌘' : 'Ctrl+';
  // Crossfade for the Preview / Edit icon and label, which swap in place
  const SWAP = 'transition-[opacity,scale] duration-150 ease-(--ease-spring)';
  const MENU_IN = { start: 0.9, duration: 160, easing: backOut };
  const MENU_OUT = { start: 0.95, duration: 100 };
  const GROUPS = [
    {
      key: 'text', label: 'Text style', icon: Type, actions: [
        { label: `Bold (${MOD}B)`, icon: Bold, run: (/** @type {HTMLTextAreaElement} */ area) => applyEdit(area, wrap(area, MARKERS.bold)) },
        { label: `Italic (${MOD}I)`, icon: Italic, run: (/** @type {HTMLTextAreaElement} */ area) => applyEdit(area, wrap(area, MARKERS.italic)) },
        { label: 'Text size: heading 1, 2, 3, normal', icon: Heading, run: cycleHeading },
      ],
    },
    {
      key: 'lists', label: 'Lists and code', icon: List, actions: [
        { label: 'Bulleted list', icon: List, run: (/** @type {HTMLTextAreaElement} */ area) => toggleList(area, 'bullet') },
        { label: 'Numbered list', icon: ListOrdered, run: (/** @type {HTMLTextAreaElement} */ area) => toggleList(area, 'number') },
        { label: 'Checklist', icon: ListTodo, run: (/** @type {HTMLTextAreaElement} */ area) => toggleList(area, 'check') },
        { label: 'Code', icon: Code, run: (/** @type {HTMLTextAreaElement} */ area) => applyEdit(area, wrap(area, MARKERS.code)) },
      ],
    },
  ];

  /** The menu that is open: 'text', 'lists' or ''. */
  let open = $state('');
  /** @type {HTMLElement | undefined} */
  let root = $state();

  /** @param {{ run: (area: HTMLTextAreaElement) => void }} action */
  function apply(action) {
    if (textarea) action.run(textarea);
    open = '';
  }

  /** Taps outside close the menu. Escape closes it too; the note editor sees [data-popover] and stays open. @param {PointerEvent} event */
  function onWindowPointer(event) {
    if (open && !root?.contains(/** @type {Node} */ (event.target))) open = '';
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={(event) => { if (open && event.key === 'Escape') open = ''; }} />

{#snippet button(/** @type {any} */ action)}
  <button type="button" class={BUTTON} title={action.label} aria-label={action.label} disabled={preview || !textarea}
    onmousedown={(event) => event.preventDefault()} onclick={() => apply(action)}>
    <action.icon class="size-4" />
  </button>
{/snippet}

<div bind:this={root} class="flex min-w-0 items-center justify-end gap-0.5 {className}" role="toolbar" aria-label="Formatting">
  <!-- Two buttons, each opening its options in a row above it -->
  {#each GROUPS as group (group.key)}
    <div class="relative shrink-0">
      <button type="button" class="{BUTTON} {open === group.key ? 'bg-surface-raised text-ink' : ''}" title={group.label} aria-label={group.label} aria-haspopup="true"
        aria-expanded={open === group.key} disabled={preview || !textarea} onmousedown={(event) => event.preventDefault()} onclick={() => (open = open === group.key ? '' : group.key)}>
        <group.icon class="size-4" />
      </button>
      {#if open === group.key}
        <div data-popover class="absolute right-0 bottom-full z-20 mb-1 flex origin-bottom-right gap-0.5 border border-line bg-surface p-0.5" role="group" aria-label={group.label}
          in:scale={MENU_IN} out:scale={MENU_OUT}>
          {#each group.actions as action (action.label)}{@render button(action)}{/each}
        </div>
      {/if}
    </div>
  {/each}
  {#if showPreview}
    <span class="mx-0.5 h-5 w-px shrink-0 bg-line" aria-hidden="true"></span>
    <button type="button" class="{BUTTON} w-auto shrink-0 sm:w-auto tv:w-auto gap-1 px-1.5 text-xs whitespace-nowrap sm:gap-1.5 sm:px-2 {preview ? 'text-accent' : ''}" aria-pressed={preview} aria-label={preview ? 'Back to editing' : 'Preview formatting'} onclick={() => { preview = !preview; open = ''; }}
      title={preview ? 'Back to editing' : 'Preview formatting'}>
      <!-- Both icons and both labels share one grid cell and crossfade, so the button and the buttons beside it never move -->
      <span class="grid *:col-start-1 *:row-start-1" aria-hidden="true">
        <Eye class="size-4 {SWAP} {preview ? 'scale-50 opacity-0' : ''}" />
        <Pencil class="size-4 {SWAP} {preview ? '' : 'scale-50 opacity-0'}" />
      </span>
      <span class="grid *:col-start-1 *:row-start-1" aria-hidden="true">
        <span class="{SWAP} {preview ? 'opacity-0' : ''}">Preview</span>
        <span class="{SWAP} {preview ? '' : 'opacity-0'}">Edit</span>
      </span>
    </button>
  {/if}
</div>
