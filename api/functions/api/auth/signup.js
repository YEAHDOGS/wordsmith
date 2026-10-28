// POST /api/auth/signup { password } - private beta (see signupLocked). The right beta password sets a signed cookie
// that expires with the login state (10 minutes), and the OAuth callback that follows may then create a new account. 404 while sign-up is open.
import { cookie } from '../../../lib/auth.js';
import { sameSecret } from '../../../lib/crypto.js';
import { HttpError, json, readJson } from '../../../lib/http.js';
import { LOGIN_RATE_WINDOW_MS, SIGNUP_COOKIE, STATE_TTL_MS, STATE_TTL_SECONDS, signupLocked, signupProof } from '../../../lib/login.js';
import { clientIp, rateLimit } from '../../../lib/rate-limit.js';

// Guesses allowed per IP per LOGIN_RATE_WINDOW_MS (10 minutes).
const ATTEMPT_LIMIT = 10;
const MAX_PASSWORD = 200;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost({ request, env }) {
  if (!signupLocked(env)) throw new HttpError(404, 'Not found');
  await rateLimit(env, `signup:${clientIp(request)}`, ATTEMPT_LIMIT, LOGIN_RATE_WINDOW_MS);
  const { password } = await readJson(request);
  if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD) throw new HttpError(400, 'Enter the beta password');
  if (!(await sameSecret(password, env.SIGNUP_PASSWORD))) throw new HttpError(403, 'Wrong beta password');
  // crossSite: Apple returns with a cross-site form POST, which only carries SameSite=None cookies.
  const proof = cookie(request, SIGNUP_COOKIE, await signupProof(env, Date.now() + STATE_TTL_MS), { maxAge: STATE_TTL_SECONDS, crossSite: true });
  return json({ ok: true }, 200, { 'Set-Cookie': proof });
}
