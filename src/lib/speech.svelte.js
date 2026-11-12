// Local speech-to-text: speech models that run on this machine, so nothing you say leaves it. The engine lives in the
// desktop apps (src/tauri/src/speech/); this is everything the web side knows about it: which models exist (the
// catalog in speech-models.json, loaded on first use), which are downloaded, the download in progress, the settings,
// and starting and stopping a listening session. In a browser, and on phones for now, `available` stays false and
// the app falls back to the browser's own speech recognition (src/lib/listen.js).
// Settings stay on this device: a model on this machine means nothing on another.
import { Channel, invoke } from '@tauri-apps/api/core';
import { IS_NATIVE } from './api.js';
import { openMic } from './mic.js';

const SETTINGS_KEY = 'ws_speech';
const MODEL_HOST = 'https://huggingface.co';
// Downloaded bytes are handed to the app in pieces this big.
const DOWNLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const MS_PER_MINUTE = 60_000;
// Fast and accurate English that shows words while you speak; the model picked until you choose another.
export const DEFAULT_MODEL = 'parakeet-unified-en-0.6b';
/** Minutes a model stays in memory after you stop talking. UNLOAD_NEVER keeps it loaded, 0 frees it at once. */
export const UNLOAD_NEVER = -1;
export const UNLOAD_OPTIONS = [0, 5, 15, 60, UNLOAD_NEVER];
export const ACCELERATIONS = ['auto', 'cpu'];
export const MAX_WORDS = 100;
const DEFAULTS = { modelId: DEFAULT_MODEL, acceleration: 'auto', unloadMinutes: 15, language: '', words: /** @type {string[]} */ ([]) };
const DENIED_ERROR = 'NotAllowedError';

/**
 * @typedef {{ id: string, name: string, family: string, params: number | null, languages: string[], streaming: boolean, translates: boolean, license: string, repo: string, file: string, quant: string, size: number, sha256: string }} SpeechModel
 * @typedef {{ repo: string, file: string, size: number, sha256: string }} ModelFile
 * @typedef {{ onInterim: (text: string) => void, onFinal: (text: string) => void, onProblem: (kind: 'mic-denied' | 'mic' | 'speech', detail: string) => void, onEnd: () => void }} Listener
 */

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

class Speech {
  /** True in a desktop app that carries the speech engine. */
  available = $state(false);
  /** True once `available` is known (at once in a browser), so screens can wait instead of flashing the wrong state. */
  checked = $state(!IS_NATIVE);
  /** @type {{ version: string, vad: ModelFile, models: SpeechModel[] } | null} */
  catalog = $state(null);
  /** File names of the models on this machine. @type {string[]} */
  installed = $state([]);
  /** The download in progress, or the last one that failed. @type {{ id: string, received: number, size: number, error: string } | null} */
  download = $state(null);
  settings = $state(loadSettings());
  /** @type {'idle' | 'loading' | 'listening'} */
  phase = $state('idle');
  /** An utterance is being heard right now. */
  speaking = $state(false);
  /** Where the loaded model runs: "cpu", "metal"... */
  backend = $state('');

  /** @type {Promise<void> | undefined} */ #ready;
  /** @type {AbortController | null} */ #abort = null;
  /** @type {(() => void) | null} */ #closeMic = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ #unloadTimer;
  /** Counts sessions, so a session that was replaced can't change the state of the one after it. */ #run = 0;
  /** The session stop() was last called for, so a microphone that finishes opening after it is closed again. */ #stopped = 0;

  /** Finds out whether the engine is here and what is downloaded. Safe to call often; the work happens once. */
  init() {
    this.#ready ??= this.#init();
    return this.#ready;
  }

