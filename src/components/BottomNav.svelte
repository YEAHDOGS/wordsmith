<script>
  // Phone navigation in thumb reach. The center button captures a new note in the current context.
  import Inbox from '@lucide/svelte/icons/inbox';
  import Kanban from '@lucide/svelte/icons/kanban';
  import Plus from '@lucide/svelte/icons/plus';
  import Folder from '@lucide/svelte/icons/folder';
  import Settings from '@lucide/svelte/icons/settings';
  import { router } from '../lib/router.svelte.js';
  import { ui } from '../lib/ui.svelte.js';

  /** @type {{ onnew: () => void }} */
  let { onnew } = $props();

  const ITEM = 'spring press flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-ink-muted';
  const active = (/** @type {string} */ view) => (router.route.view === view ? 'text-accent' : '');
</script>

<nav class="flex items-stretch border-t border-line bg-app pb-[env(safe-area-inset-bottom)]" aria-label="Quick">
  <button class="{ITEM} {active('notes')}" onclick={() => router.go('notes')}><Inbox class="size-5" />Notes</button>
  <button class="{ITEM} {active('features')}" onclick={() => router.go('features')}><Kanban class="size-5" />Features</button>
  <button class="{ITEM} text-accent-ink" onclick={onnew} aria-label="New note">
    <span class="flex size-11 -mt-4 items-center justify-center bg-accent text-accent-ink shadow-lg spring hover:bg-accent-hover"><Plus class="size-6" /></span>
  </button>
  <button class="{ITEM} {active('project')}" onclick={() => (ui.drawerOpen = true)}><Folder class="size-5" />Projects</button>
  <button class="{ITEM} {active('settings')}" onclick={() => router.go('settings')}><Settings class="size-5" />Agents</button>
</nav>
