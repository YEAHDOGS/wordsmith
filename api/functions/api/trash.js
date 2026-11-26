// Empties the trash now instead of after TRASH_DAYS (src/lib/models.js). Purging is server-only: it removes attachment
// files from R2, which a device can't do through sync. Restoring needs no route: sync clears deleted_at.
// POST /api/trash { notes?, projects?, labels?, note_groups?: string[] } -> { saved: { table: rows }, more: false }  "Delete forever"
// POST /api/trash { all: true } -> { saved, more }  "Empty trash": a page at a time; call again while more is true.
import { requireAuth } from '../../lib/auth.js';
import { HttpError, json, readJson } from '../../lib/http.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { purgeBefore, purgeRows } from '../../lib/trash.js';
import { MAX_SYNC_BATCH, TRASH_TABLES, isId } from '../../../src/lib/models.js';

// Each call can write a few hundred rows and delete R2 objects: generous for a person, a wall for a runaway loop.
const PURGE_LIMIT = 60;
const PURGE_WINDOW_MS = 60_000;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost(context) {
  const { user } = await requireAuth(context);
  const { env, request } = context;
  const body = await readJson(request);
  await rateLimit(env, `trash:${user.id}`, PURGE_LIMIT, PURGE_WINDOW_MS);
  if (body.all === true) return json(await purgeBefore(env, user.id, Infinity));

  const lists = TRASH_TABLES.map((table) => (Array.isArray(body[table]) ? body[table] : []));
  const total = lists.reduce((sum, ids) => sum + ids.length, 0);
  if (!total) throw new HttpError(400, `Send ids in ${TRASH_TABLES.join(', ')}, or all: true`);
  if (total > MAX_SYNC_BATCH) throw new HttpError(413, `Send at most ${MAX_SYNC_BATCH} ids at a time`);
  if (!lists.every((ids) => ids.every(isId))) throw new HttpError(400, 'Every id must be an id');

  /** @type {Record<string, any[]>} */
  const saved = {};
  for (const [index, table] of TRASH_TABLES.entries()) saved[table] = await purgeRows(env, user.id, table, [...new Set(lists[index])]);
  return json({ saved, more: false });
}
