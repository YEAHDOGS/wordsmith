// GitHub, Google and Apple sign-in. Each provider builds an authorize URL and turns a callback code
// into a normalized profile. Credentials come from Worker secrets; a provider without them is hidden.
import { HttpError } from './http.js';
import { decodeJwtPayload, pkceChallenge, signEs256Jwt } from './crypto.js';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API = 'https://api.github.com';
// read:user + user:email identify you; read:org lists the organizations you belong to (private memberships too) so the
// repo picker can find their repos. Set GITHUB_OAUTH_SCOPE to add "repo" so the picker and PR auto-sync see private repos.
const GITHUB_DEFAULT_SCOPE = 'read:user user:email read:org';
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_SCOPE = 'openid email profile';
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_AUTHORIZE_URL = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_SCOPE = 'name email';
const APPLE_SECRET_TTL_SECONDS = 300;
export const USER_AGENT = 'wordsmith-by-DOGS';

/** @typedef {{ providerUserId: string, email: string | null, emailVerified: boolean, name: string | null, avatarUrl: string | null, accessToken: string | null }} Profile */

/** @param {Record<string, any>} env */
export function configuredProviders(env) {
  const providers = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) providers.push('github');
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push('google');
  if (env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY) providers.push('apple');
  return providers;
}

/** Callback URL registered with each provider. APP_ORIGIN pins it when requests arrive on several hosts. @param {Request} request @param {Record<string, any>} env @param {string} provider */
export function redirectUri(request, env, provider) {
  return `${env.APP_ORIGIN || new URL(request.url).origin}/api/auth/${provider}/callback`;
}

/**
 * @param {string} provider
 * @param {{ env: Record<string, any>, redirect: string, state: string, verifier: string }} options
 */
export async function authorizeUrl(provider, { env, redirect, state, verifier }) {
  const challenge = await pkceChallenge(verifier);
  const params = {
    github: { client_id: env.GITHUB_CLIENT_ID, redirect_uri: redirect, scope: env.GITHUB_OAUTH_SCOPE || GITHUB_DEFAULT_SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', allow_signup: 'true' },
    google: { client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: GOOGLE_SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' },
    // Apple posts the callback as a form whenever name/email scopes are requested.
    apple: { client_id: env.APPLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', response_mode: 'form_post', scope: APPLE_SCOPE, state },
  }[provider];
  const base = { github: GITHUB_AUTHORIZE_URL, google: GOOGLE_AUTHORIZE_URL, apple: APPLE_AUTHORIZE_URL }[provider];
  return `${base}?${new URLSearchParams(params)}`;
}

/** @param {string} url @param {Record<string, string>} form */
async function postForm(url, form) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': USER_AGENT },
    body: new URLSearchParams(form),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new HttpError(502, `Sign-in provider refused the code (${data.error || response.status})`);
  return data;
}

/** @param {string} url @param {string} token */
async function getJson(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new HttpError(502, `Sign-in provider profile lookup failed (${response.status})`);
  return response.json();
}

/** @param {Record<string, any>} env */
function appleClientSecret(env) {
  const now = Math.floor(Date.now() / 1000);
  return signEs256Jwt(
    { alg: 'ES256', kid: env.APPLE_KEY_ID },
    { iss: env.APPLE_TEAM_ID, iat: now, exp: now + APPLE_SECRET_TTL_SECONDS, aud: APPLE_ISSUER, sub: env.APPLE_CLIENT_ID },
    env.APPLE_PRIVATE_KEY,
  );
}

/**
 * Exchanges a callback code for the signed-in person's profile.
 * @param {string} provider
 * @param {{ env: Record<string, any>, code: string, redirect: string, verifier: string, appleUser?: string | null }} options
 * @returns {Promise<Profile>}
 */
export async function fetchProfile(provider, { env, code, redirect, verifier, appleUser }) {
  if (provider === 'github') {
    const token = await postForm(GITHUB_TOKEN_URL, { client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirect, code_verifier: verifier });
    const user = await getJson(`${GITHUB_API}/user`, token.access_token);
    const emails = await getJson(`${GITHUB_API}/user/emails`, token.access_token).catch(() => []);
    const primary = emails.find((/** @type {any} */ entry) => entry.primary && entry.verified);
    return { providerUserId: String(user.id), email: primary?.email || null, emailVerified: Boolean(primary), name: user.name || user.login, avatarUrl: user.avatar_url || null, accessToken: token.access_token };
  }
  if (provider === 'google') {
    const token = await postForm(GOOGLE_TOKEN_URL, { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier });
    const user = await getJson(GOOGLE_USERINFO_URL, token.access_token);
    return { providerUserId: String(user.sub), email: user.email || null, emailVerified: user.email_verified === true, name: user.name || null, avatarUrl: user.picture || null, accessToken: null };
  }
  const token = await postForm(APPLE_TOKEN_URL, { client_id: env.APPLE_CLIENT_ID, client_secret: await appleClientSecret(env), code, redirect_uri: redirect, grant_type: 'authorization_code' });
  // The id_token came straight from Apple over TLS in exchange for our client secret, so its claims are trusted (OIDC core 3.1.3.7).
  const claims = decodeJwtPayload(token.id_token);
  if (claims.iss !== APPLE_ISSUER || claims.aud !== env.APPLE_CLIENT_ID) throw new HttpError(502, 'Apple returned an unexpected token');
  // Apple only sends the person's name, as form field "user", on their very first sign-in.
  let name = null;
  try {
    const parsed = JSON.parse(appleUser || 'null');
    name = [parsed?.name?.firstName, parsed?.name?.lastName].filter(Boolean).join(' ') || null;
  } catch { /* name stays null */ }
  return { providerUserId: String(claims.sub), email: claims.email || null, emailVerified: claims.email_verified === true || claims.email_verified === 'true', name, avatarUrl: null, accessToken: null };
}
