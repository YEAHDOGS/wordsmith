// Shrinks a recording to Opus at a voice bitrate (TAPE_BITRATE, mono) before it uploads: a 128 kbps MP3 comes out
// about a fifth of its size, which is what lets thousands of recordings fit R2's free tier. Three ways, best first:
// - the desktop apps: libopus in Rust (src/tauri/src/tapes/mod.rs) streams through files of any length;
// - phones and browsers: the browser's own Opus encoder (WebCodecs). The decoded audio is held in memory while it
//   encodes, so this way takes recordings up to MAX_WEB_SOURCE_BYTES; longer ones import from the desktop app;
// - a browser with no Opus encoder (older Safari) uploads the recording as it is, when it fits MAX_TAPE_BYTES.
// Both encoders hand back bare Opus packets, which src/lib/ogg-opus.js wraps into the .ogg that uploads.
import { invoke } from '@tauri-apps/api/core';
import { IS_NATIVE } from './api.js';
import { visitorPlatform } from './github-public.js';
import { oggOpus } from './ogg-opus.js';
import { MAX_TAPE_BYTES, MAX_TAPE_SOURCE_BYTES, TAPE_BITRATE, TAPE_EXTENSION, TAPE_TYPE, audioType, fileExtension } from './models.js';

const OPUS_RATE = 48_000;
// What the browser decodes to before encoding: Opus keeps speech and a beat at 24 kHz, and it halves the memory.
const WEB_RATE = 24_000;
const WEB_FRAME_US = 20_000;
// Encode in 0.2 s pieces, and let at most this many wait in the encoder at once.
const WEB_CHUNK_FRAMES = 4_800;
const MAX_QUEUED = 8;
const US_PER_SECOND = 1_000_000;
const MS_PER_SECOND = 1_000;
// About 30 minutes of a 128 kbps MP3, a few hundred MB once decoded. Phones can't safely hold more.
const MAX_WEB_SOURCE_BYTES = 30 * 1024 * 1024;
// libopus's delay at 48 kHz, used when the browser doesn't say its own (it is in the OpusHead it may hand back).
const DEFAULT_PRE_SKIP = 312;
const OPUS_HEAD_PRE_SKIP = 10;
// The desktop encoder's answer: pre-skip (u32), samples (u64), then u16-length-prefixed packets.
const NATIVE_HEADER_BYTES = 12;
const PACKET_LENGTH_BYTES = 2;
const NATIVE_FRAME_SAMPLES = 960;
const EXTENSION_HEADER = 'tape-extension';
const BYTES_PER_MB = 1024 * 1024;
const WEB_CONFIG = { codec: 'opus', sampleRate: WEB_RATE, numberOfChannels: 1, bitrate: TAPE_BITRATE, opus: { frameDuration: WEB_FRAME_US, application: 'audio' } };

/** The desktop apps carry libopus; Android and iOS don't. */
export const NATIVE_ENCODER = IS_NATIVE && !['android', 'ios'].includes(visitorPlatform());

/** @param {number} bytes */
const megabytes = (bytes) => `${Math.round(bytes / BYTES_PER_MB)} MB`;

/**
 * Why a recording is too big to import here, or '' if it isn't. Checked before the file is read, so a phone never
 * loads a 500 MB file just to refuse it. @param {File} source
 */
export function tooLarge(source) {
  if (source.size > MAX_TAPE_SOURCE_BYTES) return `${source.name} is too large to be a recording.`;
  if (!NATIVE_ENCODER && source.size > MAX_WEB_SOURCE_BYTES) return `${source.name} is ${megabytes(source.size)}. Recordings over ${megabytes(MAX_WEB_SOURCE_BYTES)} import from the wordsmith desktop app.`;
  return '';
}

/** @typedef {{ file: File, durationMs: number, encoded: boolean }} EncodedTape the upload, how long it plays, and whether it was shrunk */

/**
 * The tape to upload for a recording: Opus in an Ogg file, or the original where no encoder is available.
 * @param {File} source the original recording
 * @param {ArrayBuffer} bytes its contents, already read (for the hash)
 * @returns {Promise<EncodedTape>}
 */
export async function encodeTape(source, bytes) {
  const name = source.name.replace(/\.[^.]+$/, '') + TAPE_EXTENSION;
  if (NATIVE_ENCODER) return packed(await nativePackets(source, bytes), name);
  if (await webEncoderReady()) {
    if (bytes.byteLength > MAX_WEB_SOURCE_BYTES) throw new Error(`${source.name} is ${megabytes(bytes.byteLength)}. Recordings over ${megabytes(MAX_WEB_SOURCE_BYTES)} import from the wordsmith desktop app.`);
    return packed(await webPackets(bytes), name);
  }
  const type = audioType(source.name);
  if (!type || source.size > MAX_TAPE_BYTES) throw new Error(`This browser can't shrink ${source.name}. Import it from the wordsmith desktop app, or Chrome, Edge or Firefox.`);
  return { file: new File([bytes], source.name, { type }), durationMs: await playLength(source), encoded: false };
}

