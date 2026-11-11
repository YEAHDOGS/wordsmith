<script>
  // Design page. Without an id: every design as a card (DesignGrid.svelte), newest change first, with a filter by
  // project; only the grid scrolls. With an id: that design's canvas (DiagramCanvas.svelte). A design linked to a
  // project is the same row the project's Designs tab shows, so both stay in step. Agents create designs through
  // /api/v1/diagrams and MCP; the prompt button copies instructions for them.
  import { scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import Plus from '@lucide/svelte/icons/plus';
  import Copy from '@lucide/svelte/icons/copy';
  import Network from '@lucide/svelte/icons/network';
  import DiagramCanvas from './DiagramCanvas.svelte';
  import DesignGrid from './DesignGrid.svelte';
  import { store } from '../lib/store.svelte.js';
  import { MAX_DIAGRAMS } from '../lib/models.js';
  import { router } from '../lib/router.svelte.js';
  import { apiUrl } from '../lib/api.js';
  import { byName } from '../lib/nav-order.js';
  import TEXT from './design.json';

  /** @type {{ id?: string }} */
  let { id = '' } = $props();

  const BUTTON = 'spring press inline-flex min-h-10 items-center justify-center gap-2 border px-3 text-sm font-medium tv:min-h-14 tv:text-xl';
  const PRIMARY = `${BUTTON} border-accent bg-accent text-accent-ink hover:bg-accent-hover`;
  const SECONDARY = `${BUTTON} border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink`;
  const COPIED_MS = 1_600;
  // Filter values that aren't a project id.
  const ALL = '';
  const UNLINKED = 'none';

  const diagrams = $derived(store.diagrams.filter((diagram) => !diagram.deleted_at).sort((a, b) => b.updated_at - a.updated_at));
  const projects = $derived(byName(store.projects.filter((project) => !project.deleted_at)));
  let filter = $state(ALL);
  const shown = $derived(diagrams.filter((diagram) => filter === ALL || (filter === UNLINKED ? !diagram.project_id : diagram.project_id === filter)));
  let copied = $state(false);

  /** A new design starts in the project being looked at, if any. */
  function create() {
    const diagram = store.create('diagrams', { project_id: filter !== ALL && filter !== UNLINKED ? filter : null });
    router.go('design', diagram.id);
  }

  async function copyPrompt() {
    await navigator.clipboard?.writeText(TEXT.prompt.replaceAll('{origin}', apiUrl('')).replaceAll('{id}', ':id'));
    copied = true;
    setTimeout(() => (copied = false), COPIED_MS);
  }
</script>

{#if id}
  <DiagramCanvas {id} />
{:else}
  <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 py-2 sm:px-4 short:py-1">
    <button class="{PRIMARY} disabled:opacity-40" disabled={diagrams.length >= MAX_DIAGRAMS} title={diagrams.length >= MAX_DIAGRAMS ? TEXT.atLimit : undefined} onclick={create}><Plus class="size-4" />{TEXT.new}</button>
    <button class={SECONDARY} onclick={copyPrompt}><Copy class="size-4" />{copied ? TEXT.copied : TEXT.copyPrompt}</button>
    {#if diagrams.length}
      <select class="spring ml-auto min-h-10 max-w-full min-w-0 border border-line bg-surface px-2 text-sm text-ink-muted hover:border-line-strong hover:text-ink focus:border-accent focus:outline-none tv:min-h-14 tv:text-xl"
        aria-label={TEXT.filter} bind:value={filter}>
        <option value={ALL}>{TEXT.allProjects}</option>
        <option value={UNLINKED}>{TEXT.noProject}</option>
        {#each projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}
      </select>
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    {#if shown.length}
      <DesignGrid diagrams={shown} />
    {:else if diagrams.length}
      <p class="px-4 py-12 text-center text-sm text-ink-muted">{TEXT.noneInFilter}</p>
    {:else}
      <div class="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
        <span in:scale={{ start: 0.6, duration: 300, easing: backOut }}><Network class="size-10 text-accent tv:size-16" /></span>
        <h2 class="text-fluid-lg font-bold">{TEXT.emptyTitle}</h2>
        <p class="text-fluid-sm leading-relaxed text-ink-muted short:hidden">{TEXT.emptyBody}</p>
      </div>
    {/if}
  </div>
{/if}
