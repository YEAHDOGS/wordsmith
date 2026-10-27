<script>
  // Title and search in one compact row. Search filters the current view on-device (no requests). On phones search
  // is an icon that expands over the row, so the header stays one slim line. Sync lives in the sidebar; the menu
  // button carries a yellow dot when sync has a problem, because the sidebar is a hidden drawer on phones.
  import Menu from '@lucide/svelte/icons/menu';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import { fade, fly, scale } from 'svelte/transition';
  import { backOut, cubicIn } from 'svelte/easing';
  import { store } from '../lib/store.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { syncProblem } from './sync-problem.js';

  /** @type {{ title: string, subtitle?: string }} */
  let { title, subtitle = '' } = $props();

  const ICON_BUTTON = 'spring press relative flex size-10 tv:size-12 shrink-0 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink';
  const TITLE_IN = { y: 10, duration: 220, easing: backOut };
  const TITLE_OUT = { y: -10, duration: 120, easing: cubicIn };
  const SEARCH_IN = { x: 32, duration: 200, easing: backOut };
  const SEARCH_OUT = { x: 32, duration: 140, easing: cubicIn };
  const BADGE = { start: 0.3, duration: 200, easing: backOut };

  let searching = $state(false);
  const problem = $derived(syncProblem(store));
  // A phone search with text in it stays open, so the filter is never applied invisibly.
  const phoneSearch = $derived(searching || !!ui.query);

  function closeSearch() {
    ui.query = '';
    searching = false;
  }

  /** @param {HTMLElement} node */
  function autofocus(node) {
    node.focus();
  }
</script>

<header class="relative flex h-12 shrink-0 items-center gap-1 border-b border-line bg-app px-1 sm:h-14 sm:gap-2 sm:px-4 tv:h-20">
  <button class="{ICON_BUTTON} lg:hidden" aria-label={problem ? `Open navigation. Sync problem: ${problem.title}` : 'Open navigation'} onclick={() => (ui.drawerOpen = true)}>
    <Menu class="size-5" />
    {#if problem}
      <span class="absolute top-2 right-2" aria-hidden="true" transition:scale={BADGE}>
        <span class="badge-breathe block size-2.5 rounded-full bg-requested ring-2 ring-app"></span>
      </span>
    {/if}
  </button>

  <div class="min-w-0 flex-1 pl-1 sm:max-w-xs sm:flex-none sm:pl-0 lg:max-w-sm">
    <!-- One grid cell: the leaving and entering titles overlap while they animate, so nothing shifts -->
    <div class="grid min-w-0">
      {#key title}
        <h1 class="col-start-1 row-start-1 min-w-0 truncate text-fluid-lg leading-tight font-bold tracking-tight" in:fly={TITLE_IN} out:fly={TITLE_OUT}>{title}</h1>
      {/key}
    </div>
    <!-- Always takes its line (even empty), so pages with and without a subtitle keep the title in place -->
    <div class="short:hidden grid h-4 min-w-0">
      {#key subtitle}
        <p class="col-start-1 row-start-1 min-w-0 truncate font-mono text-[11px] leading-4 text-ink-faint" in:fade={{ duration: 200, delay: 60 }} out:fade={{ duration: 100 }}>{subtitle}</p>
      {/key}
    </div>
  </div>

  <label class="group relative ml-auto hidden min-w-0 flex-1 items-center sm:flex sm:max-w-md">
    <Search class="pointer-events-none absolute left-3 size-4 text-ink-faint" />
    <input bind:value={ui.query} type="search" placeholder="Search notes, status, PRs" aria-label="Search"
      class="spring w-full border border-line bg-surface py-2 pr-8 pl-9 text-sm tv:text-xl text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent focus:outline-none" />
    {#if ui.query}
      <button class="absolute right-2 text-ink-faint hover:text-ink" aria-label="Clear search" onclick={() => (ui.query = '')} transition:scale={BADGE}><X class="size-4" /></button>
    {/if}
  </label>

  <!-- Phones: a search icon in the same row; it expands over the header instead of taking a row of its own -->
  <button class="{ICON_BUTTON} sm:hidden" aria-label="Search" aria-expanded={phoneSearch} onclick={() => (searching = true)}><Search class="size-5" /></button>
  {#if phoneSearch}
    <div class="absolute inset-0 z-10 flex items-center gap-1 bg-app px-1 sm:hidden" in:fly={SEARCH_IN} out:fly={SEARCH_OUT}>
      <label class="relative flex min-w-0 flex-1 items-center">
        <Search class="pointer-events-none absolute left-3 size-4 text-ink-faint" />
        <input use:autofocus bind:value={ui.query} type="search" placeholder="Search notes, status, PRs" aria-label="Search"
          class="w-full border border-line bg-surface py-2 pr-3 pl-9 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          onblur={() => !ui.query && (searching = false)} onkeydown={(event) => event.key === 'Escape' && closeSearch()} />
      </label>
      <button class={ICON_BUTTON} aria-label="Close search" onclick={closeSearch}><X class="size-5" /></button>
    </div>
  {/if}
</header>
