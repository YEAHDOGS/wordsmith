// GET /api/attachments/:id - streams the file (streamFile in api/lib/attachments.js: Range requests, cached for a year).
// DELETE /api/attachments/:id - removes it from R2 and tombstones the row.
import { requireAuth } from '../../../lib/auth.js';
import { bucket, release, streamFile } from '../../../lib/attachments.js';
import { HttpError, json } from '../../../lib/http.js';
import { actorFor } from '../../../lib/notes.js';
import { isId } from '../../../../src/lib/models.js';

/** @param {{ request: Request, env: Record<string, any>, params: { id: string } }} context */
async function load(context) {
  const auth = await requireAuth(context, { allowToken: true });
  if (!isId(context.params.id)) throw new HttpError(400, 'Bad id');
  const row = await context.env.DB.prepare('SELECT * FROM attachments WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .bind(context.params.id, auth.user.id).first();
  if (!row) throw new HttpError(404, 'Attachment not found');
  return { auth, row };
}

/** @param {{ request: Request, env: Record<string, any>, params: { id: string } }} context */
export async function onRequestGet(context) {
  const { row } = await load(context);
  return streamFile(context, { key: String(row.r2_key), size: Number(row.size), type: String(row.type), name: String(row.name), etag: String(row.id) });
}

/** @param {{ request: Request, env: Record<string, any>, params: { id: string } }} context */
export async function onRequestDelete(context) {
  const { env } = context;
  const files = bucket(env);
  const { auth, row } = await load(context);
  await files.delete(row.r2_key);
  const now = Date.now();
  const actor = actorFor(auth);
  const deleted = await env.DB.prepare(`UPDATE attachments
    SET note_id = '', r2_key = '', name = '', type = '', size = 0, deleted_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL RETURNING id`)
    .bind(now, now, row.id, auth.user.id).first();
  // A trash purge or another delete may have won after load(); only the winner erases metadata and releases storage.
  if (!deleted) return json({ ok: true });
  await env.DB.prepare(`INSERT INTO note_events (id, user_id, note_id, type, actor_type, actor_name, data, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM notes WHERE id = ? AND user_id = ? AND purged_at IS NULL)`)
    .bind(crypto.randomUUID(), auth.user.id, row.note_id, 'detached', actor.type, actor.name, JSON.stringify({ attachment_id: row.id, name: row.name }), now, row.note_id, auth.user.id).run();
  await release(env, Number(row.size));
  return json({ ok: true });
}
