// Importing tapes: recordings picked or dropped on the Tapes page (a whole recorder folder at once is fine) go
// through a queue: read the file, hash it, skip it if that file is already a tape, shrink it (tape-encode.js), and
// upload it (POST /api/tapes), which creates the tape. The server knows every file by its hash too, so importing the
// same folder again, after a crash or on another device, only adds what's new: that's how an import resumes.
// The queue lives here, outside the page, so leaving the Tapes page doesn't stop it.
import { ApiError, uploadFile } from './api.js';
import { NATIVE_ENCODER, encodeTape } from './tape-encode.js';
import { store } from './store.svelte.js';
import { MAX_TAPE_SOURCE_BYTES, TAPE_EXISTS, TAPE_LIMIT, audioType } from './models.js';

// The desktop encoder runs on its own threads, so two files encode while others upload; a phone does one at a time.
const WORKERS = NATIVE_ENCODER ? 2 : 1;
const RATE_LIMITED = 429;
const STORAGE_FULL = 507;
// Errors that stop the whole queue: nothing after them would get in either.
const STOPPERS = [RATE_LIMITED, STORAGE_FULL, 401];
const OFFLINE = "You're offline. Import again when you're back; finished tapes are kept.";
// Recorder apps name files after the moment they started: 2024-05-12 14-33-01, 20240512_143301, 2024.05.12-14.33...
const DATE_IN_NAME = /(20\d{2})[-_. ]?([01]\d)[-_. ]?([0-3]\d)[-_. T]*([0-2]\d)[-_.: h]?([0-5]\d)(?:[-_.: m]?([0-5]\d))?/;
const HEX = 16;
const HEX_PAIR = 2;
// Recent finished items stay listed so the page can show what just landed; the rest are counted.
const KEEP_DONE = 20;

/** @typedef {'waiting' | 'reading' | 'encoding' | 'uploading' | 'done' | 'skipped' | 'failed'} ItemStatus */
/** @typedef {{ id: string, name: string, status: ItemStatus, progress: number, error: string }} QueueItem */

/** SHA-256 of a file's bytes, hex. @param {ArrayBuffer} bytes */
async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(HEX).padStart(HEX_PAIR, '0')).join('');
}

/** When a recording was made: the date in its name, else the file's own time. @param {File} file */
export function recordedAt(file) {
  const match = DATE_IN_NAME.exec(file.name);
  if (!match) return file.lastModified || null;
  const [, year, month, day, hour, minute, second = '0'] = match.map(Number);
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
  #workers = 0;

  get active() {
    return this.items.some((item) => !['done', 'skipped', 'failed'].includes(item.status));
  }

  get total() {
    return this.done + this.skipped + this.failed + this.items.filter((item) => !['done', 'skipped', 'failed'].includes(item.status)).length;
  }

  /** Queues recordings (anything that isn't audio is left out) and starts working. @param {File[]} files */
  add(files) {
    if (!this.active) Object.assign(this, { done: 0, skipped: 0, failed: 0, sourceBytes: 0, storedBytes: 0, stopped: '' });
    const known = new Set([...this.#files.values()].map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    for (const file of files.filter(isRecording)) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (known.has(key)) continue;
      known.add(key);
      const id = crypto.randomUUID();
      this.#files.set(id, file);
      this.items.push({ id, name: file.name, status: 'waiting', progress: 0, error: '' });
    }
    while (this.#workers < WORKERS) this.#work();
  }

  /** Puts failed files back in the queue. */
  retry() {
    for (const item of this.items) if (item.status === 'failed') Object.assign(item, { status: 'waiting', error: '', progress: 0 });
    this.failed = 0;
    this.stopped = '';
    while (this.#workers < WORKERS) this.#work();
  }

  /** Drops what hasn't started yet. */
  cancel() {
    for (const item of this.items.filter((entry) => entry.status === 'waiting')) this.#files.delete(item.id);
    this.items = this.items.filter((item) => item.status !== 'waiting');
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
    if (!file) return;
    try {
      if (file.size > MAX_TAPE_SOURCE_BYTES) throw new Error(`${file.name} is too large to be a recording.`);
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
      const tape = await encodeTape(file, bytes);
      item.status = 'uploading';
      const meta = { id: crypto.randomUUID(), name: file.name, hash, size: file.size, recorded_at: recordedAt(file), duration_ms: tape.durationMs };
      const answer = await uploadFile('/api/tapes', tape.file, (fraction) => (item.progress = fraction), { 'X-Tape': encodeURIComponent(JSON.stringify(meta)) });
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
      item.error = failure instanceof TypeError ? OFFLINE : failure.message;
      this.failed++;
      const status = failure instanceof ApiError ? failure.status : 0;
      if (STOPPERS.includes(status) || (failure instanceof ApiError && failure.code === TAPE_LIMIT)) this.stopped = failure.message;
    }
  }

  /** @param {QueueItem} item @param {'done' | 'skipped'} status */
  #finish(item, status) {
    item.status = status;
    item.progress = 1;
    this[status]++;
    this.#files.delete(item.id);
    // Keep the list short: finished items past the last few are only counted.
    const finished = this.items.filter((entry) => entry.status === 'done' || entry.status === 'skipped');
    if (finished.length > KEEP_DONE) {
      const drop = new Set(finished.slice(0, finished.length - KEEP_DONE).map((entry) => entry.id));
      this.items = this.items.filter((entry) => !drop.has(entry.id));
    }
  }
}

export const tapeImport = new TapeImport();
