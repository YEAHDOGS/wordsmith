// The trash. Deleting a project, label, note or note group only tombstones it (deleted_at); it stays recoverable for
// TRASH_DAYS. Purging blanks its content, removes a note's attachments from R2 and stamps purged_at, keeping the
// tombstone so offline devices still learn about the delete. Rows are purged by age (checked during sync, at most
// every PURGE_CHECK_MS per user per isolate, so there are no cron triggers or extra Workers), or right away by
// "Delete forever" and "Empty trash" (POST /api/trash).
import { TRASH_MS, TRASH_TABLES } from '../../src/lib/models.js';
import { release } from './attachments.js';
import { MAX_BIND_PARAMS, toApi } from './rows.js';

// Rows purged per table per pass; a backlog clears over the next passes.
export const PURGE_BATCH = 50;
const PURGE_CHECK_MS = 6 * 3_600_000;
// The per-isolate throttle forgets everyone past this many users rather than growing without bound.
const MAX_TRACKED_USERS = 10_000;
// R2's delete() takes at most this many keys per call.
const R2_DELETE_MAX = 1000;
// What a purged row keeps of its content: nothing a person wrote.
/** @type {Record<string, Record<string, any>>} */
const PURGED_FIELDS = {
  notes: { title: '', body: '', analysis: '', status: '', public: false },
  projects: { name: '', description: '', repo: '' },
  labels: { name: '' },
  note_groups: { name: '' },
};
// Same as PURGED_FIELDS, as D1 stores it, for the purge UPDATE.
/** @type {Record<string, string>} */
const PURGE_SET = Object.fromEntries(Object.entries(PURGED_FIELDS).map(([table, fields]) =>
  [table, Object.entries(fields).map(([column, value]) => `${column} = ${typeof value === 'boolean' ? Number(value) : "''"}`).join(', ')]));

/** @type {Map<string, number>} user id -> last age check in this isolate */
const lastCheck = new Map();

/**
 * Keeps a row's trash state straight on every write: a restored row (no deleted_at) is out of the trash for good, and a
 * purged row that is still deleted keeps its blank content, whatever a stale device sends. Mutates `row`.
 * @param {string} table @param {Record<string, any>} row
 */
export function settleTrash(table, row) {
  if (!TRASH_TABLES.includes(table)) return row;
  if (!row.deleted_at) return Object.assign(row, { purged_at: null });
  if (row.purged_at) Object.assign(row, PURGED_FIELDS[table]);
  return row;
}

/**
 * Purges these rows (only those in the trash: deleted, not yet purged). A note's attachments go first, so a failure
 * leaves the note in the trash for the next pass instead of orphaning its files.
 * @param {Record<string, any>} env @param {string} userId @param {string} table @param {string[]} ids
 * @returns {Promise<Record<string, any>[]>} the purged rows, API shaped
 */
export async function purgeRows(env, userId, table, ids) {
  if (!TRASH_TABLES.includes(table) || !ids.length) return [];
  const now = Date.now();
  const purged = [];
  // now, now and the user id take three of the bound parameters.
  const chunkSize = MAX_BIND_PARAMS - 3;
  for (let start = 0; start < ids.length; start += chunkSize) {
    const chunk = ids.slice(start, start + chunkSize);
    if (table === 'notes') await purgeAttachments(env, userId, chunk, now);
    const { results } = await env.DB.prepare(
      `UPDATE ${table} SET ${PURGE_SET[table]}, purged_at = ?, updated_at = ?
       WHERE user_id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL AND id IN (${chunk.map(() => '?').join(', ')})
       RETURNING *`,
    ).bind(now, now, userId, ...chunk).all();
    purged.push(...results.map(toApi));
  }
  return purged;
}

/**
 * Deletes every live attachment on these notes: R2 objects, then the rows (tombstoned, so devices drop them), then the
 * storage they reserved.
 * @param {Record<string, any>} env @param {string} userId @param {string[]} noteIds @param {number} now
 */
async function purgeAttachments(env, userId, noteIds, now) {
  const { results } = await env.DB.prepare(
    `SELECT id, r2_key, size FROM attachments WHERE user_id = ? AND deleted_at IS NULL AND note_id IN (${noteIds.map(() => '?').join(', ')})`,
  ).bind(userId, ...noteIds).all();
  if (!results.length) return;
  const keys = results.map((/** @type {any} */ file) => file.r2_key);
  for (let start = 0; env.ATTACHMENTS && start < keys.length; start += R2_DELETE_MAX) await env.ATTACHMENTS.delete(keys.slice(start, start + R2_DELETE_MAX));
  const ids = results.map((/** @type {any} */ file) => file.id);
  const chunkSize = MAX_BIND_PARAMS - 2;
  const updates = [];
  for (let start = 0; start < ids.length; start += chunkSize) {
    const chunk = ids.slice(start, start + chunkSize);
    updates.push(env.DB.prepare(`UPDATE attachments SET deleted_at = ?, updated_at = ? WHERE id IN (${chunk.map(() => '?').join(', ')})`).bind(now, now, ...chunk));
  }
  await env.DB.batch(updates);
  await release(env, results.reduce((sum, /** @type {any} */ file) => sum + Number(file.size), 0));
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
