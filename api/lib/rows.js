// Converts synced rows between D1 (JSON text, 0/1 integers) and the API shape (arrays, booleans), and builds upserts.
import { BOOL_FIELDS, JSON_FIELDS, MODELS, SERVER_FIELDS } from '../../src/lib/models.js';

// D1 caps bound parameters per query at 100.
export const MAX_BIND_PARAMS = 100;
export const SYNCED_TABLES = /** @type {const} */ (['projects', 'labels', 'notes', 'boards']);

/** Every column a synced table stores, in a fixed order. @param {keyof typeof MODELS} table */
export const columnsOf = (table) => ['id', 'user_id', ...Object.keys(MODELS[table]), ...SERVER_FIELDS[table], 'created_at', 'updated_at', 'deleted_at'];

/**
 * D1 row -> API row. user_id is dropped: callers only ever see their own rows.
 * @param {Record<string, any>} row
 */
export function toApi(row) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'user_id') continue;
    if (JSON_FIELDS.includes(key)) out[key] = safeJson(value, []);
    else if (BOOL_FIELDS.includes(key)) out[key] = Boolean(value);
    else out[key] = value;
  }
  return out;
}

/** @param {any} text @param {any} fallback */
export function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * INSERT ... ON CONFLICT DO UPDATE for a full row. The WHERE keeps one user from overwriting another user's id.
 * @param {Record<string, any>} env
 * @param {keyof typeof MODELS} table
 * @param {Record<string, any>} row API-shaped row including id, user_id and timestamps
 */
export function upsertStatement(env, table, row) {
  const columns = columnsOf(table);
  const values = columns.map((column) => {
    const value = row[column];
    if (JSON_FIELDS.includes(column)) return JSON.stringify(value ?? []);
    if (BOOL_FIELDS.includes(column)) return value ? 1 : 0;
    return value ?? null;
  });
  const updates = columns.filter((column) => !['id', 'user_id', 'created_at'].includes(column)).map((column) => `${column} = excluded.${column}`);
  return env.DB.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')} WHERE ${table}.user_id = excluded.user_id`,
  ).bind(...values);
}

/**
 * Loads rows by id for one user, chunked under the bind limit.
 * @param {Record<string, any>} env
 * @param {keyof typeof MODELS} table
 * @param {string} userId
 * @param {string[]} ids
 * @returns {Promise<Map<string, Record<string, any>>>}
 */
export async function loadByIds(env, table, userId, ids) {
  const found = new Map();
  const chunkSize = MAX_BIND_PARAMS - 1;
  for (let start = 0; start < ids.length; start += chunkSize) {
    const chunk = ids.slice(start, start + chunkSize);
    const { results } = await env.DB.prepare(`SELECT * FROM ${table} WHERE user_id = ? AND id IN (${chunk.map(() => '?').join(', ')})`)
      .bind(userId, ...chunk).all();
    for (const row of results) found.set(row.id, toApi(row));
  }
  return found;
}
