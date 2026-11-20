// The tape recorder: Scribe's mic with ticket writing switched off ("Just record"). It records straight to a tape,
// with no speech recognition and no model. Audio is encoded while you talk, by the browser's Opus encoder at the tape
// bitrate (TAPE_BITRATE, mono, the same as an import: about 11 MB an hour), so stopping only wraps it into an .ogg.
// The finished tape joins the import queue (src/lib/tapes.svelte.js), which keeps it on the device until it uploads,
// retries it, and shows it on the Tapes side; it belongs to the account that was signed in when recording started.
// A browser without the Opus encoder (older Safari) records with MediaRecorder instead, and the queue shrinks that
// file like an import. Recording keeps going while you move around the app, like Scribe.
import { openMic } from './mic.js';
import { tapeImport } from './tapes.svelte.js';
import { MAX_TAPE_BYTES, TAPE_BITRATE, TAPE_EXTENSION } from './models.js';

const RECORD_ONLY_KEY = 'ws_record_only';
// The encoder loads on the first recording, keeping it out of the start-up bundle.
const encoding = () => import('./tape-encode.js');
// The signal as it is: echo cancelling, noise suppression and gain control pump a beat and smear a room.
const RECORDING_INPUT = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
// 0.1 s at the encoder's 24 kHz per piece from the microphone.
const CHUNK_SAMPLES = 2_400;
const TICK_MS = 250;
// The microphone hands over audio in 0.1 s pieces: on stop, wait a little longer than one for the last to arrive.
const TAIL_MS = 150;
const MS_PER_SECOND = 1_000;
const BITS_PER_BYTE = 8;
// Stops by itself a little short of the largest tape the server takes (about two hours), leaving room for Ogg pages.
const FULL_FRACTION = 0.95;
const MAX_RECORDING_MS = Math.floor(((FULL_FRACTION * MAX_TAPE_BYTES * BITS_PER_BYTE) / TAPE_BITRATE) * MS_PER_SECOND);
// MediaRecorder formats, smallest good one first, and the extension each file gets.
const FALLBACK_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
const FALLBACK_EXTENSIONS = { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a' };
const FALLBACK_SLICE_MS = 1_000;
const MAX_FALLBACK_BYTES = Math.floor(FULL_FRACTION * MAX_TAPE_BYTES);
const NO_RECORDER = "This browser can't record audio";
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
  /** The microphone is opening: a second press waits for it instead of opening another. */
  starting = $state(false);
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
  /** The account that was signed in when recording started; the tape is theirs. */
  #userId = '';
  /** Stop was asked for while the microphone was still opening. */
  #stopAsked = false;

  constructor() {
    // Closing the tab mid-recording, or before a finished one is written to the device, would lose it: ask first.
    // returnValue too: Chromium before 119 only asks when it is set.
    addEventListener('beforeunload', (event) => {
      if (!this.recording && !this.starting && !tapeImport.persisting) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  /** @param {boolean} on */
  setRecordOnly(on) {
    if (this.recording || this.starting) return;
    this.recordOnly = on;
    if (on) localStorage.setItem(RECORD_ONLY_KEY, '1');
    else localStorage.removeItem(RECORD_ONLY_KEY);
  }

  /** The mic button. A press while the microphone opens (a double click) is ignored, so it starts one recording. */
  toggle() {
    if (this.starting) return;
    return this.recording ? this.stop() : this.start();
  }

  async start() {
    if (this.recording || this.starting) return;
    this.starting = true;
    this.#stopAsked = false;
    this.#userId = tapeImport.userId;
    this.problem = '';
    this.detail = '';
    try {
      const encoder = await encoding();
      this.#finish = (await encoder.webEncoderReady()) ? await this.#encoding(encoder) : await this.#mediaRecorder();
    } catch (error) {
      const failure = /** @type {Error} */ (error);
      this.problem = failure.name === 'NotAllowedError' ? 'mic-denied' : 'mic';
      this.detail = failure.message;
      return;
    } finally {
      this.starting = false;
    }
    this.#startedAt = Date.now();
    this.elapsed = 0;
    this.recording = true;
    this.#timer = setInterval(() => {
      this.elapsed = Date.now() - this.#startedAt;
      if (this.elapsed >= MAX_RECORDING_MS) this.stop();
    }, TICK_MS);
    // Stop (or sign-out) came while the microphone opened: close it straight away.
    if (this.#stopAsked) this.stop();
  }

  /** Stops, then queues the tape to upload. */
  async stop() {
    if (this.starting) {
      this.#stopAsked = true;
      return;
    }
    const finish = this.#finish;
    if (!this.recording || !finish) return;
    clearInterval(this.#timer);
    this.recording = false;
    this.#finish = null;
    try {
      const recording = await finish();
      if (!recording) return;
      this.lastItem = tapeImport.addRecording(recording.file, { durationMs: recording.durationMs, encoded: recording.encoded, userId: this.#userId });
    } catch (error) {
      this.problem = 'save';
      this.detail = /** @type {Error} */ (error).message;
    }
  }

  /** Encodes while recording, with the browser's Opus encoder. @param {typeof import('./tape-encode.js')} encoders */
  async #encoding({ liveEncoder, packed }) {
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
      await new Promise((resolve) => setTimeout(resolve, TAIL_MS));
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
    // Checked before the microphone opens, so a WebView without MediaRecorder never leaves it on.
    if (typeof MediaRecorder === 'undefined') throw new Error(NO_RECORDER);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: RECORDING_INPUT });
    const mimeType = FALLBACK_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
    /** @type {MediaRecorder} */
    let media;
    try {
      // None of ours supported: leave the choice to the browser, then read what it picked from media.mimeType.
      media = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: TAPE_BITRATE } : { audioBitsPerSecond: TAPE_BITRATE });
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      throw error;
    }
    /** @type {Blob[]} */
    const parts = [];
    let bytes = 0;
    // MediaRecorder treats the bitrate as a hint (Safari's AAC runs well over it), so the size cap counts real bytes.
    media.ondataavailable = (event) => {
      if (!event.data.size) return;
      parts.push(event.data);
      bytes += event.data.size;
      if (bytes >= MAX_FALLBACK_BYTES) this.stop();
    };
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
