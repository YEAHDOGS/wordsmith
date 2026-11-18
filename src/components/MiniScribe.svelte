<script>
  // Mini Scribe: the whole window while it is folded into a strip that stays on top of other apps (desktop apps only,
  // src/lib/mini-scribe.svelte.js). The mic on the left; beside it what Scribe is doing, then your newest words, a
  // ticket it just wrote, or what went wrong; the arrow on the right unfolds the window again. Hold the words to move
  // the strip around the screen.
  import { onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import Mic from '@lucide/svelte/icons/mic';
  import Square from '@lucide/svelte/icons/square';
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import { scribe } from '../lib/scribe.svelte.js';
  import { speech } from '../lib/speech.svelte.js';
  import { mini } from '../lib/mini-scribe.svelte.js';
  import TEXT from './scribe.json';

  // Two short lines fit beside the mic: the newest words this long, at most.
  const CAPTION_CHARS = 90;
  const POP = { start: 0.7, duration: 200, easing: backOut };
  const SWAP = { duration: 150 };

  const status = $derived(scribe.thinking ? TEXT.thinking : scribe.listening ? (speech.phase === 'loading' ? TEXT.loadingSpeech : TEXT.listening) : TEXT.miniIdle);
  const ticket = $derived(scribe.recent[0]);
  const caption = $derived(scribe.caption.length > CAPTION_CHARS ? `…${scribe.caption.slice(-CAPTION_CHARS)}` : scribe.caption);
  // Problems get one short line here; the full text waits on the Scribe page.
  const problem = $derived.by(() => {
    if (!scribe.problem) return '';
    if (scribe.problem === 'model' && !scribe.ready) return TEXT.miniProblems['model-setup'];
    return TEXT.miniProblems[/** @type {'mic-denied' | 'mic' | 'speech' | 'model' | 'allowance'} */ (scribe.problem)];
  });

  // Spoken once per ticket or problem; the caption itself changes with every word, so it is never announced.
  const announcement = $derived(problem || (ticket ? `${TEXT[ticket.kind]}: ${ticket.title || TEXT.untitled}` : ''));

  /** @type {HTMLButtonElement | undefined} */
  let micButton = $state();
  /** @type {HTMLButtonElement | undefined} */
  let unfoldButton = $state();

  // Keyboard focus moves into the strip (the rest of the app is inert behind it); mini.exit() hands it back. A mic
  // with no speech engine is disabled and can't hold focus, so the unfold button takes it then.
  onMount(() => (scribe.engine ? micButton : unfoldButton)?.focus());

  /**
   * Escape unfolds the window. Caught on the way down and stopped there, so the hidden app's own Escape handlers
   * (clearing a selection, closing a drawer) never see it.
   * @param {KeyboardEvent} event
   */
  function onkeydowncapture(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    mini.exit();
  }
</script>

<svelte:window {onkeydowncapture} />

<div class="fixed inset-0 z-[60] flex select-none items-stretch border border-line-strong bg-surface text-ink" role="region" aria-label={TEXT.mini} in:fade={SWAP}>
  <button bind:this={micButton} class="spring press relative mx-3 flex size-16 shrink-0 self-center items-center justify-center border-2 {scribe.listening ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong bg-app text-ink hover:border-accent hover:text-accent'} disabled:opacity-40"
    aria-label={scribe.listening ? TEXT.stop : TEXT.start} aria-pressed={scribe.listening} disabled={!scribe.engine} onclick={() => scribe.toggle()}>
    {#if scribe.listening}
      <span class="live-dot pointer-events-none absolute inset-0 border border-accent" aria-hidden="true"></span>
      <span in:scale={POP}><Square class="size-6" /></span>
    {:else}
      <span in:scale={POP}><Mic class="size-7" /></span>
    {/if}
  </button>

  <!-- The strip has no title bar: holding anywhere on the words moves it -->
  <div class="flex min-w-0 flex-1 cursor-grab flex-col justify-center gap-1 py-2 pr-2 active:cursor-grabbing" role="presentation" onpointerdown={(event) => mini.drag(event)}>
    <p class="pointer-events-none flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-widest text-ink-faint" role="status">
      {#if scribe.listening || scribe.thinking}<span class="live-dot size-1.5 shrink-0 rounded-full {scribe.thinking ? 'bg-progress' : 'bg-accent'}" aria-hidden="true"></span>{/if}
      {#key status}<span class="truncate" in:fade={SWAP}>{status}</span>{/key}
      {#if scribe.made}
        <!-- Hidden from screen readers: the announcement below already says each ticket once -->
        {#key scribe.made}<span class="ml-auto shrink-0 text-complete" aria-hidden="true" title={TEXT.made.replace('{count}', String(scribe.made))} in:scale={POP}>{scribe.made}</span>{/key}
      {/if}
    </p>
    <p class="pointer-events-none line-clamp-2 text-xs leading-snug">
      {#if problem}
        <span class="text-accent" in:fade={SWAP}>{problem}</span>
      {:else if ticket}
        {#key ticket.id}<span in:fade={SWAP}><span class="font-mono uppercase tracking-wider {ticket.kind === 'created' ? 'text-complete' : 'text-progress'}">{TEXT[ticket.kind]}</span> {ticket.title || TEXT.untitled}</span>{/key}
      {:else if caption}
        <span class="text-ink-muted">{caption}</span>
      {:else}
        <span class="text-ink-faint">{TEXT.miniHint}</span>
      {/if}
    </p>
  </div>

  <p class="sr-only" aria-live="polite">{announcement}</p>

  <button bind:this={unfoldButton} class="spring press flex w-10 shrink-0 items-center justify-center border-l border-line text-ink-muted hover:bg-app hover:text-ink" aria-label={TEXT.miniClose} title={TEXT.miniClose} onclick={() => mini.exit()}>
    <Maximize2 class="size-4" />
  </button>
</div>
