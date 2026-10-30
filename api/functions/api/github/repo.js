// GET /api/github/repo?name=owner/repo - checks a typed repo exists and is reachable before linking it.
import { getRepo } from '../../../lib/github-api.js';
import { withGithub } from '../../../lib/github-route.js';
import { json } from '../../../lib/http.js';

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestGet(context) {
  const name = (new URL(context.request.url).searchParams.get('name') || '').trim();
  return json({ repo: await withGithub(context, ({ token }) => getRepo(token, name)) });
}
