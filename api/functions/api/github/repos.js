// GET /api/github/repos?q= - repos you can link a project to. With a GitHub sign-in: yours and your organizations'.
// Without one (Google or Apple sign-in only): public repos matching q, and needs_github: true so the app says how to
// see more. Also org_access hints (missing scopes, orgs with no visible repos, the grant link) when org repos may be hidden.
import { searchRepos } from '../../../lib/github-api.js';
import { withGithub } from '../../../lib/github-route.js';
import { json } from '../../../lib/http.js';

const MAX_QUERY = 100;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestGet(context) {
  const q = (new URL(context.request.url).searchParams.get('q') || '').slice(0, MAX_QUERY);
  return json(await withGithub(context, ({ auth, token, source }) =>
    searchRepos(token, auth.user.id, q, context.env.GITHUB_CLIENT_ID || null, source === 'sign-in')));
}
