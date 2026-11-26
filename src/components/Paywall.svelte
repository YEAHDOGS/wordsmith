<script>
  // The paywall: what a signed-in account sees once its free trial (TRIAL_DAYS in src/lib/models.js) is over and it
  // holds no plan. The server already refuses everything but signing in and out (402, TRIAL_ENDED), so this replaces
  // the whole app. Joining happens on DOGS's Buy Me a Coffee memberships page (SUBSCRIBE_URL); its webhook
  // (api/functions/api/webhooks/bmc.js) unlocks the account with the same email, so coming back to this tab, or
  // "check again", asks the server whether that has happened. The plans (PLANS) are listed with what each unlocks.
  // The X in the corner doesn't let anyone in: one press gets an honest reply instead, and then the X is gone. The card
  // shakes and its words slide across; its height holds, so nothing jumps.
  // On Worker Previews and staging nobody is locked out; Settings there can show this screen anyway (auth.showPaywall),
  // and then a bar on top leads back to the app.
  // Layout: one centered card on the spine at every size; bigger type and spacing on TVs; compact on short screens.
  import { onMount, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import X from '@lucide/svelte/icons/x';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Coffee from '@lucide/svelte/icons/coffee';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import { auth, openExternal } from '../lib/auth.svelte.js';
  import { IS_NATIVE } from '../lib/api.js';
  import { PLANS, SUBSCRIBE_URL } from '../lib/models.js';
  import { store } from '../lib/store.svelte.js';
  import { deleteLocalDb } from '../lib/idb.js';
  import CoffeeButton from './CoffeeButton.svelte';
  import TEXT from './paywall.json';

  const STAGES = TEXT.stages;
  const PAID = Object.values(PLANS).filter((plan) => plan.level !== null);
  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  /** @param {number} bytes */
  const size = (bytes) => (bytes >= GB ? `${+(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / MB)} MB`);
  const SHAKE_MS = 420;
  const TEXT_IN = { x: 40, duration: 320, easing: quintOut, delay: 60 };
  const TEXT_OUT = { x: -40, duration: 160 };
  const CARD_IN = { y: 24, duration: 320, easing: quintOut };
  const STATUS_FADE = { duration: 150 };
  const BUTTON = 'spring press flex min-h-12 w-full items-center justify-center gap-2 px-4 text-sm font-bold short:min-h-9 tv:min-h-20 tv:text-2xl';

  let stage = $state(0);
  let shaking = $state(false);
  let checking = $state(false);
  let stillLocked = $state(false);
  /** The last check couldn't reach the server, so nothing is known yet. */
  let unreachable = $state(false);
  const last = $derived(stage === STAGES.length - 1);
  /** @type {HTMLElement | undefined} */
  let card = $state();
  /** @type {HTMLAnchorElement | undefined} */
  let subscribeLink = $state();

  const email = $derived(auth.user?.email ?? '');
  const note = $derived(unreachable ? TEXT.unreachable : stillLocked ? (email ? TEXT.stillLocked.replace('{email}', email) : TEXT.stillLockedNoEmail)
    : email ? TEXT.manual.replace('{email}', email) : TEXT.manualNoEmail);

  // Focus starts in the paywall, so keyboards and screen readers land on it. Coming back to this tab (from joining on
  // Buy Me a Coffee) checks quietly, so the app opens by itself once the membership has arrived.
  onMount(() => {
    card?.focus();
    const back = () => document.visibilityState === 'visible' && !checking && auth.refresh();
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  });

  function dismiss() {
    if (last) return;
    stage++;
    // The X disappears on the last stage: hand focus to the offer instead of dropping it.
    if (last) tick().then(() => subscribeLink?.focus());
    shaking = true;
    setTimeout(() => (shaking = false), SHAKE_MS);
  }

  /** The Buy Me a Coffee page, in the system browser on the native apps. @param {MouseEvent} event */
  function subscribe(event) {
    if (!IS_NATIVE) return;
    event.preventDefault();
    openExternal(SUBSCRIBE_URL);
  }

  // A quiet re-read: a server hiccup leaves the paywall up instead of signing out.
  async function check() {
    checking = true;
    stillLocked = false;
    unreachable = false;
    const answered = await auth.refresh();
    checking = false;
    unreachable = !answered;
    stillLocked = answered && auth.locked;
  }

  // Like Settings' sign out, this device forgets its copy of the notes too. The store may never have opened (the app
  // started locked), so the database is also deleted by name.
  async function signOut() {
    const userId = auth.user?.id;
    await auth.signOut();
    await store.wipe();
    if (userId) await deleteLocalDb(userId).catch(() => {});
  }
</script>

<!-- Two rows: the Previews bar (when on), then the page, which scrolls by itself, so the bar never covers the card -->
<div class="flex h-dvh w-full flex-col bg-app" role="dialog" aria-modal="true" aria-label={TEXT.label}>
  {#if auth.showPaywall}
    <!-- Previews only: the way back, always in view -->
    <div class="flex shrink-0 items-center justify-center gap-3 border-b border-accent bg-accent-soft px-3 py-1.5 text-xs text-ink tv:py-4 tv:text-xl">
      <span class="min-w-0 truncate max-sm:hidden">{TEXT.previewNote}</span>
      <button class="spring press flex shrink-0 items-center gap-1.5 border border-accent px-2.5 py-1 font-bold hover:bg-accent hover:text-accent-ink tv:px-5 tv:py-2" onclick={() => auth.setShowPaywall(false)}>
        <Undo2 class="size-3.5 tv:size-6" />{TEXT.previewOff}
      </button>
    </div>
  {/if}
  <div class="relative flex min-h-0 w-full flex-1 justify-center overflow-y-auto px-3 py-6 short:py-2">
  <div class="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-line" aria-hidden="true"></div>

  <section bind:this={card} tabindex="-1" class="relative my-auto focus:outline-none flex h-fit w-full max-w-md flex-col gap-5 border border-line-strong bg-surface p-6 shadow-2xl short:gap-3 short:p-4 short:sm:max-w-3xl short:sm:flex-row short:sm:items-center short:sm:gap-4 short:sm:pr-12 tv:max-w-3xl tv:gap-10 tv:p-14 {shaking ? 'paywall-shake' : ''}" in:fly={CARD_IN}>
    <!-- The X: top right, as promised. Gone after the press (its space is kept). -->
    <button class="spring press absolute top-2 right-2 flex size-10 items-center justify-center text-ink-muted hover:rotate-90 hover:bg-surface-raised hover:text-ink tv:size-16 {last ? 'invisible' : ''}"
      aria-label={TEXT.dismiss} title={TEXT.dismiss} tabindex={last ? -1 : 0} onclick={dismiss}>
      <X class="size-5 tv:size-8" />
    </button>

    <!-- Words on the left, buttons on the right on short screens (phones on their side); one column otherwise -->
    <div class="flex min-w-0 flex-col gap-5 short:flex-1 short:gap-2 tv:gap-10">
    <span class="text-fluid-lg font-black tracking-tight text-ink tv:text-5xl" aria-hidden="true">word<span class="text-accent">smith</span></span>

    <!-- Every stage's words sit invisibly in one cell, so the card keeps the tallest one's height -->
    <div class="grid overflow-hidden" aria-live="polite">
      {#each STAGES as words, index (index)}
        <div class="invisible col-start-1 row-start-1 flex flex-col gap-3 tv:gap-6" aria-hidden="true">
          <h2 class="text-fluid-xl leading-tight font-bold">{words.title}</h2>
          <p class="text-fluid-base leading-relaxed short:text-sm">{words.body}</p>
        </div>
      {/each}
      {#key stage}
        <div class="col-start-1 row-start-1 flex flex-col gap-3 tv:gap-6" in:fly={TEXT_IN} out:fly={TEXT_OUT}>
          <h2 class="text-fluid-xl leading-tight font-bold text-ink">{STAGES[stage].title}</h2>
          <p class="text-fluid-base leading-relaxed text-ink-muted short:text-sm">{STAGES[stage].body}</p>
        </div>
      {/key}
    </div>

    </div>

    <div class="flex min-w-0 flex-col gap-5 short:flex-1 short:gap-2 tv:gap-10">
    <div class="flex flex-col gap-2 short:gap-1.5 tv:gap-4">
      <a bind:this={subscribeLink} class="{BUTTON} bg-accent text-accent-ink hover:bg-accent-hover" href={SUBSCRIBE_URL} target="_blank" rel="noopener noreferrer" onclick={subscribe}>
        <Coffee class="size-4 tv:size-7" />{TEXT.dollar}
      </a>
      <!-- The plans, each a way into the same memberships page; what each unlocks comes from PLANS -->
      <ul class="grid grid-cols-3 border border-line" aria-label={TEXT.plansLabel}>
        {#each PAID as plan (plan.level)}
          <li class="min-w-0 border-r border-line last:border-r-0">
            <a class="spring flex h-full flex-col gap-0.5 p-2 text-[0.6875rem] leading-snug text-ink-faint hover:bg-surface-raised hover:text-ink-muted short:p-1.5 tv:gap-1 tv:p-4 tv:text-lg" href={SUBSCRIBE_URL} target="_blank" rel="noopener noreferrer" onclick={subscribe}>
              <span class="truncate text-xs font-bold text-ink tv:text-xl">{plan.name}</span>
              <span class="font-mono text-accent">{TEXT.price.replace('{price}', String(plan.monthly))}</span>
              <span class="font-mono text-accent">{TEXT.priceYear.replace('{price}', String(plan.yearly))}</span>
              <span class="short:hidden">{TEXT.scribe.replace('{neurons}', plan.scribeNeurons.toLocaleString())}</span>
              <span class="short:hidden">{TEXT.tapes.replace('{size}', size(plan.tapeBytes))}</span>
              <span class="short:hidden">{TEXT.uploads.replace('{size}', size(plan.uploads.video))}</span>
            </a>
          </li>
        {/each}
      </ul>
      <button class="{BUTTON} border border-line text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-60" disabled={checking} onclick={check}>
        <RefreshCw class="size-4 tv:size-7 {checking ? 'animate-spin' : ''}" />{checking ? TEXT.checking : TEXT.check}
      </button>
      <!-- A one-time coffee, beside the plans: a thank you that unlocks nothing -->
      <CoffeeButton class="{BUTTON} border border-line text-ink-muted hover:border-accent hover:text-ink" iconClass="size-4 tv:size-7" />
    </div>

    <p class="min-h-[2.5em] text-xs leading-relaxed short:min-h-0 short:text-[0.6875rem] tv:text-lg {stillLocked || unreachable ? 'text-accent' : 'text-ink-faint'}" role="status">
      {#key note}<span in:fade={STATUS_FADE}>{note}</span>{/key}
    </p>
    <button class="spring press -mt-2 self-center px-2 py-1 text-xs text-ink-faint underline-offset-4 hover:text-ink hover:underline tv:text-lg" onclick={signOut}>{TEXT.signOut}</button>
    </div>
  </section>
  </div>
</div>
