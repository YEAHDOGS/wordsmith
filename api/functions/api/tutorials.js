// GET /api/tutorials -> { tutorials: string[] }  the first-run tutorials this account has finished or skipped.
// POST /api/tutorials { tutorial } -> { tutorials: string[] }  marks a first-run tutorial finished (or skipped) for
// this account, so it never shows again on any device. GET /api/auth/session lists the ones already seen.
import { requireAuth } from '../../lib/auth.js';
import { HttpError, json, readJson } from '../../lib/http.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { TUTORIALS } from '../../../src/lib/models.js';

// One write per tutorial per account is all a person needs; this only stops a runaway loop.
const TUTORIAL_LIMIT = 20;
const TUTORIAL_WINDOW_MS = 60_000;

/** The tutorials this account has seen. @param {Record<string, any>} env @param {string} userId @returns {Promise<string[]>} */
export async function seenTutorials(env, userId) {
  const { results } = await env.DB.prepare('SELECT tutorial FROM tutorials_seen WHERE user_id = ?').bind(userId).all();
  return results.map((row) => String(row.tutorial)).filter((tutorial) => TUTORIALS.includes(tutorial));
}

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestGet(context) {
  const { user } = await requireAuth(context);
  return json({ tutorials: await seenTutorials(context.env, user.id) });
}

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost(context) {
  const { user } = await requireAuth(context);
  const { env, request } = context;
  const { tutorial } = await readJson(request);
  if (!TUTORIALS.includes(tutorial)) throw new HttpError(400, `tutorial must be one of ${TUTORIALS.join(', ')}`);
  await rateLimit(env, `tutorials:${user.id}`, TUTORIAL_LIMIT, TUTORIAL_WINDOW_MS);
  await env.DB.prepare('INSERT OR IGNORE INTO tutorials_seen (user_id, tutorial, seen_at) VALUES (?, ?, ?)').bind(user.id, tutorial, Date.now()).run();
  return json({ tutorials: await seenTutorials(env, user.id) });
}