  async #init() {
    if (!IS_NATIVE) return;
    try {
      this.installed = await invoke('speech_models');
      this.catalog = (await import('./speech-models.json')).default;
      this.available = true;
    } catch {
      // A phone build, or a desktop build from before local speech: no engine.
    }
    this.checked = true;
  }

  /** The chosen model. @returns {SpeechModel | undefined} */
  get model() {
    return this.catalog?.models.find((model) => model.id === this.settings.modelId);
  }

  /** @param {SpeechModel} model */
  has(model) {
    return this.installed.includes(model.file);
  }

  /** True when the chosen model is downloaded and ready to listen. */
  get usable() {
    return Boolean(this.available && this.catalog && this.model && this.has(this.model) && this.installed.includes(this.catalog.vad.file));
  }

  /** @param {Partial<typeof DEFAULTS>} patch */
  configure(patch) {
    this.settings = { ...this.settings, ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    // A model that was only waiting out its timeout follows the new timeout.
    if (patch.unloadMinutes !== undefined && this.phase === 'idle') this.#scheduleUnload();
  }

  /**
   * Downloads a model (and, the first time, the small voice activity model every model needs), then selects it if
   * nothing usable was selected. One download at a time.
   * @param {SpeechModel} model
   */
  async install(model) {
    if (!this.catalog || this.#abort) return;
    const abort = new AbortController();
    this.#abort = abort;
    const vad = this.catalog.vad;
    const needsVad = !this.installed.includes(vad.file);
    this.download = { id: model.id, received: 0, size: model.size + (needsVad ? vad.size : 0), error: '' };
    try {
      if (needsVad) await this.#fetchFile(vad, 0, abort.signal);
      await this.#fetchFile(model, needsVad ? vad.size : 0, abort.signal);
      this.download = null;
      if (!this.usable) this.configure({ modelId: model.id });
    } catch (error) {
      await invoke('speech_download_cancel').catch(() => {});
      // A cancel leaves nothing to report; anything else stays on the row until the next try.
      this.download = abort.signal.aborted ? null : { ...this.download, error: /** @type {Error} */ (error).message || String(error) };
    }
    this.#abort = null;
    this.installed = await invoke('speech_models');
  }

  /**
   * Streams one file from the model host into the app, which checks its SHA-256 before keeping it.
   * @param {ModelFile} file @param {number} before bytes of this download already done @param {AbortSignal} signal
   */
  async #fetchFile(file, before, signal) {
    await invoke('speech_download_begin', { file: file.file, sha256: file.sha256 });
    const response = await fetch(`${MODEL_HOST}/${file.repo}/resolve/main/${file.file}`, { signal });
    if (!response.ok || !response.body) throw new Error(`The model host answered ${response.status}`);
    const reader = response.body.getReader();
    /** @type {Uint8Array[]} */
    let parts = [];
    let held = 0;
    const flush = async () => {
      const chunk = new Uint8Array(held);
      let offset = 0;
      for (const part of parts) {
        chunk.set(part, offset);
        offset += part.length;
      }
      parts = [];
      held = 0;
      const written = await invoke('speech_download_chunk', chunk);
      if (this.download) this.download.received = before + Number(written);
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        parts.push(value);
        held += value.length;
      }
      if (held >= DOWNLOAD_CHUNK_BYTES || (done && held)) await flush();
      if (done) break;
    }
    await invoke('speech_download_finish', { file: file.file });
  }

  cancelInstall() {
    this.#abort?.abort();
  }

  /** Deletes a downloaded model from this machine. @param {SpeechModel} model */
  async remove(model) {
    await invoke('speech_delete', { file: model.file }).catch(() => {});
    this.installed = await invoke('speech_models');
  }

  /**
   * Starts listening with the chosen model. One session at a time: starting again replaces the one running, which
   * still hands its listener the speech it already heard, then onEnd.
   * @param {Listener} listener
   */
  async start(listener) {
    const model = this.model;
    if (!this.usable || !model || !this.catalog) {
      listener.onProblem('speech', 'No speech model is downloaded');
      return listener.onEnd();
    }
    const run = ++this.#run;
    clearTimeout(this.#unloadTimer);
    this.#closeMic?.();
    this.#closeMic = null;
    this.phase = 'loading';
    this.speaking = false;
    const events = new Channel();
    // Words and the ending always reach this session's own listener; only the current session moves the shared state.
    events.onmessage = (/** @type {any} */ event) => {
      const current = run === this.#run;
      if (event.kind === 'listening' && current) {
        this.phase = 'listening';
        this.backend = event.backend;
      } else if (event.kind === 'speaking' && current) {
        this.speaking = true;
      } else if (event.kind === 'interim') {
        listener.onInterim(event.text);
      } else if (event.kind === 'final') {
        if (current) this.speaking = false;
        listener.onFinal(event.text);
      } else if (event.kind === 'stopped' || event.kind === 'error') {
        if (event.kind === 'error') listener.onProblem('speech', event.message);
        if (current) this.#finish();
        listener.onEnd();
      }
    };
    try {
      await invoke('speech_start', {
        model: model.file, vad: this.catalog.vad.file, cpuOnly: this.settings.acceleration === 'cpu',
        language: model.languages.includes(this.settings.language) ? this.settings.language : null,
        vocabulary: this.settings.words, onEvent: events,
      });
    } catch (error) {
      // The engine never started, so no Stopped will come.
      listener.onProblem('speech', /** @type {Error} */ (error).message || String(error));
      if (run === this.#run) this.#finish();
      return listener.onEnd();
    }
    try {
      const close = await openMic((audio) => invoke('speech_feed', audio).catch(() => {}));
      // Stopped or replaced while the microphone was still opening.
      if (run !== this.#run || this.#stopped === run) return close();
      this.#closeMic = close;
    } catch (error) {
      if (run !== this.#run) return;
      const denied = /** @type {Error} */ (error).name === DENIED_ERROR;
      listener.onProblem(denied ? 'mic-denied' : 'mic', /** @type {Error} */ (error).message || String(error));
      this.stop();
    }
  }

  /** Stops listening. Speech already heard still arrives (onFinal), then onEnd. */
  stop() {
    this.#stopped = this.#run;
    this.#closeMic?.();
    this.#closeMic = null;
    if (this.phase !== 'idle') invoke('speech_stop').catch(() => {});
  }

  #finish() {
    this.#closeMic?.();
    this.#closeMic = null;
    this.phase = 'idle';
    this.speaking = false;
    this.#scheduleUnload();
  }

  /** Frees the model's memory once it has sat unused for the chosen time. */
  #scheduleUnload() {
    clearTimeout(this.#unloadTimer);
    const minutes = this.settings.unloadMinutes;
    if (minutes === UNLOAD_NEVER) return;
    this.#unloadTimer = setTimeout(() => {
      if (this.phase === 'idle') invoke('speech_unload').catch(() => {});
    }, minutes * MS_PER_MINUTE);
  }
}

export const speech = new Speech();
