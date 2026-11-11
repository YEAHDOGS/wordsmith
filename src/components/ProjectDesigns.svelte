<script>
  // A project's Designs tab: the designs linked to it, as the same cards the Design page shows (DesignGrid.svelte).
  // They are the same rows, so a change made here or there shows in both and syncs to every device. Draw a new one
  // for this project, or link one you already have; a card's unlink button takes it out of the project again
  // (it stays on the Design page). Only the grid scrolls.
  // Opening a card shows the full canvas right here, under the project's tabs: you stay in the project, and the
  // canvas's back button returns to the cards.
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import Plus from '@lucide/svelte/icons/plus';
  import Network from '@lucide/svelte/icons/network';
  import DesignGrid from './DesignGrid.svelte';
  import LazyPage from './LazyPage.svelte';
  import { store } from '../lib/store.svelte.js';
  import TEXT from './design.json';

  /** @type {{ project: any }} */
  let { project } = $props();

  const loadCanvas = () => import('./DiagramCanvas.svelte');
  const OPEN_MS = 150;
  const BUTTON = 'spring press inline-flex min-h-9 items-center justify-center gap-2 border px-3 text-sm font-medium tv:min-h-14 tv:text-xl';

  const live = $derived(store.diagrams.filter((diagram) => !diagram.deleted_at).sort((a, b) => b.updated_at - a.updated_at));
  const linked = $derived(live.filter((diagram) => diagram.project_id === project.id));
  // Designs that could be linked here: the unlinked ones first, then those in another project (linking moves them).
  const others = $derived(live.filter((diagram) => diagram.project_id !== project.id).sort((a, b) => Number(Boolean(a.project_id)) - Number(Boolean(b.project_id))));

  // The design open on the canvas, by id ('' = the cards). It closes by itself if the design is deleted, unlinked
  // (the canvas toolbar can do that) or you move to another project.
  let openId = $state('');
  const open = $derived(linked.find((diagram) => diagram.id === openId));

  function create() {
    openId = store.create('diagrams', { project_id: project.id }).id;
  }

  /** @param {any} diagram */
  function optionLabel(diagram) {
    const name = diagram.name || TEXT.untitled;
    const owner = diagram.project_id ? store.find('projects', diagram.project_id)?.name : '';
    return owner ? TEXT.inProject.replace('{design}', name).replace('{project}', owner) : name;
  }

  /** @param {Event & { currentTarget: HTMLSelectElement }} event */
  function linkExisting(event) {
    const id = event.currentTarget.value;
    event.currentTarget.value = '';
    if (id) store.update('diagrams', id, { project_id: project.id });
  }
</script>

{#if open}
  <div class="flex h-full min-h-0 flex-col border-x border-line" in:fade={{ duration: OPEN_MS }}>
    <!-- The canvas editor loads on first use (the Design page shares the same chunk), keeping it out of the start-up bundle -->
    <LazyPage load={loadCanvas} id={open.id} onback={() => (openId = '')} backLabel={TEXT.backToProject} />
  </div>
{:else}
<div class="flex h-full min-h-0 flex-col" in:fade={{ duration: OPEN_MS }}>
  <div class="flex shrink-0 flex-wrap items-center gap-2 py-2 sm:py-3 short:py-1">
    <button class="{BUTTON} border-accent bg-accent text-accent-ink hover:bg-accent-hover" onclick={create}><Plus class="size-4" />{TEXT.new}</button>
    {#if others.length}
      <select class="spring min-h-9 max-w-full min-w-0 flex-1 border border-line bg-surface px-2 text-sm text-ink-muted hover:border-line-strong hover:text-ink focus:border-accent focus:outline-none sm:max-w-xs sm:flex-none tv:min-h-14 tv:text-xl"
        aria-label={TEXT.linkExistingLabel} onchange={linkExisting}>
        <option value="">{TEXT.linkExisting}</option>
        {#each others as diagram (diagram.id)}<option value={diagram.id}>{optionLabel(diagram)}</option>{/each}
      </select>
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 sm:pb-4">
    {#if linked.length}
      <div class="border-x border-t border-line"><DesignGrid diagrams={linked} inProject onopen={(id) => (openId = id)} /></div>
    {:else}
      <div class="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
        <span in:scale={{ start: 0.6, duration: 300, easing: backOut }}><Network class="size-10 text-accent short:size-6 tv:size-16" /></span>
        <h2 class="text-fluid-lg font-bold">{TEXT.projectEmptyTitle}</h2>
        <p class="text-fluid-sm leading-relaxed text-ink-muted short:hidden">{TEXT.projectEmptyBody}</p>
      </div>
    {/if}
  </div>
</div>
{/if}
