<script>
  // Signed-in layout. Phones: one column + bottom nav + drawer. Tablets: icon rail. Desktop: full sidebar,
  // content capped at max-w-7xl. Ultra-wide: content spreads. Only lists scroll; the frame never does.
  import { untrack } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicIn, quintOut } from 'svelte/easing';
  import Sidebar from './Sidebar.svelte';
  import TopBar from './TopBar.svelte';
  import BottomNav from './BottomNav.svelte';
  import Composer from './Composer.svelte';
  import NoteGrid from './NoteGrid.svelte';
  import FeatureBoard from './FeatureBoard.svelte';
  import BoardSettings from './BoardSettings.svelte';
  import ProjectHeader from './ProjectHeader.svelte';
  import NoteEditor from './NoteEditor.svelte';
  import Settings from './Settings.svelte';
  import PullRequests from './PullRequests.svelte';
  import ProjectMedia from './ProjectMedia.svelte';
  import SelectionBar from './SelectionBar.svelte';
  import Trash from './Trash.svelte';
  import TRASH_TEXT from './trash.json';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { FEATURES_SCOPE, TRASH_DAYS } from '../lib/models.js';

  const CONTENT = 'mx-auto w-full max-w-7xl ultrawide:max-w-none';
  const SEARCH_FIELDS = ['title', 'body', 'status', 'assignee'];
  // Page changes: the old page fades out while the new one rises in, stacked in the same box so nothing shifts.
  const PAGE_IN = { y: 10, duration: 260, delay: 60, easing: quintOut };
  const PAGE_OUT = { duration: 120, easing: cubicIn };
  // Switching project tabs: the new content fades in where the old was (no out transition, so nothing stacks).
  const TAB_IN = { duration: 160 };
  const DRAWER_IN = { x: -300, duration: 260, opacity: 1, easing: quintOut };
  const DRAWER_OUT = { x: -300, duration: 180, opacity: 1, easing: cubicIn };

  let projectTab = $state('board');
  const route = $derived(router.route);
  const live = $derived(store.notes.filter((note) => !note.deleted_at));
  const project = $derived(route.view === 'project' || route.view === 'project-settings' ? store.find('projects', route.id) : null);
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

  const view = $derived.by(() => {
    const active = matches.filter((note) => !note.archived);
    switch (route.view) {
      case 'features': return { title: 'Features', subtitle: 'Every project, in claim order', features: active };
      case 'project': {
        const inProject = active.filter((note) => note.project_id === route.id);
        return { title: project?.name || 'Project', subtitle: project?.repo || '', features: inProject, notes: inProject };
      }
      case 'label': return { title: label?.name || 'Label', subtitle: 'Label', notes: active.filter((note) => note.label_ids.includes(route.id)) };
      case 'archive': return { title: 'Archive', subtitle: 'Archived notes and shipped work', notes: matches.filter((note) => note.archived) };
      case 'trash': return { title: TRASH_TEXT.title, subtitle: TRASH_TEXT.subtitle.replace('{days}', String(TRASH_DAYS)) };
      case 'settings': return { title: 'Settings', subtitle: '' };
      case 'features-settings': return { title: 'Features', subtitle: 'Board settings' };
      case 'project-settings': return { title: project?.name || 'Project', subtitle: 'Project settings' };
      default: return { title: 'All notes', subtitle: `${active.length} notes`, notes: active };
    }
  });

  // The gear next to the title opens the board's settings; on those pages it isn't shown.
  const openSettings = $derived(route.view === 'features' ? () => router.go('features-settings') : project && route.view === 'project' ? () => router.go('project-settings', project.id) : null);

  /** The cards on screen right now: what "select all" picks. */
  const visible = $derived.by(() => {
    if (route.view === 'features' || (project && projectTab === 'board')) return view.features ?? [];
    if (project && (projectTab === 'prs' || projectTab === 'media')) return [];
    return (view.notes ?? []).filter((note) => ui.showsState(note));
  });

  /** Escape closes the phone drawer; Ctrl/Cmd+A outside a text field selects every card in view. @param {KeyboardEvent} event */
  function onkeydown(event) {
    if (event.key === 'Escape' && ui.drawerOpen) {
      ui.drawerOpen = false;
      return;
    }
    if (event.key.toLowerCase() !== 'a' || !(event.ctrlKey || event.metaKey) || route.note || !visible.length) return;
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest('input, textarea, select, [contenteditable]')) return;
    event.preventDefault();
    ui.selectAll(visible.map((note) => note.id));
  }

  /** Bottom-nav "+": a blank note in the current context, opened straight into the editor. */
  function newNote() {
    const note = store.create('notes', {
      project_id: route.view === 'project' ? route.id : null,
      label_ids: route.view === 'label' ? [route.id] : [],
    });
    router.openNote(note.id);
  }

  // A selection belongs to the page it was made on.
  $effect(() => {
    route.view;
    route.id;
    projectTab;
    // untrack: clearing reads the set, which would make every new selection clear itself.
    untrack(() => ui.selected.clear());
  });

  // Leaving a project resets its tab.
  $effect(() => {
    route.id;
    projectTab = 'board';
  });
