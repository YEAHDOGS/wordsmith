<script>
  // The panel that edits whatever is selected on the architecture canvas: one box (title, details, kind, color), one
  // arrow (label, line, direction), several boxes (duplicate, delete), or the diagram itself (project, description,
  // exports) when Details is on. It floats over the canvas, on the right on wide screens and along the bottom on
  // phones, and slides with transform and opacity only, so the canvas never moves.
  import { tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import X from '@lucide/svelte/icons/x';
  import Copy from '@lucide/svelte/icons/copy';
  import Trash from '@lucide/svelte/icons/trash';
  import Cable from '@lucide/svelte/icons/cable';
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import ColorPicker from './ColorPicker.svelte';
  import Segmented from './Segmented.svelte';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { apiUrl } from '../lib/api.js';
  import { toMermaid } from '../lib/diagram.js';
  import { byName } from '../lib/nav-order.js';
  import { EDGE_STYLES, MAX_MISSION, MAX_NAME, MAX_NODE_TEXT, NODE_KINDS } from '../lib/models.js';
  import TEXT from './architecture.json';

  /** @type {{ editor: import('./diagram-editor.svelte.js').DiagramEditor, details: boolean, focus: number, onclose: () => void }} */
  let { editor, details, focus, onclose } = $props();

  const T = TEXT.inspector;
  const FIELD = 'w-full border border-line bg-app px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none tv:text-lg';
  const LABEL = 'flex flex-col gap-1 font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint tv:text-sm';
  const ACTION = 'spring press inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 border border-line bg-surface px-2 text-xs text-ink-muted hover:border-line-strong hover:text-ink tv:min-h-12 tv:text-lg';
  const DANGER = 'spring press inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 border border-line bg-surface px-2 text-xs text-ink-muted hover:border-accent hover:text-accent tv:min-h-12 tv:text-lg';
  const PANEL_IN = { y: 16, duration: 200, easing: quintOut };
  const PANEL_OUT = { y: 16, duration: 120 };
  const COPIED_MS = 1_600;
  const CONFIRM_MS = 4_000;

  const node = $derived(editor.selected.length === 1 ? editor.node(editor.selected[0]) : null);
  const edge = $derived(editor.selectedEdge ? editor.edges.find((candidate) => candidate.id === editor.selectedEdge) : null);
  const many = $derived(editor.selected.length > 1);
  const mode = $derived(node ? 'node' : edge ? 'edge' : many ? 'many' : details ? 'diagram' : '');
  const diagram = $derived(editor.diagram);
  const projects = $derived(byName(store.projects));

  let copied = $state('');
  let confirming = $state(false);
  /** @type {HTMLElement | undefined} */
  let panel = $state();

  // Double-click or Enter on a box puts the cursor in the first field.
  $effect(() => {
    if (!focus) return;
    tick().then(() => /** @type {HTMLInputElement | null | undefined} */ (panel?.querySelector('input, textarea'))?.select());
  });

  /** @param {string} what @param {string} text */
  async function copy(what, text) {
    await navigator.clipboard?.writeText(text);
    copied = what;
    setTimeout(() => (copied = ''), COPIED_MS);
  }

  /** The first press arms the button; the second, within a few seconds, deletes. */
  function removeDiagram() {
    if (!confirming) {
      confirming = true;
      setTimeout(() => (confirming = false), CONFIRM_MS);
      return;
    }
    store.remove('diagrams', editor.id);
    router.replace('architecture');
  }

  function close() {
    editor.select([]);
    onclose();
  }

  /** Escape in a field closes the panel instead of clearing the canvas selection twice. @param {KeyboardEvent} event */
  function onkeydown(event) {
    if (event.key === 'Escape') close();
  }
</script>

{#if mode && diagram}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside bind:this={panel} {onkeydown} aria-label={T[/** @type {'node' | 'edge' | 'diagram'} */ (mode === 'many' ? 'node' : mode)]}
    class="absolute inset-x-0 bottom-0 z-30 flex max-h-[60%] short:max-h-full flex-col gap-3 overflow-y-auto overscroll-contain border-t border-line-strong bg-surface p-3 sm:inset-x-auto sm:top-2 sm:right-2 sm:bottom-auto sm:max-h-[calc(100%-1rem)] sm:w-72 sm:border tv:w-96"
    in:fly={PANEL_IN} out:fly={PANEL_OUT}>
    <header class="flex items-center justify-between">
      <h2 class="font-mono text-xs uppercase tracking-widest text-ink-muted tv:text-base">
        {mode === 'many' ? T.selected.replace('{count}', String(editor.selected.length)) : T[/** @type {'node' | 'edge' | 'diagram'} */ (mode)]}
      </h2>
      <button class="spring press -m-1 p-1 text-ink-faint hover:text-ink" aria-label={T.close} onclick={close}><X class="size-4" /></button>
    </header>

    {#if node}
      {#key node.id}
        <label class={LABEL}>{T.titleLabel}
          <input class={FIELD} value={node.title} maxlength={MAX_NAME} oninput={(event) => editor.patchNode(node.id, { title: event.currentTarget.value }, 'title')} />
        </label>
        <label class={LABEL}>{T.textLabel}
          <textarea class="{FIELD} min-h-16 resize-none" rows="3" value={node.text} maxlength={MAX_NODE_TEXT} placeholder={T.textPlaceholder}
            oninput={(event) => editor.patchNode(node.id, { text: event.currentTarget.value }, 'text')}></textarea>
        </label>
        <div class="flex items-end gap-2">
          <label class="{LABEL} min-w-0 flex-1">{T.kind}
            <select class={FIELD} value={node.kind} onchange={(event) => editor.patchNode(node.id, { kind: event.currentTarget.value })}>
              {#each NODE_KINDS as kind (kind)}<option value={kind}>{TEXT.kinds[/** @type {keyof typeof TEXT.kinds} */ (kind)]}</option>{/each}
            </select>
          </label>
          <ColorPicker value={node.color} onchange={(color) => editor.patchNode(node.id, { color })} />
        </div>
        <div class="flex flex-wrap gap-1">
          <button class={ACTION} onclick={() => { editor.connecting = true; editor.connectFrom = node.id; }}><Cable class="size-3.5" />{T.connectFrom}</button>
          <button class={ACTION} onclick={() => editor.duplicateSelection()}><Copy class="size-3.5" />{T.duplicate}</button>
          <button class={DANGER} onclick={() => editor.removeSelection()}><Trash class="size-3.5" />{T.delete}</button>
        </div>
      {/key}
    {:else if edge}
      {#key edge.id}
        <label class={LABEL}>{T.label}
          <input class={FIELD} value={edge.label} maxlength={MAX_NAME} placeholder={T.labelPlaceholder} oninput={(event) => editor.patchEdge(edge.id, { label: event.currentTarget.value }, 'label')} />
        </label>
        <div class={LABEL}>{T.style}
          <Segmented options={EDGE_STYLES} value={edge.style} labels={{ solid: T.solid, dashed: T.dashed }} label={T.style} onselect={(style) => editor.patchEdge(edge.id, { style })} />
        </div>
        <div class="flex flex-wrap gap-1">
          <button class={ACTION} onclick={() => editor.patchEdge(edge.id, { from: edge.to, to: edge.from })}><ArrowLeftRight class="size-3.5" />{T.reverse}</button>
          <button class={DANGER} onclick={() => editor.removeSelection()}><Trash class="size-3.5" />{T.delete}</button>
        </div>
      {/key}
    {:else if many}
      <div class="flex flex-wrap gap-1">
        <button class={ACTION} onclick={() => editor.duplicateSelection()}><Copy class="size-3.5" />{T.duplicate}</button>
        <button class={DANGER} onclick={() => editor.removeSelection()}><Trash class="size-3.5" />{T.delete}</button>
      </div>
    {:else}
      <label class={LABEL}>{T.project}
        <select class={FIELD} value={diagram.project_id ?? ''} onchange={(event) => store.update('diagrams', editor.id, { project_id: event.currentTarget.value || null })}>
          <option value="">{TEXT.noProject}</option>
          {#each projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}
        </select>
      </label>
      <label class={LABEL}>{T.description}
        <textarea class="{FIELD} min-h-24 resize-none" rows="4" value={diagram.description} maxlength={MAX_MISSION} placeholder={T.descriptionPlaceholder}
          oninput={(event) => store.update('diagrams', editor.id, { description: event.currentTarget.value })}></textarea>
      </label>
      <div class="flex flex-wrap gap-1">
        <button class={ACTION} onclick={() => copy('mermaid', toMermaid(diagram))}><Copy class="size-3.5" />{copied === 'mermaid' ? TEXT.copied : T.mermaid}</button>
        <button class={ACTION} onclick={() => copy('prompt', TEXT.prompt.replaceAll('{origin}', apiUrl('')).replaceAll('{id}', editor.id))}><Copy class="size-3.5" />{copied === 'prompt' ? TEXT.copied : TEXT.copyPrompt}</button>
      </div>
      <button class="{DANGER} flex-none {confirming ? 'border-accent text-accent' : ''}" onclick={removeDiagram}><Trash class="size-3.5" />{confirming ? T.confirmDelete : T.deleteDiagram}</button>
    {/if}
  </aside>
{/if}
