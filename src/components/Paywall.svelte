<script>
  // The paywall: what a signed-in account sees once its free trial (TRIAL_DAYS in src/lib/models.js) is over and no
  // membership is approved. The server already refuses everything but signing in and out (402, TRIAL_ENDED), so this
  // replaces the whole app. Subscribing happens on DOGS's Buy Me a Coffee page (SUBSCRIBE_URL); memberships are
  // approved by hand (scripts/access.js), and "check again" asks the server whether that has happened.
  // The X in the corner doesn't let anyone in: each press makes a smaller, more desperate offer, and after the second
  // the X is gone. The card shakes on each press and its words slide across; its height holds, so nothing jumps.
  // Layout: one centered card on the spine at every size; bigger type and spacing on TVs; compact on short screens.
  import { onMount, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import X from '@lucide/svelte/icons/x';
  import Coffee from '@lucide/svelte/icons/coffee';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import { auth, openExternal } from '../lib/auth.svelte.js';
  import { IS_NATIVE } from '../lib/api.js';
  import { SUBSCRIBE_URL } from '../lib/models.js';
  import { store } from '../lib/store.svelte.js';
  import { deleteLocalDb } from '../lib/idb.js';
  import TEXT from './paywall.json';

  const STAGES = TEXT.stages;
  // From the second stage on, the 50 cent offer is on the table.
  const HALF_FROM = 1;
  const SHAKE_MS = 420;
  const TEXT_IN = { x: 40, duration: 320, easing: quintOut, delay: 60 };
  const TEXT_OUT = { x: -40, duration: 160 };
  const CARD_IN = { y: 24, duration: 320, easing: quintOut };
  const OFFER_IN = { y: -10, duration: 260, easing: quintOut };
  const STATUS_FADE = { duration: 150 };
  const BUTTON = 'spring press flex min-h-12 w-full items-center justify-center gap-2 px-4 text-sm font-bold short:min-h-9 tv:min-h-20 tv:text-2xl';

  let stage = $state(0);
  let shaking = $state(false);
  let checking = $state(false);
  let stillLocked = $state(false);
  const last = $derived(stage === STAGES.length - 1);
  /** @type {HTMLElement | undefined} */
  let card = $state();
  /** @type {HTMLAnchorElement | undefined} */
  let subscribeLink = $state();

  // Focus starts in the paywall, so keyboards and screen readers land on it.
  onMount(() => card?.focus());

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
    await auth.refresh();
    checking = false;
    stillLocked = auth.locked;
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

<div class="relative flex h-dvh w-full justify-center overflow-y-auto bg-app px-3 py-6 short:py-2" role="dialog" aria-modal="true" aria-label={TEXT.label}>
  <div class="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-line" aria-hidden="true"></div>

  <section bind:this={card} tabindex="-1" class="relative my-auto focus:outline-none flex h-fit w-full max-w-md flex-col gap-5 border border-line-strong bg-surface p-6 shadow-2xl short:gap-3 short:p-4 short:sm:max-w-3xl short:sm:flex-row short:sm:items-center short:sm:gap-4 short:sm:pr-12 tv:max-w-3xl tv:gap-10 tv:p-14 {shaking ? 'paywall-shake' : ''}" in:fly={CARD_IN}>
    <!-- The X: top right, as promised. Gone after the second press (its space is kept). -->
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
      <!-- Space for the 50 cent offer is kept from the start, so it slides in without moving anything -->
      <div class="grid">
        {#if stage >= HALF_FROM}
          <a class="{BUTTON} col-start-1 row-start-1 border border-accent text-accent hover:bg-accent-soft" href={SUBSCRIBE_URL} target="_blank" rel="noopener noreferrer" onclick={subscribe} in:fly={OFFER_IN}>
            <Coffee class="size-4 tv:size-7" />{TEXT.half}
          </a>
        {:else}
          <span class="{BUTTON} invisible col-start-1 row-start-1" aria-hidden="true">{TEXT.half}</span>
        {/if}
      </div>
      <button class="{BUTTON} border border-line text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-60" disabled={checking} onclick={check}>
        <RefreshCw class="size-4 tv:size-7 {checking ? 'animate-spin' : ''}" />{checking ? TEXT.checking : TEXT.check}
      </button>
    </div>

    <p class="min-h-[2.5em] text-xs leading-relaxed short:min-h-0 short:text-[0.6875rem] tv:text-lg {stillLocked ? 'text-accent' : 'text-ink-faint'}" role="status">
      {#key stillLocked}<span in:fade={STATUS_FADE}>{stillLocked ? TEXT.stillLocked : TEXT.manual}</span>{/key}
    </p>
    <button class="spring press -mt-2 self-center px-2 py-1 text-xs text-ink-faint underline-offset-4 hover:text-ink hover:underline tv:text-lg" onclick={signOut}>{TEXT.signOut}</button>
    </div>
  </section>
</div>
