<script>
  // Project toolbar: one slim row under the top bar (which already shows the project name). Board / Notes / Pull
  // requests tabs on the left; queue counts, the GitHub repo, color, the agent prompt, rename and delete on the right.
  // Tablets and up fit one line (short tab labels below lg); if a window is too narrow the actions wrap under the tabs. Phones keep the tabs, the repo and a
  // ⋯ menu holding the rest. Rename and delete confirm in a bar that slides over the row, so nothing below moves.
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash from '@lucide/svelte/icons/trash';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import X from '@lucide/svelte/icons/x';
  import { fade, fly } from 'svelte/transition';
  import { backOut, cubicIn } from 'svelte/easing';
  import ColorPicker from './ColorPicker.svelte';
  import RepoPicker from './RepoPicker.svelte';
  import ProviderIcon from './ProviderIcon.svelte';
  import ProjectMenu from './ProjectMenu.svelte';
  import { ui } from '../lib/ui.svelte.js';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { apiUrl } from '../lib/api.js';
  import { STATE_STYLE } from '../lib/colors.js';
  import { MAX_NAME, FEATURE_STATES } from '../lib/models.js';

  /** @type {{ project: any, features: any[], tab: string, ontab: (tab: string) => void }} */
  let { project, features, tab, ontab } = $props();

  const COPIED_MS = 1400;
  const FULL_WIDTH_PERCENT = 100;
  const TABS = [{ id: 'board', label: 'Board', short: 'Board' }, { id: 'notes', label: 'Notes', short: 'Notes' }, { id: 'prs', label: 'Pull requests', short: 'PRs' }];
  /** Arrow key -> how far the tab choice moves. */
  const TAB_STEPS = { ArrowRight: 1, ArrowLeft: -1 };
  const ICON_BUTTON = 'spring press flex size-8 shrink-0 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink tv:size-11';
  const BAR_IN = { x: 24, duration: 200, easing: backOut };
  const BAR_OUT = { x: 24, duration: 130, easing: cubicIn };
  const PICKER_FADE = { duration: 120 };
  const MODE_RENAME = 'rename';
  const MODE_DELETE = 'delete';

  let copied = $state(false);
  /** The bar sliding over the row: '' (none), rename or delete. */
  let mode = $state('');
  let draftName = $state('');
  // A project created a moment ago opens straight into the (optional) repo link step.
  let pickingRepo = $state(false);
  /** @type {HTMLElement | undefined} */
  let pickerBox = $state();
  /** @type {HTMLElement | undefined} */
  let repoControls = $state();
  /** @type {Element | null} */
  let returnFocus = null;
  $effect.pre(() => {
    if (!ui.newProjectId || ui.newProjectId !== project.id) return;
    pickingRepo = true;
    ui.newProjectId = '';
  });

  const tabIndex = $derived(Math.max(0, TABS.findIndex((item) => item.id === tab)));
  const counts = $derived(Object.fromEntries(FEATURE_STATES.map((state) => [state, features.filter((note) => note.state === state).length])));
  const agentPrompt = $derived(`You have a wordsmith API token in $WORDSMITH_TOKEN. Work the "${project.name}" queue:
1. curl -s -X POST ${apiUrl('/api/v1/features/next')} -H "Authorization: Bearer $WORDSMITH_TOKEN" -H "Content-Type: application/json" -d '{"project":"${project.id}"}'
   (204 = nothing queued). This claims the feature for you.
2. As you work, PATCH ${apiUrl('/api/v1/notes/<id>')} with {"status":"what you're doing"}.
3. Open a PR${project.repo ? ` on ${project.repo}` : ''}, then PATCH {"pr_url":"https://github.com/..."}.
4. Repeat. Merged PRs complete features automatically. API docs: GET ${apiUrl('/api/v1')}`);

  async function copyPrompt() {
    await navigator.clipboard?.writeText(agentPrompt);
    copied = true;
    setTimeout(() => (copied = false), COPIED_MS);
  }

  /** Opens the rename or delete bar, remembering where focus was so closing it can go back. @param {string} next */
  function openBar(next) {
    returnFocus = document.activeElement;
    draftName = project.name;
    mode = next;
  }

  function closeBar() {
    mode = '';
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
  }

  function saveName() {
    // Closing the bar moves focus back, which blurs the field after a cancel; that blur must not save.
    if (mode !== MODE_RENAME) return;
    const name = draftName.trim();
    if (name && name !== project.name) store.update('projects', project.id, { name });
    closeBar();
  }

  function deleteProject() {
    for (const note of store.notes) if (note.project_id === project.id && !note.deleted_at) store.update('notes', note.id, { project_id: null });
    store.remove('projects', project.id);
    router.go('features');
  }

  /** Arrow keys move between tabs (only the selected one is in the tab order). @param {KeyboardEvent & { currentTarget: HTMLElement }} event */
  function onTabKey(event) {
    const step = TAB_STEPS[/** @type {keyof typeof TAB_STEPS} */ (event.key)];
    if (!step) return;
    event.preventDefault();
    const next = (tabIndex + step + TABS.length) % TABS.length;
    ontab(TABS[next].id);
    event.currentTarget.querySelectorAll('button')[next]?.focus();
  }

  /** Escape closes the slide-over bar or the repo picker. @param {KeyboardEvent} event */
  function onWindowKey(event) {
    if (event.key !== 'Escape') return;
    if (mode) closeBar();
    else if (pickingRepo) pickingRepo = false;
  }

  /** A click outside the repo picker (and its toggle) closes it. @param {PointerEvent} event */
  function onWindowPointer(event) {
    const target = /** @type {Node} */ (event.target);
    if (!pickingRepo || pickerBox?.contains(target) || repoControls?.contains(target)) return;
    pickingRepo = false;
  }
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

