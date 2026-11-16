// Sessions (web cookie or native bearer) and agent API tokens.
import { HttpError, isTrustedOrigin } from './http.js';
import { randomToken, sha256 } from './crypto.js';
import { TRIAL_ENDED, planOf, trialEndsAt } from '../../src/lib/models.js';

export const SESSION_COOKIE = 'ws_session';
export const SESSION_PREFIX = 'wss_';
export const API_TOKEN_PREFIX = 'ws_pat_';
const SESSION_DAYS = 90;
const DAY_MS = 86_400_000;
const SESSION_MS = SESSION_DAYS * DAY_MS;
export const SESSION_MAX_AGE_SECONDS = SESSION_MS / 1000;
const TOKEN_TOUCH_MS = 3_600_000;
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const MAX_USER_AGENT = 200;
const PAYMENT_REQUIRED = 402;
// The account's Buy Me a Coffee memberships, as a JSON array: every row whose email is one a sign-in provider verified
// for this account (identities.email_verified), so an unverified address can't borrow someone else's membership.
// models.js planOf turns them into a plan.
const MEMBERSHIPS = `(SELECT json_group_array(json_object('level_id', m.level_id, 'duration', m.duration, 'amount', m.amount, 'currency', m.currency, 'status', m.status, 'period_end', m.period_end))
  FROM memberships m WHERE m.email IN (SELECT lower(i.email) FROM identities i WHERE i.user_id = u.id AND i.email_verified = 1)) AS memberships`;
const USER_COLUMNS = `u.id, u.email, u.name, u.avatar_url, u.created_at, u.access, u.plan, ${MEMBERSHIPS}`;

/** plan: the best plan the account holds now (models.js planOf), null when locked.
 * @typedef {{ id: string, email: string | null, name: string | null, avatar_url: string | null, created_at: number, access: string, plan: import('../../src/lib/models.js').Plan | null, trial_ends_at: number }} User */
/** @typedef {{ user: User, via: 'cookie' | 'bearer' | 'token', tokenHash: string, tokenName?: string, tokenColor?: string }} Auth */

/** @param {Request} request @param {string} name */
export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Builds a Set-Cookie value. Secure on https; SameSite=None is needed for Apple's cross-site form_post.
 * @param {Request} request
 * @param {string} name
 * @param {string} value
 * @param {{ maxAge: number, crossSite?: boolean }} options
 */
export function cookie(request, name, value, { maxAge, crossSite = false }) {
  const secure = new URL(request.url).protocol === 'https:';
  const sameSite = crossSite && secure ? 'None' : 'Lax';
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSite}${secure ? '; Secure' : ''}`;
}

/**
 * Creates a session for a user and returns the raw token (stored only as a hash).
 * @param {Record<string, any>} env
 * @param {string} userId
 * @param {Request} request
 */
export async function createSession(env, userId, request) {
  const token = randomToken(SESSION_PREFIX);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, (request.headers.get('User-Agent') || '').slice(0, MAX_USER_AGENT), now, now + SESSION_MS)
    .run();
  return token;
}

/**
 * Resolves the caller from the session cookie, a session bearer, or an agent API token.
 * Cookie-authenticated writes must come from a trusted Origin (CSRF guard).
 * @param {Request} request
 * @param {Record<string, any>} env
 * @returns {Promise<Auth | null>}
 */
export async function getAuth(request, env) {
  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const cookieToken = readCookie(request, SESSION_COOKIE);
  const token = bearer || cookieToken;
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Date.now();

  if (token.startsWith(API_TOKEN_PREFIX)) {
    const row = await env.DB.prepare(
      `SELECT t.last_used_at, t.name AS token_name, t.color AS token_color, ${USER_COLUMNS} FROM api_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
    ).bind(tokenHash).first();
    if (!row) return null;
    if (!row.last_used_at || now - Number(row.last_used_at) > TOKEN_TOUCH_MS) {
      await env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
    }
    return { user: pickUser(row), via: 'token', tokenHash, tokenName: String(row.token_name || ''), tokenColor: String(row.token_color || 'default') };
  }

  const row = await env.DB.prepare(
    `SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(tokenHash, now).first();
  if (!row) return null;
  const via = bearer ? 'bearer' : 'cookie';
  if (via === 'cookie' && !SAFE_METHODS.includes(request.method) && !isTrustedOrigin(request, env)) {
    throw new HttpError(403, 'Untrusted origin');
  }
  return { user: pickUser(row), via, tokenHash };
}

/** @param {Record<string, any>} row @returns {User} */
function pickUser(row) {
  const created_at = Number(row.created_at);
  const access = String(row.access || 'trial');
  const plan = planOf({ created_at, access, plan: row.plan, memberships: JSON.parse(row.memberships || '[]') });
  return { id: row.id, email: row.email, name: row.name, avatar_url: row.avatar_url, created_at, access, plan, trial_ends_at: trialEndsAt({ created_at }) };
}

/**
 * Like getAuth, but throws 401 when nobody is signed in. Agent tokens are only accepted when allowToken is set.
 * @param {{ request: Request, env: Record<string, any> }} context
 * @param {{ allowToken?: boolean }} [options]
 */
export async function requireAuth({ request, env }, { allowToken = false } = {}) {
  const auth = await getAuth(request, env);
  if (!auth) throw new HttpError(401, 'Sign in required');
  // The free trial is over and the account holds no plan: nothing works but signing in and out (and agent tokens stop).
  if (!auth.user.plan) throw new HttpError(PAYMENT_REQUIRED, 'Your free trial has ended. Subscribe to DOGS to keep using wordsmith.', TRIAL_ENDED);
  if (auth.via === 'token' && !allowToken) throw new HttpError(403, 'API tokens cannot use this route');
  return auth;
}
