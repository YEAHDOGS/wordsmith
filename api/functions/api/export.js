// GET /api/export - everything the account holds, as JSON, for "Download my data" (src/lib/data-export.js builds the
// .zip on the device and fetches each file from /api/attachments/:id and /api/tapes/:id/audio).
// It works for a locked account too (free trial over, no plan): taking your data with you never needs a membership.
// Signed-in sessions only, never agent tokens. Rows in the trash are left out.
import { presentAttachment } from '../../lib/attachments.js';
import { requireAuth } from '../../lib/auth.js';
import { json } from '../../lib/http.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { SYNCED_TABLES, safeJson, toApi } from '../../lib/rows.js';

// A full export reads every row the account has, so it is rationed.
const EXPORTS_PER_WINDOW = 6;
const EXPORT_WINDOW_MS = 3_600_000;
// Most rows of one table an export carries; a table cut short is named in `truncated`.
const MAX_ROWS = 20_000;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestGet(context) {
  const { user } = await requireAuth(context, { allowLocked: true });
  const { env } = context;
  await rateLimit(env, `export:${user.id}`, EXPORTS_PER_WINDOW, EXPORT_WINDOW_MS);
  const results = await env.DB.batch([
    ...SYNCED_TABLES.map((table) => env.DB.prepare(`SELECT * FROM ${table} WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT ?`).bind(user.id, MAX_ROWS)),
    env.DB.prepare('SELECT * FROM attachments WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT ?').bind(user.id, MAX_ROWS),
    env.DB.prepare('SELECT id, note_id, type, actor_type, actor_name, data, created_at FROM note_events WHERE user_id = ? ORDER BY created_at LIMIT ?').bind(user.id, MAX_ROWS),
  ]);
  const rows = results.map((/** @type {any} */ result) => result.results);
  const names = [...SYNCED_TABLES, 'attachments', 'events'];
  const [attachments, events] = rows.slice(SYNCED_TABLES.length);
  return json({
    exported_at: Date.now(),
    user: { id: user.id, email: user.email, name: user.name, created_at: user.created_at },
    ...Object.fromEntries(SYNCED_TABLES.map((table, index) => [table, rows[index].map(toApi)])),
    attachments: attachments.map(presentAttachment),
    events: events.map((/** @type {any} */ event) => ({ ...event, data: safeJson(event.data, {}) })),
    truncated: names.filter((_, index) => rows[index].length === MAX_ROWS),
  });
}
