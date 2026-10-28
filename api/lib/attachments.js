// Attachment storage in R2 with hard caps kept below R2's free tier (10 GB stored, 1M Class A writes and 10M Class B reads
// per month). That allowance is shared by the whole Cloudflare account (other buckets, and wordsmith's staging and production),
// so each environment gets its own slice via R2_MAX_GB / R2_MAX_MONTHLY_WRITES / R2_MAX_MONTHLY_READS in wrangler.jsonc.
// When a cap is reached the request is refused with 507 instead of costing money. The bucket is private: every byte goes through here.
// The account-wide spend breaker (cost-breaker.js) refuses everything here the same way while it is open.
import { IMAGE_TYPES, MAX_ATTACHMENTS_PER_NOTE, MAX_FILE_NAME, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, VIDEO_TYPES } from '../../src/lib/models.js';
import { HttpError } from './http.js';

const GB = 1024 ** 3;
// Conservative fallbacks if an environment forgets to set its slice.
const DEFAULT_MAX_GB = 1;
const DEFAULT_MAX_MONTHLY_WRITES = 100_000;
const DEFAULT_MAX_MONTHLY_READS = 1_000_000;
const INSUFFICIENT_STORAGE = 507;

/** Throws 503 when no R2 bucket is bound (attachments switched off). @param {Record<string, any>} env */
export function bucket(env) {
  if (!env.ATTACHMENTS) throw new HttpError(503, 'Attachments are not enabled on this deployment');
  return env.ATTACHMENTS;
}

/** This environment's caps. @param {Record<string, any>} env */
function limits(env) {
  const positive = (/** @type {unknown} */ value, /** @type {number} */ fallback) => (Number(value) > 0 ? Number(value) : fallback);
  return {
    bytes: positive(env.R2_MAX_GB, DEFAULT_MAX_GB) * GB,
    writes: positive(env.R2_MAX_MONTHLY_WRITES, DEFAULT_MAX_MONTHLY_WRITES),
    reads: positive(env.R2_MAX_MONTHLY_READS, DEFAULT_MAX_MONTHLY_READS),
  };
}

/**
 * Atomically reserves R2 usage, or throws 507 when it would pass a cap.
 * @param {Record<string, any>} env
 * @param {{ bytes?: number, writes?: number, reads?: number }} usage
 */
export async function reserve(env, { bytes = 0, writes = 0, reads = 0 }) {
  const month = new Date().toISOString().slice(0, 7);
  const cap = limits(env);
  const row = await env.DB.prepare(
    `UPDATE storage_usage SET
       writes = CASE WHEN month = ?1 THEN writes ELSE 0 END + ?3,
       reads = CASE WHEN month = ?1 THEN reads ELSE 0 END + ?4,
       month = ?1,
       bytes = bytes + ?2
     WHERE id = 1
       AND bytes + ?2 <= ?5
       AND (CASE WHEN month = ?1 THEN writes ELSE 0 END) + ?3 <= ?6
       AND (CASE WHEN month = ?1 THEN reads ELSE 0 END) + ?4 <= ?7
       AND NOT EXISTS (SELECT 1 FROM cost_breaker WHERE tripped_at IS NOT NULL)
     RETURNING bytes`,
  ).bind(month, bytes, writes, reads, cap.bytes, cap.writes, cap.reads).first();
  if (!row) throw new HttpError(INSUFFICIENT_STORAGE, 'Attachment storage is at its free-tier limit');
}

/** Gives storage back after a delete or a failed upload. @param {Record<string, any>} env @param {number} bytes */
export async function release(env, bytes) {
  await env.DB.prepare('UPDATE storage_usage SET bytes = MAX(0, bytes - ?) WHERE id = 1').bind(bytes).run();
}

/**
 * Validates an upload's type, size and name before any bytes are stored.
 * @param {string} type
 * @param {number} size
 * @param {string} name
 */
export function checkUpload(type, size, name) {
  const isImage = IMAGE_TYPES.includes(type);
  if (!isImage && !VIDEO_TYPES.includes(type)) throw new HttpError(415, 'Only images (png, jpeg, gif, webp, avif) and videos (mp4, webm, mov) can be attached');
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(411, 'Content-Length is required');
  const max = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (size > max) throw new HttpError(413, `${isImage ? 'Images' : 'Videos'} can be at most ${Math.round(max / 1024 / 1024)} MB`);
  return name.replace(/[\\/\r\n\t"]/g, '_').trim().slice(0, MAX_FILE_NAME) || (isImage ? 'image' : 'video');
}

/** Counts live attachments on a note. @param {Record<string, any>} env @param {string} noteId */
export async function assertRoomOnNote(env, noteId) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM attachments WHERE note_id = ? AND deleted_at IS NULL').bind(noteId).first();
  if (Number(row?.n) >= MAX_ATTACHMENTS_PER_NOTE) throw new HttpError(400, `A note can hold at most ${MAX_ATTACHMENTS_PER_NOTE} attachments`);
}

/** Attachment as clients see it. @param {Record<string, any>} row */
export function presentAttachment(row) {
  const { user_id: _owner, r2_key: _key, ...rest } = row;
  return { ...rest, url: `/api/attachments/${row.id}` };
}
