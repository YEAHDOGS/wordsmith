<script>
  // Account, linked providers, agent API tokens, the copy-paste agent setup, webhook help and theme.
  import KeyRound from '@lucide/svelte/icons/key-round';
  import Copy from '@lucide/svelte/icons/copy';
  import LogOut from '@lucide/svelte/icons/log-out';
  import { fade, fly, slide } from 'svelte/transition';
  import ProviderIcon from './ProviderIcon.svelte';
  import { auth } from '../lib/auth.svelte.js';
  import { store } from '../lib/store.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { IS_NATIVE, api, apiUrl } from '../lib/api.js';
  import { MAX_NAME, PROVIDERS } from '../lib/models.js';
  import { ago, fullTime } from '../lib/time.js';
  import TEXT from './settings.json';

  const COPIED_MS = 1400;
  const CARD = 'bg-app p-4 sm:p-6 tv:p-10';
  const HEADING = 'mb-1 text-fluid-lg font-bold tracking-tight';
  const HINT = 'mb-4 text-fluid-sm text-ink-muted';
  const BUTTON = 'spring press inline-flex items-center gap-2 border border-line-strong px-3 py-2 text-sm text-ink hover:border-accent';
  const THEMES = ['system', 'dark', 'light'];

  /** @type {any[]} */
  let tokens = $state([]);
  let tokenName = $state('');
  let secret = $state('');
  let error = $state('');
  let copiedKey = $state('');

  const linkedProviders = $derived(auth.linked.map((identity) => identity.provider));
  const agentInstructions = $derived(`## wordsmith (feature queue)
Your wordsmith token is in the WORDSMITH_TOKEN environment variable. Send it as "Authorization: Bearer $WORDSMITH_TOKEN".
API: ${apiUrl('/api/v1')} (GET it for the full endpoint list)

Loop:
1. Claim work: POST ${apiUrl('/api/v1/features/next')} with JSON {"project":"<project name or id>"}. 204 means the queue is empty.
2. Report progress: PATCH ${apiUrl('/api/v1/notes/<id>')} with {"status":"short present-tense update"}. Do this at each milestone.
3. When your pull request is open: PATCH the same URL with {"pr_url":"https://github.com/owner/repo/pull/123"}.
4. Don't mark features complete yourself. Merging the PR completes them.
5. Have a new idea? POST ${apiUrl('/api/v1/features')} with {"project":"...","title":"...","body":"..."}.
Every call is timestamped on the feature's timeline under your token's name.`);

  async function loadTokens() {
    try {
      tokens = (await api('/api/tokens')).tokens;
    } catch (failure) {
      error = /** @type {Error} */ (failure).message;
    }
  }
  $effect(() => {
    loadTokens();
  });

  /** @param {SubmitEvent} event */
  async function createToken(event) {
    event.preventDefault();
    error = '';
    try {
      const result = await api('/api/tokens', { method: 'POST', body: { name: tokenName } });
      secret = result.secret;
      tokenName = '';
      tokens = [result.token, ...tokens];
    } catch (failure) {
      error = /** @type {Error} */ (failure).message;
    }
  }

  /** @param {string} id */
  async function revoke(id) {
    await api(`/api/tokens/${id}`, { method: 'DELETE' }).catch((failure) => (error = failure.message));
    tokens = tokens.filter((token) => token.id !== id);
  }

  /** @param {string} key @param {string} text */
  async function copy(key, text) {
    await navigator.clipboard?.writeText(text);
    copiedKey = key;
    setTimeout(() => (copiedKey = ''), COPIED_MS);
  }

  async function signOut() {
    await auth.signOut();
    await store.wipe();
  }
</script>

