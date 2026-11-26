// Tapes on the server: where their audio lives in R2, reading an upload's description, and letting go of a deleted
// tape's audio. Audio counts against the same free-tier caps as attachments (reserve/release in attachments.js).
import { bucket, release } from './attachments.js';
import { HttpError } from './http.js';
import { MAX_FILE_NAME, MAX_TAPE_DURATION_MS, SOURCE_HASH_PATTERN, TAPE_EXTENSION, isId } from '../../src/lib/models.js';

// The upload's description, URI-encoded JSON (see src/lib/tapes.svelte.js): { id, name, hash, size, recorded_at, duration_ms }.
const TAPE_HEADER = 'X-Tape';
const MAX_HEADER = 4_000;
const UNSAFE_NAME = /[\\/\r\n\t"]/g;
const FALLBACK_NAME = 'tape';
const EXTENSION = /\.[^.]+$/;

/** Where a tape's audio lives in R2. @param {string} userId @param {string} id */
export const tapeKey = (userId, id) => `${userId}/tapes/${id}`;

/** The file name tape audio downloads as: its title, with the stored type's extension. @param {Record<string, any>} tape */
export function tapeFileName(tape) {
  const base = String(tape.title || tape.source_name || FALLBACK_NAME).replace(UNSAFE_NAME, '_').replace(EXTENSION, '').trim().slice(0, MAX_FILE_NAME) || FALLBACK_NAME;
  const original = EXTENSION.exec(String(tape.source_name))?.[0] || '';
  return base + (tape.audio_type === 'audio/ogg' ? TAPE_EXTENSION : original);
}

/** A whole number within bounds, or null. @param {unknown} value @param {number} max */
function wholeOrNull(value, max) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isInteger(number) && number >= 0 && number <= max ? number : null;
}

/**
 * Reads and checks an upload's X-Tape header. Throws 400 with what's wrong.
 * @param {Request} request
 */
export function readTapeHeader(request) {
  const raw = request.headers.get(TAPE_HEADER) || '';
  if (!raw || raw.length > MAX_HEADER) throw new HttpError(400, `${TAPE_HEADER} is required`);
  /** @type {any} */
  let meta;
  try {
    meta = JSON.parse(decodeURIComponent(raw));
  } catch {
    throw new HttpError(400, `${TAPE_HEADER} must be URI-encoded JSON`);
  }
  if (!isId(meta?.id)) throw new HttpError(400, 'The tape needs an id');
  if (!SOURCE_HASH_PATTERN.test(String(meta.hash))) throw new HttpError(400, "The tape needs its original file's SHA-256");
  const name = String(meta.name ?? '').replace(UNSAFE_NAME, '_').trim().slice(0, MAX_FILE_NAME);
  return {
    id: String(meta.id),
    name,
    hash: String(meta.hash),
    size: wholeOrNull(meta.size, Number.MAX_SAFE_INTEGER) ?? 0,
    recordedAt: wholeOrNull(meta.recorded_at, Number.MAX_SAFE_INTEGER),
    durationMs: wholeOrNull(meta.duration_ms, MAX_TAPE_DURATION_MS) ?? 0,
  };
}

/**
 * Deletes the audio of tapes that were just deleted and gives their storage back. Runs after the rows are saved
 * with audio_size 0, so a failed R2 delete only leaves an object nothing points to.
 * @param {Record<string, any>} env @param {string} userId @param {{ id: string, audio_size: number }[]} tapes as they were before
 */
export async function eraseTapeAudio(env, userId, tapes) {
  if (!tapes.length) return;
  const files = bucket(env);
  // The storage is given back even if R2 refuses the delete: the rows no longer count it, and a counter that kept it
  // would stay too high forever, since nothing tries the delete again.
  try {
    await files.delete(tapes.map((tape) => tapeKey(userId, tape.id)));
  } finally {
    await release(env, tapes.reduce((sum, tape) => sum + Number(tape.audio_size || 0), 0));
  }
}

