// GET|POST /api/auth/:provider/callback - finishes an OAuth login. Apple posts a form; GitHub and Google redirect with a query.
// New accounts need the beta password while sign-up is locked (see signupLocked in login.js).
// Web logins get a session cookie. Native (device) logins park the session for the app to collect by polling.
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, cookie, createSession, getAuth, readCookie } from '../../../../lib/auth.js';
import { fetchProfile, redirectUri } from '../../../../lib/oauth.js';
import { upsertUserForProfile } from '../../../../lib/users.js';
import { SIGNUP_COOKIE, STATE_COOKIE, appRedirect, assertProvider, loadState, signupAllowed, userCode } from '../../../../lib/login.js';

const SIGNUP_LOCKED_MESSAGE = 'wordsmith is in private beta. Enter the beta password, then continue again to create your account.';

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
  const userId = await upsertUserForProfile(env, provider, profile, current?.via === 'cookie' ? current.user.id : null, await signupAllowed(request, env));
  // A native login goes back to the browser's confirmation screen (its device login is still pending) to try again there.
  if (!userId && isDevice) return appRedirect(request, { device: state, provider, code: userCode(state), auth_error: SIGNUP_LOCKED_MESSAGE }, [clearState]);
  if (!userId) return fail(SIGNUP_LOCKED_MESSAGE);
  const clearSignup = cookie(request, SIGNUP_COOKIE, '', { maxAge: 0, crossSite: true });
  const token = await createSession(env, userId, request);

  if (isDevice) {
    await env.DB.prepare('UPDATE oauth_states SET session_token = ? WHERE state = ?').bind(token, state).run();
    return appRedirect(request, { auth: 'device_done' }, [clearState, clearSignup]);
  }
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
  return appRedirect(request, { auth: 'done' }, [clearState, clearSignup, cookie(request, SESSION_COOKIE, token, { maxAge: SESSION_MAX_AGE_SECONDS })]);
}

export const onRequestGet = finish;
export const onRequestPost = finish;
