// POST /api/auth/device { provider } - native apps start a login here, open login_url in the system browser
// (Google and Apple block sign-in inside embedded WebViews), then poll /api/auth/device/poll for the session.
import { HttpError, json, readJson } from '../../../../lib/http.js';
import { randomToken, sha256 } from '../../../../lib/crypto.js';
import { clientIp, rateLimit } from '../../../../lib/rate-limit.js';
import { LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS, STATE_TTL_MS, assertProvider, userCode } from '../../../../lib/login.js';

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost({ request, env }) {
  const { provider } = await readJson(request);
  if (typeof provider !== 'string') throw new HttpError(400, 'provider is required');
  assertProvider(env, provider);
  await rateLimit(env, `login:${clientIp(request)}`, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);

  const deviceId = randomToken();
  const secret = randomToken();
  await env.DB.prepare('INSERT INTO oauth_states (state, provider, code_verifier, device_secret_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(deviceId, provider, randomToken(), await sha256(secret), Date.now()).run();
  const origin = env.APP_ORIGIN || new URL(request.url).origin;
  return json({
    device_id: deviceId,
    secret,
    code: userCode(deviceId),
    login_url: `${origin}/api/auth/${provider}/start?device=${encodeURIComponent(deviceId)}`,
    expires_in_ms: STATE_TTL_MS,
  });
}
