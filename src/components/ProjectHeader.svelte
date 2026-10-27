<script>
  // Project toolbar: one slim row under the top bar (which already shows the project name and the settings gear).
  // Board / Notes / Pull requests tabs on the left; queue counts and the GitHub repo on the right. Name, color, the agent
  // prompt, board columns and delete live in project settings (BoardSettings). Tablets and up fit one line (short tab
  // labels below lg); if a window is too narrow the repo wraps under the tabs.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { fade } from 'svelte/transition';
  import RepoPicker from './RepoPicker.svelte';
  import ProviderIcon from './ProviderIcon.svelte';
  import { ui } from '../lib/ui.svelte.js';
  import { STATE_STYLE } from '../lib/colors.js';
  import { FEATURE_STATES } from '../lib/models.js';

  /** @type {{ project: any, features: any[], tab: string, ontab: (tab: string) => void }} */
  let { project, features, tab, ontab } = $props();

  const FULL_WIDTH_PERCENT = 100;
  const TABS = [{ id: 'board', label: 'Board', short: 'Board' }, { id: 'notes', label: 'Notes', short: 'Notes' }, { id: 'prs', label: 'Pull requests', short: 'PRs' }];
  /** Arrow key -> how far the tab choice moves. */
  const TAB_STEPS = { ArrowRight: 1, ArrowLeft: -1 };
  const ICON_BUTTON = 'spring press flex size-8 shrink-0 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink tv:size-11';
  const PICKER_FADE = { duration: 120 };

  // A project created a moment ago opens straight into the (optional) repo link step.
  let pickingRepo = $state(false);
  /** @type {HTMLElement | undefined} */
  let pickerBox = $state();
  /** @type {HTMLElement | undefined} */
  let repoControls = $state();
  $effect.pre(() => {
    if (!ui.newProjectId || ui.newProjectId !== project.id) return;
    pickingRepo = true;
    ui.newProjectId = '';
  });

  const tabIndex = $derived(Math.max(0, TABS.findIndex((item) => item.id === tab)));
  const counts = $derived(Object.fromEntries(FEATURE_STATES.map((state) => [state, features.filter((note) => note.state === state).length])));

  /** Arrow keys move between tabs (only the selected one is in the tab order). @param {KeyboardEvent & { currentTarget: HTMLElement }} event */
  function onTabKey(event) {
    const step = TAB_STEPS[/** @type {keyof typeof TAB_STEPS} */ (event.key)];
    if (!step) return;
    event.preventDefault();
    const next = (tabIndex + step + TABS.length) % TABS.length;
    ontab(TABS[next].id);
    event.currentTarget.querySelectorAll('button')[next]?.focus();
  }

  /** Escape closes the repo picker. @param {KeyboardEvent} event */
  function onWindowKey(event) {
    if (event.key === 'Escape') pickingRepo = false;
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
  <div class="relative flex min-h-11 flex-wrap items-stretch gap-x-2 px-2 sm:min-h-10 sm:px-3 tv:min-h-14 tv:px-6">
    <!-- Paper tabs, the full height of the row. The chosen one is an outlined sheet with no bottom edge: it reaches 1px
         past the row (-mb-px) to cover the header's bottom line, so it opens straight into the page below. The sheet
         slides (transform only) and every label keeps one weight and size, so switching never moves a thing. -->
    <div class="relative -mb-px grid min-w-0 flex-1 grid-cols-3 sm:max-w-sm sm:flex-none" role="tablist" aria-label="Project view" tabindex="-1" onkeydown={onTabKey}>
      <span aria-hidden="true" class="absolute inset-y-0 left-0 rounded-t-ui-sm border-x border-t border-line-strong bg-app transition-transform duration-200 ease-out-soft"
        style:width="calc(100% / {TABS.length})" style:transform="translateX({tabIndex * FULL_WIDTH_PERCENT}%)"></span>
      {#each TABS as item (item.id)}
        <button role="tab" aria-selected={tab === item.id} tabindex={tab === item.id ? 0 : -1} onclick={() => ontab(item.id)}
          class="relative flex min-w-0 items-center justify-center px-2 text-xs font-semibold transition-colors duration-150 sm:px-3 sm:text-sm tv:text-lg {tab === item.id ? 'text-ink' : 'text-ink-faint hover:text-ink-muted'}">
          <span class="truncate lg:hidden">{item.short}</span><span class="hidden truncate lg:inline">{item.label}</span>
        </button>
      {/each}
    </div>

    <div class="ml-auto flex shrink-0 items-center gap-1 py-1 sm:gap-1.5">
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
    </div>
  </div>

  {#if pickingRepo}
    <!-- Floats over the board instead of pushing it down -->
    <div bind:this={pickerBox} class="absolute inset-x-0 top-full z-30 px-2 pt-1 sm:right-3 sm:left-auto sm:w-md sm:px-0" out:fade={PICKER_FADE}>
      <div class="shadow-2xl"><RepoPicker {project} onclose={() => (pickingRepo = false)} /></div>
    </div>
  {/if}
</div>
