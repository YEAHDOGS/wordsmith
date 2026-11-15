// Attachment storage in R2 with hard caps kept below R2's free tier (10 GB stored, 1M Class A writes and 10M Class B reads
// per month). That allowance is shared by the whole Cloudflare account (other buckets, and wordsmith's staging and production),
// so each environment gets its own slice via R2_MAX_GB / R2_MAX_MONTHLY_WRITES / R2_MAX_MONTHLY_READS in wrangler.jsonc.
// When a cap is reached the request is refused with 507 instead of costing money. The bucket is private: every byte goes through here.
import { AUDIO_TYPES, DOCUMENT_TYPES, MAX_ATTACHMENTS_PER_NOTE, MAX_AUDIO_BYTES, MAX_DOCUMENT_BYTES, MAX_FILE_NAME, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, attachmentKind, audioType, documentType } from '../../src/lib/models.js';
import { HttpError } from './http.js';

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const MAX_BYTES = { image: MAX_IMAGE_BYTES, video: MAX_VIDEO_BYTES, audio: MAX_AUDIO_BYTES, document: MAX_DOCUMENT_BYTES };
const PLURAL = { image: 'Images', video: 'Videos', audio: 'Audio files', document: 'Documents' };
const ERROR_TYPE = 'Only supported images, videos, audio files, and documents can be attached';
// Conservative fallbacks if an environment forgets to set its slice.
const DEFAULT_MAX_GB = 1;
const DEFAULT_MAX_MONTHLY_WRITES = 100_000;
const DEFAULT_MAX_MONTHLY_READS = 1_000_000;
const INSUFFICIENT_STORAGE = 507;
// Stored files never change, so browsers cache them for a year and repeat views cost no requests.
const CACHE_FOREVER = 'private, max-age=31536000, immutable';
const NOT_MODIFIED = 304;
const PARTIAL_CONTENT = 206;
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;
// Served from the app's origin, so never let a file act like a page. Browsers won't show a PDF in a sandboxed
// document, and Chrome's viewer embeds the file itself, so PDFs drop the sandbox and allow only that embed; the
// viewer runs apart from the app and can't reach it.
const SANDBOXED = "default-src 'none'; sandbox";
const PDF_POLICY = "default-src 'none'; object-src 'self'; form-action 'none'; frame-ancestors 'none'";
const PDF = 'application/pdf';
// Text is sent as UTF-8 so notes in any language read right.
const TEXT_CHARSET = '; charset=utf-8';

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
  const kind = attachmentKind(type);
  if (!kind) throw new HttpError(415, ERROR_TYPE);
  if (kind === 'audio' && audioType(name) !== type) throw new HttpError(415, `${type} files need a name ending in ${AUDIO_TYPES[/** @type {keyof typeof AUDIO_TYPES} */ (type)].join(' or ')}`);
  // A document's name has to carry its type's extension, so a file can't claim to be text and download as something else.
  if (kind === 'document' && documentType(name) !== type) throw new HttpError(415, `${type} files need a name ending in ${DOCUMENT_TYPES[/** @type {keyof typeof DOCUMENT_TYPES} */ (type)].join(' or ')}`);
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(411, 'Content-Length is required');
  const max = MAX_BYTES[kind];
  if (size > max) throw new HttpError(413, `${PLURAL[kind]} can be at most ${Math.round(max / MB)} MB`);
  return name.replace(/[\\/\r\n\t"]/g, '_').trim().slice(0, MAX_FILE_NAME) || kind;
}

/** Counts live attachments on a note. @param {Record<string, any>} env @param {string} noteId */
export async function assertRoomOnNote(env, noteId) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM attachments WHERE note_id = ? AND deleted_at IS NULL').bind(noteId).first();
  if (Number(row?.n) >= MAX_ATTACHMENTS_PER_NOTE) throw new HttpError(400, `A note can hold at most ${MAX_ATTACHMENTS_PER_NOTE} attachments`);
}

/**
 * Streams a stored file to its owner: Range requests (so audio and video seek), a year in the browser cache, and
 * headers that keep it from ever running as a page. Attachments and tape audio both go through here.
 * @param {{ request: Request, env: Record<string, any> }} context
 * @param {{ key: string, size: number, type: string, name: string, etag: string }} file
 */
export async function streamFile({ request, env }, { key, size, type, name, etag }) {
  const files = bucket(env);
  if (request.headers.get('If-None-Match') === `"${etag}"`) return new Response(null, { status: NOT_MODIFIED });

  /** @type {{ offset: number, length: number } | undefined} */
  let range;
  const match = RANGE_PATTERN.exec(request.headers.get('Range') || '');
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start <= end && start < size) range = { offset: start, length: end - start + 1 };
  }

  await reserve(env, { reads: 1 });
  const object = await files.get(key, range ? { range } : undefined);
  if (!object) throw new HttpError(404, 'File is missing from storage');

  // Images, video, audio and PDFs show in the browser; other documents always download.
  const disposition = attachmentKind(type) !== 'document' || type === PDF ? 'inline' : 'attachment';
  const headers = new Headers({
    'Content-Type': type.startsWith('text/') ? type + TEXT_CHARSET : type,
    'Cache-Control': CACHE_FOREVER,
    ETag: `"${etag}"`,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': type === PDF ? PDF_POLICY : SANDBOXED,
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
  });
  if (!range) {
    headers.set('Content-Length', String(size));
    return new Response(object.body, { headers });
  }
  headers.set('Content-Length', String(range.length));
  headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
  return new Response(object.body, { status: PARTIAL_CONTENT, headers });
}

/** Attachment as clients see it. @param {Record<string, any>} row */
export function presentAttachment(row) {
  const { user_id: _owner, r2_key: _key, ...rest } = row;
  return { ...rest, url: `/api/attachments/${row.id}` };
}