</script>

<svelte:window {onkeydown} />

<div class="flex h-dvh w-full overflow-hidden bg-app text-ink">
  <aside class="hidden w-16 shrink-0 border-r border-line md:block lg:w-64 ultrawide:w-72 tv:w-80">
    <div class="h-full lg:hidden"><Sidebar compact /></div>
    <div class="hidden h-full lg:block"><Sidebar /></div>
  </aside>

  <div class="flex min-w-0 flex-1 flex-col">
    <div class="relative">
      <TopBar title={view.title} subtitle={view.subtitle} onsettings={openSettings} />
      {#if ui.selected.size}<SelectionBar notes={visible} archiveView={route.view === 'archive'} projectId={route.view === 'project' ? (project?.id ?? null) : null} />{/if}
    </div>

    <main class="relative min-h-0 flex-1 overflow-hidden">
      {#key route.view + route.id}
        <div class="absolute inset-0 flex flex-col" in:fly={PAGE_IN} out:fade={PAGE_OUT}>
          {#if route.view === 'settings'}
            <Settings />
          {:else if route.view === 'trash'}
            <Trash />
          {:else if route.view === 'features-settings'}
            <BoardSettings />
          {:else if route.view === 'project-settings'}
            {#if project}<BoardSettings {project} />{:else}<p class="p-10 text-center text-ink-faint">This project doesn't exist on this device yet. It may still be syncing.</p>{/if}
          {:else if route.view === 'project' && !project}
            <p class="p-10 text-center text-ink-faint">This project doesn't exist on this device yet. It may still be syncing.</p>
          {:else if route.view === 'project' || route.view === 'features'}
            {#if project}<ProjectHeader {project} features={view.features ?? []} tab={projectTab} ontab={(tab) => (projectTab = tab)} />{/if}
            {#if route.view !== 'project' || projectTab === 'board'}
              <div class="{CONTENT} p-2 sm:p-4 short:hidden" in:fade={TAB_IN}>
                <Composer projectId={project?.id ?? null} />
              </div>
              <div class="{CONTENT} min-h-0 flex-1 pb-2 sm:px-4 sm:pb-4" in:fade={TAB_IN}>
                <FeatureBoard features={view.features ?? []} scope={project ? project.id : FEATURES_SCOPE} showProject={!project} />
              </div>
            {:else if projectTab === 'media' && project}
              <div class="{CONTENT} min-h-0 flex-1 px-2 sm:px-4" in:fade={TAB_IN}><ProjectMedia notes={view.features ?? []} /></div>
            {:else if projectTab === 'prs' && project}
              <div class="{CONTENT} min-h-0 flex-1" in:fade={TAB_IN}>
                {#if project.repo}
                  <PullRequests {project} />
                {:else}
                  <p class="px-4 py-12 text-center text-sm text-ink-muted">Link a GitHub repo above to see its pull requests here.</p>
                {/if}
              </div>
            {:else}
              <div class="min-h-0 flex-1 overflow-y-auto" in:fade={TAB_IN}>
                <div class="{CONTENT} px-2 pt-2 sm:px-4 sm:pt-4"><Composer projectId={project?.id ?? null} /></div>
                <div class="{CONTENT} pb-6 sm:px-4"><NoteGrid notes={view.notes ?? []} showProject={false} projectId={project?.id ?? null} empty="No notes in this project yet." /></div>
              </div>
            {/if}
          {:else}
            <div class="min-h-0 flex-1 overflow-y-auto">
              {#if route.view !== 'archive'}
                <div class="{CONTENT} px-2 pt-2 sm:px-4 sm:pt-4"><Composer labelId={label?.id ?? null} /></div>
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
      <button class="absolute inset-0 bg-scrim" aria-label="Close navigation" onclick={() => (ui.drawerOpen = false)} in:fade={{ duration: 220 }} out:fade={{ duration: 180 }}></button>
      <div class="relative h-full w-72 max-w-[85vw] border-r border-line" in:fly={DRAWER_IN} out:fly={DRAWER_OUT}>
        <Sidebar />
      </div>
    </div>
  {/if}

  {#if route.note}
    {#key route.note}<NoteEditor id={route.note} />{/key}
  {/if}
</div>
