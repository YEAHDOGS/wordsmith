// Delta sync for the offline-first app.
// GET  /api/sync?since=<ms>  -> { projects, labels, notes, boards, note_groups, events, attachments, cursor, more }
// POST /api/sync { projects?, labels?, notes?, boards?, note_groups? } -> { saved: { table: rows }, rejected: [{ id, error }] }
// The server stamps updated_at, so every device orders changes by server time. Pull again after a push.
import { presentAttachment } from '../../lib/attachments.js';
import { requireAuth } from '../../lib/auth.js';
import { HttpError, json, readJson } from '../../lib/http.js';
import { actorFor, saveNotes } from '../../lib/notes.js';
import { SYNCED_TABLES, loadByIds, safeJson, toApi, upsertStatement } from '../../lib/rows.js';
import { schedulePurge, settleTrash } from '../../lib/trash.js';
import { MAX_PROJECTS, MAX_SYNC_BATCH, NAME_TAKEN, PROJECT_LIMIT, cleanRow, isId, newRow, projectKey } from '../../../src/lib/models.js';

const PULL_LIMIT = 500;
// Re-send a few seconds of changes on every pull so writes that commit while we read are never skipped.
const CURSOR_OVERLAP_MS = 5_000;

/** @param {{ request: Request, env: Record<string, any>, waitUntil?: (promise: Promise<any>) => void }} context */
export async function onRequestGet(context) {
  const { user } = await requireAuth(context);
  const { env, request } = context;
  const since = Math.max(0, Number(new URL(request.url).searchParams.get('since')) || 0);
  const now = Date.now();
  // Rows past their days in the trash are purged in the background; the purge stamps updated_at, so the next pull has them.
  schedulePurge(context, user.id);

  // Most polls find nothing new: answer those with one small query instead of one per table.
  if (since) {
    // EXISTS checks rather than a UNION: D1 caps compound SELECTs at a few terms.
    const checks = [...[...SYNCED_TABLES, 'attachments'].map((table) => `EXISTS (SELECT 1 FROM ${table} WHERE user_id = ?1 AND updated_at > ?2)`),
      'EXISTS (SELECT 1 FROM note_events WHERE user_id = ?1 AND created_at > ?2)'];
    const { changed } = /** @type {{ changed: number }} */ (await env.DB.prepare(`SELECT (${checks.join(' OR ')}) AS changed`).bind(user.id, since).first());
    if (!changed) {
      return json({ ...Object.fromEntries(SYNCED_TABLES.map((table) => [table, []])), events: [], attachments: [], cursor: since, server_time: now, more: false, user_id: user.id });
    }
  }

  const queries = SYNCED_TABLES.map((table) =>
    env.DB.prepare(`SELECT * FROM ${table} WHERE user_id = ? AND updated_at > ? ORDER BY updated_at LIMIT ?`).bind(user.id, since, PULL_LIMIT));
  queries.push(env.DB.prepare('SELECT id, note_id, type, actor_type, actor_name, data, created_at FROM note_events WHERE user_id = ? AND created_at > ? ORDER BY created_at LIMIT ?')
    .bind(user.id, since, PULL_LIMIT));
  // Attachments are created by upload, not by sync, so they only flow down.
  queries.push(env.DB.prepare('SELECT * FROM attachments WHERE user_id = ? AND updated_at > ? ORDER BY updated_at LIMIT ?').bind(user.id, since, PULL_LIMIT));
  const results = (await env.DB.batch(queries)).map((/** @type {any} */ result) => result.results);

  // A full page means there is more to fetch: continue from the oldest page end so nothing is skipped.
  const pageEnds = results.filter((rows) => rows.length === PULL_LIMIT)
    .map((rows) => Number(rows.at(-1).updated_at ?? rows.at(-1).created_at));
  const more = pageEnds.length > 0;
  const cursor = more ? Math.min(...pageEnds) - 1 : Math.max(since, now - CURSOR_OVERLAP_MS);

  const [events, attachments] = results.slice(SYNCED_TABLES.length);
  return json({
    ...Object.fromEntries(SYNCED_TABLES.map((table, index) => [table, results[index].map(toApi)])),
    events: events.map((/** @type {any} */ event) => ({ ...event, data: safeJson(event.data, {}) })),
    attachments: attachments.map(presentAttachment),
    cursor,
    server_time: now,
    more,
    // Whose data this is: the app checks it against the user it started with (it may trust a cached sign-in).
    user_id: user.id,
  });
}

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost(context) {
  const auth = await requireAuth(context);
  const { env, request } = context;
  const body = await readJson(request);
  const total = SYNCED_TABLES.reduce((sum, table) => sum + (Array.isArray(body[table]) ? body[table].length : 0), 0);
  if (total > MAX_SYNC_BATCH) throw new HttpError(413, `Send at most ${MAX_SYNC_BATCH} rows per sync`);

  /** @type {{ id: unknown, error: string }[]} */
  const rejected = [];
  /** @type {Record<string, any[]>} */
  const saved = Object.fromEntries(SYNCED_TABLES.map((table) => [table, /** @type {any[]} */ ([])]));
  const now = Date.now();

  for (const table of SYNCED_TABLES) {
    const incoming = (Array.isArray(body[table]) ? body[table] : []).filter((/** @type {any} */ row) => {
      if (isId(row?.id)) return true;
      rejected.push({ id: row?.id, error: 'invalid id' });
      return false;
    });
    if (!incoming.length) continue;
    const existing = await loadByIds(env, table, auth.user.id, incoming.map((/** @type {any} */ row) => row.id));

    if (table === 'notes') {
      const changes = [];
      for (const row of incoming) {
        try {
          cleanRow('notes', row);
          changes.push({ before: existing.get(row.id) ?? null, patch: row });
        } catch (error) {
          rejected.push({ id: row.id, error: /** @type {Error} */ (error).message });
        }
      }
      saved.notes = await saveNotes(env, auth.user.id, actorFor(auth), changes);
      continue;
    }

    if (table === 'projects') {
      const result = await saveProjects(env, auth.user.id, incoming, existing, now);
      saved.projects = result.saved;
      rejected.push(...result.rejected);
      continue;
    }

    const statements = [];
    for (const row of incoming) {
      try {
        const base = existing.get(row.id) ?? newRow(table, { id: row.id, created_at: Math.min(Number(row.created_at) || now, now) });
        const next = settleTrash(table, { ...base, ...cleanRow(table, row), user_id: auth.user.id, updated_at: now, deleted_at: row.deleted_at ? Math.min(Number(row.deleted_at), now) : null });
        const upsert = upsertStatement(env, table, next, existing.get(row.id) ?? null);
        if (upsert) statements.push(upsert);
        const { user_id: _owner, ...apiRow } = next;
        saved[table].push(apiRow);
      } catch (error) {
        rejected.push({ id: row.id, error: /** @type {Error} */ (error).message });
      }
    }
    if (statements.length) await env.DB.batch(statements);
  }
  return json({ saved, rejected, server_time: now });
}

