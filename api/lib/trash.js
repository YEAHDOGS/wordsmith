// The trash. Deleting a project, label, note or note group only tombstones it (deleted_at); it stays recoverable for
// TRASH_DAYS. Purging blanks its content, removes a note's attachments from R2 and stamps purged_at, keeping the
// tombstone so offline devices still learn about the delete. Rows are purged by age (checked during sync, at most
// every PURGE_CHECK_MS per user per isolate, so there are no cron triggers or extra Workers), or right away by
// "Delete forever" and "Empty trash" (POST /api/trash).
import { MODELS, TRASH_MS, TRASH_TABLES } from '../../src/lib/models.js';
import { MAX_BIND_PARAMS, dbValue, toApi } from './rows.js';

// Rows purged per table per pass; a backlog clears over the next passes.
export const PURGE_BATCH = 50;
const PURGE_CHECK_MS = 6 * 3_600_000;
// The per-isolate throttle forgets everyone past this many users rather than growing without bound.
const MAX_TRACKED_USERS = 10_000;
// R2's delete() takes at most this many keys per call.
const R2_DELETE_MAX = 1000;
// Server-owned note data is erased too; it isn't in MODELS because clients cannot write it.
const PURGED_SERVER_FIELDS = {
  notes: {
    started_at: null,
    completed_at: null,
    prs_checked_at: null,
    analyzed_at: null,
    created_by: null,
    created_by_type: null,
  },
};
// What a purged row keeps: nothing anyone wrote. Every writable field goes back to its MODELS default, so only the
// id, the owner and the timestamps remain (plus a project's name_key, cleared below).
/** @type {Record<string, Record<string, any>>} */
const PURGED_FIELDS = Object.fromEntries(TRASH_TABLES.map((table) =>
  [table, {
    ...Object.fromEntries(Object.entries(MODELS[table]).map(([column, rule]) => [column, rule.default])),
    ...(PURGED_SERVER_FIELDS[/** @type {keyof typeof PURGED_SERVER_FIELDS} */ (table)] || {}),
  }]));
// Same as PURGED_FIELDS, as D1 stores it, for the purge UPDATE: "column = ?" pairs and their bound values.
/** @type {Record<string, { set: string, values: any[] }>} */
const PURGE_SET = Object.fromEntries(Object.entries(PURGED_FIELDS).map(([table, fields]) => [table, {
  set: [...Object.keys(fields).map((column) => `${column} = ?`), ...(table === 'projects' ? ['name_key = NULL'] : [])].join(', '),
  values: Object.entries(fields).map(([column, value]) => dbValue(column, value)),
}]));

/** @type {Map<string, number>} user id -> last age check in this isolate */
const lastCheck = new Map();

/**
 * Keeps a row's trash state straight on every write: a restored row (no deleted_at) is out of the trash for good, and a
 * purged row stays deleted and blank, whatever a stale device sends (the Trash never lists purged rows, so no real
 * restore can reach one). Mutates `row`.
 * @param {string} table @param {Record<string, any>} row @param {Record<string, any> | null} before the stored row
 */
export function settleTrash(table, row, before) {
  if (!TRASH_TABLES.includes(table)) return row;
  if (before?.purged_at && before.deleted_at) return Object.assign(row, structuredClone(PURGED_FIELDS[table]), { deleted_at: before.deleted_at, purged_at: before.purged_at });
  if (!row.deleted_at) return Object.assign(row, { purged_at: null });
  // A note going to the trash stops being shared, so restoring it never republishes it unasked.
  if (table === 'notes' && !before?.deleted_at) row.public = false;
  if (row.purged_at) Object.assign(row, structuredClone(PURGED_FIELDS[table]));
  return row;
}

/**
 * Purges these rows (only those in the trash: deleted, not yet purged). A note is purged before its attachments, so a
 * restore racing the purge either wins (the note isn't purged and keeps its files) or loses (the note is purged for
 * good, see settleTrash). Files left behind by a failed delete are swept by purgeBefore's next pass.
 * @param {Record<string, any>} env @param {string} userId @param {string} table @param {string[]} ids
 * @returns {Promise<Record<string, any>[]>} the purged rows, API shaped
 */
export async function purgeRows(env, userId, table, ids) {
  if (!TRASH_TABLES.includes(table) || !ids.length) return [];
  const now = Date.now();
  const purged = [];
  const { set, values } = PURGE_SET[table];
  // The reset values, now, now and the user id take the first bound parameters.
  const chunkSize = MAX_BIND_PARAMS - values.length - 3;
  for (let start = 0; start < ids.length; start += chunkSize) {
    const chunk = ids.slice(start, start + chunkSize);
    const { results } = await env.DB.prepare(
      `UPDATE ${table} SET ${set}, purged_at = ?, updated_at = ?
       WHERE user_id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL AND id IN (${chunk.map(() => '?').join(', ')})
       RETURNING *`,
    ).bind(...values, now, now, userId, ...chunk).all();
    if (table === 'notes' && results.length) {
      const noteIds = results.map((/** @type {any} */ row) => String(row.id));
      // The note's history (status lines, assignees, batches) goes with it.
      await env.DB.prepare(`DELETE FROM note_events WHERE user_id = ? AND note_id IN (${noteIds.map(() => '?').join(', ')})`).bind(userId, ...noteIds).run();
      await purgeAttachments(env, userId, noteIds, now);
    }
    purged.push(...results.map(toApi));
  }
  return purged;
}

