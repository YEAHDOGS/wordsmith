// Export jobs for the recording panel (src/components/RecorderPanel.svelte): WAV straight away, MP3 through lame in a
// worker. One job at a time; progress and the outcome are shown in the panel. Sessions save to Tapes by themselves
// (src/lib/scribe-tapes.svelte.js). The video export lives in VisualizerStudio.svelte.
import { recorder } from '../lib/recorder.svelte.js';
import { saveFile } from '../lib/save-file.js';
import TEXT from './recorder.json';

const MP3_EXTENSION = '.mp3';
const WAV_EXTENSION = '.wav';
// A finished job's note stays this long.
const NOTE_MS = 4_000;
const PERCENT = 100;

class RecorderExports {
  /** @type {'' | 'mp3'} */
  busy = $state('');
  progress = $state(0);
  /** What just happened, or what went wrong. */
  note = $state('');
  failed = $state(false);
  /** @type {AbortController | null} */ #job = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ #timer;

  get percent() {
    return Math.round(this.progress * PERCENT);
  }

  /** @param {string} note @param {boolean} [failed] */
  #tell(note, failed = false) {
    clearTimeout(this.#timer);
    this.note = note;
    this.failed = failed;
    this.#timer = setTimeout(() => (this.note = ''), NOTE_MS);
  }

  async wav() {
    const wav = recorder.wav();
    if (!wav) return;
    const name = recorder.fileName(WAV_EXTENSION);
    await saveFile(wav, name);
    this.#tell(TEXT.saved.replace('{name}', name));
  }

  async #encode() {
    if (this.busy || !recorder.hasAudio) return null;
    this.busy = 'mp3';
    this.progress = 0;
    this.#job = new AbortController();
    try {
      return await recorder.mp3((progress) => (this.progress = progress), this.#job.signal);
    } catch (error) {
      if (/** @type {Error} */ (error)?.name !== 'AbortError') this.#tell(TEXT.problems.export.replace('{detail}', String(/** @type {Error} */ (error)?.message || error)), true);
      return null;
    } finally {
      this.busy = '';
      this.#job = null;
    }
  }

  async mp3() {
    const blob = await this.#encode();
    if (!blob) return;
    const name = recorder.fileName(MP3_EXTENSION);
    await saveFile(blob, name);
    this.#tell(TEXT.saved.replace('{name}', name));
  }

  cancel() {
    this.#job?.abort();
  }
}

export const recorderExports = new RecorderExports();
