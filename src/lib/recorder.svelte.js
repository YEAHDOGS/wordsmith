// Scribe's recorder: while Scribe listens, the microphone is also recorded here, so a session can be played back,
// scrubbed through on the big waveform (src/components/Waveform.svelte), saved to Tapes, or exported as WAV, MP3
// (src/lib/mp3-worker.js) or a video with a visualizer (src/components/VisualizerStudio.svelte).
// Capture runs in an AudioWorklet (off the main thread) that hands back 16-bit samples and one loudness peak per
// 10 ms. Samples pile up as Blob parts, so a long session isn't held twice in memory; stopping turns them into a WAV
// that plays through an <audio> element (seeking, speed and the browser's own buffering for free). Pressing the mic
// again adds to the same recording until it's discarded. Nothing leaves this device unless it's saved or exported.

const PROCESSOR = 'ws-record';
const STORAGE_KEY = 'ws_recorder';
// Loudness peaks per second of audio: the waveform's finest detail (10 ms).
export const PEAKS_PER_SECOND = 100;
// Samples are handed over from the worklet in 100 ms batches.
const BATCHES_PER_SECOND = 10;
// The longest recording kept: an hour of 16-bit audio at 48 kHz is about 350 MB, as much as a phone can safely hold.
export const MAX_RECORDING_SECONDS = 3_600;
const INT16_MAX = 32_767;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;
const WAV_TYPE = 'audio/wav';
const MP3_KBPS = 128;
// How long stop() waits for the worklet's last batch before closing anyway.
const FLUSH_TIMEOUT_MS = 500;
// The analyser's detail for the visualizers: 1024 samples gives 512 frequency bins.
const FFT_SIZE = 1_024;
const ANALYSER_SMOOTHING = 0.72;
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
// Starting capacity of the peaks list, a minute's worth; it doubles as the recording grows.
const PEAK_CAPACITY = PEAKS_PER_SECOND * 60;
// File names keep letters, digits and dashes, and this many characters of the label.
const MAX_LABEL_CHARS = 40;
const NOT_NAME = /[^a-z0-9]+/g;
const MIC_CONSTRAINTS = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

// Runs on the audio thread. Converts each input to 16-bit, keeps the loudest sample of every block as a peak, and
// posts { samples, peaks } once a batch is full, or when told to flush (the last bit before stopping).
const WORKLET = `
class Record extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { batch, block } = options.processorOptions;
    this.batch = batch;
    this.block = block;
    this.samples = new Int16Array(batch);
    this.filled = 0;
    this.peaks = [];
    this.peak = 0;
    this.inBlock = 0;
    this.port.onmessage = () => this.post(true);
  }
  post(last) {
    const samples = this.samples.slice(0, this.filled);
    if (last && this.inBlock) {
      this.peaks.push(this.peak);
      this.peak = 0;
      this.inBlock = 0;
    }
    const peaks = Float32Array.from(this.peaks);
    this.port.postMessage({ samples, peaks, last }, [samples.buffer, peaks.buffer]);
    this.filled = 0;
    this.peaks = [];
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let index = 0; index < input.length; index++) {
      const value = Math.max(-1, Math.min(1, input[index]));
      this.samples[this.filled++] = value < 0 ? value * 32768 : value * ${INT16_MAX};
      const loud = value < 0 ? -value : value;
      if (loud > this.peak) this.peak = loud;
      if (++this.inBlock === this.block) {
        this.peaks.push(this.peak);
        this.peak = 0;
        this.inBlock = 0;
      }
      if (this.filled === this.batch) this.post(false);
    }
    return true;
  }
}
registerProcessor('${PROCESSOR}', Record);`;

/** The 44-byte header of a 16-bit mono WAV holding this many samples. @param {number} samples @param {number} rate */
function wavHeader(samples, rate) {
  const view = new DataView(new ArrayBuffer(WAV_HEADER_BYTES));
  const text = (/** @type {number} */ at, /** @type {string} */ value) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  const bytes = samples * BYTES_PER_SAMPLE;
  text(0, 'RIFF');
  view.setUint32(4, WAV_HEADER_BYTES - 8 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * BYTES_PER_SAMPLE, true); // bytes per second
  view.setUint16(32, BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, bytes, true);
  return view.buffer;
}

