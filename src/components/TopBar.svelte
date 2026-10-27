<script>
  // Title, search, sync status and theme. Search filters the current view on-device (no requests).
  import Menu from '@lucide/svelte/icons/menu';
  import Search from '@lucide/svelte/icons/search';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import CloudOff from '@lucide/svelte/icons/cloud-off';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
  import X from '@lucide/svelte/icons/x';
  import { fade } from 'svelte/transition';
  import { store } from '../lib/store.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { ago, fullTime } from '../lib/time.js';

  /** @type {{ title: string, subtitle?: string }} */
  let { title, subtitle = '' } = $props();

  const ICON_BUTTON = 'spring press flex size-9 tv:size-12 shrink-0 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink';
  const THEME_ICONS = { system: MonitorSmartphone, dark: Moon, light: Sun };
  const ThemeIcon = $derived(THEME_ICONS[ui.theme]);
  // Re-render the "synced 2 min ago" label every so often.
  const TICK_MS = 30_000;
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), TICK_MS);
    return () => clearInterval(timer);
  });

  const syncLabel = $derived.by(() => {
    now;
    if (!store.online) return `Offline${store.pending ? `, ${store.pending} waiting` : ''}`;
    if (store.syncing) return 'Syncing';
    if (store.error) return store.error;
    if (store.pending) return `${store.pending} to sync`;
    return store.lastSync ? `Synced ${ago(store.lastSync)}` : 'Not synced yet';
  });
</script>

<header class="flex items-center gap-2 border-b border-line bg-app px-2 py-2 short:py-1 sm:px-4">
  <button class="{ICON_BUTTON} lg:hidden" aria-label="Open navigation" onclick={() => (ui.drawerOpen = true)}><Menu class="size-5" /></button>

  <div class="min-w-0 flex-1 sm:flex-none sm:max-w-xs lg:max-w-sm">
    {#key title}
      <h1 class="truncate text-fluid-lg font-bold tracking-tight" in:fade={{ duration: 150 }}>{title}</h1>
    {/key}
    {#if subtitle}<p class="short:hidden truncate font-mono text-[11px] text-ink-faint">{subtitle}</p>{/if}
  </div>

  <label class="group relative ml-auto hidden min-w-0 flex-1 items-center sm:flex sm:max-w-md">
    <Search class="pointer-events-none absolute left-3 size-4 text-ink-faint" />
    <input bind:value={ui.query} type="search" placeholder="Search notes, status, PRs" aria-label="Search"
      class="spring w-full border border-line bg-surface py-2 pr-8 pl-9 text-sm tv:text-xl text-ink placeholder:text-ink-faint hover:border-line-strong focus:border-accent focus:outline-none" />
    {#if ui.query}
      <button class="absolute right-2 text-ink-faint hover:text-ink" aria-label="Clear search" onclick={() => (ui.query = '')} transition:fade={{ duration: 100 }}><X class="size-4" /></button>
    {/if}
  </label>

  <button class="{ICON_BUTTON} w-auto gap-2 px-2" onclick={() => store.sync()} title={store.lastSync ? `Last synced ${fullTime(store.lastSync)}` : 'Sync now'} aria-label="Sync now. {syncLabel}">
    {#if store.online}
      <RefreshCw class="size-4 {store.syncing ? 'spinning text-accent' : ''}" />
    {:else}
      <CloudOff class="size-4 text-requested" />
    {/if}
    <span class="hidden max-w-40 truncate font-mono text-[11px] md:inline {store.error ? 'text-accent' : ''}">{syncLabel}</span>
  </button>
  <button class={ICON_BUTTON} onclick={() => ui.cycleTheme()} aria-label="Theme: {ui.theme}. Change theme" title="Theme: {ui.theme}">
    <ThemeIcon class="size-4" />
  </button>
</header>

<!-- Phones: search gets its own row so it is always one tap away -->
<label class="relative flex items-center border-b border-line bg-app px-2 py-1.5 sm:hidden short:hidden">
  <Search class="pointer-events-none absolute left-5 size-4 text-ink-faint" />
  <input bind:value={ui.query} type="search" placeholder="Search" aria-label="Search"
    class="w-full border border-line bg-surface py-2 pr-3 pl-9 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none" />
</label>
