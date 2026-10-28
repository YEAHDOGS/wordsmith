<script>
  // Sign-in screen, plus the two browser-side steps of a native-app login (confirm code, done).
  // Layout: a centered "wormhole" hero on a vertical spine, with the four steps of the agent loop strung along it.
  import { fade, fly } from 'svelte/transition';
  import logo from '../assets/dogs-logo-cropped.png';
  import madeByDogs from '../assets/made-by-dogs-small.png';
  import ProviderIcon from './ProviderIcon.svelte';
  import { IS_NATIVE } from '../lib/api.js';
  import { auth } from '../lib/auth.svelte.js';
  import { PROVIDERS } from '../lib/models.js';
  import TEXT from './login.json';

  /** @type {{ notice?: { kind: 'device_confirm' | 'device_done', device?: string, provider?: string, code?: string } | null, message?: string }} */
  let { notice = null, message = '' } = $props();

  const WEAREDOGS_URL = 'https://wearedogs.net';
  const DOGS_URL = 'https://dogs.red';
  const REPO_URL = 'https://github.com/YEAHDOGS/wordsmith';
  const STEP_STAGGER_MS = 90;
  const BUTTON_CLASS =
    'spring press flex w-full items-center justify-center gap-3 border border-line-strong bg-surface px-5 py-3.5 short:py-2.5 text-fluid-sm font-semibold text-ink hover:border-accent hover:bg-surface-raised disabled:opacity-50';
  const INPUT_CLASS =
    'bg-surface px-5 py-3.5 short:py-2.5 text-center text-fluid-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:bg-surface-raised';

  let busy = $state('');
  let password = $state('');
  // Private beta: only needed to create an account. The app's WebView can't pass it to the system browser, so native
  // logins enter it on the browser's confirmation screen instead.
  let betaPassword = $state('');
  // Set once the server accepted betaPassword, so a second provider click doesn't spend another guess.
  let betaAccepted = $state(false);
  const showBeta = $derived(auth.signupLocked && !IS_NATIVE);
  // Start-up may have trusted a cached user and skipped the session request; the sign-in buttons need its provider list.
  $effect(() => {
    if (!auth.sessionFetched) auth.load();
  });
  const available = $derived(PROVIDERS.filter((provider) => auth.providers.includes(provider)));
  const confirmHref = $derived(
    notice?.kind === 'device_confirm' ? `/api/auth/${notice.provider}/start?device=${encodeURIComponent(notice.device || '')}&confirm=1` : '',
  );

  /** @param {SubmitEvent} event */
  async function unlockPreview(event) {
    event.preventDefault();
    if (!password) return;
    busy = 'preview';
    await auth.previewSignIn(password);
    password = '';
    busy = '';
  }

  /** Sends the beta password, if one was typed and not yet accepted, before the OAuth redirect. */
  async function unlockBeta() {
    if (!betaPassword || betaAccepted) return true;
    betaAccepted = await auth.unlockSignup(betaPassword);
    return betaAccepted;
  }

  /** Enter in the beta field on the sign-in screen: check it now, then the user picks a provider. @param {SubmitEvent} event */
  async function submitBeta(event) {
    event.preventDefault();
    if (busy) return;
    busy = 'beta';
    await unlockBeta();
    busy = '';
  }

  /** @param {string} provider */
  async function signIn(provider) {
    busy = provider;
    if (await unlockBeta()) await auth.signIn(provider);
    busy = '';
  }

  /** @param {SubmitEvent} event */
  async function confirmDevice(event) {
    event.preventDefault();
    if (busy) return;
    busy = 'confirm';
    if (await unlockBeta()) location.href = confirmHref;
    else busy = '';
  }
</script>