/** @typedef {{ packets: import('./ogg-opus.js').OpusPacket[], preSkip: number, samples: number, inputRate: number }} Packets */

/** Packets → the Ogg file to upload, checked against the size cap. @param {Packets} audio @param {string} name */
function packed(audio, name) {
  const blob = oggOpus(audio);
  if (blob.size > MAX_TAPE_BYTES) throw new Error(`${name} is still ${megabytes(blob.size)} after shrinking; tapes can be at most ${megabytes(MAX_TAPE_BYTES)} (about two hours).`);
  return { file: new File([blob], name, { type: TAPE_TYPE }), durationMs: Math.round((audio.samples / OPUS_RATE) * MS_PER_SECOND), encoded: true };
}

/** The desktop encoder. @param {File} source @param {ArrayBuffer} bytes @returns {Promise<Packets>} */
async function nativePackets(source, bytes) {
  /** @type {ArrayBuffer} */
  const answer = await invoke('tape_encode', new Uint8Array(bytes), { headers: { [EXTENSION_HEADER]: fileExtension(source.name).slice(1) } });
  const view = new DataView(answer);
  const packets = [];
  for (let offset = NATIVE_HEADER_BYTES; offset < answer.byteLength;) {
    const length = view.getUint16(offset, true);
    offset += PACKET_LENGTH_BYTES;
    packets.push({ data: new Uint8Array(answer, offset, length), samples: NATIVE_FRAME_SAMPLES });
    offset += length;
  }
  return { packets, preSkip: view.getUint32(0, true), samples: Number(view.getBigUint64(4, true)), inputRate: OPUS_RATE };
}

/** @type {Promise<boolean> | null} */
let webSupport = null;

/** Whether this browser can encode Opus (WebCodecs), asked once. */
function webEncoderReady() {
  webSupport ??= typeof AudioEncoder === 'undefined'
    ? Promise.resolve(false)
    : AudioEncoder.isConfigSupported(WEB_CONFIG).then((answer) => Boolean(answer.supported)).catch(() => false);
  return webSupport;
}

/** The browser's encoder. @param {ArrayBuffer} bytes @returns {Promise<Packets>} */
async function webPackets(bytes) {
  // decodeAudioData reads every format the browser plays and converts it to WEB_RATE on the way.
  const decoded = await new OfflineAudioContext(1, 1, WEB_RATE).decodeAudioData(bytes.slice(0));
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    for (let index = 0; index < data.length; index++) mono[index] += data[index] / decoded.numberOfChannels;
  }

  /** @type {import('./ogg-opus.js').OpusPacket[]} */
  const packets = [];
  let preSkip = DEFAULT_PRE_SKIP;
  /** @type {Error | null} */
  let failure = null;
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ data, samples: Math.round(((chunk.duration ?? WEB_FRAME_US) * OPUS_RATE) / US_PER_SECOND) });
      const head = metadata?.decoderConfig?.description;
      if (head && head.byteLength > OPUS_HEAD_PRE_SKIP + 1) preSkip = new DataView(ArrayBuffer.isView(head) ? head.buffer : head, ArrayBuffer.isView(head) ? head.byteOffset : 0).getUint16(OPUS_HEAD_PRE_SKIP, true);
    },
    error: (error) => (failure = error),
  });
  encoder.configure(WEB_CONFIG);
  for (let start = 0; start < mono.length && !failure; start += WEB_CHUNK_FRAMES) {
    const frames = mono.subarray(start, start + WEB_CHUNK_FRAMES);
    const audio = new AudioData({ format: 'f32', sampleRate: WEB_RATE, numberOfChannels: 1, numberOfFrames: frames.length, timestamp: Math.round((start * US_PER_SECOND) / WEB_RATE), data: frames });
    encoder.encode(audio);
    audio.close();
    // Keep the encoder fed without queueing the whole recording at once.
    while (encoder.encodeQueueSize > MAX_QUEUED) await new Promise((resolve) => encoder.addEventListener('dequeue', resolve, { once: true }));
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  return { packets, preSkip, samples: Math.round((mono.length * OPUS_RATE) / WEB_RATE), inputRate: decoded.sampleRate };
}

/** How long a file plays, from the browser's own player (no decoding). 0 when it can't tell. @param {File} file */
function playLength(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (/** @type {number} */ ms) => {
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? Math.round(audio.duration * MS_PER_SECOND) : 0);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}
