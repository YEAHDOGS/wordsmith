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