/**
 * Saves pushed project rows under one rule: one live project per name (projectKey on the stored name, not name_key,
 * which an old Worker may have left empty or stale and the migration's SQL backfill folded A-Z only), at most
 * MAX_PROJECTS live projects. A refusal carries a code and the server's copy, so the device can put itself right:
 * - a new project under a taken name, or past the cap, is refused (current: null);
 * - a rename onto a taken name keeps the stored name but saves every other field (current: the saved row);
 * - a project keeping its own name is always saved, even if an old Worker let a duplicate in.
 * The writes go out as one batch (D1 counts it as one query); only if another device took a name since the check,
 * and the unique index refuses the batch, are they retried one at a time.
 * @param {Record<string, any>} env @param {string} userId @param {any[]} incoming
 * @param {Map<string, Record<string, any>>} existing stored rows by id @param {number} now
 */
async function saveProjects(env, userId, incoming, existing, now) {
  /** @type {any[]} */ const saved = [];
  /** @type {any[]} */ const rejected = [];
  const { results: live } = await env.DB.prepare('SELECT id, name, name_key FROM projects WHERE user_id = ? AND deleted_at IS NULL').bind(userId).all();
  // A legacy duplicate pair shares a name: the row holding the stored key wins, whatever order the rows came back in.
  const holdersLast = [...live].sort((a, b) => Number(a.name_key !== null) - Number(b.name_key !== null));
  const names = new Map(holdersLast.map((/** @type {any} */ project) => [projectKey(project.name), String(project.id)]));
  // Deletions in this push free their slots up front, so a push that deletes one project and adds another at the cap
  // is not refused just because the new row comes first.
  // One row per id (the last one sent), so a repeated row can neither apply twice nor free a slot twice.
  const rows = [...new Map(incoming.map((row) => [String(row.id), row])).values()];
  const liveIds = new Set(live.map((/** @type {any} */ project) => String(project.id)));
  const freed = new Set(rows.filter((row) => row.deleted_at && liveIds.has(String(row.id))).map((row) => String(row.id)));
  let count = live.length - freed.size;
  /** @type {{ statement: any, next: Record<string, any>, row: Record<string, any>, before: Record<string, any> | null }[]} */
  const writes = [];
  for (const row of rows) {
    const before = existing.get(row.id) ?? null;
    let next;
    try {
      const base = before ?? newRow('projects', { id: row.id, created_at: Math.min(Number(row.created_at) || now, now) });
      next = settleTrash('projects', { ...base, ...cleanRow('projects', row), user_id: userId, updated_at: now, deleted_at: row.deleted_at ? Math.min(Number(row.deleted_at), now) : null });
    } catch (error) {
      // A refused deletion keeps its project, so it gives its slot back.
      if (freed.delete(String(row.id))) count++;
      rejected.push({ id: row.id, table: 'projects', error: /** @type {Error} */ (error).message, current: before });
      continue;
    }
    next.name_key = projectKey(next.name);
    const holder = names.get(next.name_key);
    const keepsOwnName = before !== null && projectKey(before.name) === next.name_key;
    const taken = !next.deleted_at && holder !== undefined && holder !== next.id && !keepsOwnName;
    if (taken && !before) {
      rejected.push({ id: row.id, table: 'projects', code: NAME_TAKEN, error: `A project named "${next.name}" already exists`, current: null });
      continue;
    }
    // A new project and a restored one both take a slot.
    const takesSlot = !next.deleted_at && (before === null || Boolean(before.deleted_at));
    if (takesSlot && count >= MAX_PROJECTS) {
      rejected.push({ id: row.id, table: 'projects', code: PROJECT_LIMIT, error: `You can have at most ${MAX_PROJECTS} projects`, current: before });
      continue;
    }
    const refusedName = taken ? next.name : '';
    if (taken && before) Object.assign(next, { name: before.name, name_key: projectKey(before.name) });
    // A duplicate left by an old Worker or the migration keeps its name but stays keyless while another project holds
    // the key, so the unique index never refuses its other edits; it gets its key back once the name is free.
    if (!taken && keepsOwnName && holder !== undefined && holder !== next.id) next.name_key = null;
    if (takesSlot) count++;
    for (const [key, id] of names) if (id === next.id) names.delete(key);
    if (!next.deleted_at && next.name_key !== null) names.set(next.name_key, next.id);
    const statement = upsertStatement(env, 'projects', next, before);
    const { user_id: _owner, ...apiRow } = next;
    if (statement) writes.push({ statement, next, row: apiRow, before });
    saved.push(apiRow);
    if (refusedName) rejected.push({ id: row.id, table: 'projects', code: NAME_TAKEN, error: `A project named "${refusedName}" already exists, so the name wasn't changed`, current: apiRow });
  }
  try {
    if (writes.length) await env.DB.batch(writes.map((write) => write.statement));
  } catch (error) {
    if (!/UNIQUE/i.test(/** @type {Error} */ (error).message)) throw error;
    // The batch was all-or-nothing; redo it row by row so only the clashing rows are refused.
    for (const write of writes) {
      try {
        await write.statement.run();
      } catch (rowError) {
        if (!/UNIQUE/i.test(/** @type {Error} */ (rowError).message)) throw rowError;
        const place = saved.findIndex((project) => project.id === write.row.id);
        const message = `A project named "${write.row.name}" already exists`;
        // Another device took the name since the check. A rename still saves its other edits under the stored name,
        // the same as a rename refused up front; a new project is refused.
        const kept = write.before && await keepStoredName(env, write);
        if (kept) {
          saved[place] = kept;
          rejected.push({ id: write.row.id, table: 'projects', code: NAME_TAKEN, error: `${message}, so the name wasn't changed`, current: kept });
        } else {
          saved.splice(place, 1);
          rejected.push({ id: write.row.id, table: 'projects', code: NAME_TAKEN, error: message, current: write.before });
        }
      }
    }
  }
  return { saved, rejected };
}

/**
 * Saves a refused rename's other edits under the stored name and key. Returns the saved row, or null if that clashes too.
 * @param {Record<string, any>} env @param {{ next: Record<string, any>, before: Record<string, any> | null }} write
 */
async function keepStoredName(env, write) {
  const next = { ...write.next, name: write.before?.name, name_key: write.before?.name_key ?? null };
  const statement = upsertStatement(env, 'projects', next, write.before);
  try {
    if (statement) await statement.run();
  } catch (error) {
    if (!/UNIQUE/i.test(/** @type {Error} */ (error).message)) throw error;
    return null;
  }
  const { user_id: _owner, ...apiRow } = next;
  return apiRow;
}
