// GET /api/github/repo?name=owner/repo - checks a typed repo exists and is reachable before linking it.
import { getRepo } from '../../../lib/github-api.js';
import { githubContext } from '../../../lib/github-route.js';
import { json } from '../../../lib/http.js';

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestGet(context) {
  const { token } = await githubContext(context);
  const name = (new URL(context.request.url).searchParams.get('name') || '').trim();
  return json({ repo: await getRepo(token, name) });
}
