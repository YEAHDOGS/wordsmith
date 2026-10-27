<script>
  // Navigation: views, projects and labels. Full width on desktop, icon rail on tablets (compact), drawer on phones.
  // Top: logo, wordmark and the sync icon. Bottom: the Made by DOGS sticker, then the app version and a settings cog.
  import Inbox from '@lucide/svelte/icons/inbox';
  import Kanban from '@lucide/svelte/icons/kanban';
  import Archive from '@lucide/svelte/icons/archive';
  import Settings from '@lucide/svelte/icons/settings';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Check from '@lucide/svelte/icons/check';
  import Trash from '@lucide/svelte/icons/trash';
  import Tag from '@lucide/svelte/icons/tag';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import logo from '../assets/dogs-logo-cropped.png';
  import madeByDogs from '../assets/made-by-dogs-small.png';
  import SyncStatus from './SyncStatus.svelte';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { DOT_BG } from '../lib/colors.js';
  import { MAX_NAME } from '../lib/models.js';
  import { APP_VERSION } from '../lib/version.js';

  /** @type {{ compact?: boolean }} */
  let { compact = false } = $props();

  const NAV = [
    { view: 'notes', label: 'All notes', icon: Inbox },
    { view: 'features', label: 'Features', icon: Kanban },
    { view: 'archive', label: 'Archive', icon: Archive },
  ];
  const ITEM = 'spring press group relative flex w-full items-center gap-3 px-4 py-2.5 short:py-1.5 text-left text-sm tv:text-xl text-ink-muted hover:bg-surface-raised hover:text-ink';
  const ACTIVE = 'bg-accent-soft text-ink';
  // The red bar on the active row is always there and scales in and out, so switching pages never pops.
  const INDICATOR = 'pointer-events-none absolute inset-y-0 left-0 w-0.5 origin-center bg-accent spring';
  // Section headers: the + sits in the count column (same right edge as the project counts), centered on the label.
  const SECTION = 'mt-3 flex items-center justify-between border-t border-line px-4 pt-3 pb-1';
  const SECTION_LABEL = 'font-mono text-[0.6875rem] tv:text-sm uppercase tracking-widest text-ink-faint';
  const SECTION_BUTTON = 'spring press -my-1 p-1 text-ink-faint hover:text-accent';
  const DOGS_URL = 'https://dogs.red';
  const MADE_BY = 'This product was made by DOGS';

  let newProject = $state('');
  let newLabel = $state('');
  let addingProject = $state(false);
  let addingLabel = $state(false);
  let editingLabels = $state(false);

  const projects = $derived(store.projects.filter((p) => !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name)));
  const labels = $derived(store.labels.filter((l) => !l.deleted_at).sort((a, b) => a.name.localeCompare(b.name)));
  /** Open (not complete) features per project, for the badge. */
  const openCounts = $derived.by(() => {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const note of store.notes) {
      if (note.deleted_at || note.archived || note.kind !== 'feature' || note.state === 'complete' || !note.project_id) continue;
      counts[note.project_id] = (counts[note.project_id] || 0) + 1;
    }
    return counts;
  });

  /** @param {string} view @param {string} [id] */
  function go(view, id = '') {
    router.go(view, id);
    ui.drawerOpen = false;
  }

  /** @param {SubmitEvent} event */
  function addProject(event) {
    event.preventDefault();
    const name = newProject.trim();
    if (!name) return;
    const project = store.create('projects', { name });
    ui.newProjectId = project.id;
    newProject = '';
    addingProject = false;
    go('project', project.id);
  }

  /** @param {SubmitEvent} event */
  function addLabel(event) {
    event.preventDefault();
    const name = newLabel.trim();
    if (!name) return;
    store.create('labels', { name });
    newLabel = '';
  }

  /** @param {HTMLElement} node */
  function autofocus(node) {
    node.focus();
  }

  const active = (/** @type {string} */ view, id = '') => router.route.view === view && (!id || router.route.id === id);
</script>

