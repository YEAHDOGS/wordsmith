<script>
  // Root: restores the session, reads one-time notices from OAuth redirects (?auth=, ?auth_error=, ?device=),
  // opens the signed-in user's local store, and shows the sign-in screen or the app.
  import { fade } from 'svelte/transition';
  import Login from './components/Login.svelte';
  import Shell from './components/Shell.svelte';
  import { auth } from './lib/auth.svelte.js';
  import { store } from './lib/store.svelte.js';

  const NOTICE_PARAMS = ['auth', 'auth_error', 'device', 'provider', 'code'];
  const params = new URLSearchParams(location.search);

  /** Device-login steps happen in the system browser and render on the sign-in screen. */
  const notice = params.get('device')
    ? { kind: /** @type {const} */ ('device_confirm'), device: params.get('device') || '', provider: params.get('provider') || '', code: params.get('code') || '' }
    : params.get('auth') === 'device_done' ? { kind: /** @type {const} */ ('device_done') } : null;
  const message = params.get('auth_error') || '';

  // Strip the one-time params so a reload doesn't replay them.
  if (NOTICE_PARAMS.some((key) => params.has(key))) history.replaceState(null, '', location.pathname + location.hash);

  store.onUnauthorized = () => auth.expired();
  auth.load();

  let openedFor = '';
  $effect(() => {
    const userId = auth.status === 'signed_in' ? auth.user?.id ?? '' : '';
    if (userId === openedFor) return;
    // Close, don't wipe: an expired session must not lose unsynced edits. Settings' sign out wipes explicitly.
    if (openedFor) store.close();
    openedFor = userId;
    if (userId) store.open(userId);
  });
</script>

{#if auth.status === 'loading'}
  <div class="flex h-dvh items-center justify-center bg-app" out:fade={{ duration: 150 }}>
    <span class="text-fluid-xl font-black tracking-tight text-ink">word<span class="text-accent">smith</span></span>
  </div>
{:else if auth.status === 'signed_out' || notice}
  <div in:fade={{ duration: 200 }}><Login {notice} {message} /></div>
{:else}
  <div in:fade={{ duration: 200 }}><Shell /></div>
{/if}
