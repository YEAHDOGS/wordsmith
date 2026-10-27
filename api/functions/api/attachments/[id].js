// GET /api/attachments/:id - streams the file (Range requests supported, so videos can seek).
// DELETE /api/attachments/:id - removes it from R2 and tombstones the row.
// Files are immutable, so browsers cache them for a year and repeat views cost no requests.
import { requireAuth } from '../../../lib/auth.js';
import { bucket, release, reserve } from '../../../lib/attachments.js';
import { HttpError, json } from '../../../lib/http.js';
import { actorFor } from '../../../lib/notes.js';
import { isId } from '../../../../src/lib/models.js';

const CACHE_FOREVER = 'private, max-age=31536000, immutable';
const PARTIAL_CONTENT = 206;
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

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
  const { request, env } = context;
  const files = bucket(env);
  const { row } = await load(context);
  if (request.headers.get('If-None-Match') === `"${row.id}"`) return new Response(null, { status: 304 });

  /** @type {{ offset: number, length: number } | undefined} */
  let range;
  const match = RANGE_PATTERN.exec(request.headers.get('Range') || '');
  if (match && (match[1] || match[2])) {
    const size = Number(row.size);
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start <= end && start < size) range = { offset: start, length: end - start + 1 };
  }

  await reserve(env, { reads: 1 });
  const object = await files.get(row.r2_key, range ? { range } : undefined);
  if (!object) throw new HttpError(404, 'File is missing from storage');

  const headers = new Headers({
    'Content-Type': String(row.type),
    'Cache-Control': CACHE_FOREVER,
    ETag: `"${row.id}"`,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    // Served from the app's origin, so never let a file act like a page.
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(String(row.name))}`,
  });
  if (!range) {
    headers.set('Content-Length', String(row.size));
    return new Response(object.body, { headers });
  }
  headers.set('Content-Length', String(range.length));
  headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${row.size}`);
  return new Response(object.body, { status: PARTIAL_CONTENT, headers });
}

/** @param {{ request: Request, env: Record<string, any>, params: { id: string } }} context */
export async function onRequestDelete(context) {
  const { env } = context;
  const files = bucket(env);
  const { auth, row } = await load(context);
  await files.delete(row.r2_key);
  const now = Date.now();
  const actor = actorFor(auth);
  await env.DB.batch([
    env.DB.prepare('UPDATE attachments SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, row.id),
    env.DB.prepare('INSERT INTO note_events (id, user_id, note_id, type, actor_type, actor_name, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), auth.user.id, row.note_id, 'detached', actor.type, actor.name, JSON.stringify({ attachment_id: row.id, name: row.name }), now),
  ]);
  await release(env, Number(row.size));
  return json({ ok: true });
}
