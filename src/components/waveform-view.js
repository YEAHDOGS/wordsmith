// The big waveform's view and drawing (src/components/Waveform.svelte): which stretch of time is on screen, how far
// it's zoomed, and the canvas painting of bars, ruler, playhead and the overview strip under it. Zoom and scroll ease
// toward their targets frame by frame, so jumping, fitting and following the playhead glide instead of snapping.
// Colors come from the theme tokens (src/styles/theme.css), read off the canvas, so custom colors apply here too.

// Narrowest stretch the view zooms in to, and how much of the recording a live view shows.
export const MIN_SPAN = 1;
const LIVE_SPAN = 24;
// While recording, the newest audio sits this far across the view, leaving room to see it arrive.
const LIVE_EDGE = 0.92;
// How far each zoom step goes, and how far one wheel notch (100 px of delta) zooms.
export const ZOOM_STEP = 1.6;
const WHEEL_ZOOM = 0.0018;
// The view eases this fraction of the way to its target each frame (about 60 ms to settle most of the way).
const EASE = 0.28;
const SETTLED = 0.0005;
// Bars: width and gap in CSS pixels.
const BAR = 3;
const GAP = 1;
// Peaks under this loudness still draw a hairline, so silence reads as a line, not a gap.
const MIN_BAR = 0.012;
// Loud speech peaks near 0.5; this lifts quiet voices without clipping shouts (square-root curve).
const LOUDNESS_CURVE = 0.5;
// Ruler: tick steps to choose from (seconds), and the closest two ticks may sit.
const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1_800];
const MIN_TICK_PX = 72;
const RULER_PX = 18;
const TICK_PX = 5;
const LABEL_FONT = '10px ui-monospace, monospace';
const PLAYHEAD_PX = 2;
// Bars fill this much of the lane's height at full loudness, leaving a hairline above and below.
const BAR_FILL = 0.96;
// The hover time's label box, and the ruler labels' nudge right of their tick.
const LABEL_PAD = 4;
const LABEL_HEIGHT = 14;
// The overview's window over what the big view shows.
const WINDOW_ALPHA = 0.55;
const MIN_WINDOW_PX = 2;
const KNOB_PX = 5;
// When the playhead leaves the view while playing, the view pages so it sits this far in.
const FOLLOW_AT = 0.08;
const SECONDS_PER_MINUTE = 60;
const TENTHS = 10;

/** mm:ss (h:mm:ss past an hour), with tenths when asked. @param {number} seconds @param {boolean} [tenths] */
export function clock(seconds, tenths = false) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / SECONDS_PER_MINUTE);
  const whole = Math.floor(safe % SECONDS_PER_MINUTE);
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0');
  const tail = tenths ? `.${Math.floor((safe * TENTHS) % TENTHS)}` : '';
  return `${hours ? `${hours}:${pad(minutes)}` : minutes}:${pad(whole)}${tail}`;
}

/** @typedef {{ peaks: Float32Array, count: number, perSecond: number, duration: number, position: number, live: boolean, playing: boolean }} WaveInput */

export class WaveformView {
  /** Left edge (s) and visible length (s), as drawn now and as they're heading. */
  start = 0;
  span = LIVE_SPAN;
  #targetStart = 0;
  #targetSpan = LIVE_SPAN;
  /** The pointer's x over the main canvas (CSS px), or -1. */
  hover = -1;
  /** @type {WaveInput} */
  input = { peaks: new Float32Array(0), count: 0, perSecond: 1, duration: 0, position: 0, live: false, playing: false };
  /** @type {HTMLCanvasElement | null} */ main = null;
  /** @type {HTMLCanvasElement | null} */ overview = null;
  /** Called after each frame with the view, so the page can show it (aria, buttons). @type {(view: WaveformView) => void} */
  onframe = () => {};
  #frame = 0;
  #wasLive = false;

  /** Seconds at an x on the main canvas. @param {number} x CSS px */
  timeAt(x) {
    const width = this.main?.clientWidth || 1;
    return this.start + (x / width) * this.span;
  }

  /** The longest span worth showing: the whole recording. */
  get fullSpan() {
    return Math.max(MIN_SPAN, this.input.duration);
  }