/**
 * Deletes every live attachment on these notes: R2 objects, then blanks the metadata on all attachment tombstones for
 * these notes and gives back the storage reserved by live files.
 * @param {Record<string, any>} env @param {string} userId @param {string[]} noteIds @param {number} now
 */
async function purgeAttachments(env, userId, noteIds, now) {
  const { results } = await env.DB.prepare(
    `SELECT id, r2_key, size FROM attachments WHERE user_id = ? AND deleted_at IS NULL AND note_id IN (${noteIds.map(() => '?').join(', ')})`,
  ).bind(userId, ...noteIds).all();
  const keys = results.map((/** @type {any} */ file) => file.r2_key);
  if (keys.length && !env.ATTACHMENTS) throw new Error('Cannot purge attachments while R2 storage is unavailable');
  for (let start = 0; start < keys.length; start += R2_DELETE_MAX) await env.ATTACHMENTS.delete(keys.slice(start, start + R2_DELETE_MAX));
  const list = noteIds.map(() => '?').join(', ');
  // One batch (a transaction): release only files still live, then scrub live and previously deleted file metadata.
  // Clearing note_id after the first statement means a racing regular delete or a later retry cannot release twice.
  await env.DB.batch([
    env.DB.prepare(`UPDATE storage_usage SET bytes = MAX(0, bytes - (
      SELECT COALESCE(SUM(size), 0) FROM attachments WHERE user_id = ? AND deleted_at IS NULL AND note_id IN (${list})
    )) WHERE id = 1`).bind(userId, ...noteIds),
    env.DB.prepare(`UPDATE attachments SET note_id = '', r2_key = '', name = '', type = '', size = 0,
      deleted_at = COALESCE(deleted_at, ?), updated_at = ?
      WHERE user_id = ? AND note_id IN (${list})`).bind(now, now, userId, ...noteIds),
  ]);
}

/**
 * Purges up to PURGE_BATCH rows per table deleted before `cutoff` (Infinity = the whole trash).
 * @param {Record<string, any>} env @param {string} userId @param {number} cutoff
 * @returns {Promise<{ saved: Record<string, any[]>, more: boolean }>}
 */
export async function purgeBefore(env, userId, cutoff) {
  const bound = Number.isFinite(cutoff) ? cutoff : Number.MAX_SAFE_INTEGER;
  const found = await env.DB.batch(TRASH_TABLES.map((table) => env.DB.prepare(
    `SELECT id FROM ${table} WHERE user_id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL AND deleted_at < ? LIMIT ?`,
  ).bind(userId, bound, PURGE_BATCH)));
  /** @type {Record<string, any[]>} */
  const saved = {};
  let more = false;
  // Files of notes purged in an earlier pass whose R2 delete failed.
  const { results: orphaned } = await env.DB.prepare(
    `SELECT DISTINCT a.note_id FROM attachments a JOIN notes n ON n.id = a.note_id AND n.user_id = a.user_id
     WHERE a.user_id = ? AND a.note_id != '' AND n.purged_at IS NOT NULL AND n.deleted_at IS NOT NULL LIMIT ?`,
  ).bind(userId, PURGE_BATCH).all();
  if (orphaned.length) await purgeAttachments(env, userId, orphaned.map((/** @type {any} */ row) => String(row.note_id)), Date.now());
  for (const [index, table] of TRASH_TABLES.entries()) {
    const ids = found[index].results.map((/** @type {any} */ row) => String(row.id));
    if (ids.length === PURGE_BATCH) more = true;
    saved[table] = await purgeRows(env, userId, table, ids);
  }
  return { saved, more };
}

/**
 * Purges rows past their TRASH_DAYS in the background of a sync request, at most every PURGE_CHECK_MS per user in
 * this isolate. Purged rows get a fresh updated_at, so the next pull carries them to every device.
 * @param {{ env: Record<string, any>, waitUntil?: (promise: Promise<any>) => void }} context @param {string} userId
 */
export function schedulePurge(context, userId) {
  const now = Date.now();
  if (now - (lastCheck.get(userId) ?? 0) < PURGE_CHECK_MS) return;
  if (lastCheck.size >= MAX_TRACKED_USERS) lastCheck.clear();
  lastCheck.set(userId, now);
  const run = purgeBefore(context.env, userId, now - TRASH_MS).then(({ more }) => {
    // A backlog: let the next sync carry on with it.
    if (more) lastCheck.delete(userId);
  }).catch((error) => {
    lastCheck.delete(userId);
    console.error('trash purge failed', error);
  });
  if (context.waitUntil) context.waitUntil(run);
}
