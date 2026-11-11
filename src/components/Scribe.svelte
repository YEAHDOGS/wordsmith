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
  import { speech } from '../lib/speech.svelte.js';
  import { listModels } from '../lib/scribe-llm.js';
  import { store } from '../lib/store.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import { byName } from '../lib/nav-order.js';
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
  const FLIP_MS = 200;

  const projects = $derived(byName(store.projects));
  const status = $derived(scribe.thinking ? TEXT.thinking : scribe.listening ? (speech.phase === 'loading' ? TEXT.loadingSpeech : TEXT.listening) : scribe.engine ? TEXT.idle : TEXT.idleNoMic);
  // Which engine hears you: a model on this device (desktop apps), or the browser's recognition.
  const engineNote = $derived(scribe.engine === 'local' ? TEXT.engineLocal.replace('{model}', speech.model?.name ?? '') : scribe.engine === 'browser' ? TEXT.engineBrowser : '');
  const problem = $derived.by(() => {
    if (!scribe.problem) return '';
    if (scribe.problem === 'model' && !scribe.ready) return TEXT.problems['model-setup'];
    if (scribe.problem === 'model' && scribe.detail === 'timeout') return TEXT.problems.timeout;
    return TEXT.problems[/** @type {'mic-denied' | 'mic' | 'speech' | 'model'} */ (scribe.problem)].replace('{detail}', scribe.detail);
  });
  // A request the browser refused outright (server down, or the server not allowing this site) has no status to show.
  const blocked = $derived(scribe.problem === 'model' && scribe.ready && /failed to fetch|networkerror|load failed/i.test(scribe.detail));

  // The panel opens by itself until a model is set.
  let showSettings = $state(!scribe.ready);
  let typed = $state('');
  /** @type {string[]} */
  let models = $state([]);
  let finding = $state(false);
  let findNote = $state('');
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
    scribe.hear(typed);
    typed = '';
  }

  async function findModels() {
    finding = true;
    findNote = '';
    try {
      models = await listModels(scribe.settings.endpoint);
      findNote = TEXT.found.replace('{count}', String(models.length));
      if (!scribe.settings.model && models.length) scribe.configure({ model: models[0] });
    } catch (error) {
      models = [];
      findNote = `${/** @type {Error} */ (error).message}. ${TEXT.problems.cors}`;
    }
    finding = false;
  }
</script>

{#snippet settings()}
  <label class={LABEL}>{TEXT.project}
    <select class={FIELD} value={scribe.settings.projectId} onchange={(event) => scribe.configure({ projectId: event.currentTarget.value })}>
      <option value="">{TEXT.noProject}</option>
      {#each projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}
    </select>
  </label>
  <label class={LABEL}>{TEXT.endpoint}
    <input class="{FIELD} font-mono" type="url" value={scribe.settings.endpoint} spellcheck="false" autocomplete="off" oninput={(event) => scribe.configure({ endpoint: event.currentTarget.value })} />
  </label>
  <p class="text-xs leading-relaxed text-ink-faint short:hidden">{TEXT.endpointHint}</p>
  <div class="flex items-end gap-1">
    <label class="{LABEL} min-w-0 flex-1">{TEXT.model}
      {#if models.length}
        <select class={FIELD} value={scribe.settings.model} onchange={(event) => scribe.configure({ model: event.currentTarget.value })}>
          {#each models as model (model)}<option value={model}>{model}</option>{/each}
        </select>
      {:else}
        <input class="{FIELD} font-mono" value={scribe.settings.model} placeholder={TEXT.modelPlaceholder} spellcheck="false" autocomplete="off" oninput={(event) => scribe.configure({ model: event.currentTarget.value })} />
      {/if}
    </label>
    <button class="{SMALL_BUTTON} min-h-9 shrink-0" disabled={finding || !scribe.settings.endpoint.trim()} onclick={findModels}>{finding ? TEXT.finding : TEXT.find}</button>
  </div>
  {#if findNote}<p class="text-xs leading-relaxed text-ink-muted" role="status" in:fade>{findNote}</p>{/if}
  <!-- Fixed height for the engine line, so finding a local model after start-up doesn't move what's under it -->
  <p class="flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-ink-muted">
    <span class="min-w-0 truncate">{engineNote}</span>
    {#if speech.available}<button class="spring press shrink-0 font-semibold text-accent hover:text-accent-hover" onclick={() => router.go('settings')}>{TEXT.speechSettings}</button>{/if}
  </p>
  <p class="text-xs leading-relaxed text-ink-faint">{scribe.engine === 'local' ? TEXT.privacyLocal : TEXT.privacy}</p>
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
    </button>
    <div class="relative flex min-w-0 flex-col items-center gap-2 bg-app px-2 short:items-start">
      <p class="flex items-center gap-2 text-center text-fluid-sm text-ink-muted" role="status">
        {#if scribe.thinking}<span class="live-dot size-2 shrink-0 rounded-full bg-progress" aria-hidden="true"></span>{/if}
        {#key status}<span in:fade={{ duration: 150 }}>{status}</span>{/key}
        <span class="border border-line px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-widest text-accent">{TEXT.beta}</span>
      </p>
      <form class="flex w-full max-w-md gap-px sm:w-96" onsubmit={send}>
        <input class="{FIELD} min-w-0 flex-1" bind:value={typed} placeholder={TEXT.typePlaceholder} aria-label={TEXT.typePlaceholder} />
        <button type="submit" class="{SMALL_BUTTON} min-h-9" disabled={!typed.trim()} aria-label={TEXT.send}><Send class="size-4" /></button>
        <button type="button" class="{SMALL_BUTTON} min-h-9 xl:hidden {showSettings ? 'border-accent text-ink' : ''}" aria-label={TEXT.settings} aria-pressed={showSettings} onclick={() => (showSettings = !showSettings)}><Settings2 class="size-4" /></button>
      </form>
    </div>
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
          <p class="mb-2 border-l-2 pl-3 text-fluid-sm leading-relaxed transition-colors duration-300 {line.handled ? 'border-complete text-ink-muted' : 'border-progress text-ink'}" in:fly={ROW_IN}>{line.text}</p>
        {/each}
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
