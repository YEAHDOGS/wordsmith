<script>
  // Project banner: rename inline, set the GitHub repo, see the queue at a glance, and copy a ready-made
  // prompt that tells an agent how to pull this project's next feature.
  import Copy from '@lucide/svelte/icons/copy';
  import Trash from '@lucide/svelte/icons/trash';
  import { fade } from 'svelte/transition';
  import ColorPicker from './ColorPicker.svelte';
  import RepoPicker from './RepoPicker.svelte';
  import ProviderIcon from './ProviderIcon.svelte';
  import { ui } from '../lib/ui.svelte.js';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { apiUrl } from '../lib/api.js';
  import { STATE_STYLE } from '../lib/colors.js';
  import { MAX_NAME, FEATURE_STATES } from '../lib/models.js';

  /** @type {{ project: any, features: any[], tab: string, ontab: (tab: string) => void }} */
  let { project, features, tab, ontab } = $props();

  const COPIED_MS = 1400;
  const TABS = [{ id: 'board', label: 'Board' }, { id: 'notes', label: 'Notes' }, { id: 'prs', label: 'Pull requests' }];
  let copied = $state(false);
  let confirmDelete = $state(false);
  // A project created a moment ago opens straight into the (optional) repo link step.
  let pickingRepo = $state(false);
  $effect.pre(() => {
    if (!ui.newProjectId || ui.newProjectId !== project.id) return;
    pickingRepo = true;
    ui.newProjectId = '';
  });

  const counts = $derived(Object.fromEntries(FEATURE_STATES.map((state) => [state, features.filter((note) => note.state === state).length])));
  const agentPrompt = $derived(`You have a wordsmith API token in $WORDSMITH_TOKEN. Work the "${project.name}" queue:
1. curl -s -X POST ${apiUrl('/api/v1/features/next')} -H "Authorization: Bearer $WORDSMITH_TOKEN" -H "Content-Type: application/json" -d '{"project":"${project.id}"}'
   (204 = nothing queued). This claims the feature for you.
2. As you work, PATCH ${apiUrl('/api/v1/notes/<id>')} with {"status":"what you're doing"}.
3. Open a PR${project.repo ? ` on ${project.repo}` : ''}, then PATCH {"pr_url":"https://github.com/..."}.
4. Repeat. Merged PRs complete features automatically. API docs: GET ${apiUrl('/api/v1')}`);

  /** @param {string} field @param {string} value */
  function rename(field, value) {
    const trimmed = value.trim();
    if (field === 'name' && !trimmed) return;
    store.update('projects', project.id, { [field]: trimmed });
  }

  async function copyPrompt() {
    await navigator.clipboard?.writeText(agentPrompt);
    copied = true;
    setTimeout(() => (copied = false), COPIED_MS);
  }

  function deleteProject() {
    for (const note of store.notes) if (note.project_id === project.id && !note.deleted_at) store.update('notes', note.id, { project_id: null });
    store.remove('projects', project.id);
    router.go('features');
  }
</script>

<div class="border-b border-line">
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 short:py-2">
    <input value={project.name} maxlength={MAX_NAME} aria-label="Project name" onchange={(event) => rename('name', event.currentTarget.value)}
      class="min-w-0 max-w-full flex-1 basis-48 bg-transparent text-fluid-xl font-black tracking-tight text-ink focus:outline-none" />
    <div class="flex items-center gap-px border border-line bg-line">
      {#each FEATURE_STATES as state (state)}
        {@const style = STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (state)]}
        <span class="flex items-center gap-1.5 bg-app px-2.5 py-1 font-mono text-xs {style.text}" title={style.label}>
          <span class="size-1.5 rounded-full {style.dot}"></span>{counts[state]}
        </span>
      {/each}
    </div>
  </div>
  <div class="flex flex-wrap items-center gap-2 px-4 pb-2 short:hidden">
    {#if project.repo}
      <a href="https://github.com/{project.repo}" target="_blank" rel="noopener noreferrer" class="spring inline-flex items-center gap-1.5 border border-line px-2 py-1 font-mono text-xs text-ink hover:border-accent">
        <ProviderIcon provider="github" class="size-3.5" />{project.repo}
      </a>
      <button class="spring press text-xs text-ink-faint hover:text-accent" onclick={() => (pickingRepo = !pickingRepo)}>change</button>
    {:else}
      <button class="spring press inline-flex items-center gap-1.5 border border-dashed border-line-strong px-2.5 py-1 text-xs text-ink-muted hover:border-accent hover:text-ink" onclick={() => (pickingRepo = true)}>
        <ProviderIcon provider="github" class="size-3.5" />Link GitHub repo
      </button>
    {/if}
    <ColorPicker value={project.color} onchange={(color) => store.update('projects', project.id, { color })} />
    <button class="spring press flex items-center gap-1.5 border border-line px-2.5 py-1 text-xs text-ink-muted hover:border-accent hover:text-ink" onclick={copyPrompt}>
      <Copy class="size-3.5" />{copied ? 'Copied' : 'Copy agent prompt'}
    </button>
    <span class="flex-1"></span>
    {#if confirmDelete}
      <span class="flex items-center gap-2 text-xs" transition:fade={{ duration: 100 }}>
        Delete project? Notes stay.
        <button class="spring bg-accent px-2 py-1 font-semibold text-accent-ink" onclick={deleteProject}>Delete</button>
        <button class="spring px-2 py-1 text-ink-muted" onclick={() => (confirmDelete = false)}>Keep</button>
      </span>
    {:else}
      <button class="spring press p-1 text-ink-faint hover:text-accent" aria-label="Delete project" title="Delete project" onclick={() => (confirmDelete = true)}><Trash class="size-4" /></button>
    {/if}
  </div>
  {#if pickingRepo}
    <div class="px-4 pb-3"><RepoPicker {project} onclose={() => (pickingRepo = false)} /></div>
  {/if}
  <div class="flex px-4" role="tablist">
    {#each TABS as item (item.id)}
      <button role="tab" aria-selected={tab === item.id} class="spring relative px-3 py-2 text-sm {tab === item.id ? 'text-ink' : 'text-ink-muted hover:text-ink'}" onclick={() => ontab(item.id)}>
        {item.label}
        {#if tab === item.id}<span class="absolute inset-x-0 bottom-0 h-0.5 bg-accent" in:fade={{ duration: 150 }}></span>{/if}
      </button>
    {/each}
  </div>
</div>