// wordsmith cloud transcripts (api/functions/api/tapes/[id]/transcribe.js): Workers AI's Whisper, billed per minute of
// audio. Each account gets TAPE_CLOUD_MINUTES a day, counted as neurons on its own row of scribe_usage, inside the
// everyone-together cap Scribe's cloud shares (SCRIBE_DAILY_NEURONS), so tapes can never spend the free allowance.
export const TAPE_CLOUD_MODEL = '@cf/openai/whisper-large-v3-turbo';
// Workers AI's price for this model (developers.cloudflare.com/workers-ai/platform/pricing).
export const NEURONS_PER_AUDIO_MINUTE = 46.63;
const DEFAULT_TAPE_CLOUD_MINUTES = 15;
const DEFAULT_DAILY_NEURONS = 4_000;
// Tapes' share of the everyone-together cap, so a few busy accounts can't leave Scribe nothing.
const DEFAULT_TAPE_DAILY_NEURONS = 2_000;
export const MS_PER_MINUTE = 60_000;
/** The usage row for every account's cloud transcripts together. */
export const TAPES_EVERYONE = 'tapes:*';

/**
 * Today's limits: this account's minutes and neurons, all tapes' neurons, and everyone's (Scribe too).
 * @param {Record<string, any>} env
 */
export function cloudLimits(env) {
  const minutes = Number(env.TAPE_CLOUD_MINUTES) || DEFAULT_TAPE_CLOUD_MINUTES;
  return {
    minutes,
    neurons: minutes * NEURONS_PER_AUDIO_MINUTE,
    tapes: Number(env.TAPE_CLOUD_DAILY_NEURONS) || DEFAULT_TAPE_DAILY_NEURONS,
    everyone: Number(env.SCRIBE_DAILY_NEURONS) || DEFAULT_DAILY_NEURONS,
  };
}

/** The usage row for one account's cloud transcripts. @param {string} userId */
export const cloudKey = (userId) => `tapes:${userId}`;

// Reading an Ogg Opus file's length from its packets (RFC 3533 pages, RFC 6716 section 3.1 TOC bytes), which is what
// the model will actually hear, rather than the length the app said at upload.
const OGG_CAPTURE = 'OggS';
const OGG_PAGE_HEADER = 27;
const OGG_SEGMENTS_AT = 26;
const OGG_SEGMENT_MAX = 255;
const OPUS_HEADER_PACKETS = 2;
const OPUS_SAMPLES_PER_MS = 48;
// Frame length in ms by TOC config (its top five bits): SILK 0-11, hybrid 12-15, CELT 16-31.
const SILK_MS = [10, 20, 40, 60];
const HYBRID_MS = [10, 20];
const CELT_MS = [2.5, 5, 10, 20];
const SILK_CONFIGS = 12;
const HYBRID_CONFIGS = 16;
const FRAME_COUNT_MASK = 0x3f;
const ARBITRARY_FRAMES = 3;
const MAX_PACKET_SAMPLES = 5_760;

/** Samples (at 48 kHz) in one Opus packet, from its first two bytes. @param {number} toc @param {number} second */
function packetSamples(toc, second) {
  const config = toc >> 3;
  const ms = config < SILK_CONFIGS ? SILK_MS[config % SILK_MS.length] : config < HYBRID_CONFIGS ? HYBRID_MS[config % HYBRID_MS.length] : CELT_MS[config % CELT_MS.length];
  const code = toc & ARBITRARY_FRAMES;
  const frames = code === 0 ? 1 : code === ARBITRARY_FRAMES ? second & FRAME_COUNT_MASK : 2;
  return Math.min(frames * ms * OPUS_SAMPLES_PER_MS, MAX_PACKET_SAMPLES);
}

/**
 * How many minutes of audio an Ogg Opus file holds, counted packet by packet; null if it isn't one.
 * @param {Uint8Array} bytes
 */
export function opusMinutes(bytes) {
  const capture = new TextEncoder().encode(OGG_CAPTURE);
  let offset = 0;
  let packets = 0;
  let samples = 0;
  let inPacket = false;
  while (offset < bytes.length) {
    if (offset + OGG_PAGE_HEADER > bytes.length || capture.some((byte, index) => bytes[offset + index] !== byte)) return null;
    const segments = bytes[offset + OGG_SEGMENTS_AT];
    let body = offset + OGG_PAGE_HEADER + segments;
    if (body > bytes.length) return null;
    for (let index = 0; index < segments; index++) {
      const lace = bytes[offset + OGG_PAGE_HEADER + index];
      if (!inPacket) {
        if (packets >= OPUS_HEADER_PACKETS && lace > 0) samples += packetSamples(bytes[body], bytes[body + 1] ?? 0);
        packets++;
      }
      inPacket = lace === OGG_SEGMENT_MAX;
      body += lace;
    }
    if (body > bytes.length) return null;
    offset = body;
  }
  return packets > OPUS_HEADER_PACKETS ? samples / OPUS_SAMPLES_PER_MS / MS_PER_MINUTE : null;
}
