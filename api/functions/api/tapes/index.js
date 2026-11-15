// POST /api/tapes - creates a tape by uploading its audio as the raw request body: the app shrinks the recording to
// Opus first (src/lib/tape-encode.js). Headers: Content-Type (audio/ogg, or the original's audio type on a browser
// that can't encode), Content-Length, and X-Tape (api/lib/tapes.js). Answers { tape } (201), or, when the same
// original file is already a tape, that tape and code TAPE_EXISTS (200), so importing a folder twice adds nothing.
// Retrying an upload that already landed (same id) answers the saved tape too. Edits then go through sync.
import { requireAuth } from '../../../lib/auth.js';
import { bucket, release, reserve } from '../../../lib/attachments.js';
import { HttpError, json } from '../../../lib/http.js';
import { rateLimit } from '../../../lib/rate-limit.js';
import { toApi } from '../../../lib/rows.js';
import { readTapeHeader, tapeKey } from '../../../lib/tapes.js';
import { MAX_TAPES, MAX_TAPE_BYTES, PLANS, TAPE_EXISTS, TAPE_LIMIT, TAPE_STORAGE, attachmentKind } from '../../../../src/lib/models.js';

// A thousand-file import takes a few days at most; anything faster is a loop eating the free tier.
const UPLOADS_PER_DAY = 1_500;
const DAY_MS = 86_400_000;
const MB = 1024 * 1024;
const CREATED = 201;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireAuth(context, { allowToken: true });
  const userId = auth.user.id;
  const files = bucket(env);
  const meta = readTapeHeader(request);
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const size = Number(request.headers.get('Content-Length'));
  if (attachmentKind(type) !== 'audio') throw new HttpError(415, 'A tape is an audio file');
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(411, 'Content-Length is required');
  if (size > MAX_TAPE_BYTES) throw new HttpError(413, `A tape can be at most ${Math.round(MAX_TAPE_BYTES / MB)} MB`);
  if (!request.body) throw new HttpError(400, 'Empty upload');

  // Already here (the same file imported again, or a retry of an upload that landed): hand back what's stored.
  const existing = await env.DB.prepare('SELECT * FROM tapes WHERE user_id = ? AND deleted_at IS NULL AND (source_hash = ? OR id = ?) LIMIT 1')
    .bind(userId, meta.hash, meta.id).first();
  if (existing) return json({ tape: toApi(existing), code: TAPE_EXISTS });
  await rateLimit(env, `tape-upload:${userId}`, UPLOADS_PER_DAY, DAY_MS);
  // Tapes in the trash still hold their audio (audio_size drops to 0 once it is gone), so they count towards storage.
  const held = await env.DB.prepare('SELECT COALESCE(SUM(deleted_at IS NULL), 0) AS n, COALESCE(SUM(audio_size), 0) AS bytes FROM tapes WHERE user_id = ?').bind(userId).first();
  if (Number(held?.n) >= MAX_TAPES) return json({ error: `You can have at most ${MAX_TAPES} tapes`, code: TAPE_LIMIT }, 400);
  const plan = PLANS[/** @type {import('../../../../src/lib/models.js').Plan} */ (auth.user.plan)];
  if (Number(held?.bytes) + size > plan.tapeBytes) {
    return json({ error: `Your tapes are full: ${plan.name} holds ${Math.round(plan.tapeBytes / MB)} MB. Delete some (and empty the trash), or join a bigger DOGS membership for more room.`, code: TAPE_STORAGE }, 400);
  }

  await reserve(env, { bytes: size, writes: 1 });
  const key = tapeKey(userId, meta.id);
  try {
    const stored = await files.put(key, request.body, { httpMetadata: { contentType: type } });
    // Content-Length was checked up front; check what actually landed too, so an understated upload can't stay.
    if (!stored || stored.size > size) {
      await files.delete(key);
      throw new HttpError(413, 'The upload was larger than its declared size');
    }
  } catch (error) {
    await release(env, size);
    throw error;
  }

  const now = Date.now();
  const title = meta.name.replace(/\.[^.]+$/, '');
  /** @type {Record<string, any> | null} */
  let saved = null;
  try {
    // DO NOTHING covers both races: another device saved this file (the unique source index), or this id, first.
    saved = await env.DB.prepare(`INSERT INTO tapes (id, user_id, title, body, source_name, source_hash, source_size, recorded_at, duration_ms, audio_type, audio_size, created_at, updated_at)
      VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING *`)
      .bind(meta.id, userId, title, meta.name, meta.hash, meta.size, meta.recordedAt, meta.durationMs, type, size, now, now).first();
  } finally {
    if (!saved) {
      await files.delete(key);
      await release(env, size);
    }
  }
  if (saved) return json({ tape: toApi(saved) }, CREATED);
  const winner = await env.DB.prepare('SELECT * FROM tapes WHERE user_id = ? AND deleted_at IS NULL AND source_hash = ? LIMIT 1').bind(userId, meta.hash).first();
  if (!winner) throw new HttpError(409, 'That tape id is already taken');
  return json({ tape: toApi(winner), code: TAPE_EXISTS });
}
