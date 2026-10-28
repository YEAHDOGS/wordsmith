// Delta sync for the offline-first app.
// GET  /api/sync?since=<ms>  -> { projects, labels, notes, boards, note_groups, events, attachments, cursor, more }
// POST /api/sync { projects?, labels?, notes?, boards?, note_groups? } -> { saved: { table: rows }, rejected: [{ id, error }] }
// The server stamps updated_at, so every device orders changes by server time. Pull again after a push.
import { presentAttachment } from '../../lib/attachments.js';
import { requireAuth } from '../../lib/auth.js';
import { HttpError, json, readJson } from '../../lib/http.js';
import { actorFor, saveNotes } from '../../lib/notes.js';
import { SYNCED_TABLES, loadByIds, safeJson, toApi, upsertStatement } from '../../lib/rows.js';
import { MAX_SYNC_BATCH, cleanRow, isId, newRow, projectKey } from '../../../src/lib/models.js';

const PULL_LIMIT = 500;
// Re-send a few seconds of changes on every pull so writes that commit while we read are never skipped.
const CURSOR_OVERLAP_MS = 5_000;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestGet(context) {
  const { user } = await requireAuth(context);
  const { env, request } = context;
  const since = Math.max(0, Number(new URL(request.url).searchParams.get('since')) || 0);
  const now = Date.now();

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

    const statements = [];
    // Projects: one live project per name (projectKey). Each live project's key -> id, kept current through this batch.
    /** @type {Map<string, string> | null} */
    const projectNames = table === 'projects' ? new Map((await env.DB.prepare('SELECT id, name_key, name FROM projects WHERE user_id = ? AND deleted_at IS NULL').bind(auth.user.id).all())
      .results.map((/** @type {any} */ project) => [project.name_key ?? projectKey(project.name), String(project.id)])) : null;
    for (const row of incoming) {
      try {
        const base = existing.get(row.id) ?? newRow(table, { id: row.id, created_at: Math.min(Number(row.created_at) || now, now) });
        const next = { ...base, ...cleanRow(table, row), user_id: auth.user.id, updated_at: now, deleted_at: row.deleted_at ? Math.min(Number(row.deleted_at), now) : null };
        if (projectNames) claimProjectName(projectNames, next);
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
 * Stamps a project's name_key and holds its name for this batch, or throws when another live project already has it
 * (the database's unique index would otherwise fail the whole batch). A project keeps its own name across renames.
 * @param {Map<string, string>} names live project key -> id
 * @param {Record<string, any>} project the row about to be saved
 */
function claimProjectName(names, project) {
  project.name_key = projectKey(project.name);
  const holder = names.get(project.name_key);
  if (!project.deleted_at && holder && holder !== project.id) throw new Error(`A project named "${project.name}" already exists`);
  for (const [key, id] of names) if (id === project.id) names.delete(key);
  if (!project.deleted_at) names.set(project.name_key, project.id);
}