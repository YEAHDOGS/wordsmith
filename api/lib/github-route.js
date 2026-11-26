// Shared setup for the GitHub data routes: sign-in, per-user rate limit, the user's GitHub credential, and a clear
// message when GitHub rejects it, naming which credential failed (also written to the Worker logs).
import { requireAuth } from './auth.js';
import { githubCredential } from './github.js';
import { HttpError } from './http.js';
import { rateLimit } from './rate-limit.js';
import { GITHUB_RECONNECT } from '../../src/lib/models.js';

const GITHUB_ROUTE_LIMIT = 120;
const GITHUB_ROUTE_WINDOW_MS = 600_000;
const BAD_GATEWAY = 502;
// Either way signing in with GitHub again stores a fresh, readable token, so both keep the Sign out button.
const REJECTED = {
  'sign-in': 'GitHub rejected your GitHub sign-in (revoked or expired). Sign out and sign back in with GitHub to reconnect.',
  shared: "GitHub rejected the Worker's shared GITHUB_TOKEN, used because wordsmith has no readable GitHub sign-in for you. Sign out and sign back in with GitHub to fix it now; the GITHUB_TOKEN secret in Cloudflare also needs replacing.",
};

/**
 * Runs a GitHub route with the caller's credential: { auth, token, source }. A GitHub 401 becomes a message that names
 * the credential that failed.
 * @template T
 * @param {{ request: Request, env: Record<string, any> }} context
 * @param {(github: { auth: import('./auth.js').Auth, token: string | null, source: 'sign-in' | 'shared' | 'none' }) => Promise<T>} run
 */
export async function withGithub(context, run) {
  const auth = await requireAuth(context);
  await rateLimit(context.env, `github:${auth.user.id}`, GITHUB_ROUTE_LIMIT, GITHUB_ROUTE_WINDOW_MS);
  const credential = await githubCredential(context.env, auth.user.id);
  try {
    return await run({ auth, ...credential });
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== GITHUB_RECONNECT) throw error;
    console.warn(`GitHub rejected the ${credential.source} credential for user ${auth.user.id}`);
    throw new HttpError(BAD_GATEWAY, REJECTED[/** @type {'sign-in' | 'shared'} */ (credential.source)] ?? error.message, GITHUB_RECONNECT);
  }
}
