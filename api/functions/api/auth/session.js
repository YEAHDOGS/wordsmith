// GET /api/auth/session - who is signed in, which providers are available and which are linked.
// DELETE /api/auth/session - signs out this device.
import { SESSION_COOKIE, cookie, getAuth } from '../../../lib/auth.js';
import { json } from '../../../lib/http.js';
import { devLoginEnabled, previewLoginEnabled } from '../../../lib/login.js';
import { configuredProviders } from '../../../lib/oauth.js';

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestGet({ request, env }) {
  const auth = await getAuth(request, env);
  const base = { providers: configuredProviders(env), dev_login: devLoginEnabled(request, env), preview_login: previewLoginEnabled(request, env) };
  if (!auth || auth.via === 'token') return json({ ...base, user: null });
  // provider_user_id is the account's public id at the provider (GitHub's numeric user id): Settings uses it to link the profile
  const { results } = await env.DB.prepare('SELECT provider, provider_user_id, email, created_at FROM identities WHERE user_id = ?').bind(auth.user.id).all();
  return json({ ...base, user: auth.user, linked: results });
}

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestDelete({ request, env }) {
  const auth = await getAuth(request, env);
  if (auth && auth.via !== 'token') await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(auth.tokenHash).run();
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, SESSION_COOKIE, '', { maxAge: 0 }) });
}
