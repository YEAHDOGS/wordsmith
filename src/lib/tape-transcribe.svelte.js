// Transcribing tapes on the desktop apps, with the local speech engine Scribe uses (src/tauri/src/speech/mod.rs,
// speech_transcribe): nothing you recorded leaves the machine to be turned into text, and it costs nothing. "Transcribe
// all" works through every tape without a transcript, newest first, one at a time in the background; the text syncs
// to your other devices like any edit. It reads the original file when this session imported it (better audio), else
// downloads the stored copy. Scribe always comes first: while it listens, transcribing waits and then carries on.
// Where there's no local engine (the web app, phones), one tape at a time goes to wordsmith cloud instead
// (POST /api/tapes/:id/transcribe), free for a few minutes a day: the page points to the desktop app for the rest.
import { invoke } from '@tauri-apps/api/core';
import { ApiError, api, mediaUrl } from './api.js';
import { speech } from './speech.svelte.js';
import { store } from './store.svelte.js';
import { tapeImport } from './tapes.svelte.js';
import { TAPE_CLOUD_ALLOWANCE, TAPE_TYPE, fileExtension } from './models.js';

// How often a waiting queue looks again for Scribe to finish.
const WAIT_MS = 15_000;
// The engine's answers when Scribe has it (speech/mod.rs BUSY and INTERRUPTED): wait and try again, not a failure.
const YIELDED = /Scribe (is|started) listening/;
const OGG_EXTENSION = 'ogg';
const NO_MODEL = 'Download a speech model in Settings → Local speech first.';
const MS_PER_MINUTE = 60_000;
const KEPT_EDITS = 'You edited the transcript while it was being made, so your text was kept. Transcribe again to replace it.';

/** @typedef {{ available: boolean, used: number, limit: number }} CloudAllowance minutes of wordsmith cloud today */

/** The tapes still to transcribe, newest recording first. */
const untranscribed = () => store.tapes
  .filter((tape) => !tape.deleted_at && !tape.transcribed_at && tape.audio_size > 0)
  .sort((a, b) => (b.recorded_at ?? b.created_at) - (a.recorded_at ?? a.created_at));

class TapeTranscriber {
  /** "Transcribe all" is on: the queue keeps going until every tape has text. */
  running = $state(false);
  /** The tape being transcribed now. @type {string} */
  current = $state('');
  /** Transcribed this run. */
  done = $state(0);
  /** Waiting for Scribe to stop listening. */
  waiting = $state(false);
  error = $state('');
  /** Tapes that failed this session, by id, so the queue moves past them. @type {Map<string, string>} */
  failures = $state(new Map());

  /** wordsmith cloud's free minutes today, on devices without a local engine; null until asked. @type {CloudAllowance | null} */
  cloud = $state(null);

  /** @type {ReturnType<typeof setTimeout> | undefined} */ #timer;
  #working = false;

  /** Tapes left to transcribe (failed ones included, so the count is honest). */
  get remaining() {
    return untranscribed().length;
  }

  /** Free cloud minutes left today. */
  get cloudLeft() {
    return this.cloud ? Math.max(0, this.cloud.limit - this.cloud.used) : 0;
  }

  /** Whether a tape fits in what's left of today's cloud minutes. @param {any} tape */
  fitsCloud(tape) {
    // Only tapes the app shrank to Opus: the cloud counts their length from the audio itself.
    return Boolean(this.cloud?.available) && tape.audio_type === TAPE_TYPE && Math.max(1, (tape.duration_ms || 0) / MS_PER_MINUTE) <= this.cloudLeft;
  }

  /** Asks how many cloud minutes are left today, where there's no local engine. */
  async loadCloud() {
    await speech.init();
    if (speech.available) return;
    try {
      this.cloud = await api('/api/tapes/transcription');
    } catch {
      this.cloud = null;
    }
  }

  /** Whether this device can transcribe at all: a desktop app with a speech model downloaded. */
  get ready() {
    return speech.available && speech.usable;
  }

  /** Starts working through every tape without a transcript. */
  async start() {
    await speech.init();
    if (!this.ready) {
      this.error = NO_MODEL;
      return;
    }
    // A new run tries again the tapes that failed before.
    Object.assign(this, { running: true, done: 0, error: '', waiting: false, failures: new Map() });
    this.#loop();
  }

