<script>
  // Settings for a board page. A project gets its name, color, linked GitHub repo, mission statement (Markdown), agent
  // prompt and delete, plus its
  // board columns; the Features page (no project) gets just its columns. Opened from the gear next to the page title
  // (#/project-settings/<id>, #/features-settings). One stacked column on phones, a 1px grid of cards from lg up,
  // matching the main Settings page.
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import Trash from '@lucide/svelte/icons/trash';
  import { slide } from 'svelte/transition';
  import BoardColumns from './BoardColumns.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import RepoPicker from './RepoPicker.svelte';
  import ProviderIcon from './ProviderIcon.svelte';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { apiUrl } from '../lib/api.js';
  import { reveal } from '../lib/reveal.js';
  import { FEATURES_SCOPE, MAX_MISSION, MAX_NAME } from '../lib/models.js';
  import { renderMarkdown } from '../lib/markdown.js';
  import { markdownKeys } from '../lib/markdown-input.js';
  import MarkdownToolbar from './MarkdownToolbar.svelte';
  import { projectPrompt } from './agent-prompts.js';
  import { BOX, BUTTON, CARD, HEADING, HINT } from './settings-styles.js';
  import TEXT from './board-settings.json';

  /** @type {{ project?: any }} */
  let { project = null } = $props();

  const COPIED_MS = 1400;
  const SWAP = { duration: 150 };
  const FIELD = 'h-10 w-full border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none tv:h-12 tv:text-lg';
  const LABEL = 'mb-1.5 block text-xs font-semibold tracking-wide text-ink-faint uppercase';

  const MISSION_SAVE_MS = 600;

  let copied = $state(false);
  // The mission statement is loaded once per project and saved after a pause, so a sync landing mid-typing can't
  // overwrite what you're writing.
  let mission = $state('');
  let missionPreview = $state(false);
  let loadedMission = '';
  /** @type {HTMLTextAreaElement | undefined} */
  let missionField = $state();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let missionTimer;
  $effect.pre(() => {
    if (!project || loadedMission === project.id) return;
    loadedMission = project.id;
    mission = project.description;
  });

  function saveMission() {
    clearTimeout(missionTimer);
    if (project && mission !== project.description) store.update('projects', project.id, { description: mission });
  }
  // Leaving the page saves what's typed.
  $effect(() => () => saveMission());
  let pickingRepo = $state(false);
  let confirming = $state(false);

  /** Renames on commit; an empty name puts the old one back. @param {Event & { currentTarget: HTMLInputElement }} event */
  function rename(event) {
    const name = event.currentTarget.value.trim();
    if (!name) {
      event.currentTarget.value = project.name;
      return;
    }
    if (name !== project.name) store.update('projects', project.id, { name });
  }

  async function copyPrompt() {
    await navigator.clipboard?.writeText(projectPrompt(project, apiUrl));
    copied = true;
    setTimeout(() => (copied = false), COPIED_MS);
  }

  function deleteProject() {
    for (const note of store.notes) if (note.project_id === project.id && !note.deleted_at) store.update('notes', note.id, { project_id: null });
    store.remove('projects', project.id);
    router.go('features');
  }
</script>

