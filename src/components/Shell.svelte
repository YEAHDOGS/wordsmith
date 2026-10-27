<script>
  // Signed-in layout. Phones: one column + bottom nav + drawer. Tablets: icon rail. Desktop: full sidebar,
  // content capped at max-w-7xl. Ultra-wide: content spreads. Only lists scroll; the frame never does.
  import { fade, fly } from 'svelte/transition';
  import Sidebar from './Sidebar.svelte';
  import TopBar from './TopBar.svelte';
  import BottomNav from './BottomNav.svelte';
  import Composer from './Composer.svelte';
  import NoteGrid from './NoteGrid.svelte';
  import FeatureBoard from './FeatureBoard.svelte';
  import ProjectHeader from './ProjectHeader.svelte';
  import NoteEditor from './NoteEditor.svelte';
  import Settings from './Settings.svelte';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { ui } from '../lib/ui.svelte.js';

  const CONTENT = 'mx-auto w-full max-w-7xl ultrawide:max-w-none';
  const SEARCH_FIELDS = ['title', 'body', 'status', 'assignee'];

  let projectTab = $state('board');
  const route = $derived(router.route);
  const live = $derived(store.notes.filter((note) => !note.deleted_at));
  const project = $derived(route.view === 'project' ? store.find('projects', route.id) : null);
  const label = $derived(route.view === 'label' ? store.find('labels', route.id) : null);

  /** On-device search over text fields, PR urls/titles and label names. */
  const matches = $derived.by(() => {
    const query = ui.query.trim().toLowerCase();
    if (!query) return live;
    const labelNames = new Map(store.labels.map((entry) => [entry.id, entry.name.toLowerCase()]));
    return live.filter((note) =>
      SEARCH_FIELDS.some((field) => String(note[field] || '').toLowerCase().includes(query))
      || note.pull_requests.some((/** @type {any} */ pr) => `${pr.url} ${pr.title}`.toLowerCase().includes(query))
      || note.label_ids.some((/** @type {string} */ id) => labelNames.get(id)?.includes(query)));
  });

  const byRecent = (/** @type {any} */ a, /** @type {any} */ b) => b.updated_at - a.updated_at;
  const view = $derived.by(() => {
    const active = matches.filter((note) => !note.archived);
    switch (route.view) {
      case 'features': return { title: 'Features', subtitle: 'Every project, in claim order', features: active.filter((note) => note.kind === 'feature') };
      case 'project': {
        const inProject = active.filter((note) => note.project_id === route.id);
        return { title: project?.name || 'Project', subtitle: project?.repo || '', features: inProject.filter((note) => note.kind === 'feature'), notes: inProject.filter((note) => note.kind === 'note').sort(byRecent) };
      }
      case 'label': return { title: label?.name || 'Label', subtitle: 'Label', notes: active.filter((note) => note.label_ids.includes(route.id)).sort(byRecent) };
      case 'archive': return { title: 'Archive', subtitle: 'Archived notes and shipped work', notes: matches.filter((note) => note.archived).sort(byRecent) };
      case 'settings': return { title: 'Settings & agents', subtitle: '' };
      default: return { title: 'All notes', subtitle: `${active.length} notes`, notes: active.sort(byRecent) };
    }
  });

  /** Bottom-nav "+": a blank note in the current context, opened straight into the editor. */
  function newNote() {
    const inProject = route.view === 'project';
    const note = store.create('notes', {
      kind: inProject || route.view === 'features' ? 'feature' : 'note',
      project_id: inProject ? route.id : null,
      label_ids: route.view === 'label' ? [route.id] : [],
    });
    router.openNote(note.id);
  }

  // Leaving a project resets its tab.
  $effect(() => {
    route.id;
    projectTab = 'board';
  });
</script>

<div class="flex h-dvh w-full overflow-hidden bg-app text-ink">
  <aside class="hidden w-16 shrink-0 border-r border-line md:block lg:w-64 ultrawide:w-72 tv:w-80">
    <div class="h-full lg:hidden"><Sidebar compact /></div>
    <div class="hidden h-full lg:block"><Sidebar /></div>
  </aside>

  <div class="flex min-w-0 flex-1 flex-col">
    <TopBar title={view.title} subtitle={view.subtitle} />

    <main class="min-h-0 flex-1 overflow-hidden">
      {#key route.view + route.id}
        <div class="flex h-full flex-col" in:fade={{ duration: 150 }}>
          {#if route.view === 'settings'}
            <Settings />
          {:else if route.view === 'project' && !project}
            <p class="p-10 text-center text-ink-faint">This project doesn't exist on this device yet. It may still be syncing.</p>
          {:else if route.view === 'project' || route.view === 'features'}
            {#if project}<ProjectHeader {project} features={view.features ?? []} tab={projectTab} ontab={(tab) => (projectTab = tab)} />{/if}
            {#if route.view !== 'project' || projectTab === 'board'}
              <div class="{CONTENT} border-b border-line p-2 sm:p-3 short:hidden">
                <Composer projectId={project?.id ?? null} defaultKind="feature" />
              </div>
              <div class="{CONTENT} min-h-0 flex-1 sm:border-x border-line">
                <FeatureBoard features={view.features ?? []} showProject={!project} />
              </div>
            {:else}
              <div class="min-h-0 flex-1 overflow-y-auto">
                <div class="{CONTENT} p-2 sm:p-4"><Composer projectId={project?.id ?? null} defaultKind="note" /></div>
                <div class="{CONTENT} pb-6 sm:px-4"><NoteGrid notes={view.notes ?? []} showProject={false} empty="No notes in this project yet." /></div>
              </div>
            {/if}
          {:else}
            <div class="min-h-0 flex-1 overflow-y-auto">
              {#if route.view !== 'archive'}
                <div class="{CONTENT} p-2 sm:p-4"><Composer labelId={label?.id ?? null} /></div>
              {/if}
              <div class="{CONTENT} pb-6 sm:px-4">
                <NoteGrid notes={view.notes ?? []} empty={ui.query ? 'No matches.' : route.view === 'archive' ? 'Nothing archived.' : 'Capture your first idea above.'} />
              </div>
            </div>
          {/if}
        </div>
      {/key}
    </main>

    <div class="md:hidden"><BottomNav onnew={newNote} /></div>
  </div>

  {#if ui.drawerOpen}
    <div class="fixed inset-0 z-40 flex lg:hidden">
      <button class="absolute inset-0 bg-scrim" aria-label="Close navigation" onclick={() => (ui.drawerOpen = false)} transition:fade={{ duration: 150 }}></button>
      <div class="relative h-full w-72 max-w-[85vw] border-r border-line" transition:fly={{ x: -300, duration: 220, opacity: 1 }}>
        <Sidebar />
      </div>
    </div>
  {/if}

  {#if route.note}
    {#key route.note}<NoteEditor id={route.note} />{/key}
  {/if}
</div>