  stop() {
    this.running = false;
    this.waiting = false;
    clearTimeout(this.#timer);
  }

  /** Transcribes one tape now (the button on an open tape): on this device, or with wordsmith cloud. @param {any} tape */
  async one(tape) {
    await speech.init();
    if (!speech.available) return this.#cloud(tape);
    if (!this.ready) {
      this.error = NO_MODEL;
      return;
    }
    await this.#transcribe(tape);
  }

  async #loop() {
    if (this.#working || !this.running) return;
    this.#working = true;
    try {
      for (let tape = this.#next(); tape && this.running; tape = this.#next()) {
        if (speech.phase !== 'idle' || !(await this.#transcribe(tape))) {
          this.waiting = true;
          this.#timer = setTimeout(() => this.#loop(), WAIT_MS);
          return;
        }
      }
      if (!this.#next()) this.running = false;
    } finally {
      this.#working = false;
    }
  }

  #next() {
    return untranscribed().find((tape) => !this.failures.has(tape.id)) ?? null;
  }

  /**
   * Turns one tape into text and saves it. False when Scribe has the engine (try again later).
   * @param {any} tape
   */
  async #transcribe(tape) {
    const model = speech.model;
    const catalog = speech.catalog;
    if (!model || !catalog) return false;
    this.current = tape.id;
    this.waiting = false;
    const before = tape.transcript;
    try {
      // The original when it can still be read (it may have been moved or deleted since), else the stored copy.
      const original = tapeImport.originals.get(tape.id);
      const local = original ? await original.arrayBuffer().catch(() => null) : null;
      const bytes = local ?? (await this.#download(tape));
      const extension = local && original ? fileExtension(original.name).slice(1) : OGG_EXTENSION;
      /** @type {string} */
      const text = await invoke('speech_transcribe', new Uint8Array(bytes), {
        headers: {
          'speech-model': model.file,
          'speech-vad': catalog.vad.file,
          'speech-cpu-only': speech.settings.acceleration === 'cpu' ? '1' : '0',
          'speech-language': model.languages.includes(speech.settings.language) ? speech.settings.language : '',
          'tape-extension': extension,
        },
      });
      if (this.#edited(tape.id, before)) return true;
      store.update('tapes', tape.id, { transcript: text, transcript_model: model.id, transcribed_at: Date.now() });
      this.done++;
      return true;
    } catch (error) {
      const message = /** @type {Error} */ (error)?.message ?? String(error);
      if (YIELDED.test(message)) return false;
      this.failures.set(tape.id, message);
      this.failures = new Map(this.failures);
      return true;
    } finally {
      this.current = '';
    }
  }

  /** Transcribes one tape with wordsmith cloud and saves the text. @param {any} tape */
  async #cloud(tape) {
    if (this.current) return;
    this.current = tape.id;
    this.error = '';
    const before = tape.transcript;
    try {
      const answer = await api(`/api/tapes/${tape.id}/transcribe`, { method: 'POST' });
      this.cloud = { available: true, used: answer.used, limit: answer.limit };
      if (this.#edited(tape.id, before)) return;
      // Saved as an edit, not adopted: an unsynced note on this tape would otherwise push an empty transcript over it.
      const { transcript, transcript_model, transcribed_at } = answer.tape;
      store.update('tapes', tape.id, { transcript, transcript_model, transcribed_at });
      if (this.failures.delete(tape.id)) this.failures = new Map(this.failures);
    } catch (error) {
      const failure = /** @type {Error} */ (error);
      if (failure instanceof ApiError && failure.code === TAPE_CLOUD_ALLOWANCE && this.cloud) this.cloud = { ...this.cloud, used: this.cloud.limit };
      this.failures.set(tape.id, failure.message);
      this.failures = new Map(this.failures);
    } finally {
      this.current = '';
    }
  }

  /**
   * Whether the transcript was edited while it was being made: the edit wins, and the tape says why.
   * @param {string} id @param {string} before the transcript when transcribing started
   */
  #edited(id, before) {
    const now = store.find('tapes', id);
    if (!now || now.transcript === before) return false;
    this.failures.set(id, KEPT_EDITS);
    this.failures = new Map(this.failures);
    return true;
  }

  /** The stored copy of a tape's audio. @param {any} tape */
  async #download(tape) {
    const url = await mediaUrl(`/api/tapes/${tape.id}/audio`);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Couldn't download this tape (${response.status})`);
      return await response.arrayBuffer();
    } finally {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
  }
}

export const transcriber = new TapeTranscriber();
