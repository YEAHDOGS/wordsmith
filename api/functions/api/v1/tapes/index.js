// GET /api/v1/tapes?q=&rating=&transcribed=&limit=&offset= - the owner's voice recordings for an agent to dig through:
// title, notes, transcript, rating, when and how long. q matches title, notes and transcript; rating is 0-3 (TAPE_RATINGS);
// transcribed=1 keeps only tapes with a transcript. Newest recording first, at most MAX_LIMIT a page.
import { json } from '../../../../lib/http.js';
import { rateLimit } from '../../../../lib/rate-limit.js';
import { TAPE_RATINGS } from '../../../../../src/lib/models.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_QUERY = 200;
// Each call reads every tape the owner has (search can't use an index), so a looping agent is stopped well before it
// spends the free tier's daily row reads.
const READS_PER_DAY = 600;
const DAY_MS = 86_400_000;
const COLUMNS = 'id, title, body, transcript, transcript_model, transcribed_at, rating, recorded_at, duration_ms, source_name, created_at';

/** A whole number from the query string, held within bounds. @param {string | null} value @param {number} fallback @param {number} max */
function bounded(value, fallback, max) {
  const number = Number(value);
  return value !== null && Number.isInteger(number) && number >= 0 ? Math.min(number, max) : fallback;
}

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestGet({ request, env, data }) {
  await rateLimit(env, `tape-list:${data.auth.user.id}`, READS_PER_DAY, DAY_MS);
  const params = new URL(request.url).searchParams;
  const query = (params.get('q') || '').trim().slice(0, MAX_QUERY).toLowerCase();
  const rating = bounded(params.get('rating'), -1, TAPE_RATINGS.length - 1);
  const limit = bounded(params.get('limit'), DEFAULT_LIMIT, MAX_LIMIT) || DEFAULT_LIMIT;
  const offset = bounded(params.get('offset'), 0, Number.MAX_SAFE_INTEGER);
  const where = ['user_id = ?', 'deleted_at IS NULL'];
  /** @type {any[]} */
  const binds = [data.auth.user.id];
  if (query) {
    where.push("(instr(lower(title), ?) > 0 OR instr(lower(body), ?) > 0 OR instr(lower(transcript), ?) > 0)");
    binds.push(query, query, query);
  }
  if (params.has('rating') && rating >= 0) {
    where.push('rating = ?');
    binds.push(rating);
  }
  if (params.get('transcribed') === '1') where.push('transcribed_at IS NOT NULL');
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM tapes WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(recorded_at, created_at) DESC LIMIT ? OFFSET ?`).bind(...binds, limit + 1, offset).all();
  const tapes = results.slice(0, limit).map((/** @type {any} */ tape) => ({ ...tape, rating_label: TAPE_RATINGS[tape.rating] }));
  return json({ tapes, more: results.length > limit, next_offset: offset + tapes.length, ratings: TAPE_RATINGS });
}
