// Shared pieces of the OAuth login flow: state rows, the state cookie and redirects back into the app.
// Pages shown outside a normal login (device confirmation, errors) are rendered by the SPA from query params.
import { HttpError } from './http.js';
import { configuredProviders } from './oauth.js';

export const STATE_COOKIE = 'ws_oauth';
export const STATE_TTL_MS = 600_000;
export const STATE_TTL_SECONDS = STATE_TTL_MS / 1000;
export const LOGIN_RATE_LIMIT = 30;
export const LOGIN_RATE_WINDOW_MS = 600_000;
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
