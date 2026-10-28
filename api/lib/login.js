// Shared pieces of the OAuth login flow: state rows, the state cookie and redirects back into the app.
// Pages shown outside a normal login (device confirmation, errors) are rendered by the SPA from query params.
import { readCookie } from './auth.js';
import { hmacSha256, sameSecret } from './crypto.js';
import { HttpError } from './http.js';
import { configuredProviders } from './oauth.js';
import { APP_HOST, SHORT_HOSTS } from '../../src/lib/models.js';

export const STATE_COOKIE = 'ws_oauth';
export const STATE_TTL_MS = 600_000;
export const STATE_TTL_SECONDS = STATE_TTL_MS / 1000;
export const LOGIN_RATE_LIMIT = 30;
export const LOGIN_RATE_WINDOW_MS = 600_000;
// Holds proof of the beta password (SIGNUP_PASSWORD) through the OAuth round trip, so the callback may create an account.
export const SIGNUP_COOKIE = 'ws_signup';
const SIGNUP_PROOF_PREFIX = 'wordsmith-signup:';
// A proof is "<expires_at ms>.<hex HMAC>".
const SIGNUP_PROOF_PATTERN = /^(\d+)\.[0-9a-f]+$/;
// Characters of the device-login confirmation code shown in the app and in the browser.
const USER_CODE_LENGTH = 6;
const REDIRECT_STATUS = 303;
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1'];
// Private LAN addresses (10.x, 172.16-31.x, 192.168.x), so a phone on the same Wi-Fi can use the dev login too.
const PRIVATE_IPV4 = /^(10\.\d+|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+$/;

/**
 * The dev-only login button: needs DEV_LOGIN=true (set only in .dev.vars) AND a localhost or private-LAN request,
 * so it can never switch on in preview or production.
 * @param {Request} request
 * @param {Record<string, any>} env
 */
export function devLoginEnabled(request, env) {
  const { hostname } = new URL(request.url);
  return env.DEV_LOGIN === 'true' && (LOCAL_HOSTNAMES.includes(hostname) || PRIVATE_IPV4.test(hostname));
}

/**
 * The password sign-in on Worker Previews (OAuth only calls back to wordsmith.dogs.red, so a Preview has no other way
 * in). Needs the PREVIEW_PASSWORD secret, which is set only in the Previews base config (`npx wrangler preview
 * base-config secret put PREVIEW_PASSWORD`), never on the production Worker; the host check keeps it off the
 * production domains even if it were.
 * @param {Request} request
 * @param {Record<string, any>} env
 */
export function previewLoginEnabled(request, env) {
  const { hostname } = new URL(request.url);
  return Boolean(env.PREVIEW_PASSWORD) && hostname !== APP_HOST && !SHORT_HOSTS.includes(hostname);
}

/**
 * Private beta: while the SIGNUP_PASSWORD secret is set, new accounts need it. Existing users, and providers linked to
 * an existing account (signed in, or the same verified email), sign in as usual. Unset, sign-up is open.
 * @param {Record<string, any>} env
 */
export function signupLocked(env) {
  return Boolean(env.SIGNUP_PASSWORD);
}

/**
 * The SIGNUP_COOKIE value once the beta password checked out: its expiry, signed with a key only the server holds
 * (TOKEN_ENCRYPTION_KEY plus the password), so a copied cookie stops working at expiresAt or when the password changes,
 * and can't be brute-forced back into the password offline.
 * @param {Record<string, any>} env
 * @param {number} expiresAt epoch ms
 */
export async function signupProof(env, expiresAt) {
  const signature = await hmacSha256(`${env.TOKEN_ENCRYPTION_KEY || ''}:${env.SIGNUP_PASSWORD}`, SIGNUP_PROOF_PREFIX + expiresAt);
  return `${expiresAt}.${signature}`;
}

/** May this request create a new account? @param {Request} request @param {Record<string, any>} env */
export async function signupAllowed(request, env) {
  if (!signupLocked(env)) return true;
  const proof = readCookie(request, SIGNUP_COOKIE) || '';
  const expiresAt = Number(SIGNUP_PROOF_PATTERN.exec(proof)?.[1]);
  if (!(expiresAt > Date.now())) return false;
  return sameSecret(proof, await signupProof(env, expiresAt));
}

/** Throws 404 unless the provider exists and has credentials. @param {Record<string, any>} env @param {string} provider */
export function assertProvider(env, provider) {
  if (!configuredProviders(env).includes(provider)) throw new HttpError(404, `Sign-in with ${provider} is not set up`);
}

/** Loads an unexpired OAuth state row. @param {Record<string, any>} env @param {string | null} state */
export async function loadState(env, state) {
  if (!state) return null;
  const row = await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ? AND created_at > ?').bind(state, Date.now() - STATE_TTL_MS).first();
  return row ?? null;
}

/** Short code that lets you check the browser tab belongs to the app you are signing in. @param {string} state */
export function userCode(state) {
  return state.replace(/[^A-Za-z0-9]/g, '').slice(-USER_CODE_LENGTH).toUpperCase();
}

/**
 * Redirects to the app root with query params the SPA turns into a notice.
 * @param {Request} request
 * @param {Record<string, string>} params
 * @param {string[]} [cookies]
 */
export function appRedirect(request, params, cookies = []) {
  const target = new URL('/', request.url);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  const headers = new Headers({ Location: target.pathname + target.search, 'Cache-Control': 'no-store' });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: REDIRECT_STATUS, headers });
}
