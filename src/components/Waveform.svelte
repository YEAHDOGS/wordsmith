<script>
  // The big waveform: a recording's loudness drawn as bars, with a time ruler and the playhead. Press or drag on it to
  // scrub (one finger on touch screens), pinch or Ctrl/Cmd + wheel to zoom around the pointer, wheel or swipe to scroll
  // sideways, and drag the overview strip under it to move through a long recording. As a slider it takes the keys:
  // arrows step 1 s (5 s with Shift), Page Up/Down 15 s, Home/End, + and - zoom, 0 fits, Space plays.
  // While recording it scrolls with the newest audio. View and drawing live in waveform-view.js.
  import { onDestroy } from 'svelte';
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import ZoomOut from '@lucide/svelte/icons/zoom-out';
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import { WaveformView, ZOOM_STEP, clock } from './waveform-view.js';
  import TEXT from './recorder.json';

  /**
   * @type {{ peaks: Float32Array, count: number, perSecond: number, version: number, duration: number, position: number,
   *   live: boolean, playing: boolean, onseek: (seconds: number) => void, ontoggle: () => void, onscrub?: (active: boolean) => void }}
   */
  let { peaks, count, perSecond, version, duration, position, live, playing, onseek, ontoggle, onscrub = () => {} } = $props();

  const STEP_SECONDS = 1;
  const BIG_STEP_SECONDS = 5;
  const PAGE_SECONDS = 15;
  const ZOOM_BUTTON = 'spring press flex size-7 items-center justify-center border border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-40 tv:size-10';
  const PINCH_POINTERS = 2;
  // Zoomed all the way out once the view is within this much of the whole recording (s).
  const FULL_EPSILON = 0.01;

  const view = new WaveformView();
  /** @type {HTMLCanvasElement | undefined} */
  let main = $state();
  /** @type {HTMLCanvasElement | undefined} */
  let overview = $state();
  // Mirrors of the view for the buttons and the slider's reading, refreshed each frame.
  let span = $state(view.span);
  let fullSpan = $state(view.fullSpan);
  let scrubbing = $state(false);
  /** Pointers down on the main canvas, for pinching. @type {Map<number, number>} */
  const pointers = new Map();
  let pinchFrom = 0;
  let overviewX = -1;

  view.onframe = () => {
    span = view.span;
    fullSpan = view.fullSpan;
  };

  $effect(() => {
    view.main = main ?? null;
    view.overview = overview ?? null;
    view.update({ peaks, count, perSecond, duration, position, live, playing });
    // Redraw on new peaks too, which arrive in place.
    version;
  });

  // Redraw at the new size when the panel resizes (rotation, sidebar, window).
  $effect(() => {
    if (!main) return;
    const observer = new ResizeObserver(() => view.invalidate());
    observer.observe(main);
    return () => observer.disconnect();
  });

  onDestroy(() => view.destroy());

  /** @param {PointerEvent} event */
  function down(event) {
    if (live || !duration) return;
    /** @type {HTMLElement} */ (event.currentTarget).setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, event.offsetX);
    if (pointers.size === PINCH_POINTERS) {
      const [a, b] = [...pointers.values()];
      pinchFrom = Math.abs(a - b);
      scrubbing = false;
      onscrub(false);
      return;
    }
    scrubbing = true;
    onscrub(true);
    onseek(view.timeAt(event.offsetX));
  }

  /** @param {PointerEvent} event */
  function move(event) {
    view.hover = event.pointerType === 'mouse' ? event.offsetX : -1;
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, event.offsetX);
    if (pointers.size === PINCH_POINTERS && pinchFrom) {
      const [a, b] = [...pointers.values()];
      const distance = Math.abs(a - b);
      if (distance) view.zoom(distance / pinchFrom, view.timeAt((a + b) / 2));
      pinchFrom = distance;
      return;
    }
    if (scrubbing) onseek(view.timeAt(event.offsetX));
    else view.invalidate();
  }

  /** @param {PointerEvent} event */
  function up(event) {
    pointers.delete(event.pointerId);
    if (pointers.size < PINCH_POINTERS) pinchFrom = 0;
    if (!pointers.size && scrubbing) {
      scrubbing = false;
      onscrub(false);
    }
  }

  function leave() {
    view.hover = -1;
    view.invalidate();
  }

  /** @param {WheelEvent} event */
  function wheel(event) {
    if (!duration || live) return;
    event.preventDefault();
    view.wheel(event);
  }

  /** The overview: press outside the window to jump the view there; drag to slide it. @param {PointerEvent} event */
  function overviewDown(event) {
    if (live || !duration) return;
    /** @type {HTMLElement} */ (event.currentTarget).setPointerCapture(event.pointerId);
    const width = overview?.clientWidth || 1;
    const time = (event.offsetX / width) * view.fullSpan;
    if (time < view.start || time > view.start + view.span) view.center(time);
    overviewX = event.offsetX;
  }

  /** @param {PointerEvent} event */
  function overviewMove(event) {
    if (overviewX < 0) return;
    const width = overview?.clientWidth || 1;
    view.pan(((event.offsetX - overviewX) / width) * view.fullSpan);
    overviewX = event.offsetX;
  }

  /** @param {KeyboardEvent} event */
  function key(event) {
    if (!duration || live) return;
    const step = event.shiftKey ? BIG_STEP_SECONDS : STEP_SECONDS;
    /** @type {Record<string, () => void>} */
    const keys = {
      ArrowLeft: () => onseek(position - step),
      ArrowRight: () => onseek(position + step),
      PageDown: () => onseek(position - PAGE_SECONDS),
      PageUp: () => onseek(position + PAGE_SECONDS),
      Home: () => onseek(0),
      End: () => onseek(duration),
      '+': () => view.zoom(ZOOM_STEP),
      '=': () => view.zoom(ZOOM_STEP),
      '-': () => view.zoom(1 / ZOOM_STEP),
      '0': () => view.fit(),
      ' ': ontoggle,
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
    // A step that lands outside the view brings it along.
    if (event.key.startsWith('Arrow') || event.key.startsWith('Page') || event.key === 'Home' || event.key === 'End') queueMicrotask(() => {
      if (position < view.start || position > view.start + view.span) view.center(position);
    });
  }
</script>

<div class="relative flex min-h-0 min-w-0 flex-1 flex-col gap-px">
  <canvas bind:this={main} class="block min-h-0 w-full flex-1 touch-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent {live || !duration ? 'cursor-default' : scrubbing ? 'cursor-grabbing' : 'cursor-text'}"
    tabindex={duration && !live ? 0 : -1} role="slider" aria-label={TEXT.waveform} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(live ? duration : position)}
    aria-valuetext={TEXT.at.replace('{at}', clock(live ? duration : position)).replace('{total}', clock(duration))}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onpointerleave={leave} onwheel={wheel} onkeydown={key}></canvas>
  <canvas bind:this={overview} class="block h-5 w-full shrink-0 touch-none select-none short:h-3 tv:h-8 {live || !duration ? '' : 'cursor-grab'}" aria-hidden="true"
    onpointerdown={overviewDown} onpointermove={overviewMove} onpointerup={() => (overviewX = -1)} onpointercancel={() => (overviewX = -1)}></canvas>
  {#if duration && !live}
    <div class="absolute top-5 right-1 flex gap-px short:hidden tv:top-7">
      <button class={ZOOM_BUTTON} aria-label={TEXT.zoomOut} title={TEXT.zoomOut} disabled={span >= fullSpan - FULL_EPSILON} onclick={() => view.zoom(1 / ZOOM_STEP)}><ZoomOut class="size-3.5 tv:size-5" /></button>
      <button class={ZOOM_BUTTON} aria-label={TEXT.zoomIn} title={TEXT.zoomIn} onclick={() => view.zoom(ZOOM_STEP)}><ZoomIn class="size-3.5 tv:size-5" /></button>
      <button class={ZOOM_BUTTON} aria-label={TEXT.fit} title={TEXT.fit} disabled={span >= fullSpan - FULL_EPSILON} onclick={() => view.fit()}><Maximize2 class="size-3.5 tv:size-5" /></button>
    </div>
  {/if}
</div>
