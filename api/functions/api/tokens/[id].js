// DELETE /api/tokens/:id - revokes an agent API token immediately.
import { requireAuth } from '../../../lib/auth.js';
import { HttpError, json } from '../../../lib/http.js';

/** @param {{ request: Request, env: Record<string, any>, params: { id: string } }} context */
export async function onRequestDelete(context) {
  const { user } = await requireAuth(context);
  const result = await context.env.DB.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(Date.now(), context.params.id, user.id).run();
  if (!result.meta.changes) throw new HttpError(404, 'Token not found');
  return json({ ok: true });
}
