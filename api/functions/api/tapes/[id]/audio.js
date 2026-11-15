// GET /api/tapes/:id/audio - streams a tape's audio to its owner (streamFile: Range requests, so the player seeks;
// cached for a year, so playing a tape again costs no request). Works for the app and agent tokens.
import { requireAuth } from '../../../../lib/auth.js';
import { streamFile } from '../../../../lib/attachments.js';
import { HttpError } from '../../../../lib/http.js';
import { tapeFileName, tapeKey } from '../../../../lib/tapes.js';
import { isId } from '../../../../../src/lib/models.js';

/** @param {{ request: Request, env: Record<string, any>, params: { id: string } }} context */
export async function onRequestGet(context) {
  const auth = await requireAuth(context, { allowToken: true });
  if (!isId(context.params.id)) throw new HttpError(400, 'Bad id');
  const tape = await context.env.DB.prepare('SELECT * FROM tapes WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND audio_size > 0')
    .bind(context.params.id, auth.user.id).first();
  if (!tape) throw new HttpError(404, 'Tape not found');
  return streamFile(context, { key: tapeKey(auth.user.id, String(tape.id)), size: Number(tape.audio_size), type: String(tape.audio_type), name: tapeFileName(tape), etag: String(tape.id) });
}
