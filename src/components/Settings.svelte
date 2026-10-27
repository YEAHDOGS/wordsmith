<script>
  // Account, linked providers, agent API tokens, appearance, the app version and installers,
  // the copy-paste agent setup and webhook help. One stacked column on phones, a 1px grid of cards from lg up.
  import KeyRound from '@lucide/svelte/icons/key-round';
  import Copy from '@lucide/svelte/icons/copy';
  import LogOut from '@lucide/svelte/icons/log-out';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { fade, slide } from 'svelte/transition';
  import ProviderIcon from './ProviderIcon.svelte';
  import AppearanceSettings from './AppearanceSettings.svelte';
  import InstallApp from './InstallApp.svelte';
  import { auth, openExternal } from '../lib/auth.svelte.js';
  import { store } from '../lib/store.svelte.js';
  import { IS_NATIVE, api, apiUrl } from '../lib/api.js';
  import { MAX_NAME, PROVIDERS } from '../lib/models.js';
  import { ago, fullTime } from '../lib/time.js';
  import { reveal } from '../lib/reveal.js';
  import { githubProfileUrl } from './settings-data.js';
  import { BOX, BUTTON, CARD, HEADING, HINT } from './settings-styles.js';
  import TEXT from './settings.json';

  const COPIED_MS = 1400;
  const SWAP = { duration: 150 };
  // Until the profile lookup answers (or if it can't), the GitHub chip opens the profile settings page instead
  const GITHUB_PROFILE_FALLBACK = 'https://github.com/settings/profile';
  // The agent setup shows this many lines until expanded; wide screens start expanded
  const SETUP_PREVIEW_LINES = 4;
  const WIDE_SCREEN = '(min-width: 1024px)';

  /** @type {any[]} */
  let tokens = $state([]);
  let tokenName = $state('');
  let secret = $state('');
  let error = $state('');
  let copiedKey = $state('');
  let setupOpen = $state(matchMedia(WIDE_SCREEN).matches);
  let githubUrl = $state(GITHUB_PROFILE_FALLBACK);

  const linkedProviders = $derived(auth.linked.map((identity) => identity.provider));
  const githubId = $derived(auth.linked.find((identity) => identity.provider === 'github')?.provider_user_id || '');
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
  const setupLines = $derived(agentInstructions.split('\n'));

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

  $effect(() => {
    if (!githubId) return;
    githubProfileUrl(githubId).then((url) => {
      if (url) githubUrl = url;
    });
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

  /** The native app has no browser tabs: hand the profile to the system browser instead. @param {MouseEvent} event */
  function openGithub(event) {
    if (!IS_NATIVE) return;
    event.preventDefault();
    openExternal(githubUrl);
  }

  async function signOut() {
    await auth.signOut();
    await store.wipe();
  }
</script>

{#snippet copyButton(key, text, extra = '')}
  <button class="{BUTTON} {extra} shrink-0" onclick={() => copy(key, text)}>
    <Copy class="size-4" />
    <!-- Both labels share one cell so the button never changes width -->
    <span class="grid">
      <span class="col-start-1 row-start-1 transition-opacity duration-150 {copiedKey === key ? 'opacity-0' : ''}">{TEXT.copy}</span>
      <span class="col-start-1 row-start-1 transition-opacity duration-150 {copiedKey === key ? '' : 'opacity-0'}" aria-hidden="true">{TEXT.copied}</span>
    </span>
  </button>
{/snippet}

<div class="h-full overflow-x-hidden overflow-y-auto overscroll-contain">
  <div class="mx-auto grid max-w-7xl grid-cols-1 gap-px border-line bg-line sm:border-x lg:grid-cols-2 ultrawide:max-w-none ultrawide:grid-cols-3">
    <section class={CARD} use:reveal={0}>
      <h2 class={HEADING}>{TEXT.account}</h2>
      <div class="mb-4 flex items-center gap-3">
        {#if auth.user?.avatar_url}<img src={auth.user.avatar_url} alt="" class="size-10 shrink-0 rounded-ui-sm border border-line" />{/if}
        <div class="min-w-0">
          <p class="truncate font-semibold">{auth.user?.name || TEXT.you}</p>
          <p class="selectable truncate font-mono text-xs text-ink-muted">{auth.user?.email || ''}</p>
        </div>
      </div>
      <p class="mb-2 text-xs text-ink-faint">{TEXT.linked}</p>
      <div class="mb-3 flex flex-wrap gap-2">
        {#each PROVIDERS.filter((provider) => auth.providers.includes(provider) || linkedProviders.includes(provider)) as provider (provider)}
          {@const name = TEXT.providers[/** @type {keyof typeof TEXT.providers} */ (provider)]}
          {#if provider === 'github' && linkedProviders.includes(provider)}
            <a class="spring press inline-flex max-w-full items-center gap-2 rounded-ui-sm border border-complete bg-complete-soft px-3 py-2 text-sm hover:border-accent"
              href={githubUrl} target="_blank" rel="noopener noreferrer" title={TEXT.openProfile} onclick={openGithub}>
              <ProviderIcon {provider} class="size-4 shrink-0" />{name}<ExternalLink class="size-3.5 shrink-0 text-ink-muted" />
            </a>
          {:else if linkedProviders.includes(provider)}
            <span class="inline-flex items-center gap-2 rounded-ui-sm border border-complete bg-complete-soft px-3 py-2 text-sm"><ProviderIcon {provider} class="size-4" />{name}</span>
          {:else if !IS_NATIVE}
            <a class={BUTTON} href={apiUrl(`/api/auth/${provider}/start`)}><ProviderIcon {provider} class="size-4" />{TEXT.link} {name}</a>
          {/if}
        {/each}
      </div>
      <p class={HINT}>{TEXT.linkHint}</p>
      <button class="{BUTTON} hover:text-accent" onclick={signOut}><LogOut class="size-4" />{TEXT.signOut}</button>
      <p class="mt-2 text-xs text-ink-faint">{TEXT.signOutHint}</p>
    </section>

    <!-- Flex column so the token list can fill whatever height the Account card sets for this row -->
    <section class="{CARD} flex min-h-0 flex-col" use:reveal={1}>
      <h2 class={HEADING}>{TEXT.tokens}</h2>
      <p class={HINT}>{TEXT.tokensHint}</p>
      <form class="mb-3 flex gap-2" onsubmit={createToken}>
        <input bind:value={tokenName} maxlength={MAX_NAME} placeholder={TEXT.tokenName} aria-label={TEXT.tokenName}
          class="min-w-0 flex-1 border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none" />
        <button class="spring press shrink-0 bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-40" disabled={!tokenName.trim()}>{TEXT.create}</button>
      </form>
      {#if secret}
        <div class="mb-3 rounded-ui-sm border border-accent bg-accent-soft p-3" transition:slide={SWAP}>
          <p class="mb-2 text-xs font-semibold">{TEXT.secretOnce}</p>
          <div class="flex flex-wrap items-center gap-2">
            <code class="selectable min-w-0 flex-1 basis-40 font-mono text-xs break-all">{secret}</code>
            {@render copyButton('secret', secret)}
          </div>
        </div>
      {/if}
      {#if error}<p class="mb-3 text-xs wrap-break-word text-accent" role="alert" transition:slide={SWAP}>{error}</p>{/if}
      <!-- The list is absolutely positioned so it never grows the row: the Account card sets the height, the list scrolls inside it -->
      <div class="relative min-h-40 flex-1">
        <ul class="absolute inset-0 divide-y divide-line overflow-y-auto overscroll-contain {BOX}">
          {#each tokens as token (token.id)}
            <li class="flex items-center gap-3 px-3 py-2" transition:slide={SWAP}>
              <KeyRound class="size-4 shrink-0 text-ink-faint" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold">{token.name}</p>
                <p class="truncate font-mono text-[0.6875rem] text-ink-faint" title={fullTime(token.last_used_at)}>{token.prefix}… · {token.last_used_at ? `${TEXT.lastUsed} ${ago(token.last_used_at)}` : TEXT.never}</p>
              </div>
              <button class="spring press shrink-0 px-2 py-1 text-xs text-ink-muted hover:text-accent" onclick={() => revoke(token.id)}>{TEXT.revoke}</button>
            </li>
          {:else}
            <li class="px-3 py-4 text-center text-xs text-ink-faint" in:fade={SWAP}>{TEXT.noTokens}</li>
          {/each}
        </ul>
      </div>
    </section>

    <section class={CARD} use:reveal={2}>
      <AppearanceSettings />
    </section>

    <section class={CARD} use:reveal={3}>
      <InstallApp />
    </section>

    <section class="{CARD} lg:col-span-2" use:reveal={4}>
      <div class="flex flex-wrap items-start justify-between gap-x-3">
        <div class="min-w-0 flex-1 basis-60">
          <h2 class={HEADING}>{TEXT.setup}</h2>
          <p class={HINT}>{TEXT.setupHint}</p>
        </div>
        {@render copyButton('setup', agentInstructions, 'mb-4')}
      </div>
      <!-- Long URLs wrap anywhere, so the block never pushes the page sideways; the rest folds away behind a toggle -->
      <div class="selectable overflow-hidden font-mono text-xs leading-relaxed text-ink-muted {BOX}">
        <pre class="px-4 pt-4 whitespace-pre-wrap wrap-anywhere {setupOpen ? '' : 'pb-4'}">{setupLines.slice(0, SETUP_PREVIEW_LINES).join('\n')}</pre>
        {#if setupOpen}
          <pre class="px-4 pb-4 whitespace-pre-wrap wrap-anywhere" transition:slide={SWAP}>{setupLines.slice(SETUP_PREVIEW_LINES).join('\n')}</pre>
        {/if}
      </div>
      <button class="spring press mt-2 inline-flex items-center gap-1.5 py-1 text-xs text-ink-muted hover:text-ink" aria-expanded={setupOpen} onclick={() => (setupOpen = !setupOpen)}>
        <ChevronDown class="size-3.5 transition-transform duration-150 ease-spring {setupOpen ? 'rotate-180' : ''}" />{setupOpen ? TEXT.showLess : TEXT.showAll}
      </button>

      <h2 class="{HEADING} mt-8">{TEXT.webhook}</h2>
      <p class={HINT}>{TEXT.webhookHint}</p>
      <div class="flex items-center gap-2">
        <code class="selectable min-w-0 flex-1 truncate px-3 py-2 font-mono text-xs {BOX}">{apiUrl('/api/github/webhook')}</code>
        {@render copyButton('webhook', apiUrl('/api/github/webhook'))}
      </div>
      {#if copiedKey}<span class="sr-only" role="status" transition:fade>{TEXT.copied}</span>{/if}
    </section>
  </div>
</div>
