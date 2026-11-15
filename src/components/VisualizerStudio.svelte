<script>
  // The video studio, opened from Export → Video on the Scribe page's recording band (loaded only then). A live
  // preview of the recording with an animated WebGL visualizer, and the choices beside it: the scene, the shape
  // (16:9, 1:1, 9:16 or 1080p), a title and subtitle drawn on the video, a background image or video of your own,
  // the glow color and the wordsmith mark. Record plays the recording through once and saves it as MP4 (WebM where
  // the browser can't make MP4). State, drawing and recording live in visualizer-studio.svelte.js.
  // Layout: preview above the choices on phones held upright; side by side on phones on their side and from laptops up.
  import { onDestroy, onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import X from '@lucide/svelte/icons/x';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import Circle from '@lucide/svelte/icons/circle';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Segmented from './Segmented.svelte';
  import { FORMATS, Studio } from './visualizer-studio.svelte.js';
  import { clock } from './waveform-view.js';
  import { recorder } from '../lib/recorder.svelte.js';
  import { scribe } from '../lib/scribe.svelte.js';
  import { store } from '../lib/store.svelte.js';
  import TEXT from './visualizer.json';

  /** @type {{ onclose: () => void }} */
  let { onclose } = $props();

  const PERCENT = 100;
  const LABEL = 'font-mono text-[0.6875rem] uppercase tracking-widest text-ink-faint tv:text-sm';
  const FIELD = 'w-full border border-line bg-app px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none tv:text-lg';
  const SMALL_BUTTON = 'spring press inline-flex min-h-9 items-center justify-center gap-1.5 border border-line bg-surface px-2 text-xs text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-40 tv:min-h-12 tv:text-lg';
  const PANEL_IN = { y: 24, duration: 260, easing: quintOut };
  const FORMAT_IDS = /** @type {(keyof typeof FORMATS)[]} */ (Object.keys(FORMATS));
  // Longest title and subtitle: about what fits across a 9:16 frame.
  const MAX_TITLE = 80;
  const MAX_SUBTITLE = 120;
  const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm';

  const studio = new Studio();
  const project = store.find('projects', scribe.settings.projectId);
  studio.title = project && !project.deleted_at ? project.name : '';
  /** @type {HTMLDialogElement | undefined} */
  let dialog = $state();
  /** @type {HTMLCanvasElement | undefined} */
  let canvas = $state();
  /** @type {HTMLInputElement | undefined} */
  let fileInput = $state();
  const recording = $derived(studio.status === 'recording');
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--ws-accent').trim();

  onMount(() => {
    dialog?.showModal();
    if (canvas) studio.attach(canvas);
  });

  onDestroy(() => {
    studio.destroy();
    recorder.pause();
  });

  function close() {
    if (recording) studio.cancel();
    dialog?.close();
  }

  /** @param {Event} event */
  function cancelKey(event) {
    // Escape mid-recording cancels the recording first; a second Escape closes.
    if (!recording) return;
    event.preventDefault();
    studio.cancel();
  }

  /** @param {Event & { currentTarget: HTMLInputElement }} event */
  function pick(event) {
    const file = event.currentTarget.files?.[0];
    if (file) studio.setBackground(file);
    event.currentTarget.value = '';
  }
</script>

<dialog bind:this={dialog} aria-label={TEXT.title} onclose={onclose} oncancel={cancelKey}
  class="m-auto h-[calc(100dvh-1rem)] max-h-none w-[min(76rem,calc(100vw-1rem))] max-w-none bg-transparent p-0 text-ink backdrop:bg-scrim md:h-[min(52rem,calc(100dvh-2rem))] tv:w-[min(110rem,calc(100vw-4rem))] tv:h-[calc(100dvh-4rem)]">
  <div class="flex h-full flex-col border border-line-strong bg-surface" in:fly={PANEL_IN}>
    <header class="flex shrink-0 items-center gap-2 border-b border-line py-1 pr-1 pl-4">
      <h2 class="min-w-0 flex-1 truncate text-fluid-base font-bold">{TEXT.title}</h2>
      <button class="spring press flex size-9 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink tv:size-12" onclick={close} aria-label={TEXT.close} title={TEXT.close}>
        <X class="size-4 tv:size-6" />
      </button>
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-px bg-line short:flex-row lg:flex-row">
      <!-- Preview: the canvas that gets recorded, scaled to fit -->
      <section class="relative flex min-h-0 basis-2/5 flex-col bg-app short:basis-auto short:flex-1 lg:flex-1" aria-label={TEXT.preview}>
        <div class="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4">
          <canvas bind:this={canvas} class="block max-h-full max-w-full border border-line shadow-lg" aria-label={TEXT.preview}></canvas>
        </div>
        {#if studio.problem === 'webgl'}
          <p class="absolute inset-0 flex items-center justify-center p-6 text-center text-fluid-sm text-ink-muted" role="alert">{TEXT.problems.webgl}</p>
        {/if}
        <div class="flex shrink-0 items-center gap-2 border-t border-line px-2 py-1">
          <button class="{SMALL_BUTTON} min-w-9 border-transparent {recorder.playing ? 'text-accent' : 'text-ink'}" disabled={recording} aria-label={recorder.playing ? TEXT.pause : TEXT.play} title={recorder.playing ? TEXT.pause : TEXT.play} onclick={() => recorder.toggle()}>
            {#if recorder.playing}<Pause class="size-4 tv:size-6" />{:else}<Play class="size-4 tv:size-6" />{/if}
          </button>
          <span class="font-mono text-xs text-ink-muted tabular-nums tv:text-lg">{clock(recorder.position)} / {clock(recorder.duration)}</span>
          <input class="min-w-0 flex-1 accent-accent" type="range" min="0" max={recorder.duration} step="0.1" value={recorder.position} disabled={recording} aria-label={TEXT.preview}
            oninput={(event) => recorder.seek(Number(event.currentTarget.value))} />
        </div>
      </section>

      <!-- Choices: only this column scrolls; Record stays pinned under it -->
      <section class="flex min-h-0 flex-1 flex-col bg-surface short:w-72 short:flex-none lg:w-96 lg:flex-none tv:lg:w-[34rem]">
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3 sm:p-4">
          <fieldset class="flex flex-col gap-2" disabled={recording}>
            <legend class="{LABEL} mb-2">{TEXT.scene}</legend>
            <div class="grid grid-cols-2 gap-px border border-line bg-line">
              {#each studio.scenes as scene (scene)}
                {@const words = TEXT.scenes[scene]}
                <button class="spring press group relative flex min-w-0 flex-col items-start gap-1 bg-surface p-2 text-left hover:bg-surface-raised {studio.scene === scene ? 'outline-2 -outline-offset-2 outline-accent' : ''}"
                  aria-pressed={studio.scene === scene} onclick={() => studio.setScene(scene)}>
                  <span class="block h-8 w-full transition-transform duration-150 ease-spring group-hover:scale-y-110 tv:h-14" aria-hidden="true"
                    style:background="linear-gradient(135deg, var(--ws-viz-{scene}-a) 0%, var(--ws-viz-{scene}-b) 55%, var(--ws-viz-{scene}-c) 100%)"></span>
                  <span class="text-sm text-ink tv:text-xl">{words.name}</span>
                  <span class="text-[0.6875rem] leading-snug text-ink-faint tv:text-base">{words.note}</span>
                </button>
              {/each}
            </div>
          </fieldset>

          <div class="flex flex-col gap-2">
            <span class={LABEL}>{TEXT.shape}</span>
            <Segmented options={FORMAT_IDS} value={studio.format} labels={TEXT.formats} label={TEXT.shape} onselect={(format) => studio.setFormat(format)} />
          </div>

          <fieldset class="flex flex-col gap-2">
            <legend class="{LABEL} mb-2">{TEXT.words}</legend>
            <input class={FIELD} bind:value={studio.title} placeholder={TEXT.videoTitle} aria-label={TEXT.videoTitle} maxlength={MAX_TITLE} />
            <input class={FIELD} bind:value={studio.subtitle} placeholder={TEXT.videoSubtitle} aria-label={TEXT.videoSubtitle} maxlength={MAX_SUBTITLE} />
            <label class="flex items-center gap-2 text-sm text-ink-muted tv:text-lg">
              <input type="checkbox" class="size-4 accent-accent" checked={studio.mark} onchange={(event) => studio.setMark(event.currentTarget.checked)} />{TEXT.mark}
            </label>
          </fieldset>

          <div class="flex flex-col gap-2">
            <span class={LABEL}>{TEXT.background}</span>
            <div class="flex min-w-0 items-center gap-2">
              <button class="{SMALL_BUTTON} shrink-0" disabled={recording} onclick={() => fileInput?.click()}><ImagePlus class="size-4" />{TEXT.pickBackground}</button>
              <span class="min-w-0 flex-1 truncate text-xs text-ink-faint">{studio.backgroundName || TEXT.noBackground}</span>
              {#if studio.backgroundName}
                <button class="spring press shrink-0 p-1 text-ink-faint hover:text-ink" aria-label={TEXT.clearBackground} title={TEXT.clearBackground} disabled={recording} onclick={() => studio.clearBackground()} in:fade={{ duration: 120 }}><X class="size-4" /></button>
              {/if}
            </div>
            <input bind:this={fileInput} type="file" accept={ACCEPT} class="hidden" onchange={pick} />
          </div>

          <div class="flex flex-col gap-2">
            <span class={LABEL}>{TEXT.glow}</span>
            <div class="flex items-center gap-2">
              <input type="color" class="h-9 w-14 cursor-pointer border border-line bg-app p-0.5" value={studio.glow || accent} aria-label={TEXT.glow} oninput={(event) => studio.setGlow(event.currentTarget.value)} />
              <button class={SMALL_BUTTON} disabled={!studio.glow} onclick={() => studio.setGlow('')}><RotateCcw class="size-3.5" />{TEXT.glowTheme}</button>
            </div>
          </div>
        </div>

        <footer class="flex shrink-0 flex-col gap-2 border-t border-line p-3 sm:p-4">
          {#if !studio.type}
            <p class="text-xs leading-relaxed text-ink-muted" role="alert">{TEXT.unsupported}</p>
          {:else}
            {#if studio.problem === 'record'}<p class="text-xs text-accent" role="alert">{TEXT.problems.record.replace('{detail}', studio.detail)}</p>{/if}
            {#if recording}
              <div class="flex items-center gap-2" in:fade={{ duration: 150 }}>
                <div class="relative h-11 min-w-0 flex-1 overflow-hidden border border-accent bg-app tv:h-16">
                  <span class="absolute inset-y-0 left-0 w-full origin-left bg-accent-soft" style:transform="scaleX({studio.progress})" aria-hidden="true"></span>
                  <span class="relative flex h-full items-center gap-2 px-3 font-mono text-sm text-ink tabular-nums tv:text-xl" role="status">
                    <span class="live-dot size-2 rounded-full bg-accent" aria-hidden="true"></span>{TEXT.recording.replace('{percent}', String(Math.round(studio.progress * PERCENT)))}
                  </span>
                </div>
                <button class="{SMALL_BUTTON} min-h-11 tv:min-h-16" onclick={() => studio.cancel()}>{TEXT.cancel}</button>
              </div>
            {:else}
              <button class="spring press flex min-h-11 w-full items-center justify-center gap-2 bg-accent px-4 text-sm font-bold text-accent-ink hover:bg-accent-hover disabled:opacity-40 tv:min-h-16 tv:text-xl"
                disabled={!recorder.hasAudio || studio.problem === 'webgl'} onclick={() => studio.record()} in:fade={{ duration: 150 }}>
                <Circle class="size-4 fill-current tv:size-6" />{TEXT.record.replace('{format}', studio.type.mp4 ? 'MP4' : 'WebM')}
              </button>
            {/if}
            <p class="text-[0.6875rem] leading-relaxed text-ink-faint tv:text-base">
              {TEXT.realtime.replace('{length}', clock(recorder.duration))}{studio.type.mp4 ? '' : ` ${TEXT.webm}`}
            </p>
          {/if}
        </footer>
      </section>
    </div>
  </div>
</dialog>
