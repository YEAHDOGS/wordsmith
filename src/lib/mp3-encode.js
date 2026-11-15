// MP3 encoding with lame (@breezystack/lamejs). Runs in src/lib/mp3-worker.js; on a browser that can't start module
// workers it runs here on the main thread instead, a slice at a time so the page keeps responding.
import { Mp3Encoder } from '@breezystack/lamejs';

const MP3_TYPE = 'audio/mpeg';
const CHANNELS = 1;
// lame takes 1152 samples per MP3 frame; feeding whole frames keeps its buffers small.
const FRAME_SAMPLES = 1_152;
// Progress is reported, and the main thread gets a breath, every this many frames.
const FRAMES_PER_SLICE = 256;

/**
 * @param {{ pcm: ArrayBuffer, sampleRate: number, kbps: number }} input 16-bit mono samples
 * @param {(progress: number) => void} onProgress
 * @returns {Promise<Blob>}
 */
export async function encodeMp3({ pcm, sampleRate, kbps }, onProgress) {
  const samples = new Int16Array(pcm);
  const encoder = new Mp3Encoder(CHANNELS, sampleRate, kbps);
  /** @type {Uint8Array[]} */
  const parts = [];
  const slice = FRAME_SAMPLES * FRAMES_PER_SLICE;
  for (let start = 0; start < samples.length; start += FRAME_SAMPLES) {
    const out = encoder.encodeBuffer(samples.subarray(start, start + FRAME_SAMPLES));
    if (out.length) parts.push(new Uint8Array(out));
    if (start % slice !== 0) continue;
    onProgress(start / samples.length);
    await new Promise((resolve) => setTimeout(resolve));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  onProgress(1);
  return new Blob(parts, { type: MP3_TYPE });
}
