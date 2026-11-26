<script>
  // Signs out after pushing any unsynced edits, so nothing typed on this device is lost with the local copy.
  // Shown where GitHub rejected wordsmith's credentials: signing back in with GitHub stores a fresh token.
  import LogOut from '@lucide/svelte/icons/log-out';
  import { auth } from '../lib/auth.svelte.js';
  import { store } from '../lib/store.svelte.js';

  let busy = $state(false);

  async function signOut() {
    busy = true;
    await store.sync().catch(() => {});
    await auth.signOut();
    await store.wipe();
  }
</script>

<button class="spring press inline-flex shrink-0 items-center gap-1.5 border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-60 tv:text-base"
  onclick={signOut} disabled={busy}><LogOut class="size-3.5" />Sign out</button>
