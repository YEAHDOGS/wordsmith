// POST /api/notes/:id/attachments - upload one image, video or document (pdf, docx, md, txt) as the raw request body.
// Headers: Content-Type (the file's type), Content-Length, X-File-Name (URI-encoded). Works for the app and agent tokens.
import { requireAuth } from '../../../../lib/auth.js';
import { assertRoomOnNote, bucket, checkUpload, presentAttachment, release, reserve } from '../../../../lib/attachments.js';
import { HttpError, json } from '../../../../lib/http.js';
import { actorFor } from '../../../../lib/notes.js';
import { rateLimit } from '../../../../lib/rate-limit.js';
import { isId } from '../../../../../src/lib/models.js';

const UPLOADS_PER_DAY = 300;
const DAY_MS = 86_400_000;

/** @param {{ request: Request, env: Record<string, any>, params: { id: string } }} context */
export async function onRequestPost(context) {
  const { request, env, params } = context;
  const auth = await requireAuth(context, { allowToken: true });
  if (!isId(params.id)) throw new HttpError(400, 'Bad note id');
  const files = bucket(env);
  await rateLimit(env, `upload:${auth.user.id}`, UPLOADS_PER_DAY, DAY_MS);

  const note = await env.DB.prepare('SELECT id FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(params.id, auth.user.id).first();
  if (!note) throw new HttpError(404, 'Note not found. Sync it first, then upload.');
  await assertRoomOnNote(env, params.id);

  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const size = Number(request.headers.get('Content-Length'));
  const name = checkUpload(type, size, decodeURIComponent(request.headers.get('X-File-Name') || ''));
  if (!request.body) throw new HttpError(400, 'Empty upload');

  await reserve(env, { bytes: size, writes: 1 });
  const id = crypto.randomUUID();
  const key = `${auth.user.id}/${id}`;
  try {
    const stored = await files.put(key, request.body, { httpMetadata: { contentType: type } });
    // Content-Length was checked up front; check what actually landed too, so a client that understated it can't
    // leave a large file in R2.
    if (!stored || stored.size > size) {
      await files.delete(key);
      throw new HttpError(413, 'The upload was larger than its declared size');
    }
  } catch (error) {
    await release(env, size);
    throw error;
  }

  const now = Date.now();
  const row = { id, user_id: auth.user.id, note_id: params.id, r2_key: key, name, type, size, created_at: now, updated_at: now, deleted_at: null };
  const actor = actorFor(auth);
  const [saved] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO attachments (id, user_id, note_id, r2_key, name, type, size, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL)`)
      .bind(id, auth.user.id, params.id, key, name, type, size, now, now, params.id, auth.user.id),
    env.DB.prepare(`INSERT INTO note_events (id, user_id, note_id, type, actor_type, actor_name, data, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL)`)
      .bind(crypto.randomUUID(), auth.user.id, params.id, 'attached', actor.type, actor.name, JSON.stringify({ attachment_id: id, name, type, size }), now, params.id, auth.user.id),
  ]);
  if (!saved.meta.changes) {
    await files.delete(key);
    await release(env, size);
    throw new HttpError(404, 'Note is no longer available for attachments');
  }
  return json({ attachment: presentAttachment(row) }, 201);
}
