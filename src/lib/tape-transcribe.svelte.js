// Transcribing tapes on the desktop apps, with the local speech engine Scribe uses (src/tauri/src/speech/mod.rs,
// speech_transcribe): nothing you recorded leaves the machine to be turned into text, and it costs nothing. "Transcribe
// all" works through every tape without a transcript, newest first, one at a time in the background; the text syncs
// to your other devices like any edit. It reads the original file when this session imported it (better audio), else
// downloads the stored copy. Scribe always comes first: while it listens, transcribing waits and then carries on.
import { invoke } from '@tauri-apps/api/core';
import { mediaUrl } from './api.js';
import { speech } from './speech.svelte.js';
import { store } from './store.svelte.js';
import { tapeImport } from './tapes.svelte.js';
import { fileExtension } from './models.js';

// How often a waiting queue looks again for Scribe to finish.
const WAIT_MS = 15_000;
// The engine's answers when Scribe has it (speech/mod.rs BUSY and INTERRUPTED): wait and try again, not a failure.
const YIELDED = /Scribe (is|started) listening/;
const OGG_EXTENSION = 'ogg';
const NO_MODEL = 'Download a speech model in Settings → Local speech first.';

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

  /** @type {ReturnType<typeof setTimeout> | undefined} */ #timer;
  #working = false;

  /** Tapes left to transcribe (failed ones included, so the count is honest). */
  get remaining() {
    return untranscribed().length;
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
    Object.assign(this, { running: true, done: 0, error: '' });
    this.#loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this.#timer);
  }

  /** Transcribes one tape now (the button on an open tape). @param {any} tape */
  async one(tape) {
    await speech.init();
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
    try {
      const original = tapeImport.originals.get(tape.id);
      const bytes = original ? await original.arrayBuffer() : await this.#download(tape);
      const extension = original ? fileExtension(original.name).slice(1) : OGG_EXTENSION;
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

  /** The stored copy of a tape's audio. @param {any} tape */
  async #download(tape) {
    const url = await mediaUrl(`/api/tapes/${tape.id}/audio`);
    try {
      return await (await fetch(url)).arrayBuffer();
    } finally {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
  }
}

export const transcriber = new TapeTranscriber();
