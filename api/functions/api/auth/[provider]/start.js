// GET /api/auth/:provider/start - begins an OAuth login.
// ?device=<id> continues a native-app login started with POST /api/auth/device; the browser first
// shows a confirmation screen, then comes back with &confirm=1.
import { cookie } from '../../../../lib/auth.js';
import { randomToken } from '../../../../lib/crypto.js';
import { authorizeUrl, redirectUri } from '../../../../lib/oauth.js';
import { clientIp, rateLimit } from '../../../../lib/rate-limit.js';
import { LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS, STATE_COOKIE, STATE_TTL_SECONDS, appRedirect, assertProvider, loadState, userCode } from '../../../../lib/login.js';

/** @param {{ request: Request, env: Record<string, any>, params: { provider: string } }} context */
export async function onRequestGet({ request, env, params }) {
  const { provider } = params;
  assertProvider(env, provider);
  await rateLimit(env, `login:${clientIp(request)}`, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);
  const url = new URL(request.url);
  const deviceId = url.searchParams.get('device');

  let state;
  let verifier;
  if (deviceId) {
    const row = await loadState(env, deviceId);
    if (!row?.device_secret_hash || row.provider !== provider) return appRedirect(request, { auth_error: 'This app sign-in link expired. Start again from the app.' });
    if (url.searchParams.get('confirm') !== '1') return appRedirect(request, { device: deviceId, provider, code: userCode(deviceId) });
    state = deviceId;
    verifier = String(row.code_verifier);
  } else {
    state = randomToken();
    verifier = randomToken();
    await env.DB.prepare('INSERT INTO oauth_states (state, provider, code_verifier, created_at) VALUES (?, ?, ?, ?)')
      .bind(state, provider, verifier, Date.now()).run();
  }

  const location = await authorizeUrl(provider, { env, redirect: redirectUri(request, env, provider), state, verifier });
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookie(request, STATE_COOKIE, state, { maxAge: STATE_TTL_SECONDS, crossSite: provider === 'apple' }));
  return new Response(null, { status: 302, headers });
}
