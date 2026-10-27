// GET /api/github/repos?q= - repos you can link a project to (needs GitHub sign-in or GITHUB_TOKEN).
// Returns needs_github: true when there is no token, so the app falls back to typing owner/name.
import { searchRepos } from '../../../lib/github-api.js';
import { githubContext } from '../../../lib/github-route.js';
import { json } from '../../../lib/http.js';

const MAX_QUERY = 100;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestGet(context) {
  const { auth, token } = await githubContext(context);
  const q = (new URL(context.request.url).searchParams.get('q') || '').slice(0, MAX_QUERY);
  return json(await searchRepos(token, auth.user.id, q));
}
