<script>
  // Settings → Speech: the local speech models (state in src/lib/speech.svelte.js). Pick from every model the engine
  // runs, grouped by family: download, select, delete. Beside the list: where the model runs, how long it stays in
  // memory, the language, custom words, and a mic to try it. Only the model list scrolls. In a browser, and on phones
  // for now, the card only says where local speech is available.
  import Search from '@lucide/svelte/icons/search';
  import Download from '@lucide/svelte/icons/download';
  import Check from '@lucide/svelte/icons/check';
  import Trash from '@lucide/svelte/icons/trash';
  import X from '@lucide/svelte/icons/x';
  import Mic from '@lucide/svelte/icons/mic';
  import Square from '@lucide/svelte/icons/square';
  import Plus from '@lucide/svelte/icons/plus';
  import { onDestroy } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { backOut } from 'svelte/easing';
  import Segmented from './Segmented.svelte';
  import { ACCELERATIONS, DEFAULT_MODEL, MAX_WORDS, UNLOAD_OPTIONS, speech } from '../lib/speech.svelte.js';
  import { listen } from '../lib/listen.js';
  import { BOX, HEADING, HINT, SUBHEADING } from './settings-styles.js';
  import TEXT from './speech.json';

  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  const PERCENT = 100;
  const MAX_WORD_LENGTH = 40;
  const FLIP_MS = 160;
  const FADE_MS = 150;
  const POP = { start: 0.7, duration: 180, easing: backOut };
  const UNLOADS = UNLOAD_OPTIONS.map(String);
  const FIELD = 'w-full min-w-0 border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none';
  const ROW_BUTTON = 'spring press flex h-8 shrink-0 items-center justify-center gap-1.5 border border-line-strong px-2.5 text-xs text-ink hover:border-accent disabled:opacity-40 tv:h-11 tv:text-base';
  const BADGE = 'shrink-0 border border-line px-1 font-mono text-[0.625rem] uppercase tracking-wider text-ink-muted tv:text-xs';
  const languageNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(undefined, { type: 'language' }) : null;

  let query = $state('');
  let onlyDownloaded = $state(false);
  let word = $state('');
  // The try-it strip: its own short listening session, separate from Scribe's.
  let testing = $state(false);
  let heard = $state('');
  let interim = $state('');
  let problem = $state('');
  /** @type {{ stop: () => void } | null} */
  let session = null;

  speech.init();
  onDestroy(() => session?.stop());

  const models = $derived(speech.catalog?.models ?? []);
  const shown = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return models.filter((model) => (!onlyDownloaded || speech.has(model))
      && (!needle || `${model.name} ${model.id} ${TEXT.families[/** @type {keyof typeof TEXT.families} */ (model.family)] ?? model.family}`.toLowerCase().includes(needle)));
  });
  // Models grouped by family, in catalog order (family A-Z, smallest first).
  const groups = $derived.by(() => {
    /** @type {Map<string, import('../lib/speech.svelte.js').SpeechModel[]>} */
    const byFamily = new Map();
    for (const model of shown) byFamily.set(model.family, [...(byFamily.get(model.family) ?? []), model]);
    return [...byFamily].map(([family, list]) => ({ family, list }));
  });
  const selected = $derived(speech.model);
  const downloading = $derived(Boolean(speech.download && !speech.download.error));
  const testStatus = $derived(!speech.usable ? TEXT.testNeedsModel : !testing ? TEXT.testIdle : speech.phase === 'loading' ? TEXT.testLoading : TEXT.testListening);

  /** @param {number} bytes */
  const size = (bytes) => (bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / MB)} MB`);

  /** @param {import('../lib/speech.svelte.js').SpeechModel} model */
  function languagesLabel(model) {
    if (model.languages.length === 1) return model.languages[0].toUpperCase();
    return model.languages.length ? TEXT.languages.replace('{count}', String(model.languages.length)) : '';
  }

  /** @param {SubmitEvent} event */
  function addWord(event) {
    event.preventDefault();
    const next = word.trim().slice(0, MAX_WORD_LENGTH);
    word = '';
    if (!next || speech.settings.words.includes(next) || speech.settings.words.length >= MAX_WORDS) return;
    speech.configure({ words: [...speech.settings.words, next] });
  }

  function toggleTest() {
    if (testing) return session?.stop();
    testing = true;
    heard = '';
    interim = '';
    problem = '';
    session = listen({
      onInterim: (text) => (interim = text),
      onFinal: (text) => {
        interim = '';
        heard = `${heard} ${text}`.trim();
      },
      onProblem: (kind, detail) => (problem = TEXT.problems[kind].replace('{detail}', detail)),
      onEnd: () => {
        testing = false;
        interim = '';
        session = null;
      },
    });
  }
</script>

<h2 class={HEADING}>{TEXT.title}</h2>
{#if !speech.available}
  <!-- Nothing until the app has checked for the engine, so the desktop apps never flash this note -->
  {#if speech.checked}<p class="{HINT} mb-0" in:fade={{ duration: FADE_MS }}>{TEXT.unavailable}</p>{/if}
{:else}
  <p class={HINT}>{TEXT.hint}</p>
  <div class="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-8">
    <div class="min-w-0">
      <p class={SUBHEADING}>{TEXT.models}</p>
      <div class="mb-2 flex gap-2">
        <label class="relative flex min-w-0 flex-1 items-center">
          <Search class="pointer-events-none absolute left-3 size-4 text-ink-faint" />
          <input bind:value={query} type="search" placeholder={TEXT.search} aria-label={TEXT.search} class="{FIELD} pl-9" />
        </label>
        <button class="{ROW_BUTTON} h-auto {onlyDownloaded ? 'border-accent bg-accent-soft' : ''}" aria-pressed={onlyDownloaded} onclick={() => (onlyDownloaded = !onlyDownloaded)}>{TEXT.onlyDownloaded}</button>
      </div>
      <!-- The one scrolling list on this card; a fixed height, so filtering never resizes the card -->
      <ul class="{BOX} h-80 overflow-x-hidden overflow-y-auto overscroll-contain short:h-48 tv:h-[32rem]" aria-label={TEXT.models}>
        {#each groups as group (group.family)}
          <li animate:flip={{ duration: FLIP_MS }}>
            <p class="sticky top-0 z-10 border-b border-line bg-surface-raised px-3 py-1 font-mono text-[0.6875rem] uppercase tracking-widest text-ink-muted tv:text-sm">{TEXT.families[/** @type {keyof typeof TEXT.families} */ (group.family)] ?? group.family}</p>
            <ul>
              {#each group.list as model (model.id)}
                {@const here = speech.has(model)}
                {@const inUse = here && selected?.id === model.id}
                {@const progress = speech.download?.id === model.id ? speech.download : null}
                <li class="relative flex min-h-12 items-center gap-2 border-b border-line px-3 py-1.5 {inUse ? 'bg-accent-soft' : ''}" animate:flip={{ duration: FLIP_MS }}>
                  <div class="min-w-0 flex-1">
                    <p class="flex min-w-0 items-center gap-1.5 text-sm tv:text-lg">
                      <span class="truncate {inUse ? 'font-semibold' : ''}">{model.name}</span>
                      {#if model.streaming}<span class="{BADGE} border-progress text-progress" title={TEXT.liveHint}>{TEXT.live}</span>{/if}
                      {#if model.id === DEFAULT_MODEL}<span class="{BADGE} border-accent text-accent max-sm:hidden">{TEXT.recommended}</span>{/if}
                    </p>
                    <p class="truncate font-mono text-[0.6875rem] text-ink-faint tv:text-sm">
                      {#if progress?.error}
                        <span class="text-accent" role="alert">{TEXT.failed.replace('{detail}', progress.error)}</span>
                      {:else}
                        {size(model.size)}{languagesLabel(model) ? ` · ${languagesLabel(model)}` : ''}{model.license ? ` · ${model.license}` : ''}
                      {/if}
                    </p>
                  </div>
                  {#if progress && !progress.error}
                    <span class="shrink-0 font-mono text-xs text-ink-muted" aria-live="polite">{TEXT.downloading.replace('{percent}', String(Math.floor((progress.received / progress.size) * PERCENT)))}</span>
                    <button class={ROW_BUTTON} onclick={() => speech.cancelInstall()}><X class="size-3.5" />{TEXT.cancel}</button>
                    <!-- Progress along the row's bottom edge: transform only -->
                    <span class="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent transition-transform duration-200" style:transform="scaleX({progress.received / progress.size})" aria-hidden="true"></span>
                  {:else if inUse}
                    <span class="flex shrink-0 items-center gap-1 text-xs font-semibold text-accent" in:scale={POP}><Check class="size-4" />{TEXT.selected}</span>
                    <button class="{ROW_BUTTON} w-8 px-0 hover:text-accent" aria-label={TEXT.delete.replace('{model}', model.name)} title={TEXT.delete.replace('{model}', model.name)} disabled={speech.phase !== 'idle'} onclick={() => speech.remove(model)}><Trash class="size-3.5" /></button>
                  {:else if here}
                    <button class={ROW_BUTTON} aria-label={TEXT.select.replace('{model}', model.name)} disabled={speech.phase !== 'idle'} onclick={() => speech.configure({ modelId: model.id })}>{TEXT.select.replace('{model}', '').trim()}</button>
                    <button class="{ROW_BUTTON} w-8 px-0 hover:text-accent" aria-label={TEXT.delete.replace('{model}', model.name)} title={TEXT.delete.replace('{model}', model.name)} onclick={() => speech.remove(model)}><Trash class="size-3.5" /></button>
                  {:else}
                    <button class={ROW_BUTTON} disabled={downloading} onclick={() => speech.install(model)}><Download class="size-3.5" />{TEXT.download}</button>
                  {/if}
                </li>
              {/each}
            </ul>
          </li>
        {:else}
          <li class="px-3 py-6 text-center text-sm text-ink-faint">{onlyDownloaded && !query.trim() ? TEXT.noneDownloaded : TEXT.none}</li>
        {/each}
      </ul>
    </div>

    <div class="grid min-w-0 content-start gap-5">
      <div>
        <p class={SUBHEADING}>{TEXT.test}</p>
        <div class="{BOX} flex items-start gap-3 p-3">
          <button class="spring press relative flex size-11 shrink-0 items-center justify-center border-2 disabled:opacity-40 tv:size-16 {testing ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong bg-app text-ink hover:border-accent hover:text-accent'}"
            aria-label={testing ? TEXT.testStop : TEXT.testStart} aria-pressed={testing} disabled={!speech.usable} onclick={toggleTest}>
            {#if testing}
              <span class="live-dot pointer-events-none absolute inset-0 border border-accent" aria-hidden="true"></span>
              <span in:scale={POP}><Square class="size-4" /></span>
            {:else}
              <span in:scale={POP}><Mic class="size-5" /></span>
            {/if}
          </button>
          <!-- Fixed height: words arriving never move the options underneath -->
          <div class="selectable h-16 min-w-0 flex-1 overflow-y-auto overscroll-contain text-sm leading-relaxed tv:h-24 tv:text-lg" aria-live="polite">
            {#if problem}
              <p class="text-accent" role="alert">{problem}</p>
            {:else if heard || interim}
              <p>{heard} <span class="text-ink-faint">{interim}</span></p>
            {:else}
              {#key testStatus}<p class="text-ink-faint" in:fade={{ duration: FADE_MS }}>{testStatus}</p>{/key}
            {/if}
          </div>
        </div>
      </div>

      <div>
        <p class={SUBHEADING}>{TEXT.acceleration}</p>
        <Segmented options={ACCELERATIONS} value={speech.settings.acceleration} labels={TEXT.accelerations} label={TEXT.acceleration} onselect={(acceleration) => speech.configure({ acceleration })} />
        <p class="mt-2 text-xs text-ink-faint">{speech.backend ? TEXT.accelerationHint.replace('{backend}', speech.backend.toUpperCase()) : TEXT.accelerationHintIdle}</p>
      </div>

      <div>
        <p class={SUBHEADING}>{TEXT.unload}</p>
        <Segmented options={UNLOADS} value={String(speech.settings.unloadMinutes)} labels={TEXT.unloads} label={TEXT.unload} onselect={(minutes) => speech.configure({ unloadMinutes: Number(minutes) })} />
        <p class="mt-2 text-xs text-ink-faint">{TEXT.unloadHint}</p>
      </div>

      {#if selected && selected.languages.length > 1}
        <label class="block" transition:fade={{ duration: FADE_MS }}>
          <span class="{SUBHEADING} block">{TEXT.language}</span>
          <select class={FIELD} value={selected.languages.includes(speech.settings.language) ? speech.settings.language : ''} onchange={(event) => speech.configure({ language: event.currentTarget.value })}>
            <option value="">{TEXT.languageAuto}</option>
            {#each selected.languages as code (code)}<option value={code}>{languageNames?.of(code) ?? code} ({code})</option>{/each}
          </select>
        </label>
      {/if}

      <div>
        <p class={SUBHEADING}>{TEXT.words}</p>
        <form class="flex gap-2" onsubmit={addWord}>
          <input bind:value={word} maxlength={MAX_WORD_LENGTH} placeholder={TEXT.wordPlaceholder} aria-label={TEXT.words} class={FIELD} autocomplete="off" spellcheck="false" />
          <button class="{ROW_BUTTON} h-auto" disabled={!word.trim() || speech.settings.words.length >= MAX_WORDS}><Plus class="size-3.5" />{TEXT.addWord}</button>
        </form>
        {#if speech.settings.words.length}
          <ul class="mt-2 flex flex-wrap gap-1.5">
            {#each speech.settings.words as entry (entry)}
              <li class="flex items-center border border-line bg-surface text-xs tv:text-base" animate:flip={{ duration: FLIP_MS }} in:scale={POP} out:fade={{ duration: FADE_MS }}>
                <span class="max-w-40 truncate py-1 pl-2">{entry}</span>
                <button class="spring press p-1.5 text-ink-faint hover:text-accent" aria-label={TEXT.removeWord.replace('{word}', entry)} onclick={() => speech.configure({ words: speech.settings.words.filter((other) => other !== entry) })}><X class="size-3" /></button>
              </li>
            {/each}
          </ul>
        {/if}
        <p class="mt-2 text-xs text-ink-faint">{TEXT.wordsHint}</p>
      </div>
    </div>
  </div>
{/if}
