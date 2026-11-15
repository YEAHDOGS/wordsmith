<script>
  // The recording band on the Scribe page, between the mic and the lists: the big waveform (Waveform.svelte), and one
  // row of controls under it: back to start, back 5 s, play, forward 5 s, the time, the speed, then Export (MP3, WAV,
  // or a video with a visualizer, VisualizerStudio.svelte, loaded on first use), the Save-to-Tapes switch (each
  // session becomes a tape when Scribe stops: src/lib/scribe-tapes.svelte.js), Discard and the record switch. Its height is fixed per screen size, so recording, stopping and playing never move the lists below.
  // On narrow screens the buttons drop their labels; on short screens (phones on their side) the band shrinks.
  import { fade, fly, scale } from 'svelte/transition';
  import { backOut, quintOut } from 'svelte/easing';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import SkipBack from '@lucide/svelte/icons/skip-back';
  import Rewind from '@lucide/svelte/icons/rewind';
  import FastForward from '@lucide/svelte/icons/fast-forward';
  import Download from '@lucide/svelte/icons/download';
  import CassetteTape from '@lucide/svelte/icons/cassette-tape';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Clapperboard from '@lucide/svelte/icons/clapperboard';
  import FileAudio from '@lucide/svelte/icons/file-audio';
  import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
  import X from '@lucide/svelte/icons/x';
  import Waveform from './Waveform.svelte';
  import { clock } from './waveform-view.js';
  import { recorderExports } from './recorder-exports.svelte.js';
  import { PEAKS_PER_SECOND, SPEEDS, recorder } from '../lib/recorder.svelte.js';
  import { auth } from '../lib/auth.svelte.js';
  import { scribeTapes } from '../lib/scribe-tapes.svelte.js';
  import { router } from '../lib/router.svelte.js';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import TEXT from './recorder.json';

  const SKIP_SECONDS = 5;
  // A Discard press waits this long for the second press that confirms it.
  const CONFIRM_MS = 3_000;
  // A "saved to Tapes" note stays this long.
  const TAPES_NOTE_MS = 6_000;
  const PERCENT = 100;
  const BUTTON = 'spring press inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 bg-surface px-2 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40 short:min-h-8 tv:min-h-14 tv:min-w-14 tv:text-lg';
  const ICON = 'size-4 tv:size-6';
  const MENU_IN = { y: -6, duration: 160, easing: quintOut };
  const POP = { start: 0.6, duration: 180, easing: backOut };

  let menuOpen = $state(false);
  let confirming = $state(false);
  let studioOpen = $state(false);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let confirmTimer;
  // Playing again after a scrub, if it was playing when the scrub began.
  let resumeAfterScrub = false;

  const ready = $derived(recorder.hasAudio && !recorder.recording);
  const problem = $derived(recorder.problem ? TEXT.problems[/** @type {'mic-denied' | 'mic' | 'limit'} */ (recorder.problem)] : '');
  // How the last session's tape is doing; a saved note fades after a while, a failure stays until Retry.
  let tapesNoteHidden = $state(false);
  $effect(() => {
    if (scribeTapes.status !== 'saved') {
      tapesNoteHidden = false;
      return;
    }
    const timer = setTimeout(() => (tapesNoteHidden = true), TAPES_NOTE_MS);
    return () => clearTimeout(timer);
  });
  const tapesNote = $derived(
    scribeTapes.status === 'saving' ? TEXT.tapesSaving.replace('{percent}', String(Math.round(scribeTapes.progress * PERCENT)))
      : scribeTapes.status === 'failed' ? TEXT.tapesFailed.replace('{detail}', scribeTapes.error === 'offline' ? TEXT.tapesOffline : scribeTapes.error)
        : scribeTapes.status === 'saved' && !tapesNoteHidden ? TEXT.tapesSaved : '');
  const loadStudio = () => import('./VisualizerStudio.svelte');

  /** @param {boolean} active */
  function scrub(active) {
    if (active) {
      resumeAfterScrub = recorder.playing;
      recorder.pause();
    } else if (resumeAfterScrub) recorder.play();
  }

  function discard() {
    if (!confirming) {
      confirming = true;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirming = false), CONFIRM_MS);
      return;
    }
    confirming = false;
    recorder.discard();
  }

  /** @param {() => void} run */
  function choose(run) {
    menuOpen = false;
    run();
  }

  /** Closes the menu on a press outside it or Escape. @param {HTMLElement} node */
  function dismiss(node) {
    const outside = (/** @type {PointerEvent} */ event) => !node.contains(/** @type {Node} */ (event.target)) && (menuOpen = false);
    const escape = (/** @type {KeyboardEvent} */ event) => event.key === 'Escape' && (menuOpen = false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }
</script>

<section class="relative flex shrink-0 flex-col border-b border-line bg-app" aria-label={TEXT.title}>
  <div class="relative flex h-28 min-w-0 short:h-16 sm:h-36 tv:h-60">
    <Waveform peaks={recorder.peaks} count={recorder.peakCount} perSecond={PEAKS_PER_SECOND} version={recorder.peaksVersion} duration={recorder.duration}
      position={recorder.position} live={recorder.recording} playing={recorder.playing}
      onseek={(seconds) => recorder.seek(seconds)} ontoggle={() => recorder.toggle()} onscrub={scrub} />
    {#if !recorder.duration && !recorder.recording}
      <p class="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 px-4 text-center text-fluid-sm text-ink-faint" transition:fade={{ duration: 150 }}>
        <AudioWaveform class="size-5 shrink-0 short:hidden" />{recorder.enabled ? TEXT.empty : TEXT.off}
      </p>
    {/if}
    {#if recorder.recording}
      <span class="pointer-events-none absolute top-5 left-2 flex items-center gap-1.5 border border-accent bg-app px-1.5 py-0.5 font-mono text-[0.6875rem] uppercase tracking-widest text-accent tv:top-7 tv:text-sm" transition:scale={POP}>
        <span class="live-dot size-1.5 rounded-full bg-accent" aria-hidden="true"></span>{TEXT.recording} {clock(recorder.duration)}
      </span>
    {/if}
  </div>

  {#if problem || recorderExports.note || tapesNote}
    {@const bad = Boolean(problem) || (!problem && recorderExports.note ? recorderExports.failed : scribeTapes.status === 'failed')}
    <div class="absolute inset-x-0 top-full z-20 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-center text-xs text-ink {bad ? 'border-accent bg-accent-soft' : scribeTapes.status === 'saving' && !problem && !recorderExports.note ? 'border-progress bg-progress-soft' : 'border-complete bg-complete-soft'}" role="status" transition:fade={{ duration: 150 }}>
      <span>{problem || recorderExports.note || tapesNote}</span>
      {#if !problem && !recorderExports.note && scribeTapes.status === 'failed'}
        <button class="spring press inline-flex items-center gap-1 underline-offset-4 hover:underline" onclick={() => scribeTapes.retry()}><RotateCcw class="size-3" />{TEXT.retry}</button>
      {:else if !problem && !recorderExports.note && scribeTapes.status === 'saved'}
        <button class="spring press underline-offset-4 hover:underline" onclick={() => router.go('tapes')}>{TEXT.tapesOpen}</button>
      {/if}
    </div>
  {/if}

  <div class="flex min-w-0 items-center gap-px border-t border-line bg-line">
    <button class={BUTTON} aria-label={TEXT.toStart} title={TEXT.toStart} disabled={!ready} onclick={() => recorder.seek(0)}><SkipBack class={ICON} /></button>
    <button class={BUTTON} aria-label={TEXT.back} title={TEXT.back} disabled={!ready} onclick={() => recorder.skip(-SKIP_SECONDS)}><Rewind class={ICON} /></button>
    <button class="{BUTTON} min-w-12 {recorder.playing ? 'text-accent' : 'text-ink'}" aria-label={recorder.playing ? TEXT.pause : TEXT.play} title={recorder.playing ? TEXT.pause : TEXT.play} disabled={!ready} onclick={() => recorder.toggle()}>
      {#key recorder.playing}<span class="flex" in:scale={POP}>{#if recorder.playing}<Pause class={ICON} />{:else}<Play class={ICON} />{/if}</span>{/key}
    </button>
    <button class={BUTTON} aria-label={TEXT.forward} title={TEXT.forward} disabled={!ready} onclick={() => recorder.skip(SKIP_SECONDS)}><FastForward class={ICON} /></button>
    <span class="flex min-h-9 shrink-0 items-center bg-surface px-2 font-mono text-xs text-ink-muted tabular-nums short:min-h-8 tv:min-h-14 tv:text-lg">
      <span class="text-ink">{clock(recorder.recording ? recorder.duration : recorder.position, ready)}</span><span class="max-sm:hidden">&nbsp;/ {clock(recorder.duration)}</span>
    </span>
    <label class="flex min-h-9 shrink-0 items-center bg-surface px-1 short:min-h-8 max-sm:hidden tv:min-h-14">
      <span class="sr-only">{TEXT.speed}</span>
      <select class="bg-surface font-mono text-xs text-ink-muted focus:outline-none disabled:opacity-40 tv:text-lg" value={recorder.speed} disabled={!ready} onchange={(event) => recorder.setSpeed(Number(event.currentTarget.value))}>
        {#each SPEEDS as speed (speed)}<option value={speed}>{speed}×</option>{/each}
      </select>
    </label>
    <span class="min-h-9 min-w-0 flex-1 self-stretch bg-surface short:min-h-8"></span>

    {#if recorderExports.busy}
      <span class="relative flex min-h-9 shrink-0 items-center gap-2 overflow-hidden bg-surface px-2 text-xs text-ink-muted short:min-h-8 tv:min-h-14 tv:text-lg" role="status" in:fade={{ duration: 120 }}>
        <span class="absolute inset-y-0 left-0 w-full origin-left bg-accent-soft transition-transform duration-150" style:transform="scaleX({recorderExports.progress})" aria-hidden="true"></span>
        <span class="relative font-mono tabular-nums">{TEXT.saving.replace('{percent}', String(recorderExports.percent))}</span>
        <button class="relative spring press p-0.5 hover:text-ink" aria-label={TEXT.cancel} title={TEXT.cancel} onclick={() => recorderExports.cancel()}><X class="size-3.5" /></button>
      </span>
    {/if}

    <div class="relative flex shrink-0" {@attach dismiss}>
      <button class={BUTTON} aria-haspopup="menu" aria-expanded={menuOpen} disabled={!ready || Boolean(recorderExports.busy)} onclick={() => (menuOpen = !menuOpen)}>
        <Download class={ICON} /><span class="max-md:hidden">{TEXT.export}</span>
      </button>
      {#if menuOpen}
        <ul class="absolute top-full right-0 z-40 mt-px flex w-60 flex-col gap-px border border-line-strong bg-line shadow-lg tv:w-96" role="menu" in:fly={MENU_IN} out:fade={{ duration: 100 }}>
          {#each [{ id: 'mp3', icon: FileAudio, run: () => recorderExports.mp3() }, { id: 'wav', icon: FileAudio, run: () => recorderExports.wav() }, { id: 'video', icon: Clapperboard, run: () => (studioOpen = true) }] as option (option.id)}
            <li role="none">
              <button class="spring flex w-full items-center gap-3 bg-surface px-3 py-2 text-left hover:bg-surface-raised" role="menuitem" onclick={() => choose(option.run)}>
                <option.icon class="size-4 shrink-0 text-accent tv:size-6" />
                <span class="flex min-w-0 flex-col">
                  <span class="text-sm text-ink tv:text-xl">{TEXT[/** @type {'mp3' | 'wav' | 'video'} */ (option.id)]}</span>
                  <span class="text-xs text-ink-faint tv:text-base">{TEXT[/** @type {'mp3Note' | 'wavNote' | 'videoNote'} */ (`${option.id}Note`)]}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    {#if !auth.demo}
      <button class="{BUTTON} {scribeTapes.enabled ? 'text-accent' : ''}" role="switch" aria-checked={scribeTapes.enabled} aria-label={TEXT.tapes} title={TEXT.tapes} onclick={() => scribeTapes.setEnabled(!scribeTapes.enabled)}>
        <CassetteTape class={ICON} /><span class="max-lg:hidden">{TEXT.tapes}</span>
      </button>
    {/if}
    <button class="{BUTTON} {confirming ? 'bg-accent text-accent-ink hover:bg-accent-hover hover:text-accent-ink' : ''}" aria-label={confirming ? TEXT.discardConfirm : TEXT.discard} title={confirming ? TEXT.discardConfirm : TEXT.discard}
      disabled={!recorder.duration || recorder.recording} onclick={discard}>
      <Trash2 class={ICON} />
    </button>
    <button class="{BUTTON} {recorder.enabled ? 'text-accent' : ''}" role="switch" aria-checked={recorder.enabled} aria-label={TEXT.record} title={TEXT.record} onclick={() => recorder.setEnabled(!recorder.enabled)}>
      <span class="relative flex h-4 w-7 items-center border {recorder.enabled ? 'border-accent bg-accent-soft' : 'border-line-strong'} tv:h-6 tv:w-11" aria-hidden="true">
        <span class="absolute left-0.5 size-2.5 transition-transform duration-150 ease-spring tv:size-4 {recorder.enabled ? 'translate-x-3 bg-accent tv:translate-x-5' : 'bg-ink-faint'}"></span>
      </span>
      <span class="max-md:hidden">{TEXT.record}</span>
    </button>
  </div>
</section>

{#if studioOpen}
  {#await loadStudio() then { default: Studio }}
    <Studio onclose={() => (studioOpen = false)} />
  {/await}
{/if}
