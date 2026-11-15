// PATCH /api/v1/tapes/:id { rating?, title?, body?, body_append? } - an agent's verdict on a tape after reading its
// transcript: rate it (0-3, TAPE_RATINGS), rename it, or add notes (body_append adds a paragraph; body replaces).
// The app shows the change on its next sync.
import { HttpError, json, readJson } from '../../../../lib/http.js';
import { rateLimit } from '../../../../lib/rate-limit.js';
import { toApi } from '../../../../lib/rows.js';
import { MAX_BODY, cleanRow, isId } from '../../../../../src/lib/models.js';

const WRITES_PER_HOUR = 600;
const HOUR_MS = 3_600_000;
const PARAGRAPH = '\n\n';

/** @param {{ request: Request, env: Record<string, any>, params: { id: string }, data: Record<string, any> }} context */
export async function onRequestPatch({ request, env, params, data }) {
  const userId = data.auth.user.id;
  if (!isId(params.id)) throw new HttpError(400, 'Bad tape id');
  await rateLimit(env, `tape-agent:${userId}`, WRITES_PER_HOUR, HOUR_MS);
  const input = await readJson(request);
  const tape = await env.DB.prepare('SELECT * FROM tapes WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(params.id, userId).first();
  if (!tape) throw new HttpError(404, 'Tape not found');
  const body = typeof input.body_append === 'string' && input.body_append.trim()
    ? [String(tape.body).trim(), input.body_append.trim()].filter(Boolean).join(PARAGRAPH).slice(0, MAX_BODY)
    : input.body;
  /** @type {Record<string, any>} */
  let changes;
  try {
    changes = cleanRow('tapes', { rating: input.rating, title: input.title, body });
  } catch (error) {
    throw new HttpError(400, /** @type {Error} */ (error).message);
  }
  const columns = Object.keys(changes);
  if (!columns.length) throw new HttpError(400, 'Send rating, title, body or body_append');
  const saved = await env.DB.prepare(`UPDATE tapes SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL RETURNING *`).bind(...columns.map((column) => changes[column]), Date.now(), params.id, userId).first();
  if (!saved) throw new HttpError(404, 'Tape not found');
  return json({ tape: toApi(saved) });
}
