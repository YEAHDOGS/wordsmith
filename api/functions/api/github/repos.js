// GET /api/github/repos?q= - repos you can link a project to, including your organizations' (needs GitHub sign-in or
// GITHUB_TOKEN). Returns needs_github: true when there is no token, so the app falls back to typing owner/name, and
// org_access hints (missing scopes, orgs with no visible repos, the grant link) when org repos may be hidden.
import { searchRepos } from '../../../lib/github-api.js';
import { withGithub } from '../../../lib/github-route.js';
import { json } from '../../../lib/http.js';

const MAX_QUERY = 100;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestGet(context) {
  const q = (new URL(context.request.url).searchParams.get('q') || '').slice(0, MAX_QUERY);
  return json(await withGithub(context, ({ auth, token, source }) =>
    // The shared GITHUB_TOKEN is not an OAuth grant, so there is no app connection page to link to.
    searchRepos(token, auth.user.id, q, source === 'sign-in' ? context.env.GITHUB_CLIENT_ID || null : null)));
}
