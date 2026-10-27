<script>
  // Navigation: views, projects and labels. Full width on desktop, icon rail on tablets (compact), drawer on phones.
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
  import { fly, slide } from 'svelte/transition';
  import logo from '../assets/dogs-logo-cropped.png';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { DOT_BG } from '../lib/colors.js';
  import { MAX_NAME } from '../lib/models.js';

  /** @type {{ compact?: boolean }} */
  let { compact = false } = $props();

  const NAV = [
    { view: 'notes', label: 'All notes', icon: Inbox },
    { view: 'features', label: 'Features', icon: Kanban },
    { view: 'archive', label: 'Archive', icon: Archive },
  ];
  const ITEM = 'spring press group relative flex w-full items-center gap-3 px-4 py-2.5 short:py-1.5 text-left text-sm tv:text-xl text-ink-muted hover:bg-surface-raised hover:text-ink';
  const ACTIVE = 'bg-accent-soft text-ink';

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
  <div class="flex items-center gap-2.5 border-b border-line px-4 py-3 short:py-2 {compact ? 'justify-center px-0' : ''}">
    <img src={logo} alt="DOGS logo" class="size-7 object-contain spring hover:rotate-12" />
    {#if !compact}
      <span class="text-base tv:text-2xl font-black tracking-tight">word<span class="text-accent">smith</span></span>
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto py-2">
    {#each NAV as item (item.view)}
      <button class="{ITEM} {active(item.view) ? ACTIVE : ''} {compact ? 'justify-center px-0' : ''}" onclick={() => go(item.view)} title={item.label} aria-current={active(item.view) ? 'page' : undefined}>
        {#if active(item.view)}<span class="absolute inset-y-0 left-0 w-0.5 bg-accent" in:fly={{ x: -4, duration: 150 }}></span>{/if}
        <item.icon class="size-4 tv:size-6 shrink-0" />
        {#if !compact}<span>{item.label}</span>{/if}
      </button>
    {/each}

    <div class="mt-3 flex items-center justify-between border-t border-line px-4 pt-3 pb-1 {compact ? 'justify-center px-0' : ''}">
      {#if !compact}<span class="font-mono text-[11px] tv:text-sm uppercase tracking-widest text-ink-faint">Projects</span>{/if}
      <button class="spring press p-1 text-ink-faint hover:text-accent" title="New project" aria-label="New project" onclick={() => (compact ? (ui.drawerOpen = true) : (addingProject = !addingProject))}>
        <Plus class="size-4" />
      </button>
    </div>
    {#if addingProject && !compact}
      <form class="px-4 py-1" onsubmit={addProject} transition:slide={{ duration: 150 }}>
        <input use:autofocus bind:value={newProject} maxlength={MAX_NAME} placeholder="Project name" aria-label="Project name"
          class="w-full border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          onkeydown={(event) => event.key === 'Escape' && (addingProject = false)} />
      </form>
    {/if}
    {#each projects as project (project.id)}
      <button animate:flip={{ duration: 150 }} class="{ITEM} {active('project', project.id) ? ACTIVE : ''} {compact ? 'justify-center px-0' : ''}" onclick={() => go('project', project.id)} title={project.name}>
        {#if active('project', project.id)}<span class="absolute inset-y-0 left-0 w-0.5 bg-accent"></span>{/if}
        {#if compact}
          <span class="flex size-7 items-center justify-center border border-line font-mono text-xs uppercase text-ink">{project.name.slice(0, 2)}</span>
        {:else}
          <span class="size-2 shrink-0 rounded-full {DOT_BG[/** @type {keyof typeof DOT_BG} */ (project.color)] || DOT_BG.default}"></span>
          <span class="min-w-0 flex-1 truncate">{project.name}</span>
          {#if openCounts[project.id]}<span class="font-mono text-xs text-ink-faint">{openCounts[project.id]}</span>{/if}
        {/if}
      </button>
    {/each}

    {#if !compact}
      <div class="mt-3 flex items-center justify-between border-t border-line px-4 pt-3 pb-1">
        <span class="font-mono text-[11px] tv:text-sm uppercase tracking-widest text-ink-faint">Labels</span>
        <div class="flex gap-1">
          <button class="spring press p-1 text-ink-faint hover:text-accent" title={editingLabels ? 'Done editing' : 'Edit labels'} aria-label={editingLabels ? 'Done editing labels' : 'Edit labels'} onclick={() => (editingLabels = !editingLabels)}>
            {#if editingLabels}<Check class="size-4" />{:else}<Pencil class="size-4" />{/if}
          </button>
          <button class="spring press p-1 text-ink-faint hover:text-accent" title="New label" aria-label="New label" onclick={() => (addingLabel = !addingLabel)}><Plus class="size-4" /></button>
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
              <button class="spring press p-1 text-ink-faint hover:text-accent" aria-label="Delete label {label.name}" title="Delete label" onclick={() => store.remove('labels', label.id)}><Trash class="size-4" /></button>
            </div>
          {:else}
            <button class="{ITEM} {active('label', label.id) ? ACTIVE : ''}" onclick={() => go('label', label.id)}>
              {#if active('label', label.id)}<span class="absolute inset-y-0 left-0 w-0.5 bg-accent"></span>{/if}
              <Tag class="size-4 shrink-0" />
              <span class="truncate">{label.name}</span>
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <button class="{ITEM} border-t border-line {active('settings') ? ACTIVE : ''} {compact ? 'justify-center px-0' : ''}" onclick={() => go('settings')} title="Settings">
    <Settings class="size-4 tv:size-6" />
    {#if !compact}<span>Settings &amp; agents</span>{/if}
  </button>
</nav>
