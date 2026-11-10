<script>
  // The architecture canvas: one diagram's boxes on a dotted grid, joined by arrows. Drag the background to pan, the
  // wheel or a pinch to zoom, a box to move it (a zone carries the boxes inside it), the dot on a box's right edge to
  // pull an arrow to another box, and the corner of a selected box to resize it. Phones and keyboards use the Connect
  // tool instead of the dot: pick the first box, then the second. Details are edited in the inspector, which floats
  // over the canvas so nothing shifts when it opens. Gestures and state live in diagram-editor.svelte.js.
  // Agents draw on the same diagram through the API; their changes arrive with sync and the boxes glide into place.
  import { untrack } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Cable from '@lucide/svelte/icons/cable';
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import Maximize from '@lucide/svelte/icons/maximize';
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import DiagramInspector from './DiagramInspector.svelte';
  import { DiagramEditor } from './diagram-editor.svelte.js';
  import { KIND_ICON } from './diagram-kinds.js';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { RAIL_BORDER, TINT_BG } from '../lib/colors.js';
  import { center, edgeCurve } from '../lib/diagram.js';
  import { DIAGRAM_GRID, MAX_NAME, NODE_KINDS } from '../lib/models.js';
  import TEXT from './architecture.json';

  /** @type {{ id: string }} */
  let { id } = $props();

  const TOOL = 'spring press flex size-9 shrink-0 items-center justify-center border border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-40 tv:size-12';
  const TOOL_ON = 'border-accent bg-accent-soft text-ink';
  const NODE_IN = { start: 0.85, duration: 180, easing: backOut };
  const HINT = { duration: 150 };
  const PERCENT = 100;
  const ARROW_SIZE = 10;
  const EDGE_HIT_WIDTH = 16;
  const DASH = '6 5';
  // Element ids must be unique on the page: two canvases can overlap for a moment while pages slide.
  const uid = $props.id();

  const editor = $derived(new DiagramEditor(id));
  const diagram = $derived(editor.diagram);
  const curves = $derived(editor.edges.map((edge) => {
    const from = editor.node(edge.from);
    const to = editor.node(edge.to);
    return from && to ? { edge, ...edgeCurve(from, to) } : null;
  }).filter((curve) => curve !== null));
  const linkFrom = $derived(editor.link ? editor.node(editor.link.from) : null);
  const hint = $derived.by(() => {
    if (editor.notice === 'limit') return TEXT.limit;
    if (editor.connecting) return editor.connectFrom ? TEXT.connectHintTo : TEXT.connectHint;
    return editor.nodes.length ? '' : TEXT.emptyCanvas;
  });

  let details = $state(false);
  /** Bumped to move focus into the inspector's first field (double-click or Enter on a box). */
  let focusInspector = $state(0);
  /** @type {HTMLDivElement | undefined} */
  let viewport = $state();

  // Hand the editor its viewport and frame the diagram the first time it is on screen.
  $effect(() => {
    if (!viewport) return;
    editor.element = viewport;
    untrack(() => editor.fit());
  });

  // The limit notice clears itself on the next selection.
  $effect(() => {
    editor.selected;
    editor.selectedEdge;
    untrack(() => (editor.notice = ''));
  });

  /** What a pointer event landed on. @param {Event} event */
  function targetOf(event) {
    const element = /** @type {Element} */ (event.target);
    return {
      node: /** @type {HTMLElement | null} */ (element.closest('[data-node]'))?.dataset.node,
      edge: /** @type {SVGElement | null} */ (element.closest('[data-edge]'))?.dataset.edge,
      handle: /** @type {'link' | 'resize' | undefined} */ (/** @type {HTMLElement | null} */ (element.closest('[data-handle]'))?.dataset.handle),
    };
  }

  /** @param {PointerEvent} event */
  function onpointerdown(event) {
    if (event.button > 0) return;
    // Capture keeps the drag alive outside the canvas. It throws if the pointer is already gone; the drag then just ends early.
    try {
      viewport?.setPointerCapture(event.pointerId);
    } catch {
      // Nothing to release.
    }
    viewport?.focus({ preventScroll: true });
    editor.down(event, targetOf(event));
  }

  /** @param {PointerEvent} event */
  function onpointerup(event) {
    // The pointer is captured, so the event's target is the canvas: look up what is really under it.
    const under = /** @type {HTMLElement | null} */ (document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node]'));
    editor.up(event, under?.dataset.node);
  }

  /** @param {KeyboardEvent} event */
  function onkeydown(event) {
    const focused = /** @type {HTMLElement} */ (event.target).dataset?.node;
    if (focused && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      if (editor.connecting && editor.connectFrom) {
        editor.connect(editor.connectFrom, focused);
        editor.connecting = false;
        editor.connectFrom = '';
      } else if (editor.connecting) {
        editor.connectFrom = focused;
      } else {
        editor.select([focused]);
        focusInspector++;
      }
      return;
    }
    if (event.key.toLowerCase() === 'c' && !event.ctrlKey && !event.metaKey) return editor.toggleConnect();
    if (editor.key(event)) event.preventDefault();
  }

  /** @param {MouseEvent} event */
  function ondblclick(event) {
    if (targetOf(event).node) focusInspector++;
  }

  /** @param {string} name */
  function rename(name) {
    store.update('diagrams', id, { name });
  }
