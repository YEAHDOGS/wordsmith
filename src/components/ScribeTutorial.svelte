<script>
  // Scribe's first-run tutorial: four short steps, each a card beside a spotlit part of the screen (the project
  // picker, the mic, then Settings twice), with one giant button to move on. Shown the first time Scribe opens with a
  // project to use; finishing or skipping it (button, Skip, or Escape) records it in D1 (src/lib/tutorials.svelte.js),
  // so it never shows again for this account on any device. The spotlight glides from one target to the next
  // (transform), the card follows, and its words slide in. Placement lives in scribe-tutorial.js.
  import { onDestroy, onMount, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Check from '@lucide/svelte/icons/check';
  import { place, targetBox } from './scribe-tutorial.js';
  import { tutorials } from '../lib/tutorials.svelte.js';
  import TEXT from './scribe-tutorial.json';

  /** @type {{ onclose: () => void }} */
  let { onclose } = $props();

  const TUTORIAL = 'scribe';
  const STEPS = TEXT.steps;
  const CARD_IN = { y: 18, duration: 320, easing: backOut };
  const TEXT_IN = { x: 28, duration: 260, easing: quintOut };
  const TEXT_OUT = { x: -28, duration: 140 };

  let step = $state(0);
  /** @type {import('./scribe-tutorial.js').Box | null} */
  let spot = $state(null);
  let cardAt = $state({ x: 0, y: 0 });
  /** @type {HTMLElement | undefined} */
  let card = $state();
  /** @type {HTMLButtonElement | undefined} */
  let next = $state();
  let frame = 0;
  const last = $derived(step === STEPS.length - 1);

  // Follows the target every frame: the page may still be settling, scrolling, or resizing under the tutorial.
  function follow() {
    const box = targetBox(STEPS[step].target);
    const size = { width: card?.offsetWidth ?? 0, height: card?.offsetHeight ?? 0 };
    const placed = place(box, size);
    spot = placed.spot;
    cardAt = placed.card;
    frame = requestAnimationFrame(follow);
  }

  onMount(() => {
    frame = requestAnimationFrame(follow);
    tick().then(() => next?.focus());
  });

  onDestroy(() => cancelAnimationFrame(frame));

  function finish() {
    tutorials.markSeen(TUTORIAL);
    onclose();
  }

  function advance() {
    if (last) return finish();
    step++;
    next?.focus();
  }

  /** @param {KeyboardEvent} event */
  function key(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    finish();
  }
</script>

<svelte:window onkeydown={key} />

<div class="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="scribe-tutorial-text" transition:fade={{ duration: 180 }}>
  <!-- The spotlight: a clear box over the target whose shadow dims everything else. Without a target, plain dimming. -->
  {#if spot}
    <div class="pointer-events-none absolute top-0 left-0 border-2 border-accent transition-[transform,width,height] duration-300 ease-spring"
      style:transform="translate({spot.x}px, {spot.y}px)" style:width="{spot.width}px" style:height="{spot.height}px"
      style:box-shadow="0 0 0 200vmax var(--ws-scrim)" aria-hidden="true">
      <span class="live-dot absolute inset-0 border border-accent"></span>
    </div>
  {:else}
    <div class="absolute inset-0 bg-scrim" aria-hidden="true"></div>
  {/if}
  <!-- Presses outside the card do nothing, so the page can't be changed mid-tutorial -->
  <div class="absolute inset-0" aria-hidden="true"></div>

  <section bind:this={card} class="absolute top-0 left-0 flex w-[min(24rem,calc(100vw-1rem))] flex-col gap-4 border border-line-strong bg-surface p-4 shadow-2xl transition-transform duration-300 ease-spring short:gap-2 short:p-3 tv:w-[40rem] tv:gap-6 tv:p-8"
    style:transform="translate({cardAt.x}px, {cardAt.y}px)" in:fly={CARD_IN}>
    <div class="flex items-center justify-between gap-3">
      <ol class="flex gap-1.5" aria-label={TEXT.step.replace('{step}', String(step + 1)).replace('{total}', String(STEPS.length))}>
        {#each STEPS as _, index (index)}
          <li class="h-1 w-6 origin-left transition-[transform,background-color] duration-300 ease-spring tv:h-2 tv:w-10 {index <= step ? 'bg-accent' : 'scale-x-50 bg-line-strong'}"></li>
        {/each}
      </ol>
      <span class="font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint tv:text-sm">{TEXT.step.replace('{step}', String(step + 1)).replace('{total}', String(STEPS.length))}</span>
    </div>

    <!-- Every step's words sit invisibly in one grid cell, so the card keeps the tallest one's height and never jumps -->
    <div class="grid overflow-hidden">
      {#each STEPS as { text }, index (index)}
        <p class="invisible col-start-1 row-start-1 text-fluid-lg leading-snug font-bold tv:text-5xl" aria-hidden="true">{text}</p>
      {/each}
      {#key step}
        <p id="scribe-tutorial-text" class="col-start-1 row-start-1 text-fluid-lg leading-snug font-bold text-ink tv:text-5xl" in:fly={TEXT_IN} out:fly={TEXT_OUT}>{STEPS[step].text}</p>
      {/key}
    </div>

    <button bind:this={next} class="spring press group flex min-h-16 w-full items-center justify-center gap-3 bg-accent px-6 text-fluid-lg font-bold text-accent-ink hover:bg-accent-hover short:min-h-12 tv:min-h-28 tv:text-4xl" onclick={advance}>
      {last ? TEXT.done : TEXT.next}
      <span class="flex transition-transform duration-150 ease-spring group-hover:translate-x-1">
        {#if last}<Check class="size-6 tv:size-10" />{:else}<ArrowRight class="size-6 tv:size-10" />{/if}
      </span>
    </button>
    <!-- Kept on the last step too (hidden), so the card's height holds -->
    <button class="spring press -mt-2 self-center px-2 py-1 text-xs text-ink-faint underline-offset-4 hover:text-ink hover:underline short:-mt-1 tv:text-lg {last ? 'invisible' : ''}" tabindex={last ? -1 : 0} onclick={finish}>{TEXT.skip}</button>
  </section>
</div>
