// The Tapes page's player: one audio element for every tape, so starting one stops the last. Next and previous
// follow the list as it's shown (sorted and searched). On phones the lock screen and headphone buttons drive it
// too (Media Session). The Tapes page pauses it when you leave.
import { mediaUrl } from '../lib/api.js';

const SKIP_SECONDS = 10;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const CLOCK_DIGITS = 2;
// Pressing previous this far into a tape starts it over instead of going back.
const RESTART_AFTER_S = 3;
const MEDIA_ACTIONS = /** @type {const} */ (['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward']);

/** h:mm:ss or m:ss. @param {number} seconds */
export function clock(seconds) {
  const whole = Math.max(0, Math.floor(seconds || 0));
  const [hours, minutes, rest] = [Math.floor(whole / SECONDS_PER_HOUR), Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE), whole % SECONDS_PER_MINUTE];
  const pad = (/** @type {number} */ value) => String(value).padStart(CLOCK_DIGITS, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

class TapePlayer {
  /** The tape playing or paused, or null when the player is closed. @type {any} */
  tape = $state(null);
  playing = $state(false);
  loading = $state(false);
  time = $state(0);
  duration = $state(0);
  error = $state('');
  /** The tapes in the order the page shows them: next and previous walk this. @type {any[]} */
  order = [];

  /** @type {HTMLAudioElement | null} */ #audio = null;
  #url = '';

  #element() {
    if (this.#audio) return this.#audio;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('timeupdate', () => (this.time = audio.currentTime));
    audio.addEventListener('durationchange', () => (this.duration = Number.isFinite(audio.duration) ? audio.duration : this.duration));
    audio.addEventListener('play', () => (this.playing = true));
    audio.addEventListener('pause', () => (this.playing = false));
    audio.addEventListener('ended', () => this.next());
    audio.addEventListener('error', () => {
      if (this.tape) this.error = 'error';
    });
    this.#audio = audio;
    this.#mediaSession();
    return audio;
  }

  /** Plays a tape from the start, or toggles it when it's the one loaded. @param {any} tape */
  async play(tape) {
    if (this.tape?.id === tape.id) return this.toggle();
    const audio = this.#element();
    audio.pause();
    this.#release();
    Object.assign(this, { tape, time: 0, duration: (tape.duration_ms || 0) / 1000, error: '', loading: true });
    try {
      const url = await mediaUrl(`/api/tapes/${tape.id}/audio`);
      // Another tape was picked while this one loaded.
      if (this.tape?.id !== tape.id) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        return;
      }
      this.#url = url;
      audio.src = url;
      await audio.play();
      if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: tape.title || tape.source_name, artist: 'wordsmith' });
    } catch {
      this.error = 'error';
    } finally {
      this.loading = false;
    }
  }

  toggle() {
    const audio = this.#audio;
    if (!audio || !this.tape) return;
    if (audio.paused) audio.play().catch(() => (this.error = 'error'));
    else audio.pause();
  }

  pause() {
    this.#audio?.pause();
  }

  /** @param {number} seconds */
  seek(seconds) {
    if (!this.#audio) return;
    this.#audio.currentTime = Math.max(0, Math.min(seconds, this.duration || seconds));
  }

  next() {
    const index = this.order.findIndex((tape) => tape.id === this.tape?.id);
    const following = this.order[index + 1];
    if (following) this.play(following);
    else this.#audio?.pause();
  }

  previous() {
    if (this.time > RESTART_AFTER_S) return this.seek(0);
    const index = this.order.findIndex((tape) => tape.id === this.tape?.id);
    if (index > 0) this.play(this.order[index - 1]);
  }

  /** Stops and hides the player. */
  close() {
    this.#audio?.pause();
    this.#release();
    this.tape = null;
  }

  #release() {
    if (this.#audio) this.#audio.removeAttribute('src');
    if (this.#url.startsWith('blob:')) URL.revokeObjectURL(this.#url);
    this.#url = '';
  }

  #mediaSession() {
    if (!('mediaSession' in navigator)) return;
    /** @type {Record<(typeof MEDIA_ACTIONS)[number], () => void>} */
    const handlers = {
      play: () => this.toggle(),
      pause: () => this.pause(),
      previoustrack: () => this.previous(),
      nexttrack: () => this.next(),
      seekbackward: () => this.seek(this.time - SKIP_SECONDS),
      seekforward: () => this.seek(this.time + SKIP_SECONDS),
    };
    for (const action of MEDIA_ACTIONS) {
      try {
        navigator.mediaSession.setActionHandler(action, handlers[action]);
      } catch {
        // This browser doesn't offer that action.
      }
    }
  }
}

export const player = new TapePlayer();
