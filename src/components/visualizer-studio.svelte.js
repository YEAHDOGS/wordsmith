// The video studio's state (VisualizerStudio.svelte): which scene, shape, words, background and glow color, the
// live preview loop, and the export. A frame is drawn by WebGL (visualizer-gl.js) onto a hidden canvas, then copied
// onto the visible one with the title, subtitle, the wordsmith mark and a progress line on top; that visible canvas
// is what gets recorded. Exporting plays the recording from the start in real time while MediaRecorder captures the
// canvas and the audio together: MP4 where the browser records it (Chrome and Edge 126+, Safari), WebM otherwise.
// Choices are remembered on this device; a picked background is not (it stays on the device, and only for now).
import { recorder } from '../lib/recorder.svelte.js';
import { saveFile } from '../lib/save-file.js';
import { Visualizer, hexColor, tokenColor } from './visualizer-gl.js';
import { SCENES } from './visualizer-scenes.js';

const STORAGE_KEY = 'ws_visualizer';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
/** Output shapes and their sizes in pixels. */
export const FORMATS = /** @type {const} */ ({ landscape: [1280, 720], square: [1080, 1080], portrait: [720, 1280], hd: [1920, 1080] });
const DEFAULT_FORMAT = 'landscape';
// Best first: H.264 + AAC plays everywhere, then the WebM pairs Firefox records.
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const MP4 = 'video/mp4';
const FPS = 30;
const VIDEO_BITS = 8_000_000;
const AUDIO_BITS = 160_000;
// MediaRecorder hands over a piece every second; the last bit of audio gets this long to arrive after playback ends.
const SLICE_MS = 1_000;
const TAIL_MS = 300;
// Text, as fractions of the frame's height.
const TITLE_SIZE = 0.064;
const SUBTITLE_SIZE = 0.034;
const MARK_SIZE = 0.026;
const MARGIN = 0.065;
const LINE_GAP = 0.018;
const PROGRESS_HEIGHT = 0.007;
const SHADOW_BLUR = 0.02;
// Behind the title and subtitle, a shade rising this far up the frame keeps them readable on bright scenes.
const SHADE_HEIGHT = 0.42;
const MS_PER_SECOND = 1_000;
const MARK = 'wordsmith';

/** @typedef {typeof SCENES[number]} Scene */
/** @typedef {keyof typeof FORMATS} Format */

/** The best video type this browser records, or null. */
export function videoType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const mime = VIDEO_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  return mime ? { mime, extension: mime.startsWith(MP4) ? '.mp4' : '.webm', mp4: mime.startsWith(MP4) } : null;
}

function loadChoices() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      scene: SCENES.includes(saved.scene) ? saved.scene : SCENES[0],
      format: saved.format in FORMATS ? saved.format : DEFAULT_FORMAT,
      glow: HEX_COLOR.test(saved.glow) ? saved.glow : '',
      mark: saved.mark !== false,
    };
  } catch {
    return { scene: SCENES[0], format: DEFAULT_FORMAT, glow: '', mark: true };
  }
}

