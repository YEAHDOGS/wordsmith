// GET /api/tapes/:id/audio - streams a tape's audio to its owner (streamFile: Range requests, so the player seeks;
// cached for a year, so playing a tape again costs no request). Works for the app and agent tokens, and for a locked
// account's own session, so the data export (src/lib/data-export.js) can include its tapes.
import { requireAuth } from '../../../../lib/auth.js';
import { streamFile } from '../../../../lib/attachments.js';
import { HttpError } from '../../../../lib/http.js';
import { tapeFileName, tapeKey } from '../../../../lib/tapes.js';
import { TRIAL_ENDED, isId } from '../../../../../src/lib/models.js';

const PAYMENT_REQUIRED = 402;

/** @param {{ request: Request, env: Record<string, any>, params: { id: string } }} context */
export async function onRequestGet(context) {
  const auth = await requireAuth(context, { allowToken: true, allowLocked: true });
  if (!auth.user.plan && auth.via === 'token') throw new HttpError(PAYMENT_REQUIRED, 'Your free trial has ended. Subscribe to DOGS to keep using wordsmith.', TRIAL_ENDED);
  if (!isId(context.params.id)) throw new HttpError(400, 'Bad id');
  const tape = await context.env.DB.prepare('SELECT * FROM tapes WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND audio_size > 0')
    .bind(context.params.id, auth.user.id).first();
  if (!tape) throw new HttpError(404, 'Tape not found');
  return streamFile(context, { key: tapeKey(auth.user.id, String(tape.id)), size: Number(tape.audio_size), type: String(tape.audio_type), name: tapeFileName(tape), etag: String(tape.id) });
}