<div class="relative z-20 border-b border-line bg-app">
  <div class="relative flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 sm:min-h-10 sm:px-3 tv:min-h-14 tv:px-6">
    <!-- Segmented tabs; the highlight slides (transform only) so switching never reflows the row -->
    <div class="relative grid min-w-0 flex-1 grid-cols-3 rounded-ui border border-line p-0.5 sm:max-w-sm sm:flex-none" role="tablist" aria-label="Project view" tabindex="-1" onkeydown={onTabKey}>
      <span aria-hidden="true" class="absolute inset-y-0.5 left-0.5 rounded-ui-sm bg-accent-soft transition-transform duration-150 ease-spring"
        style:width="calc((100% - 0.25rem) / {TABS.length})" style:transform="translateX({tabIndex * FULL_WIDTH_PERCENT}%)"></span>
      {#each TABS as item (item.id)}
        <button role="tab" aria-selected={tab === item.id} tabindex={tab === item.id ? 0 : -1} onclick={() => ontab(item.id)}
          class="spring press relative truncate px-2 py-1 text-xs sm:px-3 sm:text-sm tv:py-2 tv:text-lg {tab === item.id ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink'}">
          <span class="lg:hidden">{item.short}</span><span class="hidden lg:inline">{item.label}</span>
        </button>
      {/each}
    </div>

    <div class="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
      <!-- Queue at a glance; hidden on the narrowest phones, where the board's lane tabs carry the same counts -->
      <div class="mr-1 hidden items-center gap-2.5 min-[25rem]:flex" role="group" aria-label="Feature counts">
        {#each FEATURE_STATES as state (state)}
          {@const style = STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (state)]}
          <span class="flex items-center gap-1 font-mono text-xs tabular-nums tv:text-base {style.text}" title="{style.label}: {counts[state]}">
            <span class="size-1.5 rounded-full tv:size-2.5 {style.dot}" aria-hidden="true"></span><span class="sr-only">{style.label}</span>{counts[state]}
          </span>
        {/each}
      </div>

      <div bind:this={repoControls} class="flex items-center">
        {#if project.repo}
          <a href="https://github.com/{project.repo}" target="_blank" rel="noopener noreferrer" title="Open {project.repo} on GitHub" aria-label="Open {project.repo} on GitHub"
            class="spring press flex h-8 min-w-8 items-center justify-center gap-1.5 text-ink hover:bg-surface-raised sm:px-2 tv:h-11">
            <ProviderIcon provider="github" class="size-4 shrink-0" /><span class="hidden max-w-32 truncate font-mono text-xs sm:inline lg:max-w-56 tv:text-base">{project.repo}</span>
          </a>
          <button class="{ICON_BUTTON} w-6" title="Change linked repo" aria-label="Change linked repo" aria-expanded={pickingRepo} onclick={() => (pickingRepo = !pickingRepo)}>
            <span class="flex spring {pickingRepo ? 'rotate-180' : ''}"><ChevronDown class="size-3.5" /></span>
          </button>
        {:else}
          <button class="spring press flex h-8 min-w-8 items-center justify-center gap-1.5 border border-dashed border-line-strong text-xs text-ink-muted hover:border-accent hover:text-ink sm:px-2 tv:h-11 tv:text-base {pickingRepo ? 'border-accent text-ink' : ''}"
            title="Link a GitHub repo" aria-label="Link a GitHub repo" aria-expanded={pickingRepo} onclick={() => (pickingRepo = !pickingRepo)}>
            <ProviderIcon provider="github" class="size-4 shrink-0" /><span class="hidden sm:inline">Link repo</span>
          </button>
        {/if}
      </div>

      <div class="hidden items-center sm:flex">
        <ColorPicker value={project.color} onchange={(color) => store.update('projects', project.id, { color })} />
        <button class={ICON_BUTTON} title={copied ? 'Copied' : 'Copy agent prompt'} aria-label={copied ? 'Agent prompt copied' : 'Copy agent prompt'} onclick={copyPrompt}>
          {#key copied}<span class="icon-swap flex">{#if copied}<Check class="size-4 text-complete" />{:else}<Copy class="size-4" />{/if}</span>{/key}
        </button>
        <button class={ICON_BUTTON} title="Rename project" aria-label="Rename project" onclick={() => openBar(MODE_RENAME)}><Pencil class="size-4" /></button>
        <span class="mx-1 h-5 w-px bg-line" aria-hidden="true"></span>
        <button class="{ICON_BUTTON} hover:text-accent" title="Delete project" aria-label="Delete project" onclick={() => openBar(MODE_DELETE)}><Trash class="size-4" /></button>
      </div>

      <ProjectMenu class="sm:hidden" color={project.color} {copied} oncopy={copyPrompt} onrename={() => openBar(MODE_RENAME)} ondelete={() => openBar(MODE_DELETE)}
        oncolor={(color) => store.update('projects', project.id, { color })} />
    </div>

    {#if mode === MODE_RENAME}
      <form class="absolute inset-0 z-10 flex items-center gap-1 bg-app px-2 sm:px-3" in:fly={BAR_IN} out:fly={BAR_OUT}
        onsubmit={(event) => { event.preventDefault(); saveName(); }}>
        <input bind:value={draftName} {@attach (node) => node.select()} maxlength={MAX_NAME} aria-label="Project name" onblur={saveName}
          class="h-8 min-w-0 flex-1 border border-line-strong bg-surface px-2 text-sm font-semibold text-ink focus:border-accent focus:outline-none tv:h-11 tv:text-lg" />
        <!-- pointerdown keeps focus in the field, so its blur doesn't save before Cancel runs -->
        <button type="submit" class={ICON_BUTTON} title="Save name" aria-label="Save name" onpointerdown={(event) => event.preventDefault()}><Check class="size-4" /></button>
        <button type="button" class={ICON_BUTTON} title="Cancel" aria-label="Cancel rename" onpointerdown={(event) => event.preventDefault()} onclick={closeBar}><X class="size-4" /></button>
      </form>
    {:else if mode === MODE_DELETE}
      <div class="absolute inset-0 z-10 flex items-center gap-2 bg-app px-2 text-xs sm:px-3 sm:text-sm" role="group" aria-label="Confirm delete" in:fly={BAR_IN} out:fly={BAR_OUT}>
        <span class="min-w-0 flex-1 truncate" title="Delete {project.name}? Its notes stay.">Delete this project? Its notes stay.</span>
        <button class="spring press shrink-0 bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:bg-accent-hover" onclick={deleteProject}>Delete</button>
        <button class="spring press shrink-0 px-3 py-1.5 text-ink-muted hover:text-ink" {@attach (node) => node.focus()} onclick={closeBar}>Keep</button>
      </div>
    {/if}
  </div>

  {#if pickingRepo}
    <!-- Floats over the board instead of pushing it down -->
    <div bind:this={pickerBox} class="absolute inset-x-0 top-full z-30 px-2 pt-1 sm:right-3 sm:left-auto sm:w-md sm:px-0" out:fade={PICKER_FADE}>
      <div class="shadow-2xl"><RepoPicker {project} onclose={() => (pickingRepo = false)} /></div>
    </div>
  {/if}
</div>
