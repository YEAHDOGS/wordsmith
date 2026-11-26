// POST /api/auth/signup { password } - private beta (see signupLocked). The right beta password sets a signed cookie
// that lasts SIGNUP_PROOF_TTL_MS (30 minutes), so the OAuth callback that follows may create a new account.
// 404 while sign-up is open.
import { cookie } from '../../../lib/auth.js';
import { sameSecret } from '../../../lib/crypto.js';
import { HttpError, json, readJson } from '../../../lib/http.js';
import { LOGIN_RATE_WINDOW_MS, PASSWORD_ATTEMPT_LIMIT, SIGNUP_COOKIE, SIGNUP_PROOF_TTL_MS, SIGNUP_PROOF_TTL_SECONDS, signupLocked, signupProof } from '../../../lib/login.js';
import { clientIp, rateLimit } from '../../../lib/rate-limit.js';
import { MAX_PASSWORD_LENGTH } from '../../../../src/lib/models.js';

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost({ request, env }) {
  if (!signupLocked(env)) throw new HttpError(404, 'Not found');
  // The proof is signed with TOKEN_ENCRYPTION_KEY (see signupProof); without it nobody could sign up, so say why.
  if (!env.TOKEN_ENCRYPTION_KEY) throw new HttpError(503, 'Sign-up is not set up yet');
  await rateLimit(env, `signup:${clientIp(request)}`, PASSWORD_ATTEMPT_LIMIT, LOGIN_RATE_WINDOW_MS);
  const password = (await readJson(request))?.password;
  if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD_LENGTH) throw new HttpError(400, 'Enter the beta password');
  if (!(await sameSecret(password, env.SIGNUP_PASSWORD))) throw new HttpError(403, 'Wrong beta password');
  // crossSite: Apple returns with a cross-site form POST, which only carries SameSite=None cookies.
  const proof = cookie(request, SIGNUP_COOKIE, await signupProof(env, Date.now() + SIGNUP_PROOF_TTL_MS), { maxAge: SIGNUP_PROOF_TTL_SECONDS, crossSite: true });
  return json({ ok: true }, 200, { 'Set-Cookie': proof });
}
