<script>
  // Scribe (beta): the page for the live speech-to-tickets session in src/lib/scribe.svelte.js. One mic button on the
  // spine starts and stops it. Under it, what you said (words still being heard are dimmed) beside what Scribe did
  // with it, each ticket openable and undoable. Model settings sit in a third column on wide screens and in a panel
  // that floats over the page below that, so opening it never moves the columns. Only the two lists scroll.
  import { tick } from 'svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { backOut, quintOut } from 'svelte/easing';
  import Mic from '@lucide/svelte/icons/mic';
  import Square from '@lucide/svelte/icons/square';
  import Send from '@lucide/svelte/icons/send';
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Eraser from '@lucide/svelte/icons/eraser';
  import X from '@lucide/svelte/icons/x';
  import { scribe } from '../lib/scribe.svelte.js';
  import ScribeSettings from './ScribeSettings.svelte';
  import { speech } from '../lib/speech.svelte.js';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { clockTime } from '../lib/time.js';
  import TEXT from './scribe.json';

  const FIELD = 'w-full border border-line bg-app px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none tv:text-lg';
  const LABEL = 'flex flex-col gap-1 font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint tv:text-sm';
  const HEADING = 'shrink-0 border-b border-line px-3 py-2 font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint sm:px-4 tv:text-sm';
  const SMALL_BUTTON = 'spring press inline-flex min-h-8 items-center justify-center gap-1.5 border border-line bg-surface px-2 text-xs text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-40 tv:min-h-12 tv:text-lg';
  const ROW_IN = { y: 8, duration: 220, easing: quintOut };
  const PANEL_IN = { y: 16, duration: 200, easing: quintOut };
  const PANEL_OUT = { y: 16, duration: 120 };
  const POP = { start: 0.7, duration: 200, easing: backOut };
  const ANNOUNCE_IN = { y: -10, duration: 240, easing: backOut };
  const ANNOUNCE_OUT = { duration: 180 };
  const FLIP_MS = 200;

  const status = $derived(scribe.thinking ? TEXT.thinking : scribe.listening ? (speech.phase === 'loading' ? TEXT.loadingSpeech : TEXT.listening) : scribe.engine ? TEXT.idle : TEXT.idleNoMic);
  const problem = $derived.by(() => {
    if (!scribe.problem) return '';
    if (scribe.problem === 'model' && !scribe.ready) return TEXT.problems['model-setup'];
    if (scribe.problem === 'model' && scribe.detail === 'timeout') return TEXT.problems.timeout;
    return TEXT.problems[/** @type {'mic-denied' | 'mic' | 'speech' | 'model' | 'allowance'} */ (scribe.problem)].replace('{detail}', scribe.detail);
  });
  // A request the browser refused outright (server down, or the server not allowing this site) has no status to show.
  const blocked = $derived(scribe.problem === 'model' && scribe.ready && /failed to fetch|networkerror|load failed/i.test(scribe.detail));

  // The panel opens by itself until a model is set. A model server already running on this machine is found and
  // set without asking, and the panel closes again.
  let showSettings = $state(!scribe.ready);
  let typed = $state('');
  let detected = $state('');
  scribe.detect().then((found) => {
    if (!found) return;
    showSettings = false;
    detected = TEXT.detected.replace('{model}', scribe.settings.model);
  });
  /** @type {HTMLElement | undefined} */
  let transcriptBox = $state();

  // Keep the newest words in view.
  $effect(() => {
    scribe.transcript.length;
    scribe.interim;
    tick().then(() => transcriptBox?.scrollTo({ top: transcriptBox.scrollHeight }));
  });

  /** @param {SubmitEvent} event */
  function send(event) {
    event.preventDefault();
    scribe.hear(typed, true);
    typed = '';
  }
</script>