<main class="relative flex h-dvh w-full flex-col overflow-hidden bg-app text-ink">
  <!-- The spine: one continuous 1px line the whole page hangs from -->
  <div class="spine-line pointer-events-none absolute inset-y-0 left-1/2 w-px bg-line" aria-hidden="true"></div>

  <header class="relative z-10 flex items-center justify-between border-b border-line bg-app px-4 py-3 short:py-2 sm:px-8">
    <!-- Same box as the old wrapper div, so the branding doesn't shift; the icon sits before "wordsmith" for the same reason -->
    <a href={DOGS_URL} target="_blank" rel="noopener noreferrer" class="group flex items-center gap-2.5" aria-label="DOGS (dogs.red)">
      <img src={logo} alt="DOGS logo" class="size-8 short:size-6 object-contain spring group-hover:rotate-12" />
      <span class="spring text-fluid-base font-bold tracking-[0.2em] group-hover:text-accent">DOGS</span>
    </a>
    <a href={REPO_URL} target="_blank" rel="noopener noreferrer" class="spring flex items-center gap-1.5 text-ink-faint hover:text-ink" aria-label="wordsmith on GitHub">
      <ProviderIcon provider="github" class="size-3.5 spring group-hover:rotate-0" />
      <span class="font-mono text-xs">wordsmith</span>
    </a>
  </header>

  <section class="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col items-stretch justify-center gap-6 short:gap-3 overflow-y-auto px-4 py-6 short:py-2 tv:max-w-2xl">
    <div class="relative overflow-hidden bg-app py-2 text-center sweep" in:fade={{ duration: 400 }}>
      <h1 class="text-fluid-display tv:text-display-tv font-black leading-none tracking-tight">
        word<span class="text-accent">smith</span>
      </h1>
      <p class="mt-3 short:mt-1 text-fluid-base font-medium text-ink-muted">{TEXT.tagline}</p>
    </div>

    {#if notice?.kind === 'device_confirm'}
      <div class="border border-line bg-surface p-5 text-center" in:fly={{ y: 12, duration: 300 }}>
        <h2 class="text-fluid-lg font-bold">{TEXT.confirmTitle}</h2>
        <p class="selectable my-4 font-mono text-fluid-xl tracking-[0.4em] text-accent">{notice.code}</p>
        <p class="mb-5 text-fluid-sm text-ink-muted">{TEXT.confirmBody}</p>
        <form class="flex flex-col gap-px" onsubmit={confirmDevice}>
          {#if showBeta}
            <input type="password" bind:value={betaPassword} oninput={() => (betaAccepted = false)} autocomplete="off" maxlength="200"
              placeholder={TEXT.betaLabel} aria-label={TEXT.betaLabel} class="{INPUT_CLASS} border border-line" />
          {/if}
          <button type="submit" class="{BUTTON_CLASS} border-accent" disabled={Boolean(busy)}>
            <ProviderIcon provider={notice.provider || ''} />
            {TEXT.confirmButton}
          </button>
        </form>
      </div>
    {:else if notice?.kind === 'device_done'}
      <div class="border border-complete bg-complete-soft p-5 text-center" in:fly={{ y: 12, duration: 300 }}>
        <h2 class="text-fluid-lg font-bold text-complete">{TEXT.doneTitle}</h2>
        <p class="mt-2 text-fluid-sm text-ink-muted">{TEXT.doneBody}</p>
      </div>
    {:else if auth.device}
      <div class="border border-line bg-surface p-5 text-center" in:fly={{ y: 12, duration: 300 }}>
        <h2 class="text-fluid-lg font-bold">{TEXT.deviceTitle}</h2>
        <p class="selectable my-4 font-mono text-fluid-xl tracking-[0.4em] text-accent">{auth.device.code}</p>
        <p class="mb-5 text-fluid-sm text-ink-muted">{TEXT.deviceBody}</p>
        <button class={BUTTON_CLASS} onclick={() => auth.cancelDevice()}>{TEXT.cancel}</button>
      </div>
    {:else}
      <ol class="short:hidden grid grid-cols-2 gap-px border border-line bg-line text-fluid-sm">
        {#each TEXT.steps as step, index (step)}
          <li class="flex items-center gap-2 bg-app px-3 py-2.5" in:fly={{ y: 8, delay: index * STEP_STAGGER_MS, duration: 300 }}>
            <span class="font-mono text-xs text-accent">0{index + 1}</span>
            <span class="text-ink-muted">{step}</span>
          </li>
        {/each}
      </ol>

      {#if auth.previewLogin}
        <form class="flex flex-col gap-px border border-line bg-line" onsubmit={unlockPreview} in:fly={{ y: 8, delay: 200, duration: 300 }}>
          <input type="password" bind:value={password} autocomplete="current-password" maxlength="200" placeholder={TEXT.previewLabel} aria-label={TEXT.previewLabel}
            class={INPUT_CLASS} />
          <button type="submit" class={BUTTON_CLASS} disabled={Boolean(busy) || !password}>{TEXT.previewButton}</button>
        </form>
        <p class="short:hidden text-center text-fluid-sm text-ink-muted">{TEXT.previewHint}</p>
      {/if}
      <div class="flex flex-col gap-px border border-line bg-line">
        {#if showBeta && available.length}
          <form class="flex" onsubmit={submitBeta} in:fly={{ y: 8, delay: 150, duration: 300 }}>
            <input type="password" bind:value={betaPassword} oninput={() => (betaAccepted = false)} autocomplete="off" maxlength="200"
              placeholder={TEXT.betaLabel} aria-label={TEXT.betaLabel} class="{INPUT_CLASS} w-full" />
          </form>
          {#if betaAccepted}
            <p role="status" class="bg-complete-soft px-5 py-2 text-center text-fluid-sm text-complete" in:fade>{TEXT.betaAccepted}</p>
          {/if}
        {/if}
        {#each available as provider, index (provider)}
          <button class={BUTTON_CLASS} disabled={Boolean(busy)} onclick={() => signIn(provider)} in:fly={{ y: 8, delay: 200 + index * STEP_STAGGER_MS, duration: 300 }}>
            <ProviderIcon {provider} />
            {TEXT.continue} {TEXT.providers[/** @type {keyof typeof TEXT.providers} */ (provider)]}
          </button>
        {/each}
        {#if auth.devLogin}
          <button class="{BUTTON_CLASS} border-dashed font-mono text-ink-muted" onclick={() => auth.devSignIn()}>{TEXT.dev}</button>
        {/if}
      </div>
      {#if !available.length && !auth.devLogin && !auth.previewLogin}
        <p class="text-center text-fluid-sm text-ink-muted">{TEXT.none}</p>
      {/if}
      <p class="short:hidden text-center text-fluid-sm leading-relaxed text-ink-muted">{TEXT.pitch}</p>
    {/if}

    {#if message || auth.error}
      <p role="alert" class="border border-accent bg-accent-soft px-4 py-2 text-center text-fluid-sm text-ink" transition:fade>{message || auth.error}</p>
    {/if}
  </section>

  <footer class="relative z-10 flex items-center justify-between border-t border-line bg-app px-4 py-2 sm:px-8">
    <span class="text-xs tracking-wider text-ink-faint">&copy; {new Date().getFullYear()} DOGS.</span>
    <a href={WEAREDOGS_URL} target="_blank" rel="noopener noreferrer" class="spring opacity-70 hover:opacity-100">
      <img src={madeByDogs} alt={TEXT.madeBy} width="480" height="159" class="h-6 w-auto short:h-5 tv:h-10" />
    </a>
  </footer>
</main>