export class Studio {
  #choices = loadChoices();
  /** @type {Scene} */ scene = $state(this.#choices.scene);
  /** @type {Format} */ format = $state(this.#choices.format);
  /** Glow color as #rrggbb, or '' for the theme's accent. */
  glow = $state(this.#choices.glow);
  /** Show the wordsmith mark in a corner. */
  mark = $state(this.#choices.mark);
  title = $state('');
  subtitle = $state('');
  /** The picked background's file name, or ''. */
  backgroundName = $state('');
  /** Scenes this GPU can draw (all of them, almost always). @type {Scene[]} */
  scenes = $state([...SCENES]);
  /** @type {'idle' | 'recording'} */
  status = $state('idle');
  progress = $state(0);
  /** 'webgl' (no WebGL here), 'record' (the export failed: see detail), or ''. */
  problem = $state('');
  detail = $state('');
  type = videoType();

  /** @type {Visualizer | null} */ #visualizer = null;
  /** @type {HTMLCanvasElement | null} */ #output = null;
  /** @type {HTMLCanvasElement} */ #glCanvas = document.createElement('canvas');
  #frame = 0;
  #start = performance.now();
  #backgroundUrl = '';
  /** @type {HTMLImageElement | HTMLVideoElement | null} */ #background = null;
  /** @type {{ cancelled: boolean, finish: () => void } | null} */ #job = null;

  #save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scene: this.scene, format: this.format, glow: this.glow, mark: this.mark }));
  }

  /** Starts drawing onto the visible canvas. @param {HTMLCanvasElement} canvas */
  attach(canvas) {
    this.#output = canvas;
    try {
      this.#visualizer = new Visualizer(this.#glCanvas);
    } catch {
      this.problem = 'webgl';
      return;
    }
    this.scenes = SCENES.filter((scene) => this.#visualizer?.supports(scene));
    if (!this.scenes.includes(this.scene)) this.scene = this.scenes[0] ?? SCENES[0];
    this.#resize();
    const loop = () => {
      this.#draw();
      this.#frame = requestAnimationFrame(loop);
    };
    this.#frame = requestAnimationFrame(loop);
  }

  #resize() {
    const [width, height] = FORMATS[this.format];
    for (const canvas of [this.#glCanvas, this.#output]) if (canvas) Object.assign(canvas, { width, height });
    this.#visualizer?.setBackground(this.#background);
  }

  /** @param {Scene} scene */
  setScene(scene) {
    this.scene = scene;
    this.#save();
  }

  /** @param {Format} format */
  setFormat(format) {
    if (this.status === 'recording') return;
    this.format = format;
    this.#resize();
    this.#save();
  }

  /** @param {string} glow #rrggbb, or '' for the theme's accent */
  setGlow(glow) {
    this.glow = HEX_COLOR.test(glow) ? glow : '';
    this.#save();
  }

  /** @param {boolean} mark */
  setMark(mark) {
    this.mark = mark;
    this.#save();
  }

  /** Puts a picked image or video behind the scene. @param {File} file */
  async setBackground(file) {
    this.clearBackground();
    const url = URL.createObjectURL(file);
    try {
      if (file.type.startsWith('video/')) {
        const video = Object.assign(document.createElement('video'), { src: url, muted: true, loop: true, playsInline: true });
        await video.play();
        this.#background = video;
      } else {
        const image = new Image();
        image.src = url;
        await image.decode();
        this.#background = image;
      }
    } catch {
      URL.revokeObjectURL(url);
      return;
    }
    this.#backgroundUrl = url;
    this.backgroundName = file.name;
    this.#visualizer?.setBackground(this.#background);
  }

  clearBackground() {
    if (this.#background instanceof HTMLVideoElement) this.#background.pause();
    if (this.#backgroundUrl) URL.revokeObjectURL(this.#backgroundUrl);
    this.#background = null;
    this.#backgroundUrl = '';
    this.backgroundName = '';
    this.#visualizer?.setBackground(null);
  }

  #draw() {
    const output = this.#output;
    const visualizer = this.#visualizer;
    if (!output || !visualizer) return;
    const palette = ['a', 'b', 'c'].map((key) => tokenColor(`--ws-viz-${this.scene}-${key}`));
    const glow = this.glow ? hexColor(this.glow) : tokenColor('--ws-accent');
    visualizer.draw({ scene: this.scene, analyser: recorder.analyser, time: (performance.now() - this.#start) / MS_PER_SECOND, palette, glow });
    const context = /** @type {CanvasRenderingContext2D} */ (output.getContext('2d'));
    const { width, height } = output;
    context.drawImage(this.#glCanvas, 0, 0);
    this.#overlay(context, width, height);
    if (this.status === 'recording') this.progress = recorder.duration ? recorder.position / recorder.duration : 0;
  }

  /** Title, subtitle, the mark and the progress line. @param {CanvasRenderingContext2D} context @param {number} width @param {number} height */
  #overlay(context, width, height) {
    const styles = getComputedStyle(document.documentElement);
    const text = styles.getPropertyValue('--ws-viz-text').trim();
    const shadow = styles.getPropertyValue('--ws-viz-shadow').trim();
    const sans = getComputedStyle(document.body).fontFamily;
    const margin = height * MARGIN;
    if (this.title.trim() || this.subtitle.trim()) {
      const shade = context.createLinearGradient(0, height, 0, height * (1 - SHADE_HEIGHT));
      shade.addColorStop(0, shadow);
      shade.addColorStop(1, 'transparent');
      context.fillStyle = shade;
      context.fillRect(0, height * (1 - SHADE_HEIGHT), width, height * SHADE_HEIGHT);
    }
    context.save();
    context.fillStyle = text;
    context.shadowColor = shadow;
    context.shadowBlur = height * SHADOW_BLUR;
    context.textBaseline = 'alphabetic';
    let y = height - margin;
    if (this.subtitle.trim()) {
      context.font = `500 ${Math.round(height * SUBTITLE_SIZE)}px ${sans}`;
      context.fillText(this.subtitle.trim(), margin, y, width - margin * 2);
      y -= height * (SUBTITLE_SIZE + LINE_GAP);
    }
    if (this.title.trim()) {
      context.font = `700 ${Math.round(height * TITLE_SIZE)}px ${sans}`;
      context.fillText(this.title.trim(), margin, y, width - margin * 2);
    }
    if (this.mark) {
      context.font = `600 ${Math.round(height * MARK_SIZE)}px ${sans}`;
      context.textAlign = 'right';
      context.textBaseline = 'top';
      context.fillText(MARK, width - margin, margin);
    }
    context.restore();
    // The progress line along the bottom, in the glow color.
    const played = recorder.duration ? recorder.position / recorder.duration : 0;
    context.fillStyle = this.glow || styles.getPropertyValue('--ws-accent').trim();
    context.fillRect(0, height - height * PROGRESS_HEIGHT, width * played, height * PROGRESS_HEIGHT);
  }

  /** Records the whole recording with the visualizer, in real time, and saves the video. */
  async record() {
    const type = this.type;
    if (!type || !this.#output || this.status === 'recording' || !recorder.hasAudio) return;
    this.problem = '';
    this.detail = '';
    const { context, source } = recorder.playbackSource();
    await context.resume();
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    const video = this.#output.captureStream(FPS);
    const stream = new MediaStream([...video.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    /** @type {Blob[]} */
    const pieces = [];
    const speed = recorder.speed;
    let media;
    try {
      media = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS });
    } catch (error) {
      source.disconnect(destination);
      for (const track of stream.getTracks()) track.stop();
      this.problem = 'record';
      this.detail = String(/** @type {Error} */ (error)?.message || error);
      return;
    }
    media.ondataavailable = (event) => event.data.size && pieces.push(event.data);
    const stopped = new Promise((resolve) => (media.onstop = resolve));
    const job = { cancelled: false, finish: () => {} };
    const ended = new Promise((resolve) => (job.finish = () => resolve(undefined)));
    this.#job = job;
    recorder.pause();
    recorder.setSpeed(1);
    recorder.seek(0);
    this.status = 'recording';
    this.progress = 0;
    media.start(SLICE_MS);
    recorder.audio.addEventListener('pause', job.finish, { once: true });
    await recorder.play();
    await ended;
    recorder.audio.removeEventListener('pause', job.finish);
    recorder.pause();
    await new Promise((resolve) => setTimeout(resolve, job.cancelled ? 0 : TAIL_MS));
    media.stop();
    await stopped;
    source.disconnect(destination);
    for (const track of stream.getTracks()) track.stop();
    recorder.setSpeed(speed);
    this.status = 'idle';
    this.#job = null;
    if (job.cancelled) return;
    this.progress = 1;
    await saveFile(new Blob(pieces, { type: type.mime.split(';')[0] }), recorder.fileName(type.extension));
  }

  cancel() {
    if (!this.#job) return;
    this.#job.cancelled = true;
    this.#job.finish();
  }

  destroy() {
    this.cancel();
    cancelAnimationFrame(this.#frame);
    this.clearBackground();
    this.#visualizer?.destroy();
    this.#visualizer = null;
  }
}
