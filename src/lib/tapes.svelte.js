// Importing tapes: recordings picked or dropped on the Tapes page (a whole recorder folder at once is fine) go
// through a queue: read the file, hash it, skip it if that file is already a tape, shrink it (tape-encode.js), and
// upload it (POST /api/tapes), which creates the tape. The server knows every file by its hash too, so importing the
// same folder again, after a crash or on another device, only adds what's new: that's how an import resumes.
// The queue lives here, outside the page, so leaving the Tapes page doesn't stop it. Recordings made in the app
// (src/lib/recorder.svelte.js) join the same queue, usually already encoded so they upload as they are, and are kept
// on the device (pending-recordings.js) until they do. Every item belongs to the account that queued it: claim()
// drops another account's items when the user changes, and brings back this account's recordings still waiting.
import { ApiError, uploadFile } from './api.js';
import { forgetRecording, keepRecording, waitingRecordings } from './pending-recordings.js';
import { store } from './store.svelte.js';
import { TAPE_EXISTS, TAPE_LIMIT, TAPE_STORAGE, audioType } from './models.js';

// The encoders are their own file, fetched once the app has started (and again on use if that failed), so they stay
// out of the start-up bundle yet are in memory before a tab goes offline. The recorder shares this loader.
const WARM_UP_MS = 2_000;
/** @type {Promise<typeof import('./tape-encode.js')> | null} */
let encoders = null;
/** The encoder module, loaded once; a failed load (offline, or a deploy replaced the file) is tried again next time. */
export function loadEncoders() {
  encoders ??= import('./tape-encode.js').catch((error) => {
    encoders = null;
    throw error;
  });
  return encoders;
}
setTimeout(() => loadEncoders().catch(() => {}), WARM_UP_MS);
// The desktop encoder runs on its own threads, so two files encode while others upload; a phone does one at a time.
const NATIVE_WORKERS = 2;
const WEB_WORKERS = 1;
const RATE_LIMITED = 429;
const STORAGE_FULL = 507;
// Errors that stop the whole queue: nothing after them would get in either.
const STOPPERS = [RATE_LIMITED, STORAGE_FULL, 401];
const OFFLINE = "You're offline. Import again when you're back; finished tapes are kept.";
// What a recording waits on when offline: it goes up by itself once the connection is back.
const OFFLINE_RECORDING = "You're offline. It uploads by itself when you're back.";
// Recorder apps name files after the moment they started: 2024-05-12 14-33-01, 20240512_143301, 2024.05.12-14.33...
const DATE_IN_NAME = /(20\d{2})[-_. ]?([01]\d)[-_. ]?([0-3]\d)[-_. T]*([0-2]\d)[-_.: h]?([0-5]\d)(?:[-_.: m]?([0-5]\d))?/;
// Month, day and hour limits a date in a file name must keep to (a name like 20201345... is a number, not a date).
const MAX_MONTH = 12;
const MAX_DAY = 31;
const MAX_HOUR = 23;
const WORKING = ['reading', 'encoding', 'uploading'];
const HEX = 16;
const HEX_PAIR = 2;
// Recent finished items stay listed so the page can show what just landed; the rest are counted.
const KEEP_DONE = 20;

/** @typedef {'waiting' | 'reading' | 'encoding' | 'uploading' | 'done' | 'skipped' | 'failed'} ItemStatus */
/** @typedef {{ id: string, name: string, status: ItemStatus, progress: number, error: string, userId: string, recording: boolean }} QueueItem */
/** @typedef {{ durationMs: number, encoded: boolean }} RecordingInfo how long a recording plays, and whether it is already a tape */

/** SHA-256 of a file's bytes, hex. @param {ArrayBuffer} bytes */
async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(HEX).padStart(HEX_PAIR, '0')).join('');
}

