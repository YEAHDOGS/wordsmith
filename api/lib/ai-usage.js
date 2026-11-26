// Today's Workers AI use, counted in neurons in scribe_usage (api/migrations/20261112000000_scribe_usage.sql), so the
// features that call a model (Scribe's wordsmith cloud, cloud transcripts for tapes) share one cap for everyone
// (EVERYONE) and can never spend the account's whole free allowance. Each feature keeps its own per-account row.
// A request reserves its worst-case cost first, in the same statement that checks the cap, then corrects it to what
// it really used.

/** The row counting every account together. */
export const EVERYONE = '*';
const ISO_DATE_LENGTH = 10;
// Changes a row of today's usage by ?3 neurons and ?4 requests: negative gives a reservation back.
const ADJUST = 'UPDATE scribe_usage SET neurons = MAX(0, neurons + ?3), requests = MAX(0, requests + ?4) WHERE day = ?1 AND user_id = ?2';

/** The UTC day of a time (Workers AI's allowance resets at 00:00 UTC), YYYY-MM-DD. @param {number} time */
export const dayOf = (time) => new Date(time).toISOString().slice(0, ISO_DATE_LENGTH);

/** Today in UTC, YYYY-MM-DD. */
export const today = () => dayOf(Date.now());

/**
 * Adds `neurons` to a row of today's usage only if the total stays within `cap`, in one statement, so two requests
 * can't both slip under it. Returns false when it would go over.
 * @param {Record<string, any>} env @param {string} day @param {string} key @param {number} neurons @param {number} cap
 */
export async function reserve(env, day, key, neurons, cap) {
  if (neurons > cap) return false;
  const row = await env.DB.prepare(
    `INSERT INTO scribe_usage (day, user_id, neurons, requests) VALUES (?1, ?2, ?3, 1)
     ON CONFLICT(day, user_id) DO UPDATE SET neurons = neurons + ?3, requests = requests + 1 WHERE neurons + ?3 <= ?4
     RETURNING neurons`,
  ).bind(day, key, neurons, cap).first();
  return Boolean(row);
}

/**
 * Moves rows of today's usage by `neurons` and `requests` (negative gives back), in one batch.
 * @param {Record<string, any>} env @param {string} day @param {string[]} keys @param {number} neurons @param {number} [requests]
 */
export async function adjust(env, day, keys, neurons, requests = 0) {
  await env.DB.batch(keys.map((key) => env.DB.prepare(ADJUST).bind(day, key, neurons, requests)));
}

/** Today's neurons on one row. @param {Record<string, any>} env @param {string} day @param {string} key */
export async function used(env, day, key) {
  const row = await env.DB.prepare('SELECT neurons FROM scribe_usage WHERE day = ?1 AND user_id = ?2').bind(day, key).first();
  return Number(row?.neurons ?? 0);
}
