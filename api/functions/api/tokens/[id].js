// PATCH /api/tokens/:id { color } - the color every note this token creates takes (COLORS in src/lib/models.js).
// DELETE /api/tokens/:id - revokes an agent API token immediately.
import { requireAuth } from '../../../lib/auth.js';
import { HttpError, json, readJson } from '../../../lib/http.js';
import { COLORS } from '../../../../src/lib/models.js';

/** @param {{ request: Request, env: Record<string, any>, params: { id: string } }} context */
export async function onRequestPatch(context) {
  const { user } = await requireAuth(context);
  const { color } = await readJson(context.request);
  if (!COLORS.includes(color)) throw new HttpError(400, `color must be one of ${COLORS.join(', ')}`);
  const result = await context.env.DB.prepare('UPDATE api_tokens SET color = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(color, context.params.id, user.id).run();
  if (!result.meta.changes) throw new HttpError(404, 'Token not found');
  return json({ ok: true });
}

/** @param {{ request: Request, env: Record<string, any>, params: { id: string } }} context */
export async function onRequestDelete(context) {
  const { user } = await requireAuth(context);
  const result = await context.env.DB.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(Date.now(), context.params.id, user.id).run();
  if (!result.meta.changes) throw new HttpError(404, 'Token not found');
  return json({ ok: true });
}