</script>

{#if !diagram || diagram.deleted_at}
  <p class="p-10 text-center text-ink-faint">{TEXT.missing}</p>
{:else}
  <div class="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1.5 sm:gap-1.5 sm:px-4 short:py-1">
    <button class={TOOL} aria-label={TEXT.back} title={TEXT.back} onclick={() => router.go('architecture')}><ArrowLeft class="size-4" /></button>
    <input class="h-9 min-w-24 flex-1 border border-line bg-surface px-2 text-sm font-semibold text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none tv:h-12 tv:text-xl"
      value={diagram.name} maxlength={MAX_NAME} placeholder={TEXT.namePlaceholder} aria-label={TEXT.namePlaceholder} oninput={(event) => rename(event.currentTarget.value)} />
    <button class={TOOL} aria-label={TEXT.undo} title={TEXT.undo} disabled={!editor.canUndo} onclick={() => editor.undo()}><Undo2 class="size-4" /></button>
    <button class="{TOOL} {editor.connecting ? TOOL_ON : ''}" aria-label={TEXT.connect} title={TEXT.connect} aria-pressed={editor.connecting} onclick={() => editor.toggleConnect()}><Cable class="size-4" /></button>
    <!-- Phones pinch to zoom, so the two zoom buttons give their room to the name -->
    <button class="{TOOL} max-sm:hidden" aria-label={TEXT.zoomOut} title={TEXT.zoomOut} onclick={() => editor.zoomOut()}><ZoomOut class="size-4" /></button>
    <span class="hidden w-11 text-center font-mono text-xs text-ink-faint sm:block" aria-hidden="true">{Math.round(editor.zoom * PERCENT)}%</span>
    <button class="{TOOL} max-sm:hidden" aria-label={TEXT.zoomIn} title={TEXT.zoomIn} onclick={() => editor.zoomIn()}><ZoomIn class="size-4" /></button>
    <button class={TOOL} aria-label={TEXT.fit} title={TEXT.fit} onclick={() => editor.fit()}><Maximize class="size-4" /></button>
    <button class="{TOOL} {details ? TOOL_ON : ''}" aria-label={TEXT.details} title={TEXT.details} aria-pressed={details} onclick={() => (details = !details)}><Settings2 class="size-4" /></button>
  </div>

  <!-- One row at every width: the buttons share it evenly on phones and take their own width once labels fit -->
  <div class="flex shrink-0 items-center gap-0.5 border-b border-line px-2 py-1.5 sm:gap-1 sm:px-4 short:py-1" role="toolbar" aria-label={TEXT.palette}>
    {#each NODE_KINDS as kind (kind)}
      {@const Icon = KIND_ICON[/** @type {keyof typeof KIND_ICON} */ (kind)]}
      {@const label = TEXT.kinds[/** @type {keyof typeof TEXT.kinds} */ (kind)]}
      <button class="spring press flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 border border-line bg-surface text-xs text-ink-muted hover:border-accent hover:text-ink sm:w-10 sm:flex-none xl:w-auto xl:px-2 tv:h-12 tv:text-lg"
        aria-label={label} title={label} onclick={() => editor.addNode(kind)}>
        <Icon class="size-4 shrink-0" />
        <span class="hidden xl:inline">{label.split(' ')[0]}</span>
      </button>
    {/each}
  </div>

  <div class="relative min-h-0 flex-1 overflow-hidden">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div bind:this={viewport} class="diagram-grid absolute inset-0 touch-none overflow-hidden bg-app focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent {editor.connecting ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}"
      style:--grid-step="{DIAGRAM_GRID * editor.zoom}px" style:--grid-x="{editor.pan.x}px" style:--grid-y="{editor.pan.y}px"
      role="application" aria-label="{TEXT.title}: {diagram.name || TEXT.untitled}" tabindex="0"
      {onpointerdown} onpointermove={(event) => editor.move(event)} {onpointerup} onpointercancel={(event) => editor.cancel(event)}
      onwheel={(event) => editor.wheel(event)} {onkeydown} {ondblclick}>
      <div class="absolute top-0 left-0 origin-top-left" style:transform="translate({editor.pan.x}px, {editor.pan.y}px) scale({editor.zoom})">
        <svg class="pointer-events-none absolute top-0 left-0 z-10 overflow-visible" width="1" height="1" aria-hidden="true">
          <defs>
            <marker id="{uid}-arrow" viewBox="0 0 {ARROW_SIZE} {ARROW_SIZE}" refX={ARROW_SIZE - 1} refY={ARROW_SIZE / 2} markerWidth={ARROW_SIZE} markerHeight={ARROW_SIZE} markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,0 L{ARROW_SIZE},{ARROW_SIZE / 2} L0,{ARROW_SIZE} z" class="fill-ink-muted" />
            </marker>
            <marker id="{uid}-arrow-on" viewBox="0 0 {ARROW_SIZE} {ARROW_SIZE}" refX={ARROW_SIZE - 1} refY={ARROW_SIZE / 2} markerWidth={ARROW_SIZE} markerHeight={ARROW_SIZE} markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,0 L{ARROW_SIZE},{ARROW_SIZE / 2} L0,{ARROW_SIZE} z" class="fill-accent" />
            </marker>
          </defs>
          {#each curves as { edge, path, middle } (edge.id)}
            {@const on = editor.selectedEdge === edge.id}
            <g data-edge={edge.id} class="pointer-events-auto cursor-pointer" in:fade={HINT}>
              <path d={path} class="fill-none stroke-transparent" stroke-width={EDGE_HIT_WIDTH} />
              <path d={path} class="fill-none transition-colors duration-150 {on ? 'stroke-accent' : 'stroke-ink-muted'}" stroke-width={on ? 2 : 1.5}
                stroke-dasharray={edge.style === 'dashed' ? DASH : undefined} marker-end="url(#{uid}-arrow{on ? '-on' : ''})" />
              {#if edge.label}
                <text x={middle.x} y={middle.y} text-anchor="middle" dominant-baseline="middle" stroke-width="5" stroke-linejoin="round"
                  class="stroke-app font-mono text-[0.6875rem] [paint-order:stroke] {on ? 'fill-accent' : 'fill-ink-muted'}">{edge.label}</text>
              {/if}
            </g>
          {/each}
          {#if editor.link && linkFrom}
            {@const start = center(linkFrom)}
            <path d="M{start.x},{start.y} L{editor.link.to.x},{editor.link.to.y}" class="diagram-link fill-none stroke-accent" stroke-width="2" />
          {/if}
        </svg>

        {#each editor.nodes as node (node.id)}
          {@const Icon = KIND_ICON[/** @type {keyof typeof KIND_ICON} */ (node.kind)] ?? KIND_ICON.service}
          {@const selected = editor.selected.includes(node.id)}
          {@const zone = node.kind === 'zone'}
          {@const bare = node.kind === 'text'}
          {@const kindLabel = TEXT.kinds[/** @type {keyof typeof TEXT.kinds} */ (node.kind)]}
          {@const tint = TINT_BG[/** @type {keyof typeof TINT_BG} */ (node.color)]}
          {@const rail = RAIL_BORDER[/** @type {keyof typeof RAIL_BORDER} */ (node.color)]}
          <div data-node={node.id} role="button" tabindex="0" aria-pressed={selected} aria-label="{kindLabel}: {node.title || kindLabel}"
            class="group absolute top-0 left-0 flex select-none flex-col rounded-ui border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent
              {editor.draft ? '' : 'transition-transform duration-200 ease-out-soft'}
              {zone ? 'z-0 border-dashed' : 'z-20'} {bare || (zone && node.color === 'default') ? 'bg-transparent' : tint}
              {selected || editor.connectFrom === node.id ? 'border-accent' : zone ? rail : bare ? 'border-transparent hover:border-line' : 'border-line-strong'}
              {editor.connecting ? 'cursor-crosshair' : 'cursor-move'}"
            style:width="{node.w}px" style:height="{node.h}px" style:transform="translate({node.x}px, {node.y}px)" in:scale={NODE_IN}>
            {#if zone}
              <div class="flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[0.6875rem] uppercase tracking-widest text-ink-muted">
                <Icon class="size-3.5 shrink-0" /><span class="truncate">{node.title || kindLabel}</span>
              </div>
              {#if node.text}<p class="line-clamp-2 px-2.5 text-xs text-ink-faint">{node.text}</p>{/if}
            {:else}
              <div class="flex min-h-0 flex-1 flex-col justify-center gap-0.5 overflow-hidden px-3 py-1.5">
                <div class="flex items-center gap-2">
                  {#if !bare}<Icon class="size-4 shrink-0 {selected ? 'text-accent' : 'text-ink-muted'}" />{/if}
                  <span class="truncate text-sm font-semibold {node.title ? 'text-ink' : 'text-ink-faint'}">{node.title || kindLabel}</span>
                </div>
                {#if node.text}<p class="line-clamp-3 whitespace-pre-line text-xs leading-snug text-ink-muted">{node.text}</p>{/if}
              </div>
            {/if}
            <!-- Pull an arrow from here. Shown on hover and on the selected box; the wider ::after is its touch target. -->
            <span data-handle="link" aria-hidden="true"
              class="absolute top-1/2 -right-2 size-4 -translate-y-1/2 cursor-crosshair rounded-full border border-accent bg-app transition-opacity duration-150 after:absolute after:-inset-2 group-hover:opacity-100 {selected ? 'opacity-100' : 'opacity-0'}"></span>
            {#if selected && editor.selected.length === 1}
              <span data-handle="resize" aria-hidden="true" class="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize border border-accent bg-app after:absolute after:-inset-2" in:scale={NODE_IN}></span>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    {#if hint}
      <p class="pointer-events-none absolute inset-x-2 bottom-2 z-20 mx-auto w-fit max-w-full border border-line bg-surface px-3 py-1.5 text-center text-xs text-ink-muted" role="status" transition:fade={HINT}>{hint}</p>
    {/if}

    <DiagramInspector {editor} {details} focus={focusInspector} onclose={() => (details = false)} />
  </div>
{/if}