/** @returns {boolean} */
function loadEnabled() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').enabled !== false;
  } catch {
    return true;
  }
}

class Recorder {
  /** Record audio whenever Scribe listens. On by default; remembered on this device. */
  enabled = $state(loadEnabled());
  /** @type {'idle' | 'starting' | 'recording' | 'ready'} */
  status = $state('idle');
  /** 'mic-denied', 'mic', 'limit' (the hour is full) or ''. */
  problem = $state('');
  /** Seconds recorded so far. */
  duration = $state(0);
  /** Playhead, in seconds. */
  position = $state(0);
  playing = $state(false);
  speed = $state(1);
  /** Bumped whenever peaks change, so waveforms know to redraw. */
  peaksVersion = $state(0);
  /** When the recording began (ms), for file names. */
  startedAt = $state(0);
  /** Name used in file names, usually the project's. */
  label = $state('');
  /** This recording was saved as a tape (src/lib/scribe-tapes.svelte.js): the next start begins a new one. */
  sealed = false;
  /** Loudness peaks, 0..1, PEAKS_PER_SECOND of them per second; only the first peakCount are real. Not reactive: watch peaksVersion. */
  peaks = new Float32Array(PEAK_CAPACITY);
  peakCount = 0;
  sampleRate = 0;

  /** @type {AudioContext | null} */ #context = null;
  /** @type {AnalyserNode | null} */ #analyser = null;
  /** @type {MediaStream | null} */ #stream = null;
  /** @type {MediaStreamAudioSourceNode | null} */ #micSource = null;
  /** @type {AudioWorkletNode | null} */ #node = null;
  /** The worklet module is loaded once per audio context. */ #workletReady = false;
  /** Everything recorded before this take, as raw samples. @type {Blob} */ #pcm = new Blob([]);
  /** This take's samples so far. @type {Int16Array[]} */ #chunks = [];
  #samples = 0;
  /** @type {Blob | null} */ #wav = null;
  /** @type {HTMLAudioElement | null} */ #audio = null;
  /** @type {MediaElementAudioSourceNode | null} */ #playSource = null;
  #url = '';
  #frame = 0;
  /** Resolves when the worklet's last batch arrived. @type {(() => void) | null} */ #flushed = null;
  /** Counts starts, so a stop that lands while the microphone is still opening wins. */ #take = 0;
  /** A stop is flushing the last batch. */ #stopping = false;

  get recording() {
    return this.status === 'recording' || this.status === 'starting';
  }

  get hasAudio() {
    return this.status === 'ready' && this.duration > 0;
  }

  /** The shared audio graph: one context, and an analyser the visualizers read from. */
  #graph() {
    this.#context ??= new AudioContext();
    if (!this.#analyser) {
      this.#analyser = this.#context.createAnalyser();
      this.#analyser.fftSize = FFT_SIZE;
      this.#analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
    }
    return { context: this.#context, analyser: this.#analyser };
  }

  /** The analyser on whatever is sounding: the microphone while recording, the recording while it plays. */
  get analyser() {
    return this.#graph().analyser;
  }

