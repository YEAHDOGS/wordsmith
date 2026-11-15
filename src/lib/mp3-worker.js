// Encodes a recording to MP3 off the main thread with lame (@breezystack/lamejs, LGPL-3.0: it loads as this separate
// chunk only when someone exports an MP3, so it stays out of the app bundle and can be swapped on its own).
// In:  { pcm: ArrayBuffer of 16-bit mono samples, sampleRate, kbps }
// Out: { progress: 0..1 } now and then, then { blob } (audio/mpeg), or { error }.
import { encodeMp3 } from './mp3-encode.js';

self.onmessage = async (/** @type {MessageEvent} */ event) => {
  try {
    const blob = await encodeMp3(event.data, (progress) => self.postMessage({ progress }));
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: String(/** @type {Error} */ (error)?.message || error) });
  }
};
