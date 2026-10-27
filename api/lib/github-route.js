// Shared setup for the GitHub data routes: sign-in, per-user rate limit, and the user's GitHub token.
import { requireAuth } from './auth.js';
import { githubToken } from './github.js';
import { rateLimit } from './rate-limit.js';

const GITHUB_ROUTE_LIMIT = 120;
const GITHUB_ROUTE_WINDOW_MS = 600_000;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function githubContext(context) {
  const auth = await requireAuth(context, { allowToken: true });
  await rateLimit(context.env, `github:${auth.user.id}`, GITHUB_ROUTE_LIMIT, GITHUB_ROUTE_WINDOW_MS);
  return { auth, token: await githubToken(context.env, auth.user.id) };
}
