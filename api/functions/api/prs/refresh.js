// POST /api/prs/refresh - re-checks open pull requests on your features against GitHub.
// The app calls it on open and on focus; merged PRs move their feature to complete. The webhook makes this instant.
import { requireAuth } from '../../../lib/auth.js';
import { refreshPullRequests } from '../../../lib/github.js';
import { json } from '../../../lib/http.js';
import { rateLimit } from '../../../lib/rate-limit.js';

const REFRESH_LIMIT = 30;
const REFRESH_WINDOW_MS = 600_000;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost(context) {
  const auth = await requireAuth(context, { allowToken: true });
  await rateLimit(context.env, `prs:${auth.user.id}`, REFRESH_LIMIT, REFRESH_WINDOW_MS);
  const updated = await refreshPullRequests(context.env, auth.user.id);
  return json({ updated: updated.length });
}
