// The tape recorder: Scribe's mic with ticket writing switched off ("Just record"). It records straight to a tape,
// with no speech recognition and no model. Audio is encoded while you talk, by the browser's Opus encoder at the tape
// bitrate (TAPE_BITRATE, mono, the same as an import: about 11 MB an hour), so stopping only wraps it into an .ogg.
// The finished tape joins the import queue (src/lib/tapes.svelte.js), which uploads it, retries it, and shows it on
// the Tapes side. A browser without the Opus encoder (older Safari) records with MediaRecorder instead, and that
// file goes through the queue like any import. Recording keeps going while you move around the app, like Scribe.
import { openMic } from './mic.js';
import { liveEncoder, packed, webEncoderReady } from './tape-encode.js';
import { tapeImport } from './tapes.svelte.js';
import { MAX_TAPE_BYTES, TAPE_BITRATE, TAPE_EXTENSION } from './models.js';

const RECORD_ONLY_KEY = 'ws_record_only';
// The signal as it is: echo cancelling, noise suppression and gain control pump a beat and smear a room.
const RECORDING_INPUT = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
// 0.1 s at the encoder's 24 kHz per piece from the microphone.
const CHUNK_SAMPLES = 2_400;
const TICK_MS = 250;
const MS_PER_SECOND = 1_000;
const BITS_PER_BYTE = 8;
// Stops by itself a little short of the largest tape the server takes (about two hours), leaving room for Ogg pages.
const FULL_FRACTION = 0.95;
const MAX_RECORDING_MS = Math.floor(((FULL_FRACTION * MAX_TAPE_BYTES * BITS_PER_BYTE) / TAPE_BITRATE) * MS_PER_SECOND);
// MediaRecorder formats, smallest good one first, and the extension each file gets.
const FALLBACK_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
const FALLBACK_EXTENSIONS = { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a' };
const FALLBACK_SLICE_MS = 1_000;
const NAME_DIGITS = 2;

/** @typedef {'mic-denied' | 'mic' | 'save' | ''} RecorderProblem */
/** @typedef {{ file: File, durationMs: number, encoded: boolean }} Recording */

/** "Recording 2026-11-20 14-33-01": the importer reads the start time back from the name (tapes.svelte.js recordedAt). @param {number} start */
function recordingName(start) {
  const at = new Date(start);
  const pad = (/** @type {number} */ value) => String(value).padStart(NAME_DIGITS, '0');
  return `Recording ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
}

class Recorder {
  /** Scribe's mic records tapes instead of writing tickets. Kept on this device. */
  recordOnly = $state(localStorage.getItem(RECORD_ONLY_KEY) === '1');
  recording = $state(false);
  /** Time recorded so far, ms. */
  elapsed = $state(0);
  /** The import queue id of the last recording, to show it saving. */
  lastItem = $state('');
  /** @type {RecorderProblem} */
  problem = $state('');
  detail = $state('');

  /** Stops the microphone and hands back the recording (null when nothing was heard). @type {(() => Promise<Recording | null>) | null} */
  #finish = null;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  #timer;
  #startedAt = 0;

  constructor() {
    // Closing the tab mid-recording would lose it: ask first.
    addEventListener('beforeunload', (event) => this.recording && event.preventDefault());
  }

  /** @param {boolean} on */
  setRecordOnly(on) {
    if (this.recording) return;
    this.recordOnly = on;
    if (on) localStorage.setItem(RECORD_ONLY_KEY, '1');
    else localStorage.removeItem(RECORD_ONLY_KEY);
  }

  toggle() {
    return this.recording ? this.stop() : this.start();
  }

  async start() {
    if (this.recording || this.#finish) return;
    this.problem = '';
    this.detail = '';
    try {
      this.#finish = (await webEncoderReady()) ? await this.#encoding() : await this.#mediaRecorder();
    } catch (error) {
      const failure = /** @type {Error} */ (error);
      this.problem = failure.name === 'NotAllowedError' ? 'mic-denied' : 'mic';
      this.detail = failure.message;
      return;
    }
    this.#startedAt = Date.now();
    this.elapsed = 0;
    this.recording = true;
    this.#timer = setInterval(() => {
      this.elapsed = Date.now() - this.#startedAt;
      if (this.elapsed >= MAX_RECORDING_MS) this.stop();
    }, TICK_MS);
  }

  /** Stops, then queues the tape to upload. */
  async stop() {
    const finish = this.#finish;
    if (!this.recording || !finish) return;
    clearInterval(this.#timer);
    this.recording = false;
    this.#finish = null;
    try {
      const recording = await finish();
      if (!recording) return;
      if (recording.encoded) {
        this.lastItem = tapeImport.addRecording(recording.file, recording.durationMs);
        return;
      }
      // Not yet a tape: the queue shrinks it like any import, where the device can.
      tapeImport.add([recording.file]);
      this.lastItem = tapeImport.items.at(-1)?.id ?? '';
    } catch (error) {
      this.problem = 'save';
      this.detail = /** @type {Error} */ (error).message;
    }
  }

  /** Encodes while recording, with the browser's Opus encoder. */
  async #encoding() {
    const encoder = liveEncoder();
    /** @type {() => void} */
    let close;
    try {
      close = await openMic((audio) => encoder.feed(new Float32Array(audio.buffer, audio.byteOffset, audio.byteLength / Float32Array.BYTES_PER_ELEMENT)),
        { rate: encoder.rate, chunk: CHUNK_SAMPLES, input: RECORDING_INPUT });
    } catch (error) {
      encoder.finish().catch(() => {});
      throw error;
    }
    const start = Date.now();
    return async () => {
      close();
      const audio = await encoder.finish();
      if (!audio.samples) return null;
      const name = recordingName(start) + TAPE_EXTENSION;
      const tape = packed(audio, name);
      return { file: new File([tape.file], name, { type: tape.file.type, lastModified: start }), durationMs: tape.durationMs, encoded: true };
    };
  }

  /** Records with MediaRecorder, where the browser can't encode Opus itself. */
  async #mediaRecorder() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: RECORDING_INPUT });
    const mimeType = FALLBACK_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
    const media = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: TAPE_BITRATE });
    /** @type {Blob[]} */
    const parts = [];
    media.ondataavailable = (event) => event.data.size && parts.push(event.data);
    media.start(FALLBACK_SLICE_MS);
    const start = Date.now();
    return () => /** @type {Promise<Recording | null>} */ (new Promise((resolve) => {
      media.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        const type = (media.mimeType || mimeType).split(';')[0];
        const blob = new Blob(parts, { type });
        if (!blob.size) return resolve(null);
        const extension = FALLBACK_EXTENSIONS[/** @type {keyof typeof FALLBACK_EXTENSIONS} */ (type)] ?? FALLBACK_EXTENSIONS['audio/webm'];
        resolve({ file: new File([blob], recordingName(start) + extension, { type, lastModified: start }), durationMs: Date.now() - start, encoded: false });
      };
      media.stop();
    }));
  }
}

export const recorder = new Recorder();