/** When a recording was made: the date in its name, else the file's own time. @param {File} file */
export function recordedAt(file) {
  const match = DATE_IN_NAME.exec(file.name);
  if (!match) return file.lastModified || null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = Number(match[6] ?? 0);
  if (month < 1 || month > MAX_MONTH || day < 1 || day > MAX_DAY || hour > MAX_HOUR) return file.lastModified || null;
  const time = new Date(year, month - 1, day, hour, minute, second).getTime();
  return Number.isFinite(time) ? time : file.lastModified || null;
}

/** Whether a picked file is a recording the importer takes. @param {File} file */
export const isRecording = (file) => Boolean(audioType(file.name)) || file.type.startsWith('audio/');

class TapeImport {
  /** Files waiting, working, and the most recent finished ones. @type {QueueItem[]} */
  items = $state([]);
  done = $state(0);
  skipped = $state(0);
  failed = $state(0);
  /** Why the queue stopped early (storage full, too many uploads today), shown until the next import. */
  stopped = $state('');
  /** Bytes in and out, for "saved 80%". */
  sourceBytes = $state(0);
  storedBytes = $state(0);

  /** The originals by tape id, for this session: transcription reads them rather than the smaller copy. */
  originals = new Map();
  /** @type {Map<string, File>} */ #files = new Map();
  /** Recordings made in the app, by queue id (the same id they wait under on the device). @type {Map<string, RecordingInfo>} */ #recordings = new Map();
  #workers = 0;
  /** The signed-in account the queue works for. */
  #userId = '';
  /** Recordings still being written to the device: closing the tab now could lose them. */
  persisting = $state(0);

  /** Who the queue works for, so a recording can be tagged with the account that made it. */
  get userId() {
    return this.#userId;
  }

