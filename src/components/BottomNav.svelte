<script>
  // Phone navigation in thumb reach. The center button captures a new note in the current context. It sits inside
  // the bar (not raised above it), so it never covers the cards above the nav.
  import Inbox from '@lucide/svelte/icons/inbox';
  import Kanban from '@lucide/svelte/icons/kanban';
  import Plus from '@lucide/svelte/icons/plus';
  import Folder from '@lucide/svelte/icons/folder';
  import Settings from '@lucide/svelte/icons/settings';
  import { router } from '../lib/router.svelte.js';
  import { ui } from '../lib/ui.svelte.js';

  /** @type {{ onnew: () => void }} */
  let { onnew } = $props();

  const ITEM = 'spring press relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] text-ink-muted';
  // Top-edge bar on the active tab; always rendered and scaled, so switching tabs slides rather than pops.
  const INDICATOR = 'pointer-events-none absolute inset-x-4 top-0 h-0.5 bg-accent spring';
  const active = (/** @type {string} */ view) => router.route.view === view;
</script>

<nav class="flex items-stretch border-t border-line bg-app pb-[env(safe-area-inset-bottom)]" aria-label="Quick">
  <button class="{ITEM} {active('notes') ? 'text-accent' : ''}" onclick={() => router.go('notes')} aria-current={active('notes') ? 'page' : undefined}>
    <span class="{INDICATOR} {active('notes') ? 'scale-x-100' : 'scale-x-0'}"></span><Inbox class="size-5" />Notes
  </button>
  <button class="{ITEM} {active('features') ? 'text-accent' : ''}" onclick={() => router.go('features')} aria-current={active('features') ? 'page' : undefined}>
    <span class="{INDICATOR} {active('features') ? 'scale-x-100' : 'scale-x-0'}"></span><Kanban class="size-5" />Features
  </button>
  <button class="group flex flex-1 items-center justify-center py-1.5" onclick={onnew} aria-label="New note">
    <span class="flex size-11 items-center justify-center bg-accent text-accent-ink spring group-hover:bg-accent-hover group-active:scale-90"><Plus class="size-6" /></span>
  </button>
  <button class="{ITEM} {active('project') ? 'text-accent' : ''}" onclick={() => (ui.drawerOpen = true)}>
    <span class="{INDICATOR} {active('project') ? 'scale-x-100' : 'scale-x-0'}"></span><Folder class="size-5" />Projects
  </button>
  <button class="{ITEM} {active('settings') ? 'text-accent' : ''}" onclick={() => router.go('settings')} aria-current={active('settings') ? 'page' : undefined}>
    <span class="{INDICATOR} {active('settings') ? 'scale-x-100' : 'scale-x-0'}"></span><Settings class="size-5" />Settings
  </button>
</nav>
