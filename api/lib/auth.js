// Sessions (web cookie or native bearer) and agent API tokens.
import { HttpError, isTrustedOrigin } from './http.js';
import { randomToken, sha256 } from './crypto.js';

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

/** @typedef {{ id: string, email: string | null, name: string | null, avatar_url: string | null }} User */
/** @typedef {{ user: User, via: 'cookie' | 'bearer' | 'token', tokenHash: string }} Auth */

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
      `SELECT t.last_used_at, u.id, u.email, u.name, u.avatar_url FROM api_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
    ).bind(tokenHash).first();
    if (!row) return null;
    if (!row.last_used_at || now - Number(row.last_used_at) > TOKEN_TOUCH_MS) {
      await env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
    }
    return { user: pickUser(row), via: 'token', tokenHash };
  }

  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.avatar_url FROM sessions s JOIN users u ON u.id = s.user_id
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
  return { id: row.id, email: row.email, name: row.name, avatar_url: row.avatar_url };
}

/**
 * Like getAuth, but throws 401 when nobody is signed in. Agent tokens are only accepted when allowToken is set.
 * @param {{ request: Request, env: Record<string, any> }} context
 * @param {{ allowToken?: boolean }} [options]
 */
export async function requireAuth({ request, env }, { allowToken = false } = {}) {
  const auth = await getAuth(request, env);
  if (!auth) throw new HttpError(401, 'Sign in required');
  if (auth.via === 'token' && !allowToken) throw new HttpError(403, 'API tokens cannot use this route');
  return auth;
}