  constructor() {
    // Back online: what failed only for being offline goes again (recordings made offline upload by themselves).
    addEventListener('online', () => this.#retryOffline());
  }

  /** Something is being worked on, or waits and will be: a queue stopped early is idle, so Retry shows. */
  get active() {
    return this.items.some((item) => WORKING.includes(item.status) || (item.status === 'waiting' && !this.stopped));
  }

  get total() {
    return this.done + this.skipped + this.failed + this.items.filter((item) => !['done', 'skipped', 'failed'].includes(item.status)).length;
  }

  /** Queues recordings (anything that isn't audio is left out) and starts working. @param {File[]} files */
  add(files) {
    this.#newBatch();
    const known = new Set([...this.#files.values()].map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    for (const file of files.filter(isRecording)) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (known.has(key)) continue;
      known.add(key);
      const id = crypto.randomUUID();
      this.#files.set(id, file);
      this.items.push({ id, name: file.name, status: 'waiting', progress: 0, error: '', userId: this.#userId, recording: false });
    }
    this.#spawn();
  }

  /**
   * Queues a recording made in the app and keeps it on the device until it uploads. An encoded one (Opus in Ogg)
   * uploads as it is; a MediaRecorder one is shrunk like an import. One made by an account that is no longer signed in
   * (stopped at sign-out) is only kept, and goes up when that account signs back in.
   * @param {File} file @param {RecordingInfo & { userId: string }} info
   * @returns {{ id: string, kept: Promise<string> }} its queue id, to follow it as it saves, and '' once it is safely
   *   on the device, or why it couldn't be kept (then it lives only in memory until it uploads)
   */
  addRecording(file, { durationMs, encoded, userId }) {
    const id = crypto.randomUUID();
    this.persisting++;
    const kept = keepRecording({ id, userId, name: file.name, type: file.type, lastModified: file.lastModified, durationMs, encoded, blob: file })
      .then(() => '', (error) => /** @type {Error} */ (error)?.message || String(error))
      .finally(() => this.persisting--);
    if (userId === this.#userId) this.#queueRecording(id, file, { durationMs, encoded });
    return { id, kept };
  }

  /** Throws away a recording that keeps failing: off the queue and off the device. It has no other copy. @param {string} id */
  discard(id) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item?.recording || item.status !== 'failed') return;
    this.items = this.items.filter((entry) => entry.id !== id);
    this.#files.delete(id);
    this.#recordings.delete(id);
    this.failed = Math.max(0, this.failed - 1);
    forgetRecording(id).catch(() => {});
  }

  /** Puts back what failed only because the device was offline. */
  #retryOffline() {
    const offline = this.items.filter((item) => item.status === 'failed' && (item.error === OFFLINE || item.error === OFFLINE_RECORDING));
    if (!offline.length) return;
    for (const item of offline) Object.assign(item, { status: 'waiting', error: '', progress: 0 });
    this.failed = Math.max(0, this.failed - offline.length);
    if (this.stopped && !this.items.some((item) => item.status === 'failed')) this.stopped = '';
    this.#spawn();
  }

  /**
   * Works for another account (or none): its queue goes, and this account's recordings still waiting on the device come
   * back and upload. Imports from another account are dropped; their originals are still on disk.
   * @param {string | undefined} userId
   */
  async claim(userId = '') {
    if (userId === this.#userId) return;
    this.#userId = userId;
    for (const item of this.items) {
      this.#files.delete(item.id);
      this.#recordings.delete(item.id);
    }
    this.items = [];
    Object.assign(this, { done: 0, skipped: 0, failed: 0, sourceBytes: 0, storedBytes: 0, stopped: '' });
    if (!userId) return;
    const waiting = await waitingRecordings(userId).catch(() => []);
    // Signed in as someone else again while reading: their claim wins.
    if (this.#userId !== userId) return;
    for (const recording of waiting) {
      if (this.#files.has(recording.id)) continue;
      const file = new File([recording.blob], recording.name, { type: recording.type, lastModified: recording.lastModified });
      this.#queueRecording(recording.id, file, recording);
    }
  }

  /** @param {string} id @param {File} file @param {RecordingInfo} info */
  #queueRecording(id, file, { durationMs, encoded }) {
    this.#newBatch();
    this.#files.set(id, file);
    this.#recordings.set(id, { durationMs, encoded });
    this.items.push({ id, name: file.name, status: 'waiting', progress: 0, error: '', userId: this.#userId, recording: true });
    this.#spawn();
  }

  /** Puts failed files back in the queue. */
  retry() {
    for (const item of this.items) if (item.status === 'failed') Object.assign(item, { status: 'waiting', error: '', progress: 0 });
    this.failed = 0;
    this.stopped = '';
    this.#spawn();
  }

  /** Drops what hasn't started yet. */
  cancel() {
    // Recordings stay: they are kept on the device and have no other copy, so only imports are dropped.
    for (const item of this.items.filter((entry) => entry.status === 'waiting' && !entry.recording)) this.#files.delete(item.id);
    this.items = this.items.filter((item) => item.status !== 'waiting' || item.recording);
  }

  /** A new batch starts its counts over, but files that failed stay listed and counted, so Retry still reaches them. */
  #newBatch() {
    if (this.active) return;
    const failed = this.items.filter((item) => item.status === 'failed').length;
    Object.assign(this, { done: 0, skipped: 0, failed, sourceBytes: 0, storedBytes: 0, stopped: '' });
  }

  /** Starts workers up to what this device runs at once. */
  async #spawn() {
    let native = false;
    try {
      native = (await loadEncoders()).NATIVE_ENCODER;
    } catch {
      // The encoders couldn't load (offline): one worker still runs, and each item fails with the offline message
      // (recordings are already encoded and still go up); coming back online retries them.
    }
    // #work counts itself in before its first await, so this stops at the limit.
    while (this.#workers < (native ? NATIVE_WORKERS : WEB_WORKERS)) this.#work();
  }

  async #work() {
    this.#workers++;
    try {
      for (let item = this.#next(); item; item = this.#next()) await this.#importOne(item);
    } finally {
      this.#workers--;
    }
  }

  #next() {
    if (this.stopped) return null;
    return this.items.find((item) => item.status === 'waiting') ?? null;
  }

  /** @param {QueueItem} item */
  async #importOne(item) {
    const file = this.#files.get(item.id);
    // Only the account that queued it uploads it (claim() clears the rest; this guards a worker mid-loop).
    if (!file || item.userId !== this.#userId) return;
    try {
      const recording = this.#recordings.get(item.id);
      // An encoded recording needs no encoder, so it still uploads when the encoder file can't be fetched.
      const encoder = recording?.encoded ? null : await loadEncoders();
      const refusal = encoder?.tooLarge(file);
      if (refusal) throw new Error(refusal);
      item.status = 'reading';
      const bytes = await file.arrayBuffer();
      const hash = await sha256(bytes);
      const existing = store.tapes.find((tape) => tape.source_hash === hash && !tape.deleted_at);
      if (existing) {
        this.originals.set(existing.id, file);
        this.#finish(item, 'skipped');
        return;
      }
      if (!navigator.onLine) throw new Error(OFFLINE);
      item.status = 'encoding';
      const tape = encoder ? await encoder.encodeTape(file, bytes) : { file, durationMs: recording?.durationMs ?? 0, encoded: true };
      // A MediaRecorder file often can't say how long it plays; the recorder timed it.
      if (!tape.durationMs && recording) tape.durationMs = recording.durationMs;
      // The account may have changed while this encoded; the upload goes with whichever session is current, so recheck.
      if (item.userId !== this.#userId) return;
      item.status = 'uploading';
      const meta = { id: crypto.randomUUID(), name: file.name, hash, size: file.size, recorded_at: recordedAt(file), duration_ms: tape.durationMs };
      const answer = await uploadFile('/api/tapes', tape.file, (fraction) => (item.progress = fraction), { 'X-Tape': encodeURIComponent(JSON.stringify(meta)) });
      if (!answer?.tape?.id) throw new Error('The server sent no tape back. Retry this file.');
      // Signed out or switched while it uploaded: the tape is on the right account (its session sent it), but this
      // device's store now belongs to someone else, and the queue has moved on.
      if (item.userId !== this.#userId) return;
      store.adopt('tapes', [answer.tape]);
      this.originals.set(answer.tape.id, file);
      if (answer.code === TAPE_EXISTS) {
        this.#finish(item, 'skipped');
        return;
      }
      this.sourceBytes += file.size;
      this.storedBytes += tape.file.size;
      this.#finish(item, 'done');
    } catch (error) {
      const failure = /** @type {ApiError | Error} */ (error);
      item.status = 'failed';
      const offline = failure instanceof TypeError || failure.message === OFFLINE;
      item.error = offline ? (item.recording ? OFFLINE_RECORDING : OFFLINE) : failure.message;
      this.failed++;
      const status = failure instanceof ApiError ? failure.status : 0;
      if (STOPPERS.includes(status) || (failure instanceof ApiError && [TAPE_LIMIT, TAPE_STORAGE].includes(failure.code ?? ''))) this.stopped = failure.message;
    }
  }

  /** @param {QueueItem} item @param {'done' | 'skipped'} status */
  #finish(item, status) {
    item.status = status;
    item.progress = 1;
    this[status]++;
    this.#files.delete(item.id);
    // A recording is on the server now: the device copy can go.
    if (this.#recordings.delete(item.id)) forgetRecording(item.id).catch(() => {});
    // Keep the list short: finished items past the last few are only counted.
    const finished = this.items.filter((entry) => entry.status === 'done' || entry.status === 'skipped');
    if (finished.length > KEEP_DONE) {
      const drop = new Set(finished.slice(0, finished.length - KEEP_DONE).map((entry) => entry.id));
      this.items = this.items.filter((entry) => !drop.has(entry.id));
    }
  }
}

export const tapeImport = new TapeImport();