  /** @param {boolean} enabled */
  setEnabled(enabled) {
    this.enabled = enabled;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled }));
    if (!enabled && this.recording) this.stop();
  }

  /** Starts (or continues) recording from the microphone. @param {string} [label] name for exported files */
  async start(label = '') {
    if (this.recording) return;
    if (this.sealed) this.discard();
    if (this.duration >= MAX_RECORDING_SECONDS) {
      this.problem = 'limit';
      return;
    }
    this.pause();
    const take = ++this.#take;
    this.status = 'starting';
    this.problem = '';
    if (label) this.label = label;
    try {
      const { context, analyser } = this.#graph();
      await context.resume();
      if (!this.#workletReady) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
        try {
          await context.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        this.#workletReady = true;
      }
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      if (take !== this.#take) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      // A recording continues at the rate it began with; one audio context keeps that the same.
      this.sampleRate ||= context.sampleRate;
      if (!this.startedAt) this.startedAt = Date.now();
      const node = new AudioWorkletNode(context, PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { batch: Math.round(this.sampleRate / BATCHES_PER_SECOND), block: Math.round(this.sampleRate / PEAKS_PER_SECOND) },
      });
      node.port.onmessage = (event) => this.#take === take && this.#receive(event.data);
      const source = context.createMediaStreamSource(stream);
      source.connect(node);
      source.connect(analyser);
      this.status = 'recording';
      this.#stream = stream;
      this.#micSource = source;
      this.#node = node;
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => this.stop());
    } catch (error) {
      if (take !== this.#take) return;
      const name = /** @type {Error} */ (error)?.name;
      this.problem = name === 'NotAllowedError' || name === 'SecurityError' ? 'mic-denied' : 'mic';
      this.status = this.duration ? 'ready' : 'idle';
    }
  }

  /** @param {{ samples: Int16Array, peaks: Float32Array, last: boolean }} batch */
  #receive({ samples, peaks, last }) {
    if (samples.length) {
      this.#chunks.push(samples);
      this.#samples += samples.length;
    }
    if (peaks.length) {
      if (this.peakCount + peaks.length > this.peaks.length) {
        const grown = new Float32Array(Math.max(this.peaks.length * 2, this.peakCount + peaks.length));
        grown.set(this.peaks.subarray(0, this.peakCount));
        this.peaks = grown;
      }
      this.peaks.set(peaks, this.peakCount);
      this.peakCount += peaks.length;
      this.peaksVersion++;
    }
    this.duration = this.#samples / this.sampleRate;
    this.position = this.duration;
    if (last) this.#flushed?.();
    else if (this.duration >= MAX_RECORDING_SECONDS) {
      this.problem = 'limit';
      this.stop();
    }
  }

  /** Stops recording; what was recorded becomes playable. @returns {Promise<boolean>} true for the call that stopped it */
  async stop() {
    // Scribe's stop and the speech engine's end both land here: only the first call stops (and saves) it.
    if (!this.recording || this.#stopping) return false;
    this.#stopping = true;
    this.#take++;
    const node = this.#node;
    if (node) {
      // The worklet still holds the last fraction of a batch: ask for it, and wait a moment.
      const take = this.#take;
      node.port.onmessage = (event) => this.#take === take && this.#receive(event.data);
      await new Promise((resolve) => {
        this.#flushed = () => resolve(undefined);
        node.port.postMessage('flush');
        setTimeout(resolve, FLUSH_TIMEOUT_MS);
      });
      this.#flushed = null;
      node.port.onmessage = null;
    }
    this.#micSource?.disconnect();
    node?.disconnect();
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;
    this.#micSource = null;
    this.#node = null;
    this.#pcm = new Blob([this.#pcm, ...this.#chunks.map((chunk) => /** @type {BlobPart} */ (chunk))]);
    this.#chunks = [];
    this.#wav = this.#samples ? new Blob([wavHeader(this.#samples, this.sampleRate), this.#pcm], { type: WAV_TYPE }) : null;
    this.status = this.#wav ? 'ready' : 'idle';
    this.#stopping = false;
    this.#load();
    return true;
  }

  /** Points the player at the latest WAV, keeping the playhead where it was. */
  #load() {
    if (this.#url) URL.revokeObjectURL(this.#url);
    this.#url = '';
    if (!this.#wav) return;
    this.#url = URL.createObjectURL(this.#wav);
    const audio = this.#player();
    audio.src = this.#url;
    audio.playbackRate = this.speed;
    this.position = Math.min(this.position, this.duration);
  }

  #player() {
    if (this.#audio) return this.#audio;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('ended', () => {
      this.playing = false;
      this.position = this.duration;
    });
    audio.addEventListener('pause', () => (this.playing = false));
    audio.addEventListener('play', () => (this.playing = true));
    this.#audio = audio;
    return audio;
  }

  /** The <audio> element playing the recording, routed through the analyser (the video export records from it). */
  get audio() {
    return this.#player();
  }

  /** Where the recording sounds: routed through the analyser to the speakers, created on first play. */
  playbackSource() {
    const { context, analyser } = this.#graph();
    if (!this.#playSource) {
      this.#playSource = context.createMediaElementSource(this.#player());
      this.#playSource.connect(analyser);
      this.#playSource.connect(context.destination);
    }
    return { context, source: this.#playSource };
  }

  async play() {
    if (!this.hasAudio) return;
    const audio = this.#player();
    const { context } = this.playbackSource();
    await context.resume();
    if (this.position >= this.duration - 0.05) this.position = 0;
    audio.currentTime = this.position;
    await audio.play().catch(() => {});
    this.#follow();
  }

  pause() {
    this.#audio?.pause();
    cancelAnimationFrame(this.#frame);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Keeps the playhead moving smoothly while playing (timeupdate only fires a few times a second). */
  #follow() {
    cancelAnimationFrame(this.#frame);
    const step = () => {
      if (!this.#audio || this.#audio.paused) return;
      this.position = this.#audio.currentTime;
      this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }

  /** @param {number} seconds */
  seek(seconds) {
    if (!this.hasAudio) return;
    this.position = Math.max(0, Math.min(this.duration, seconds));
    if (this.#audio) this.#audio.currentTime = this.position;
  }

  /** @param {number} seconds back (negative) or forward */
  skip(seconds) {
    this.seek(this.position + seconds);
  }

  /** @param {number} speed one of SPEEDS */
  setSpeed(speed) {
    this.speed = speed;
    if (this.#audio) this.#audio.playbackRate = speed;
  }

  /** File name for an export, e.g. wordsmith-login-page-2026-11-15-1432.mp3. @param {string} extension with the dot */
  fileName(extension) {
    const at = new Date(this.startedAt || Date.now());
    const pad = (/** @type {number} */ value) => String(value).padStart(2, '0');
    const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
    const label = this.label.toLowerCase().replace(NOT_NAME, '-').replace(/^-|-$/g, '').slice(0, MAX_LABEL_CHARS);
    return ['wordsmith', label, stamp].filter(Boolean).join('-') + extension;
  }

  /** The recording as a WAV (16-bit mono). */
  wav() {
    return this.#wav;
  }

  /** The recording's raw 16-bit mono samples at sampleRate, for encoding without decoding. */
  pcm() {
    return this.#pcm;
  }

  /**
   * The recording as an MP3, encoded by lame in a worker.
   * @param {(progress: number) => void} onProgress
   * @param {AbortSignal} [signal]
   * @returns {Promise<Blob>}
   */
  async mp3(onProgress, signal) {
    return encodeMp3InWorker({ pcm: await this.#pcm.arrayBuffer(), sampleRate: this.sampleRate, kbps: MP3_KBPS }, onProgress, signal);
  }

  /** Forgets the recording: stops it, frees the memory, and starts the next one fresh. */
  discard() {
    this.#take++;
    this.pause();
    this.#micSource?.disconnect();
    this.#node?.disconnect();
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    if (this.#audio) this.#audio.removeAttribute('src');
    if (this.#url) URL.revokeObjectURL(this.#url);
    this.#stream = null;
    this.#micSource = null;
    this.#node = null;
    this.#url = '';
    this.#wav = null;
    this.#pcm = new Blob([]);
    this.#chunks = [];
    this.#samples = 0;
    this.peaks = new Float32Array(PEAK_CAPACITY);
    this.peakCount = 0;
    this.sampleRate = 0;
    Object.assign(this, { status: 'idle', problem: '', duration: 0, position: 0, playing: false, startedAt: 0, sealed: false });
    this.#stopping = false;
    this.peaksVersion++;
  }
}

/**
 * Encodes 16-bit mono samples to MP3 with lame in a worker (src/lib/mp3-worker.js), or here, a slice at a time, on
 * browsers that can't start module workers.
 * @param {{ pcm: ArrayBuffer, sampleRate: number, kbps: number }} input
 * @param {(progress: number) => void} onProgress
 * @param {AbortSignal} [signal]
 * @returns {Promise<Blob>}
 */
export async function encodeMp3InWorker(input, onProgress, signal) {
  /** @type {Worker} */
  let worker;
  try {
    worker = new Worker(new URL('./mp3-worker.js', import.meta.url), { type: 'module' });
  } catch {
    const { encodeMp3 } = await import('./mp3-encode.js');
    return encodeMp3(input, onProgress);
  }
  return new Promise((resolve, reject) => {
    const finish = () => worker.terminate();
    signal?.addEventListener('abort', () => {
      finish();
      reject(new DOMException('Cancelled', 'AbortError'));
    });
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) return onProgress(data.progress);
      finish();
      if (data.blob) resolve(data.blob);
      else reject(new Error(data.error));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'MP3 encoding failed'));
    };
    worker.postMessage(input, [input.pcm]);
  });
}

export const recorder = new Recorder();