<div class="h-full overflow-x-hidden overflow-y-auto overscroll-contain">
  <div class="mx-auto max-w-7xl px-2 pt-2 sm:px-4 sm:pt-4 ultrawide:max-w-none">
    <button class="spring press mb-2 inline-flex items-center gap-1.5 py-1 text-xs text-ink-muted hover:text-ink tv:text-base" onclick={() => (project ? router.go('project', project.id) : router.go('features'))}>
      <ArrowLeft class="size-3.5" />{TEXT.back}
    </button>
  </div>
  <div class="mx-auto grid max-w-7xl grid-cols-1 gap-px border-line bg-line sm:border-x lg:grid-cols-2 ultrawide:max-w-none">
    {#if project}
      <section class={CARD} use:reveal={0}>
        <h2 class={HEADING}>{TEXT.project}</h2>
        <label class="mt-4 block">
          <span class={LABEL}>{TEXT.name}</span>
          <input value={project.name} maxlength={MAX_NAME} onchange={rename} class="{FIELD} font-semibold" />
        </label>
        <div class="mt-4">
          <span class={LABEL}>{TEXT.color}</span>
          <ColorPicker value={project.color} onchange={(color) => store.update('projects', project.id, { color })} />
        </div>
        <div class="mt-4">
          <span class={LABEL}>{TEXT.repo}</span>
          <p class={HINT}>{TEXT.repoHint}</p>
          <div class="flex flex-wrap items-center gap-2">
            {#if project.repo}
              <a href="https://github.com/{project.repo}" target="_blank" rel="noopener noreferrer" class="spring inline-flex min-w-0 items-center gap-2 px-3 py-2 font-mono text-sm text-ink hover:text-accent {BOX}">
                <ProviderIcon provider="github" class="size-4 shrink-0" /><span class="truncate">{project.repo}</span>
              </a>
            {/if}
            <button class={BUTTON} aria-expanded={pickingRepo} onclick={() => (pickingRepo = !pickingRepo)}>
              <ProviderIcon provider="github" class="size-4" />{project.repo ? TEXT.changeRepo : TEXT.linkRepo}
            </button>
          </div>
          {#if pickingRepo}
            <div class="mt-2" transition:slide={SWAP}><RepoPicker {project} onclose={() => (pickingRepo = false)} /></div>
          {/if}
        </div>
      </section>

      <section class="{CARD} lg:col-span-2" use:reveal={1}>
        <h2 class={HEADING}>{TEXT.mission}</h2>
        <p class={HINT}>{TEXT.missionHint}</p>
        <div class="flex min-h-48 flex-col {BOX}">
          {#if missionPreview}
            <!-- Rendered by src/lib/markdown.js, which escapes all input -->
            <div class="markdown selectable min-h-40 flex-1 px-3 py-2 text-fluid-sm text-ink">
              {#if mission.trim()}{@html renderMarkdown(mission)}{:else}<p class="text-ink-faint">Nothing to preview yet.</p>{/if}
            </div>
          {:else}
            <textarea bind:this={missionField} bind:value={mission} use:markdownKeys maxlength={MAX_MISSION} aria-label={TEXT.mission} placeholder={TEXT.missionPlaceholder}
              oninput={() => { clearTimeout(missionTimer); missionTimer = setTimeout(saveMission, MISSION_SAVE_MS); }} onblur={saveMission}
              class="min-h-40 flex-1 resize-y bg-transparent px-3 py-2 text-fluid-sm leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"></textarea>
          {/if}
          <div class="flex justify-end border-t border-line">
            <MarkdownToolbar textarea={missionField} bind:preview={missionPreview} showPreview class="-mr-1 py-0.5" />
          </div>
        </div>
      </section>
      <section class={CARD} use:reveal={2}>
        <h2 class={HEADING}>{TEXT.agent}</h2>
        <p class={HINT}>{TEXT.agentHint}</p>
        <button class={BUTTON} onclick={copyPrompt}>
          {#key copied}<span class="icon-swap flex">{#if copied}<Check class="size-4 text-complete" />{:else}<Copy class="size-4" />{/if}</span>{/key}
          {copied ? TEXT.copied : TEXT.copy}
        </button>

        <h2 class="{HEADING} mt-8">{TEXT.danger}</h2>
        <p class={HINT}>{TEXT.dangerHint}</p>
        <!-- One grid cell: the button and the confirmation swap in place -->
        <div class="grid">
          {#if confirming}
            <div class="col-start-1 row-start-1 flex flex-wrap gap-2" transition:slide={SWAP}>
              <button class="spring press inline-flex items-center gap-2 bg-accent px-3 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover" onclick={deleteProject}><Trash class="size-4" />{TEXT.confirmDelete}</button>
              <button class="spring press px-3 py-2 text-sm text-ink-muted hover:text-ink" {@attach (node) => node.focus()} onclick={() => (confirming = false)}>{TEXT.keep}</button>
            </div>
          {:else}
            <div class="col-start-1 row-start-1" transition:slide={SWAP}>
              <button class="{BUTTON} hover:text-accent" onclick={() => (confirming = true)}><Trash class="size-4" />{TEXT.delete}</button>
            </div>
          {/if}
        </div>
      </section>
    {/if}

    <section class="{CARD} lg:col-span-2" use:reveal={project ? 3 : 0}>
      <h2 class={HEADING}>{TEXT.columns}</h2>
      <p class={HINT}>{TEXT.columnsHint}{project ? '' : ` ${TEXT.featuresColumnsHint}`}</p>
      <BoardColumns scope={project ? project.id : FEATURES_SCOPE} />
    </section>
  </div>
</div>