<div class="h-full overflow-y-auto">
  <div class="mx-auto grid max-w-7xl gap-px border-line bg-line sm:border-x lg:grid-cols-2 ultrawide:max-w-none ultrawide:grid-cols-3">
    <section class={CARD} in:fly={{ y: 12, duration: 250 }}>
      <h2 class={HEADING}>{TEXT.account}</h2>
      <div class="mb-4 flex items-center gap-3">
        {#if auth.user?.avatar_url}<img src={auth.user.avatar_url} alt="" class="size-10 border border-line" />{/if}
        <div class="min-w-0">
          <p class="truncate font-semibold">{auth.user?.name || 'You'}</p>
          <p class="selectable truncate font-mono text-xs text-ink-muted">{auth.user?.email || ''}</p>
        </div>
      </div>
      <p class="mb-2 text-xs text-ink-faint">{TEXT.linked}</p>
      <div class="mb-3 flex flex-wrap gap-2">
        {#each PROVIDERS.filter((provider) => auth.providers.includes(provider) || linkedProviders.includes(provider)) as provider (provider)}
          {#if linkedProviders.includes(provider)}
            <span class="inline-flex items-center gap-2 border border-complete bg-complete-soft px-3 py-2 text-sm"><ProviderIcon {provider} class="size-4" />{TEXT.providers[/** @type {keyof typeof TEXT.providers} */ (provider)]}</span>
          {:else if !IS_NATIVE}
            <a class={BUTTON} href={apiUrl(`/api/auth/${provider}/start`)}><ProviderIcon {provider} class="size-4" />{TEXT.link} {TEXT.providers[/** @type {keyof typeof TEXT.providers} */ (provider)]}</a>
          {/if}
        {/each}
      </div>
      <p class={HINT}>{TEXT.linkHint}</p>
      <button class="{BUTTON} hover:text-accent" onclick={signOut}><LogOut class="size-4" />{TEXT.signOut}</button>
      <p class="mt-2 text-xs text-ink-faint">{TEXT.signOutHint}</p>

      <h2 class="{HEADING} mt-8">{TEXT.appearance}</h2>
      <div class="mt-2 inline-flex gap-px border border-line bg-line" role="radiogroup" aria-label="Theme">
        {#each THEMES as theme (theme)}
          <button role="radio" aria-checked={ui.theme === theme} class="spring press px-4 py-2 text-sm capitalize {ui.theme === theme ? 'bg-accent-soft text-ink' : 'bg-app text-ink-muted hover:text-ink'}"
            onclick={() => { while (ui.theme !== theme) ui.cycleTheme(); }}>{theme}</button>
        {/each}
      </div>
    </section>

    <!-- Flex column so the token list can fill whatever height the Account card sets for this row -->
    <section class="{CARD} flex min-h-0 flex-col" in:fly={{ y: 12, duration: 250, delay: 60 }}>
      <h2 class={HEADING}>{TEXT.tokens}</h2>
      <p class={HINT}>{TEXT.tokensHint}</p>
      <form class="mb-3 flex" onsubmit={createToken}>
        <input bind:value={tokenName} maxlength={MAX_NAME} placeholder={TEXT.tokenName} aria-label={TEXT.tokenName}
          class="min-w-0 flex-1 border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none" />
        <button class="spring press bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-40" disabled={!tokenName.trim()}>{TEXT.create}</button>
      </form>
      {#if secret}
        <div class="mb-3 border border-accent bg-accent-soft p-3" transition:slide={{ duration: 150 }}>
          <p class="mb-2 text-xs font-semibold">{TEXT.secretOnce}</p>
          <div class="flex items-center gap-2">
            <code class="selectable min-w-0 flex-1 truncate font-mono text-xs">{secret}</code>
            <button class={BUTTON} onclick={() => copy('secret', secret)}><Copy class="size-4" />{copiedKey === 'secret' ? TEXT.copied : TEXT.copy}</button>
          </div>
        </div>
      {/if}
      {#if error}<p class="mb-3 text-xs text-accent" role="alert">{error}</p>{/if}
      <!-- The list is absolutely positioned so it never grows the row: the Account card sets the height, the list scrolls inside it -->
      <div class="relative min-h-40 flex-1">
        <ul class="absolute inset-0 divide-y divide-line overflow-y-auto overscroll-contain border border-line">
          {#each tokens as token (token.id)}
            <li class="flex items-center gap-3 px-3 py-2" transition:slide={{ duration: 150 }}>
              <KeyRound class="size-4 shrink-0 text-ink-faint" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold">{token.name}</p>
                <p class="font-mono text-[11px] text-ink-faint" title={fullTime(token.last_used_at)}>{token.prefix}… · {token.last_used_at ? `${TEXT.lastUsed} ${ago(token.last_used_at)}` : TEXT.never}</p>
              </div>
              <button class="spring press px-2 py-1 text-xs text-ink-muted hover:text-accent" onclick={() => revoke(token.id)}>{TEXT.revoke}</button>
            </li>
          {:else}
            <li class="px-3 py-4 text-center text-xs text-ink-faint">No tokens yet.</li>
          {/each}
        </ul>
      </div>
    </section>

    <section class="{CARD} lg:col-span-2 ultrawide:col-span-1" in:fly={{ y: 12, duration: 250, delay: 120 }}>
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class={HEADING}>{TEXT.setup}</h2>
          <p class={HINT}>{TEXT.setupHint}</p>
        </div>
        <button class="{BUTTON} shrink-0" onclick={() => copy('setup', agentInstructions)}><Copy class="size-4" />{copiedKey === 'setup' ? TEXT.copied : TEXT.copy}</button>
      </div>
      <pre class="selectable max-h-72 overflow-auto border border-line bg-surface p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">{agentInstructions}</pre>

      <h2 class="{HEADING} mt-8">{TEXT.webhook}</h2>
      <p class={HINT}>{TEXT.webhookHint}</p>
      <div class="flex items-center gap-2">
        <code class="selectable min-w-0 flex-1 truncate border border-line bg-surface px-3 py-2 font-mono text-xs">{apiUrl('/api/github/webhook')}</code>
        <button class={BUTTON} onclick={() => copy('webhook', apiUrl('/api/github/webhook'))}><Copy class="size-4" />{copiedKey === 'webhook' ? TEXT.copied : TEXT.copy}</button>
      </div>
      {#if copiedKey}<span class="sr-only" transition:fade>{TEXT.copied}</span>{/if}
    </section>
  </div>
</div>
