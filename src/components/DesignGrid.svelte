<script>
  // Designs as cards, each with a small drawing of it: the Design page shows every design, a project's Designs tab
  // shows that project's. A card opens its canvas. Under the drawing, the Design page has a project picker (linking a
  // design to a project is one choice, right on the card); the project tab has an unlink button instead. The grid
  // grows from one column on phones to six on ultra-wide screens.
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import Folder from '@lucide/svelte/icons/folder';
  import Unlink from '@lucide/svelte/icons/unlink';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { byName } from '../lib/nav-order.js';
  import { ago } from '../lib/time.js';
  import { bounds, center, liveEdges } from '../lib/diagram.js';
  import TEXT from './design.json';

  /**
   * @type {{ diagrams: any[], inProject?: boolean, onopen?: (id: string) => void }}
   * inProject: the cards belong to one project's tab (unlink instead of the picker).
   * onopen: what a card does; by default it opens the design on the Design page.
   */
  let { diagrams, inProject = false, onopen = (id) => router.go('design', id) } = $props();

  const CARD_STAGGER_MS = 40;
  const MAX_STAGGERED = 12;
  const FLIP_MS = 220;
  // The thumbnail's drawing area, in SVG units; designs are scaled to fit inside it with this margin.
  const THUMB = { w: 240, h: 135, margin: 12 };

  const projects = $derived(byName(store.projects.filter((project) => !project.deleted_at)));

  /**
   * A design shrunk into the thumbnail: its boxes as rectangles and its arrows as straight lines, in SVG units.
   * @param {any} diagram
   */
  function thumbnail(diagram) {
    const box = bounds(diagram.nodes);
    if (!box) return { rects: [], lines: [] };
    const ratio = Math.min((THUMB.w - THUMB.margin * 2) / Math.max(box.w, 1), (THUMB.h - THUMB.margin * 2) / Math.max(box.h, 1));
    const left = (THUMB.w - box.w * ratio) / 2;
    const top = (THUMB.h - box.h * ratio) / 2;
    const place = (/** @type {{ x: number, y: number }} */ point) => ({ x: left + (point.x - box.x) * ratio, y: top + (point.y - box.y) * ratio });
    const byId = new Map(diagram.nodes.map((/** @type {any} */ node) => [node.id, node]));
    return {
      rects: diagram.nodes.map((/** @type {any} */ node) => ({ id: node.id, zone: node.kind === 'zone', ...place(node), w: node.w * ratio, h: node.h * ratio })),
      lines: liveEdges(diagram.nodes, diagram.edges).map((edge) => ({ id: edge.id, from: place(center(byId.get(edge.from))), to: place(center(byId.get(edge.to))) })),
    };
  }
</script>

<ul class="mx-auto grid w-full max-w-7xl grid-cols-1 gap-px border-b border-line bg-line sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 ultrawide:max-w-none ultrawide:grid-cols-6 short:grid-cols-3">
  {#each diagrams as diagram, index (diagram.id)}
    {@const thumb = thumbnail(diagram)}
    {@const name = diagram.name || TEXT.untitled}
    <li class="flex min-w-0 flex-col bg-app" animate:flip={{ duration: FLIP_MS }} in:fly={{ y: 10, duration: 260, delay: Math.min(index, MAX_STAGGERED) * CARD_STAGGER_MS }}>
      <button class="group flex w-full min-w-0 flex-col text-left transition-colors duration-150 hover:bg-surface-raised focus-visible:bg-surface-raised" aria-label={TEXT.open.replace('{design}', name)} onclick={() => onopen(diagram.id)}>
        <svg viewBox="0 0 {THUMB.w} {THUMB.h}" class="diagram-grid aspect-video w-full border-b border-line bg-app short:hidden" aria-hidden="true">
          {#each thumb.lines as line (line.id)}
            <line x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} class="stroke-ink-faint" stroke-width="1" />
          {/each}
          {#each thumb.rects as rect (rect.id)}
            <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} stroke-width="1" stroke-dasharray={rect.zone ? '3 2' : undefined}
              class="spring origin-center {rect.zone ? 'fill-none stroke-line-strong' : 'fill-surface stroke-ink-muted group-hover:stroke-accent'}" />
          {/each}
        </svg>
        <span class="flex items-baseline gap-2 px-3 pt-2.5 short:pt-1.5">
          <span class="min-w-0 flex-1 truncate text-sm font-semibold text-ink tv:text-xl">{name}</span>
          <span class="shrink-0 font-mono text-[0.6875rem] text-ink-faint tv:text-sm">{ago(diagram.updated_at)}</span>
        </span>
      </button>
      <!-- Outside the card button: a control of its own, so linking never opens the canvas -->
      <div class="flex h-9 items-center gap-2 px-3 pb-1 font-mono text-[0.6875rem] text-ink-faint tv:h-12 tv:text-sm">
        {#if inProject}
          <span class="min-w-0 flex-1 truncate">{TEXT.nodes.replace('{count}', String(diagram.nodes.length))}</span>
          <button class="spring press -mr-1.5 flex size-7 shrink-0 items-center justify-center text-ink-faint hover:text-accent tv:size-10" aria-label={TEXT.unlink.replace('{design}', name)} title={TEXT.unlink.replace('{design}', name)}
            onclick={() => store.update('diagrams', diagram.id, { project_id: null })}><Unlink class="size-3.5 tv:size-5" /></button>
        {:else}
          <label class="flex min-w-0 flex-1 items-center gap-1.5 {diagram.project_id ? 'text-ink-muted' : ''}">
            <Folder class="size-3 shrink-0" aria-hidden="true" />
            <select class="spring min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent py-1 font-mono text-[0.6875rem] text-inherit hover:text-ink focus:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent tv:text-sm"
              aria-label={TEXT.linkTo.replace('{design}', name)} value={diagram.project_id ?? ''} onchange={(event) => store.update('diagrams', diagram.id, { project_id: event.currentTarget.value || null })}>
              <option value="">{TEXT.noProject}</option>
              {#each projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}
            </select>
          </label>
          <span class="shrink-0">{TEXT.nodes.replace('{count}', String(diagram.nodes.length))}</span>
        {/if}
      </div>
    </li>
  {/each}
</ul>