  /** @param {number} start @param {number} span */
  #aim(start, span) {
    this.#targetSpan = Math.max(MIN_SPAN, Math.min(this.fullSpan, span));
    this.#targetStart = Math.max(0, Math.min(this.fullSpan - this.#targetSpan, start));
    this.invalidate();
  }

  /** Shows the whole recording. */
  fit() {
    this.#aim(0, this.fullSpan);
  }

  /** Zooms by a factor around a time (the playhead by default). @param {number} factor over 1 zooms in @param {number} [around] */
  zoom(factor, around = this.input.position) {
    const span = this.#targetSpan / factor;
    const share = this.#targetSpan ? (around - this.#targetStart) / this.#targetSpan : 0.5;
    this.#aim(around - share * span, span);
  }

  /** Scrolls by seconds. @param {number} seconds */
  pan(seconds) {
    this.#aim(this.#targetStart + seconds, this.#targetSpan);
  }

  /** Puts a time in the middle of the view. @param {number} seconds */
  center(seconds) {
    this.#aim(seconds - this.#targetSpan / 2, this.#targetSpan);
  }

  /** Wheel: scrolls sideways, or zooms around the pointer with Ctrl/Cmd (and trackpad pinches, which send ctrlKey). @param {WheelEvent} event */
  wheel(event) {
    const width = this.main?.clientWidth || 1;
    if (event.ctrlKey || event.metaKey) {
      const around = this.timeAt(event.offsetX);
      this.zoom(Math.exp(-event.deltaY * WHEEL_ZOOM), around);
      return;
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    this.pan((delta / width) * this.#targetSpan);
  }

  /** New data from the recorder: keep the live edge in view, follow the playhead, then draw. @param {WaveInput} input */
  update(input) {
    const ended = this.#wasLive && !input.live;
    const first = !this.input.duration && input.duration;
    this.input = input;
    this.#wasLive = input.live;
    if (input.live) {
      this.#targetSpan = Math.max(MIN_SPAN, Math.min(LIVE_SPAN, input.duration / LIVE_EDGE));
      this.#targetStart = Math.max(0, input.duration - this.#targetSpan * LIVE_EDGE);
    } else if (ended || first) {
      // Recording just stopped (or a recording appeared): glide out to the whole thing.
      this.fit();
    } else if (input.playing && (input.position < this.#targetStart || input.position > this.#targetStart + this.#targetSpan)) {
      this.#aim(input.position - this.#targetSpan * FOLLOW_AT, this.#targetSpan);
    } else if (this.#targetSpan > this.fullSpan || this.#targetStart + this.#targetSpan > this.fullSpan) {
      this.#aim(this.#targetStart, this.#targetSpan);
    }
    this.invalidate();
  }

  invalidate() {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      const moving = Math.abs(this.start - this.#targetStart) > SETTLED * this.span || Math.abs(this.span - this.#targetSpan) > SETTLED * this.span;
      this.start += (this.#targetStart - this.start) * (moving ? EASE : 1);
      this.span += (this.#targetSpan - this.span) * (moving ? EASE : 1);
      this.#draw();
      this.onframe(this);
      if (moving) this.invalidate();
    });
  }

  destroy() {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  /** Sizes a canvas's backing store to its CSS box at the screen's pixel ratio. @param {HTMLCanvasElement} canvas */
  #prepare(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    return { context, width: canvas.clientWidth, height: canvas.clientHeight };
  }

  /** The theme's colors, read off the canvas so custom colors apply. @param {HTMLCanvasElement} canvas */
  #colors(canvas) {
    const styles = getComputedStyle(canvas);
    const token = (/** @type {string} */ name) => styles.getPropertyValue(`--ws-${name}`).trim();
    return { accent: token('accent'), soft: token('accent-soft'), ink: token('ink'), faint: token('ink-faint'), muted: token('ink-muted'), line: token('line'), strong: token('line-strong'), font: LABEL_FONT };
  }

  /** The loudest peak between two times. @param {number} from @param {number} to */
  #peak(from, to) {
    const { peaks, count, perSecond } = this.input;
    const first = Math.max(0, Math.floor(from * perSecond));
    const last = Math.min(count, Math.max(first + 1, Math.ceil(to * perSecond)));
    let loud = 0;
    for (let index = first; index < last; index++) if (peaks[index] > loud) loud = peaks[index];
    return loud;
  }

  /**
   * Mirrored bars across a width, each the loudest peak in its slice of [from, from + span].
   * @param {CanvasRenderingContext2D} context @param {number} width @param {number} top @param {number} height
   * @param {number} from @param {number} span @param {string} played @param {string} rest
   */
  #bars(context, width, top, height, from, span, played, rest) {
    const { position, duration, live } = this.input;
    const step = BAR + GAP;
    const middle = top + height / 2;
    const perPx = span / width;
    for (let x = 0; x < width; x += step) {
      const time = from + x * perPx;
      if (time > duration) break;
      const loud = Math.max(MIN_BAR, Math.pow(this.#peak(time, time + step * perPx), LOUDNESS_CURVE));
      const bar = Math.max(1, loud * height * BAR_FILL);
      context.fillStyle = live || time + step * perPx <= position ? played : rest;
      context.fillRect(x, middle - bar / 2, BAR, bar);
    }
  }

  #draw() {
    if (this.main) this.#drawMain(this.main);
    if (this.overview) this.#drawOverview(this.overview);
  }

  /** @param {HTMLCanvasElement} canvas */
  #drawMain(canvas) {
    const { context, width, height } = this.#prepare(canvas);
    const colors = this.#colors(canvas);
    const { position, duration, live } = this.input;
    const top = RULER_PX;
    const waveHeight = height - RULER_PX;
    // Center line, then the bars.
    context.fillStyle = colors.line;
    context.fillRect(0, top + waveHeight / 2, width, 1);
    // Nothing recorded yet: just the flat line.
    if (!duration && !live) return;
    this.#bars(context, width, top, waveHeight, this.start, this.span, colors.accent, colors.faint);
    // Ruler: ticks far enough apart to label.
    const step = TICK_STEPS.find((candidate) => (candidate / this.span) * width >= MIN_TICK_PX) ?? TICK_STEPS[TICK_STEPS.length - 1];
    context.font = colors.font;
    context.textBaseline = 'top';
    context.fillStyle = colors.line;
    context.fillRect(0, RULER_PX - 1, width, 1);
    for (let tick = Math.ceil(this.start / step) * step; tick <= this.start + this.span; tick += step) {
      const x = ((tick - this.start) / this.span) * width;
      context.fillStyle = colors.strong;
      context.fillRect(x, RULER_PX - TICK_PX, 1, TICK_PX);
      context.fillStyle = colors.faint;
      context.fillText(clock(tick, step < 1), x + LABEL_PAD, LABEL_PAD / 2);
    }
    // Hover: where a click would land.
    if (this.hover >= 0 && !live) {
      context.fillStyle = colors.strong;
      context.fillRect(this.hover, top, 1, waveHeight);
      const label = clock(this.timeAt(this.hover), true);
      const labelWidth = context.measureText(label).width + LABEL_PAD * 2;
      const labelX = Math.min(width - labelWidth, this.hover + LABEL_PAD);
      context.fillStyle = colors.soft;
      context.fillRect(labelX, top + LABEL_PAD / 2, labelWidth, LABEL_HEIGHT);
      context.fillStyle = colors.ink;
      context.fillText(label, labelX + LABEL_PAD, top + LABEL_PAD);
    }
    // Playhead (the live edge while recording).
    const head = ((live ? duration : position) - this.start) / this.span * width;
    if (head < -KNOB_PX || head > width + KNOB_PX) return;
    context.fillStyle = live ? colors.accent : colors.ink;
    context.fillRect(head - PLAYHEAD_PX / 2, top, PLAYHEAD_PX, waveHeight);
    context.beginPath();
    context.moveTo(head - KNOB_PX, top);
    context.lineTo(head + KNOB_PX, top);
    context.lineTo(head, top + KNOB_PX * 1.4);
    context.closePath();
    context.fill();
  }

  /** @param {HTMLCanvasElement} canvas */
  #drawOverview(canvas) {
    const { context, width, height } = this.#prepare(canvas);
    if (!this.input.duration && !this.input.live) return;
    const colors = this.#colors(canvas);
    const full = this.fullSpan;
    this.#bars(context, width, 0, height, 0, full, colors.muted, colors.strong);
    // The window: what the big view shows.
    const left = (this.start / full) * width;
    const right = ((this.start + this.span) / full) * width;
    context.fillStyle = colors.soft;
    const windowWidth = Math.max(MIN_WINDOW_PX, right - left);
    context.globalAlpha = WINDOW_ALPHA;
    context.fillRect(left, 0, windowWidth, height);
    context.globalAlpha = 1;
    context.strokeStyle = colors.accent;
    context.lineWidth = 1;
    context.strokeRect(left + 0.5, 0.5, windowWidth - 1, height - 1);
    const head = ((this.input.live ? this.input.duration : this.input.position) / full) * width;
    context.fillStyle = colors.ink;
    context.fillRect(head - 0.5, 0, 1, height);
  }
}