<nav class="flex h-full min-h-0 flex-col bg-app" aria-label="Main">
  <div class="relative z-20 flex shrink-0 items-center border-b border-line {compact ? 'flex-col justify-center gap-1 py-2' : 'gap-2.5 py-2 pr-2 pl-4 short:py-1'}">
    <img src={logo} alt="DOGS logo" class="size-7 object-contain spring hover:rotate-12" />
    {#if !compact}
      <span class="min-w-0 flex-1 truncate text-base tv:text-2xl font-black tracking-tight">word<span class="text-accent">smith</span></span>
    {/if}
    <SyncStatus {compact} />
  </div>

  <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-2">
    {#each NAV as item (item.view)}
      <button class="{ITEM} {active(item.view) ? ACTIVE : ''} {compact ? 'justify-center px-0' : ''}" onclick={() => go(item.view)} title={item.label} aria-current={active(item.view) ? 'page' : undefined}>
        <span class="{INDICATOR} {active(item.view) ? 'scale-y-100' : 'scale-y-0'}"></span>
        <item.icon class="size-4 tv:size-6 shrink-0" />
        {#if !compact}<span>{item.label}</span>{/if}
      </button>
    {/each}

    {#if compact}
      <!-- Rail: a plain divider. New projects and their counts live in the full sidebar (drawer), not floating here. -->
      <div class="mx-3 my-2 border-t border-line" role="separator"></div>
    {:else}
      <div class={SECTION}>
        <span class={SECTION_LABEL}>Projects</span>
        <button class="{SECTION_BUTTON} -mr-1" title="New project" aria-label="New project" aria-expanded={addingProject} onclick={() => (addingProject = !addingProject)}>
          <span class="flex spring {addingProject ? 'rotate-45' : ''}"><Plus class="size-4" /></span>
        </button>
      </div>
    {/if}
    {#if addingProject && !compact}
      <form class="px-4 py-1" onsubmit={addProject} transition:slide={{ duration: 150 }}>
        <input use:autofocus bind:value={newProject} maxlength={MAX_NAME} placeholder="Project name" aria-label="New project name"
          class="w-full border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          onkeydown={(event) => event.key === 'Escape' && (addingProject = false)} />
      </form>
    {/if}
    {#each projects as project (project.id)}
      <button animate:flip={{ duration: 150 }} class="{ITEM} {active('project', project.id) ? ACTIVE : ''} {compact ? 'justify-center px-0' : ''}" onclick={() => go('project', project.id)}
        title={openCounts[project.id] ? `${project.name}, ${openCounts[project.id]} open` : project.name} aria-current={active('project', project.id) ? 'page' : undefined}>
        <span class="{INDICATOR} {active('project', project.id) ? 'scale-y-100' : 'scale-y-0'}"></span>
        {#if compact}
          <span class="flex size-7 items-center justify-center border border-line font-mono text-xs uppercase text-ink">{project.name.slice(0, 2)}</span>
        {:else}
          <span class="size-2 shrink-0 rounded-full {DOT_BG[/** @type {keyof typeof DOT_BG} */ (project.color)] || DOT_BG.default}"></span>
          <span class="min-w-0 flex-1 truncate">{project.name}</span>
          {#if openCounts[project.id]}<span class="min-w-4 text-right font-mono text-xs tabular-nums text-ink-faint">{openCounts[project.id]}</span>{/if}
        {/if}
      </button>
    {/each}

    {#if !compact}
      <div class={SECTION}>
        <span class={SECTION_LABEL}>Labels</span>
        <div class="-mr-1 flex gap-1">
          <button class={SECTION_BUTTON} title={editingLabels ? 'Done editing' : 'Edit labels'} aria-label={editingLabels ? 'Done editing labels' : 'Edit labels'} onclick={() => (editingLabels = !editingLabels)}>
            {#key editingLabels}
              <span class="icon-swap flex">{#if editingLabels}<Check class="size-4" />{:else}<Pencil class="size-4" />{/if}</span>
            {/key}
          </button>
          <button class={SECTION_BUTTON} title="New label" aria-label="New label" aria-expanded={addingLabel} onclick={() => (addingLabel = !addingLabel)}>
            <span class="flex spring {addingLabel ? 'rotate-45' : ''}"><Plus class="size-4" /></span>
          </button>
        </div>
      </div>
      {#if addingLabel}
        <form class="px-4 py-1" onsubmit={addLabel} transition:slide={{ duration: 150 }}>
          <input use:autofocus bind:value={newLabel} maxlength={MAX_NAME} placeholder="Label name, Enter to add" aria-label="Label name"
            class="w-full border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            onkeydown={(event) => event.key === 'Escape' && (addingLabel = false)} />
        </form>
      {/if}
      {#each labels as label (label.id)}
        <div animate:flip={{ duration: 150 }}>
          {#if editingLabels}
            <div class="flex items-center gap-2 px-4 py-1" transition:slide={{ duration: 150 }}>
              <Tag class="size-4 shrink-0 text-ink-faint" />
              <input value={label.name} maxlength={MAX_NAME} aria-label="Rename label"
                class="min-w-0 flex-1 border border-line bg-surface px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
                onchange={(event) => event.currentTarget.value.trim() && store.update('labels', label.id, { name: event.currentTarget.value.trim() })} />
              <button class="spring press -mr-1 p-1 text-ink-faint hover:text-accent" aria-label="Delete label {label.name}" title="Delete label" onclick={() => store.remove('labels', label.id)}><Trash class="size-4" /></button>
            </div>
          {:else}
            <div transition:slide={{ duration: 150 }}>
              <button class="{ITEM} {active('label', label.id) ? ACTIVE : ''}" onclick={() => go('label', label.id)} aria-current={active('label', label.id) ? 'page' : undefined}>
                <span class="{INDICATOR} {active('label', label.id) ? 'scale-y-100' : 'scale-y-0'}"></span>
                <Tag class="size-4 shrink-0" />
                <span class="truncate">{label.name}</span>
              </button>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <div class="shrink-0 border-t border-line">
    {#if !compact}
      <a href={DOGS_URL} target="_blank" rel="noopener noreferrer" class="group block w-fit px-4 pt-3 pb-1 short:hidden" title="DOGS" aria-label="{MADE_BY} (opens dogs.red in a new tab)">
        <img src={madeByDogs} alt="" width="480" height="159"
          class="h-9 w-auto -rotate-3 shadow-md spring group-hover:rotate-0 group-hover:scale-105 group-active:scale-95 tv:h-14" />
      </a>
    {/if}
    <div class="flex items-center {compact ? 'justify-center py-1' : 'justify-between py-1 pr-1.5 pl-4'}">
      {#if !compact}<span class="font-mono text-[0.6875rem] tv:text-sm text-ink-faint selectable" title="wordsmith version">v{APP_VERSION}</span>{/if}
      <button class="spring press relative flex size-9 tv:size-12 items-center justify-center hover:bg-surface-raised {active('settings') ? 'text-accent' : 'text-ink-muted hover:text-ink'}"
        onclick={() => go('settings')} title={compact ? `Settings (v${APP_VERSION})` : 'Settings'} aria-label="Settings" aria-current={active('settings') ? 'page' : undefined}>
        <span class="flex spring {active('settings') ? 'rotate-90' : ''}"><Settings class="size-4 tv:size-6" /></span>
      </button>
    </div>
  </div>
</nav>