{#snippet settings()}
  <ScribeSettings field={FIELD} label={LABEL} button={SMALL_BUTTON} />
  {#if detected}<p class="text-xs leading-relaxed text-ink-muted" role="status" in:fade>{detected}</p>{/if}
{/snippet}

<div class="relative flex min-h-0 flex-1 flex-col">
  <!-- The mic sits on the spine: one line the page hangs from -->
  <section class="relative flex shrink-0 flex-col items-center gap-2 border-b border-line px-3 py-4 short:flex-row short:justify-center short:gap-4 short:py-2 sm:py-6">
    <div class="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-line short:hidden" aria-hidden="true"></div>
    <button class="spring press relative flex size-20 shrink-0 items-center justify-center border-2 short:size-12 tv:size-28 {scribe.listening ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong bg-surface text-ink hover:border-accent hover:text-accent'} disabled:opacity-40"
      aria-label={scribe.listening ? TEXT.stop : TEXT.start} aria-pressed={scribe.listening} disabled={!scribe.engine} onclick={() => scribe.toggle()}>
      {#if scribe.listening}
        <span class="live-dot pointer-events-none absolute inset-0 border border-accent" aria-hidden="true"></span>
        <span in:scale={POP}><Square class="size-7 short:size-5 tv:size-10" /></span>
      {:else}
        <span in:scale={POP}><Mic class="size-8 short:size-5 tv:size-12" /></span>
      {/if}
      <!-- How many tickets this session wrote; pops each time it grows -->
      {#if scribe.made}
        {#key scribe.made}
          <span class="absolute -top-2 -right-2 flex min-w-6 items-center justify-center border border-complete bg-app px-1 font-mono text-xs text-complete tv:min-w-9 tv:text-lg" title={TEXT.made.replace('{count}', String(scribe.made))} in:scale={POP}>{scribe.made}</span>
        {/key}
      {/if}
    </button>
    <div class="relative flex min-w-0 flex-col items-center gap-2 bg-app px-2 short:items-start">
      <p class="flex items-center gap-2 text-center text-fluid-sm text-ink-muted" role="status">
        {#if scribe.thinking}<span class="live-dot size-2 shrink-0 rounded-full bg-progress" aria-hidden="true"></span>{/if}
        {#key status}<span in:fade={{ duration: 150 }}>{status}</span>{/key}
        <span class="border border-line px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-widest text-accent">{TEXT.beta}</span>
      </p>
      <!-- Your words, live, right under the stop button. Two lines are always kept for them, so nothing moves as they come and go. -->
      <p class="h-[2.75em] w-full max-w-md overflow-hidden text-center text-fluid-sm leading-snug text-ink short:hidden sm:w-96" aria-hidden="true">
        {#if scribe.listening || scribe.interim}{scribe.interim ? scribe.caption.slice(0, scribe.caption.length - scribe.interim.length) : scribe.caption}<span class="text-ink-faint">{scribe.interim ? scribe.caption.slice(-scribe.interim.length) : ''}</span>{/if}
      </p>
      <form class="flex w-full max-w-md gap-px sm:w-96" onsubmit={send}>
        <input class="{FIELD} min-w-0 flex-1" bind:value={typed} placeholder={TEXT.typePlaceholder} aria-label={TEXT.typePlaceholder} />
        <button type="submit" class="{SMALL_BUTTON} min-h-9" disabled={!typed.trim()} aria-label={TEXT.send}><Send class="size-4" /></button>
        <button type="button" class="{SMALL_BUTTON} min-h-9 xl:hidden {showSettings ? 'border-accent text-ink' : ''}" aria-label={TEXT.settings} aria-pressed={showSettings} onclick={() => (showSettings = !showSettings)}><Settings2 class="size-4" /></button>
      </form>
    </div>
    <!-- Tickets the moment they are written: they float over the lists below the mic, so nothing shifts, and open on a tap -->
    <ol class="pointer-events-none absolute inset-x-0 top-full z-20 flex flex-col items-center gap-1 px-3 pt-2" aria-live="polite">
      {#each scribe.recent as entry (entry.id)}
        <li class="pointer-events-auto w-full max-w-md" in:fly={ANNOUNCE_IN} out:fade={ANNOUNCE_OUT} animate:flip={{ duration: FLIP_MS }}>
          <button class="spring press flex w-full items-center gap-2 border bg-surface px-3 py-2 text-left shadow-lg {entry.kind === 'created' ? 'border-complete' : 'border-progress'}" onclick={() => router.openNote(entry.noteId)}>
            <span class="shrink-0 font-mono text-[0.6875rem] uppercase tracking-wider {entry.kind === 'created' ? 'text-complete' : 'text-progress'} tv:text-sm">{TEXT[entry.kind]}</span>
            <span class="min-w-0 flex-1 truncate text-sm text-ink tv:text-xl">{store.find('notes', entry.noteId)?.title || entry.title || TEXT.untitled}</span>
          </button>
        </li>
      {/each}
    </ol>
  </section>

  {#if problem}
    <div class="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-accent bg-accent-soft px-3 py-2 text-center text-fluid-sm text-ink" role="alert" transition:fade={{ duration: 150 }}>
      <span>{problem}{blocked ? ` ${TEXT.problems.cors}` : ''}</span>
      {#if scribe.problem === 'model' && scribe.ready}<button class={SMALL_BUTTON} onclick={() => scribe.retry()}><RotateCcw class="size-3.5" />{TEXT.retry}</button>{/if}
    </div>
  {/if}

  <!-- Stacked on phones held upright; side by side from tablets up and on any short screen (a phone on its side) -->
  <div class="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-px bg-line short:grid-cols-2 short:grid-rows-1 md:grid-cols-2 md:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem] tv:xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28rem]">
    <section class="flex min-h-0 flex-col bg-app" aria-label={TEXT.transcript}>
      <h2 class={HEADING}>{TEXT.transcript}</h2>
      <div bind:this={transcriptBox} class="selectable min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
        {#if !scribe.transcript.length && !scribe.interim}
          <p class="text-fluid-sm leading-relaxed text-ink-faint">{TEXT.transcriptEmpty}</p>
        {/if}
        {#each scribe.transcript as line (line.id)}
          <p class="mb-2 border-l-2 pl-3 text-fluid-sm leading-relaxed transition-colors duration-300 {line.skipped ? 'border-line text-ink-faint italic' : line.handled ? 'border-complete text-ink-muted' : 'border-progress text-ink'}" in:fly={ROW_IN}>{line.text}</p>
        {/each}
        <!-- Speech the work check kept on this device: said so once, with a way to send it after all -->
        {#if scribe.skipped}
          <div class="mb-2 flex flex-wrap items-center gap-2 pl-3.5 text-xs text-ink-faint tv:text-lg" in:fade={{ duration: 150 }}>
            <span>{TEXT.skipped}</span>
            <button class={SMALL_BUTTON} onclick={() => scribe.sendSkipped()}><Send class="size-3.5" />{TEXT.sendSkipped}</button>
          </div>
        {/if}
        {#if scribe.interim}<p class="border-l-2 border-line pl-3 text-fluid-sm leading-relaxed text-ink-faint" aria-hidden="true">{scribe.interim}</p>{/if}
      </div>
    </section>

    <section class="flex min-h-0 flex-col bg-app" aria-label={TEXT.activity}>
      <h2 class="{HEADING} flex items-center justify-between">
        {TEXT.activity}
        <button class="spring press -my-1 flex items-center gap-1 p-1 normal-case tracking-normal hover:text-ink disabled:opacity-40" disabled={!scribe.log.length && !scribe.transcript.length} aria-label={TEXT.clear} title={TEXT.clear} onclick={() => scribe.clear()}><Eraser class="size-3.5" /><span class="max-sm:hidden">{TEXT.clear}</span></button>
      </h2>
      <ul class="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-live="polite">
        {#each scribe.log as entry (entry.id)}
          <li class="flex items-center gap-2 border-b border-line px-3 py-2 sm:px-4" animate:flip={{ duration: FLIP_MS }} in:fly={ROW_IN}>
            <span class="w-16 shrink-0 font-mono text-[0.6875rem] uppercase tracking-wider {entry.kind === 'created' ? 'text-complete' : 'text-progress'} tv:w-24 tv:text-sm">{TEXT[entry.kind]}</span>
            <button class="min-w-0 flex-1 truncate text-left text-sm hover:text-accent tv:text-xl {entry.undone ? 'text-ink-faint line-through' : 'text-ink'}" disabled={entry.undone && entry.kind === 'created'} onclick={() => router.openNote(entry.noteId)}>
              {store.find('notes', entry.noteId)?.title || entry.title || TEXT.untitled}
            </button>
            <span class="hidden shrink-0 font-mono text-[0.6875rem] text-ink-faint sm:block">{clockTime(entry.at)}</span>
            <button class="{SMALL_BUTTON} shrink-0" disabled={entry.undone} onclick={() => scribe.undo(entry.id)}>{entry.undone ? TEXT.undone : TEXT.undo}</button>
          </li>
        {:else}
          <li class="px-3 py-3 text-fluid-sm leading-relaxed text-ink-faint sm:px-4">{TEXT.activityEmpty}</li>
        {/each}
      </ul>
    </section>

    <section class="hidden min-h-0 flex-col gap-3 overflow-y-auto bg-app p-4 xl:flex" aria-label={TEXT.settings}>
      <h2 class="font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint tv:text-sm">{TEXT.settings}</h2>
      {@render settings()}
    </section>
  </div>

  {#if showSettings}
    <aside class="absolute inset-x-0 bottom-0 z-30 flex max-h-[70%] flex-col gap-3 overflow-y-auto overscroll-contain border-t border-line-strong bg-surface p-3 short:max-h-full sm:inset-x-auto sm:right-2 sm:bottom-2 sm:w-80 sm:border xl:hidden"
      aria-label={TEXT.settings} in:fly={PANEL_IN} out:fly={PANEL_OUT}>
      <header class="flex items-center justify-between">
        <h2 class="font-mono text-xs uppercase tracking-widest text-ink-muted">{TEXT.settings}</h2>
        <button class="spring press -m-1 p-1 text-ink-faint hover:text-ink" aria-label="Close" onclick={() => (showSettings = false)}><X class="size-4" /></button>
      </header>
      {@render settings()}
    </aside>
  {/if}
</div>
