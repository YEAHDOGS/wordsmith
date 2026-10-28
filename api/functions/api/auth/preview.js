// POST /api/auth/preview { password } - Worker Previews only (see previewLoginEnabled). The right password signs in one
// fixed Preview user on the staging database, so the owner can try a pull request's live site. 404 everywhere else.
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, cookie, createSession } from '../../../lib/auth.js';
import { sameSecret } from '../../../lib/crypto.js';
import { HttpError, json, readJson } from '../../../lib/http.js';
import { LOGIN_RATE_WINDOW_MS, previewLoginEnabled } from '../../../lib/login.js';
import { clientIp, rateLimit } from '../../../lib/rate-limit.js';

const PREVIEW_USER = { id: 'preview-owner', email: 'preview@wordsmith.dogs.red', name: 'Preview' };
// Wrong guesses allowed per IP per LOGIN_RATE_WINDOW_MS (10 minutes).
const ATTEMPT_LIMIT = 10;
const MAX_PASSWORD = 200;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost({ request, env }) {
  if (!previewLoginEnabled(request, env)) throw new HttpError(404, 'Not found');
  await rateLimit(env, `preview-login:${clientIp(request)}`, ATTEMPT_LIMIT, LOGIN_RATE_WINDOW_MS);
  const { password } = await readJson(request);
  if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD) throw new HttpError(400, 'Enter the Preview password');
  if (!(await sameSecret(password, env.PREVIEW_PASSWORD))) throw new HttpError(403, 'Wrong password');
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, name, avatar_url, created_at) VALUES (?, ?, ?, NULL, ?)')
    .bind(PREVIEW_USER.id, PREVIEW_USER.email, PREVIEW_USER.name, Date.now()).run();
  const token = await createSession(env, PREVIEW_USER.id, request);
  return json({ token }, 200, { 'Set-Cookie': cookie(request, SESSION_COOKIE, token, { maxAge: SESSION_MAX_AGE_SECONDS }) });
}
