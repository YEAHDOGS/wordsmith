// Downloads for one tape (TapeRow.svelte): the copy stored in R2 (Opus, or the original where it couldn't be shrunk),
// and, for Scribe sessions recorded on this device, the full-quality original kept in IndexedDB (src/lib/recordings.js).
import { mediaUrl } from '../lib/api.js';
import { auth } from '../lib/auth.svelte.js';
import { getOriginal } from '../lib/recordings.js';
import { saveFile } from '../lib/save-file.js';
import { AUDIO_TYPES } from '../lib/models.js';

const NOT_NAME = /[\/:*?"<>|]+/g;
const MAX_NAME_CHARS = 80;
const FALLBACK_NAME = 'tape';
const WAV_EXTENSION = '.wav';

/** A file name for a tape, from its title. @param {any} tape @param {string} extension with the dot */
function fileName(tape, extension) {
  const base = String(tape.title || tape.source_name || FALLBACK_NAME).replace(/\.[^.]+$/, '').replace(NOT_NAME, '-').trim().slice(0, MAX_NAME_CHARS);
  return (base || FALLBACK_NAME) + extension;
}

/** Saves the tape's stored audio (from R2). @param {any} tape */
export async function downloadStored(tape) {
  const url = await mediaUrl(`/api/tapes/${tape.id}/audio`);
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  // The last extension listed is the usual one (.ogg, not .oga).
  const extension = AUDIO_TYPES[/** @type {keyof typeof AUDIO_TYPES} */ (tape.audio_type)]?.at(-1) ?? '';
  await saveFile(blob, fileName(tape, extension));
}

/** Saves the full-quality original kept on this device. @param {any} tape */
export async function downloadOriginal(tape) {
  const userId = auth.user?.id;
  const original = userId ? await getOriginal(userId, tape.id) : undefined;
  if (!original) throw new Error('The original is not on this device.');
  await saveFile(original.blob, fileName(tape, WAV_EXTENSION));
}
