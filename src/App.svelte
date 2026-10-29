<script>
  // Root: restores the session, reads one-time notices from OAuth redirects (?auth=, ?auth_error=, ?device=),
  // opens the signed-in user's local store, and shows the sign-in screen or the app.
  import { fade } from 'svelte/transition';
  import { cubicIn } from 'svelte/easing';
  import Login from './components/Login.svelte';
  import Shell from './components/Shell.svelte';
  import Privacy from './components/Privacy.svelte';
  import { privacy } from './components/privacy-route.svelte.js';
  import { auth } from './lib/auth.svelte.js';
  import { store } from './lib/store.svelte.js';
  import { fileShare } from './share-capture.js';

  const NOTICE_PARAMS = ['auth', 'auth_error', 'device', 'provider', 'code'];
  const SCREEN_IN = { duration: 260, delay: 80 };
  const SCREEN_OUT = { duration: 150, easing: cubicIn };
  const params = new URLSearchParams(location.search);

  /** Device-login steps happen in the system browser and render on the sign-in screen. */
  const notice = params.get('device')
    ? { kind: /** @type {const} */ ('device_confirm'), device: params.get('device') || '', provider: params.get('provider') || '', code: params.get('code') || '' }
    : params.get('auth') === 'device_done' ? { kind: /** @type {const} */ ('device_done') } : null;
  const message = params.get('auth_error') || '';

  // Coming back from a sign-in carries one-time params: strip them so a reload doesn't replay them, and ask the server.
  // Any other start trusts the cached user (one request saved per start); the first sync corrects it if needed.
  const returning = NOTICE_PARAMS.some((key) => params.has(key));
  if (returning) history.replaceState(null, '', location.pathname + location.hash);

  store.onUnauthorized = () => auth.expired();
  store.onOtherUser = () => auth.load();
  auth.load(!returning);

  let openedFor = '';
  $effect(() => {
    const userId = auth.status === 'signed_in' ? auth.user?.id ?? '' : '';
    if (userId === openedFor) return;
    // Close, don't wipe: an expired session must not lose unsynced edits. Settings' sign out wipes explicitly.
    if (openedFor) store.close();
    openedFor = userId;
    // A page shared into the app (share-capture.js) becomes a note once the store has loaded.
    if (userId) store.open(userId).then(fileShare);
  });
</script>

<!-- Splash, sign-in, app and the Privacy Policy share one grid cell: the leaving screen fades out on top of the arriving one, never below it.
     The policy comes first so /privacy reads the same signed in or out. -->
<div class="grid h-dvh w-full overflow-hidden bg-app">
  {#if privacy.open}
    <div class="col-start-1 row-start-1 min-h-0" in:fade={SCREEN_IN} out:fade={SCREEN_OUT}><Privacy /></div>
  {:else if auth.status === 'loading'}
    <div class="col-start-1 row-start-1 flex min-h-0 items-center justify-center" out:fade={SCREEN_OUT}>
      <span class="text-fluid-xl font-black tracking-tight text-ink">word<span class="text-accent">smith</span></span>
    </div>
  {:else if auth.status === 'signed_out' || notice}
    <div class="col-start-1 row-start-1 min-h-0" in:fade={SCREEN_IN} out:fade={SCREEN_OUT}><Login {notice} {message} /></div>
  {:else}
    <div class="col-start-1 row-start-1 min-h-0" in:fade={SCREEN_IN} out:fade={SCREEN_OUT}><Shell /></div>
  {/if}
</div>
