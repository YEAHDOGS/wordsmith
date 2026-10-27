// POST /api/auth/dev - local development only (see devLoginEnabled). Signs in a fixed local user so the app
// can be exercised under `wrangler pages dev` before any OAuth app exists. Returns 404 everywhere else.
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, cookie, createSession } from '../../../lib/auth.js';
import { HttpError, json } from '../../../lib/http.js';
import { devLoginEnabled } from '../../../lib/login.js';

const DEV_USER = { id: 'local-dev-user', email: 'dev@localhost', name: 'Local dev' };

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost({ request, env }) {
  if (!devLoginEnabled(request, env)) throw new HttpError(404, 'Not found');
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, name, avatar_url, created_at) VALUES (?, ?, ?, NULL, ?)')
    .bind(DEV_USER.id, DEV_USER.email, DEV_USER.name, Date.now()).run();
  const token = await createSession(env, DEV_USER.id, request);
  return json({ token }, 200, { 'Set-Cookie': cookie(request, SESSION_COOKIE, token, { maxAge: SESSION_MAX_AGE_SECONDS }) });
}
