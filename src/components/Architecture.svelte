<script>
  // Architecture page. Without an id: every diagram as a card with a small drawing of it, newest change first, in a
  // grid that grows from one column on phones to six on ultra-wide screens (only the grid scrolls). With an id: that
  // diagram's canvas (DiagramCanvas.svelte). Agents create diagrams through /api/v1/diagrams and MCP; the prompt
  // button copies instructions for them.
  import { flip } from 'svelte/animate';
  import { fly, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import Plus from '@lucide/svelte/icons/plus';
  import Copy from '@lucide/svelte/icons/copy';
  import Folder from '@lucide/svelte/icons/folder';
  import Network from '@lucide/svelte/icons/network';
  import DiagramCanvas from './DiagramCanvas.svelte';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { apiUrl } from '../lib/api.js';
  import { ago } from '../lib/time.js';
  import { bounds, center, liveEdges } from '../lib/diagram.js';
  import TEXT from './architecture.json';

  /** @type {{ id?: string }} */
  let { id = '' } = $props();

  const BUTTON = 'spring press inline-flex min-h-10 items-center justify-center gap-2 border px-3 text-sm font-medium tv:min-h-14 tv:text-xl';
  const PRIMARY = `${BUTTON} border-accent bg-accent text-accent-ink hover:bg-accent-hover`;
  const SECONDARY = `${BUTTON} border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink`;
  const CARD_STAGGER_MS = 40;
  const MAX_STAGGERED = 12;
  const FLIP_MS = 220;
  const COPIED_MS = 1_600;
  // The thumbnail's drawing area, in SVG units; diagrams are scaled to fit inside it with this margin.
  const THUMB = { w: 240, h: 135, margin: 12 };

  const diagrams = $derived(store.diagrams.filter((diagram) => !diagram.deleted_at).sort((a, b) => b.updated_at - a.updated_at));
  let copied = $state(false);

  function create() {
    const diagram = store.create('diagrams', {});
    router.go('architecture', diagram.id);
  }

  async function copyPrompt() {
    await navigator.clipboard?.writeText(TEXT.prompt.replaceAll('{origin}', apiUrl('')).replaceAll('{id}', ':id'));
    copied = true;
    setTimeout(() => (copied = false), COPIED_MS);
  }

  /**
   * A diagram shrunk into the thumbnail: its boxes as rectangles and its arrows as straight lines, in SVG units.
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

{#if id}
  <DiagramCanvas {id} />
{:else}
  <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 py-2 sm:px-4 short:py-1">
    <button class={PRIMARY} onclick={create}><Plus class="size-4" />{TEXT.new}</button>
    <button class={SECONDARY} onclick={copyPrompt}><Copy class="size-4" />{copied ? TEXT.copied : TEXT.copyPrompt}</button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    {#if diagrams.length}
      <ul class="mx-auto grid w-full max-w-7xl grid-cols-1 gap-px border-b border-line bg-line sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 ultrawide:max-w-none ultrawide:grid-cols-6 short:grid-cols-3">
        {#each diagrams as diagram, index (diagram.id)}
          {@const thumb = thumbnail(diagram)}
          {@const project = diagram.project_id ? store.find('projects', diagram.project_id) : null}
          <li class="bg-app" animate:flip={{ duration: FLIP_MS }} in:fly={{ y: 10, duration: 260, delay: Math.min(index, MAX_STAGGERED) * CARD_STAGGER_MS }}>
            <button class="group flex w-full flex-col text-left transition-colors duration-150 hover:bg-surface-raised focus-visible:bg-surface-raised" onclick={() => router.go('architecture', diagram.id)}>
              <svg viewBox="0 0 {THUMB.w} {THUMB.h}" class="diagram-grid aspect-video w-full border-b border-line bg-app short:hidden" aria-hidden="true">
                {#each thumb.lines as line (line.id)}
                  <line x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} class="stroke-ink-faint" stroke-width="1" />
                {/each}
                {#each thumb.rects as rect (rect.id)}
                  <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} stroke-width="1" stroke-dasharray={rect.zone ? '3 2' : undefined}
                    class="spring origin-center {rect.zone ? 'fill-none stroke-line-strong' : 'fill-surface stroke-ink-muted group-hover:stroke-accent'}" />
                {/each}
              </svg>
              <span class="flex flex-col gap-1 px-3 py-2.5 short:py-1.5">
                <span class="truncate text-sm font-semibold text-ink tv:text-xl">{diagram.name || TEXT.untitled}</span>
                <span class="flex items-center gap-2 font-mono text-[0.6875rem] text-ink-faint tv:text-sm">
                  {#if project}<span class="flex min-w-0 items-center gap-1"><Folder class="size-3 shrink-0" /><span class="truncate">{project.name}</span></span>{/if}
                  <span class="shrink-0">{TEXT.nodes.replace('{count}', String(diagram.nodes.length))}</span>
                  <span class="ml-auto shrink-0">{ago(diagram.updated_at)}</span>
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
        <span in:scale={{ start: 0.6, duration: 300, easing: backOut }}><Network class="size-10 text-accent tv:size-16" /></span>
        <h2 class="text-fluid-lg font-bold">{TEXT.emptyTitle}</h2>
        <p class="text-fluid-sm leading-relaxed text-ink-muted short:hidden">{TEXT.emptyBody}</p>
      </div>
    {/if}
  </div>
{/if}
