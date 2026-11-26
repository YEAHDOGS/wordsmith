<script>
  // The guided tour (state in src/lib/tour.svelte.js, words in tour.json): a card that walks through each part of
  // wordsmith while the app behind it moves to that part, so you see what it describes. It doesn't block the page:
  // look around, then carry on. Arrow keys (with the card focused) and the buttons step through it, Escape closes it.
  // Phones: a card above the bottom nav, edge to edge. Tablets and up: a card in the bottom-right corner. Only its
  // text scrolls, when a screen is too short for it; the header and buttons always show.
  import { fade, fly } from 'svelte/transition';
  import { backOut, cubicIn, quintOut } from 'svelte/easing';
  import X from '@lucide/svelte/icons/x';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import { tour } from '../lib/tour.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { store } from '../lib/store.svelte.js';
  import { apiUrl } from '../lib/api.js';
  import { fill } from '../lib/fill.js';
  import { byName } from '../lib/nav-order.js';
  import { NEEDS_YOU_ENABLED } from '../lib/models.js';
  import TEXT from './tour.json';

  // Steps for pages this build has (Needs you can be switched off in models.js).
  const STEPS = TEXT.steps.filter((step) => step.view !== 'attention' || NEEDS_YOU_ENABLED);
  /** @type {Record<string, number>} */
  const KEY_STEPS = { ArrowLeft: -1, ArrowRight: 1 };
  const CARD_IN = { y: 24, duration: 280, easing: backOut };
  const CARD_OUT = { y: 24, duration: 160, easing: cubicIn };
  const STEP_SHIFT_PX = 24;
  const STEP_IN_MS = 240;
  const COPIED_MS = 1_500;
  const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
  const BUTTON = 'spring press inline-flex items-center gap-1.5 px-3 py-2 text-sm tv:px-5 tv:py-3 tv:text-xl';

  let copied = $state(false);

  const step = $derived(STEPS[tour.step] ?? STEPS[0]);
  const last = $derived(tour.step === STEPS.length - 1);
  const code = $derived(step.code ? fill(step.code, { endpoint: apiUrl('/api/mcp') }) : '');
  /** @param {number} ms */
  const motion = (ms) => (REDUCED_MOTION.matches ? 0 : ms);

  // Each step shows its page behind the card. Projects show the first one (A-Z), or Features while there are none.
  $effect(() => {
    const view = step.view;
    const project = view === 'project' ? byName(store.projects)[0] : null;
    if (view === 'project') router.replace(project ? 'project' : 'features', project?.id ?? '');
    else router.replace(view);
  });

  /** @param {number} by */
  const move = (by) => (last && by > 0 ? tour.close() : tour.goTo(tour.step + by, STEPS.length));

  async function copy() {
    await navigator.clipboard?.writeText(code).catch(() => {});
    copied = true;
    setTimeout(() => (copied = false), COPIED_MS);
  }

  /** Arrow keys step through the tour while the card has focus. @param {HTMLElement} node */
  function arrowKeys(node) {
    /** @param {KeyboardEvent} event */
    const onkeydown = (event) => {
      const by = KEY_STEPS[event.key];
      if (!by || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      move(by);
    };
    node.addEventListener('keydown', onkeydown);
    return () => node.removeEventListener('keydown', onkeydown);
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && tour.close()} />

<div class="fixed inset-x-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-h-[calc(100dvh-8.5rem)] max-w-md flex-col rounded-ui border border-line-strong bg-surface shadow-2xl md:inset-x-auto md:right-4 md:bottom-4 md:max-h-[calc(100dvh-6rem)] tv:right-8 tv:bottom-8 tv:max-w-2xl"
  role="dialog" aria-modal="false" aria-label={TEXT.label} aria-describedby="tour-body" tabindex="-1" {@attach arrowKeys}
  in:fly={{ ...CARD_IN, duration: motion(CARD_IN.duration) }} out:fly={{ ...CARD_OUT, duration: motion(CARD_OUT.duration) }}>
  <header class="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2 tv:px-5 tv:py-3">
    <span class="shrink-0 font-mono text-[0.6875rem] text-ink-faint tabular-nums tv:text-sm">{fill(TEXT.progress, { n: tour.step + 1, total: STEPS.length })}</span>
    <!-- How far along: a bar that scales, so it never reflows -->
    <span class="h-0.5 min-w-0 flex-1 overflow-hidden bg-line" aria-hidden="true">
      <span class="block h-full origin-left bg-accent transition-transform duration-300 ease-out" style:transform="scaleX({(tour.step + 1) / STEPS.length})"></span>
    </span>
    <button class="spring press -m-1 p-1 text-ink-faint hover:text-ink" aria-label={TEXT.close} title={TEXT.close} onclick={() => tour.close()}><X class="size-4 tv:size-6" /></button>
  </header>

  <!-- One grid cell: the leaving step's text slides out under the arriving one, so the card never jumps -->
  <div class="grid min-h-0 flex-1 overflow-hidden">
    {#key tour.step}
      <div id="tour-body" class="col-start-1 row-start-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 tv:px-6 tv:py-5"
        in:fly={{ x: tour.direction * STEP_SHIFT_PX, duration: motion(STEP_IN_MS), easing: quintOut }} out:fade={{ duration: motion(STEP_IN_MS / 2) }}>
        <h2 class="text-fluid-lg font-bold tracking-tight text-ink">{step.title}</h2>
        <p class="mt-1.5 text-sm leading-relaxed text-ink-muted tv:text-xl">{step.body}</p>
        <ul class="mt-3 grid gap-1.5">
          {#each step.points as point, index (index)}
            <li class="flex gap-2 text-sm leading-relaxed text-ink tv:text-xl">
              <span class="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true"></span>{point}
            </li>
          {/each}
        </ul>
        {#if code}
          <div class="mt-3 flex items-start gap-2 rounded-ui-sm border border-line bg-app p-2">
            <code class="selectable min-w-0 flex-1 font-mono text-[0.6875rem] leading-relaxed wrap-anywhere text-ink tv:text-sm">{code}</code>
            <button class="spring press shrink-0 p-1 text-ink-muted hover:text-ink" aria-label={copied ? TEXT.copied : TEXT.copy} title={copied ? TEXT.copied : TEXT.copy} onclick={copy}>
              {#key copied}<span class="icon-swap flex">{#if copied}<Check class="size-4 text-complete" />{:else}<Copy class="size-4" />{/if}</span>{/key}
            </button>
          </div>
        {/if}
      </div>
    {/key}
  </div>

  <footer class="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-2 tv:px-5 tv:py-3">
    <button class="{BUTTON} text-ink-muted hover:text-ink disabled:opacity-0" disabled={tour.step === 0} onclick={() => move(-1)}><ArrowLeft class="size-4" />{TEXT.back}</button>
    <button class="{BUTTON} bg-accent font-semibold text-accent-ink hover:bg-accent-hover" {@attach (node) => node.focus()} onclick={() => move(1)}>
      {last ? TEXT.finish : TEXT.next}{#if !last}<ArrowRight class="size-4" />{/if}
    </button>
  </footer>
</div>
