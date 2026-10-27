// GET|POST /api/auth/:provider/callback - finishes an OAuth login. Apple posts a form; GitHub and Google redirect with a query.
// Web logins get a session cookie. Native (device) logins park the session for the app to collect by polling.
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, cookie, createSession, getAuth, readCookie } from '../../../../lib/auth.js';
import { fetchProfile, redirectUri } from '../../../../lib/oauth.js';
import { upsertUserForProfile } from '../../../../lib/users.js';
import { STATE_COOKIE, appRedirect, assertProvider, loadState } from '../../../../lib/login.js';

/** @param {{ request: Request, env: Record<string, any>, params: { provider: string } }} context */
async function finish({ request, env, params }) {
  const { provider } = params;
  assertProvider(env, provider);
  const fields = request.method === 'POST' ? await request.formData() : new URL(request.url).searchParams;
  const code = String(fields.get('code') || '');
  const state = String(fields.get('state') || '');
  const clearState = cookie(request, STATE_COOKIE, '', { maxAge: 0, crossSite: provider === 'apple' });
  const fail = (/** @type {string} */ message) => appRedirect(request, { auth_error: message }, [clearState]);

  if (fields.get('error')) return fail('Sign-in was cancelled.');
  const row = await loadState(env, state);
  if (!row || row.provider !== provider || !code) return fail('Sign-in expired. Please try again.');
  const isDevice = Boolean(row.device_secret_hash);
  // Web logins must finish in the browser that started them (login CSRF guard).
  if (!isDevice && readCookie(request, STATE_COOKIE) !== state) return fail('Sign-in could not be verified. Please try again.');

  const profile = await fetchProfile(provider, {
    env, code, redirect: redirectUri(request, env, provider), verifier: String(row.code_verifier), appleUser: /** @type {string | null} */ (fields.get('user')),
  });
  // Already signed in on the web? Then this links the new provider to the same account.
  const current = isDevice ? null : await getAuth(request, env).catch(() => null);
  const userId = await upsertUserForProfile(env, provider, profile, current?.via === 'cookie' ? current.user.id : null);
  const token = await createSession(env, userId, request);

  if (isDevice) {
    await env.DB.prepare('UPDATE oauth_states SET session_token = ? WHERE state = ?').bind(token, state).run();
    return appRedirect(request, { auth: 'device_done' }, [clearState]);
  }
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
  return appRedirect(request, { auth: 'done' }, [clearState, cookie(request, SESSION_COOKIE, token, { maxAge: SESSION_MAX_AGE_SECONDS })]);
}

export const onRequestGet = finish;
export const onRequestPost = finish;
