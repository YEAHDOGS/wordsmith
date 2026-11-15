// Scribe sessions become tapes: when Scribe stops listening, what it recorded (src/lib/recorder.svelte.js) is saved
// to the Tapes page by itself, with the session's transcript and a title naming the project. Two copies:
// - in R2 (POST /api/tapes, the same route imports use): small Opus at the Tapes bitrate, about 11 MB an hour, well
//   inside the 25 MB tape cap (MAX_TAPE_BYTES), so it plays and syncs on every device;
// - on this device, in IndexedDB (src/lib/recordings.js): the full-quality WAV, for download from Tapes.
// The original is kept before anything uploads, so a failed upload loses nothing: Retry sends it again. Each saved
// session seals the recording, so pressing the mic again starts the next session fresh. Off in demo mode, and when
// switched off on the recording band (remembered on this device).
import { ApiError, uploadFile } from './api.js';
import { auth } from './auth.svelte.js';
import { store } from './store.svelte.js';
import { encodeMp3InWorker, recorder } from './recorder.svelte.js';
import { encodeRecording } from './tape-encode.js';
import { keepOriginal } from './recordings.js';
import { MAX_TITLE, MAX_TRANSCRIPT } from './models.js';

const STORAGE_KEY = 'ws_scribe_tapes';
const TAPES_PATH = '/api/tapes';
// Sessions shorter than this (a mis-press) aren't worth a tape.
const MIN_SECONDS = 3;
// Where the browser has no Opus encoder, an MP3 at this bitrate keeps an hour (about 21 MB) under the tape cap.
const FALLBACK_KBPS = 48;
const MP3_TYPE = 'audio/mpeg';
const WAV_EXTENSION = '.wav';
const MP3_EXTENSION = '.mp3';
// Encoding is the first part of the progress bar, uploading the rest.
const ENCODE_SHARE = 0.4;
const SESSION = 'Scribe session';
const MS_PER_SECOND = 1_000;
const DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** @typedef {{ id: string, name: string, wav: Blob, pcm: Blob, rate: number, durationMs: number, recordedAt: number, title: string, transcript: string }} Session */

/** @returns {boolean} */
function loadEnabled() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').enabled !== false;
  } catch {
    return true;
  }
}

/** A hex SHA-256: the server dedupes tapes by their original's hash, and a session's id is its identity. @param {string} text */
async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class ScribeTapes {
  /** Save each session to Tapes. On by default. */
  enabled = $state(loadEnabled());
  /** @type {'' | 'saving' | 'saved' | 'failed'} */
  status = $state('');
  progress = $state(0);
  error = $state('');
  /** The last session's tape. */
  tapeId = $state('');
  /** A session whose upload failed, for Retry. @type {Session | null} */ #failed = null;

  /** @param {boolean} enabled */
  setEnabled(enabled) {
    this.enabled = enabled;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled }));
  }

  /**
   * Saves what the recorder holds as a tape. Called by Scribe right after a session stops.
   * @param {{ project: string, transcript: string }} session the project's name and what was said
   */
  async save({ project, transcript }) {
    const userId = auth.user?.id;
    const wav = recorder.wav();
    if (!this.enabled || auth.demo || !userId || !wav || recorder.duration < MIN_SECONDS) return;
    const id = crypto.randomUUID();
    const recordedAt = recorder.startedAt || Date.now();
    const title = [project, SESSION, DATE.format(recordedAt)].filter(Boolean).join(' · ').slice(0, MAX_TITLE);
    /** @type {Session} */
    const session = { id, name: recorder.fileName(''), wav, pcm: recorder.pcm(), rate: recorder.sampleRate, durationMs: Math.round(recorder.duration * MS_PER_SECOND), recordedAt, title, transcript: transcript.slice(0, MAX_TRANSCRIPT) };
    // The next press starts a new session; this one's audio stays referenced here until it's uploaded.
    recorder.sealed = true;
    this.status = 'saving';
    this.progress = 0;
    this.error = '';
    try {
      await keepOriginal(userId, { id, name: session.name + WAV_EXTENSION, blob: wav, at: recordedAt });
    } catch {
      // No room on this device: the tape still uploads; it just has no full-quality copy here.
    }
    await this.#upload(session);
  }

  /** @param {Session} session */
  async #upload(session) {
    this.status = 'saving';
    this.error = '';
    try {
      const encodeProgress = (/** @type {number} */ done) => (this.progress = done * ENCODE_SHARE);
      const opus = await encodeRecording({ wav: session.wav, pcm: session.pcm, rate: session.rate, name: session.name }, encodeProgress);
      const file = opus?.file ?? new File([await encodeMp3InWorker({ pcm: await session.pcm.arrayBuffer(), sampleRate: session.rate, kbps: FALLBACK_KBPS }, encodeProgress)], session.name + MP3_EXTENSION, { type: MP3_TYPE });
      const meta = { id: session.id, name: session.name + WAV_EXTENSION, hash: await sha256(`scribe:${session.id}`), size: session.wav.size, recorded_at: session.recordedAt, duration_ms: session.durationMs };
      const answer = await uploadFile(TAPES_PATH, file, (fraction) => (this.progress = ENCODE_SHARE + fraction * (1 - ENCODE_SHARE)), { 'X-Tape': encodeURIComponent(JSON.stringify(meta)) });
      if (!answer?.tape?.id) throw new Error('The server sent no tape back.');
      store.adopt('tapes', [answer.tape]);
      store.update('tapes', answer.tape.id, { title: session.title, transcript: session.transcript });
      this.tapeId = answer.tape.id;
      this.#failed = null;
      this.progress = 1;
      this.status = 'saved';
    } catch (error) {
      this.#failed = session;
      this.status = 'failed';
      this.error = error instanceof TypeError ? 'offline' : /** @type {ApiError | Error} */ (error).message;
    }
  }

  /** Sends a failed session again. */
  retry() {
    if (this.#failed) this.#upload(this.#failed);
  }
}

export const scribeTapes = new ScribeTapes();
