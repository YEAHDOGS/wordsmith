// One way to hear the user, whichever speech engine this device has. In the desktop apps with a downloaded model,
// speech is transcribed on this machine (src/lib/speech.svelte.js). Everywhere else it is the browser's own speech
// recognition, where the browser has one (Chrome, Edge and Safari send the audio to their maker's service; Firefox
// and most phone WebViews have none). Scribe and the dictation button both listen through here, one at a time.
import { speech } from './speech.svelte.js';

// Recognition errors that are part of normal use: silence, and our own stop().
const QUIET_ERRORS = ['no-speech', 'aborted'];
const DENIED_ERRORS = ['not-allowed', 'service-not-allowed'];

const Recognition = typeof window === 'undefined' ? null : /** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition || null;

// Finds a downloaded local model as soon as anything can listen. Does nothing in a browser.
speech.init();

/** The session that is listening now, if any. @type {{ stop: () => void } | null} */
let active = null;

/** 'local' (a model on this machine), 'browser', or '' when this device can't listen at all. */
export function listenEngine() {
  if (speech.usable) return 'local';
  return Recognition ? 'browser' : '';
}

/**
 * The browser's recognition, restarted for as long as the session is wanted: browsers end it after a silence or a
 * few minutes.
 * @param {import('./speech.svelte.js').Listener} listener
 */
function browserSession(listener) {
  let wanted = true;
  /** @type {any} */
  let recognition = null;
  const end = () => {
    if (!wanted) return;
    wanted = false;
    listener.onEnd();
  };
  const begin = () => {
    recognition = new Recognition();
    const current = recognition;
    current.continuous = true;
    current.interimResults = true;
    current.lang = navigator.language || 'en-US';
    current.onresult = (/** @type {any} */ event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) listener.onFinal(result[0].transcript);
        else interim += result[0].transcript;
      }
      listener.onInterim(interim.trim());
    };
    current.onerror = (/** @type {any} */ event) => {
      if (QUIET_ERRORS.includes(event.error)) return;
      listener.onProblem(DENIED_ERRORS.includes(event.error) ? 'mic-denied' : 'mic', event.error);
      end();
    };
    current.onend = () => {
      if (wanted && recognition === current) begin();
    };
    try {
      current.start();
    } catch (error) {
      listener.onProblem('mic', /** @type {Error} */ (error).message);
      end();
    }
  };
  begin();
  return {
    stop() {
      const stopping = recognition;
      recognition = null;
      stopping?.stop();
      end();
    },
  };
}

/**
 * Starts listening; whatever was listening before stops first.
 * @param {import('./speech.svelte.js').Listener} listener
 * @returns {{ stop: () => void }}
 */
export function listen(listener) {
  active?.stop();
  /** @type {{ stop: () => void }} */
  let session;
  const wrapped = { ...listener, onEnd: () => {
    if (active === session) active = null;
    listener.onEnd();
  } };
  if (listenEngine() === 'local') {
    speech.start(wrapped);
    session = { stop: () => speech.stop() };
  } else {
    session = browserSession(wrapped);
  }
  active = session;
  return session;
}
