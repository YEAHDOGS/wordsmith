// Rich GitHub data for projects: repo search for linking, and a project's open and recently merged PRs with
// CI status, review state, draft flag and diff size. Uses GraphQL (one request per repo) when a token exists,
// REST for public repos otherwise. Responses are cached at the edge so repeat views don't spend GitHub's rate limit.
import { HttpError } from './http.js';
import { USER_AGENT } from './oauth.js';

const GITHUB_API = 'https://api.github.com';
const GRAPHQL_URL = 'https://api.github.com/graphql';
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const CACHE_ORIGIN = 'https://wordsmith-cache.internal';
const PULLS_CACHE_SECONDS = 60;
const REPOS_CACHE_SECONDS = 300;
const OPEN_LIMIT = 30;
const MERGED_LIMIT = 10;
const MAX_TITLE = 300;
// Repo listing: your own, collaborator and organization repos, up to REPO_PAGE_SIZE * MAX_REPO_PAGES of them.
const REPO_AFFILIATION = 'owner,collaborator,organization_member';
const REPO_PAGE_SIZE = 100;
const MAX_REPO_PAGES = 3;
const MAX_ORGS = 30;
const MAX_RESULTS = 50;
// Bump when the cached repo shape changes so stale entries are skipped.
const REPOS_CACHE_VERSION = 'v2';
// When the listing hit the page cap, a typed query also searches by name across you and your orgs.
const SEARCH_LIMIT = 30;
const MAX_SEARCH_QUERY = 256;
const MAX_SEARCH_OWNERS = 8;
const NEXT_LINK = /<([^>]+)>;\s*rel="next"/;
const SCOPES_HEADER = 'x-oauth-scopes';
const LINK_HEADER = 'link';
const ORG_TYPE = 'Organization';
// Scopes the picker needs, and the granted scopes that cover each one.
const WANTED_SCOPES = { 'read:org': ['read:org', 'write:org', 'admin:org'], repo: ['repo'] };
// Org owners can block OAuth apps; members grant or request access on the app's connection page.
const APP_CONNECTION_URL = 'https://github.com/settings/connections/applications/';
const APPLICATIONS_URL = 'https://github.com/settings/applications';

const PULLS_QUERY = `query($owner: String!, $name: String!, $open: Int!, $merged: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner url isPrivate
    open: pullRequests(states: OPEN, first: $open, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ...pr } }
    merged: pullRequests(states: MERGED, first: $merged, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ...pr } }
  }
}
fragment pr on PullRequest {
  number title url isDraft createdAt updatedAt mergedAt headRefName additions deletions reviewDecision
  author { login avatarUrl }
  labels(first: 5) { nodes { name } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

/** @param {string | null} token */
function headers(token) {
  /** @type {Record<string, string>} */
  const result = { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT };
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

/** Throws a readable error for a failed GitHub response. @param {Response} response */
async function fail(response) {
  const data = await response.json().catch(() => ({}));
  if (response.status === 404) throw new HttpError(404, 'GitHub repo not found, or it is private and wordsmith has no access to it');
  if (response.status === 403 || response.status === 429) throw new HttpError(429, 'GitHub rate limit reached. Sign in with GitHub or set GITHUB_TOKEN for higher limits');
  throw new HttpError(502, `GitHub error: ${data.message || response.status}`);
}

/**
 * Serves fn's JSON from the edge cache for ttl seconds. Keyed per user so private repo data never crosses accounts.
 * @param {string} key
 * @param {number} ttl
 * @param {() => Promise<any>} fn
 */
async function cached(key, ttl, fn) {
  const cache = /** @type {any} */ (globalThis.caches)?.default;
  const request = new Request(`${CACHE_ORIGIN}/${encodeURIComponent(key)}`);
  const hit = cache ? await cache.match(request) : null;
  if (hit) return hit.json();
  const value = await fn();
  if (cache) await cache.put(request, Response.json(value, { headers: { 'Cache-Control': `max-age=${ttl}` } }));
  return value;
}

/** @param {string} repo */
export function assertRepo(repo) {
  if (!REPO_PATTERN.test(repo)) throw new HttpError(400, 'Repo must look like owner/name');
}

/** GitHub repo -> picker shape. @param {any} repo */
function toRepo(repo) {
  return {
    full_name: repo.full_name,
    owner: repo.owner?.login || repo.full_name.split('/')[0],
    owner_type: repo.owner?.type === ORG_TYPE ? 'org' : 'user',
    description: repo.description || '',
    private: repo.private,
    pushed_at: Date.parse(repo.pushed_at),
    html_url: repo.html_url,
  };
}

/** GET a GitHub JSON resource, or fallback when it fails (optional extras never break the listing). @param {string} url @param {string} token @param {any} fallback */
async function getOr(url, token, fallback) {
  const response = await fetch(url, { headers: headers(token) }).catch(() => null);
  if (!response?.ok) return fallback;
  return response.json().catch(() => fallback);
}

/** Follows the Link header through at most MAX_REPO_PAGES pages of /user/repos. @param {string} token */
async function fetchRepoPages(token) {
  const repos = [];
  /** @type {string | null} */
  let scopes = null;
  /** @type {string | null} */
  let url = `${GITHUB_API}/user/repos?sort=pushed&per_page=${REPO_PAGE_SIZE}&affiliation=${REPO_AFFILIATION}`;
  for (let page = 0; page < MAX_REPO_PAGES && url; page++) {
    const response = await fetch(url, { headers: headers(token) });
    if (!response.ok) await fail(response);
    scopes ??= response.headers.get(SCOPES_HEADER);
    repos.push(...(await response.json()).map(toRepo));
    url = response.headers.get(LINK_HEADER)?.match(NEXT_LINK)?.[1] ?? null;
  }
  return { repos, scopes, truncated: Boolean(url) };
}

/** Wanted scopes the token lacks. Fine-grained tokens send no scope header, so nothing is reported for them. @param {string | null} granted */
function missingScopes(granted) {
  if (granted === null) return [];
  const have = new Set(granted.split(',').map((scope) => scope.trim()));
  return Object.entries(WANTED_SCOPES).filter(([, covers]) => !covers.some((scope) => have.has(scope))).map(([scope]) => scope);
}

/**
 * Name search across you and your orgs, for people with more repos than the listing holds. Failures return [].
 * @param {string} token
 * @param {string} userId
 * @param {{ login: string | null, orgs: string[] }} bundle
 * @param {string} needle
 */
async function searchByName(token, userId, bundle, needle) {
  const term = needle.split('/').pop();
  if (!term) return [];
  let query = `${term} in:name fork:true`;
  for (const owner of [bundle.login, ...bundle.orgs].filter(Boolean).slice(0, MAX_SEARCH_OWNERS)) {
    const next = `${query} user:${owner}`;
    if (next.length > MAX_SEARCH_QUERY) break;
    query = next;
  }
  return cached(`repo-search:${REPOS_CACHE_VERSION}:${userId}:${needle}`, REPOS_CACHE_SECONDS, async () => {
    const data = await getOr(`${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}&sort=updated&per_page=${SEARCH_LIMIT}`, token, { items: [] });
    return (data.items || []).map(toRepo);
  });
}

/**
 * Repos the user can see (their own, collaborations and organization repos), most recently pushed first, filtered by q.
 * Also reports why org repos might be missing: scopes the token lacks and orgs with no visible repos (often an
 * organization that restricts OAuth apps), with the page where access is granted. Needs a GitHub token.
 * @param {string | null} token
 * @param {string} userId
 * @param {string} q
 * @param {string | null} clientId OAuth app client id when the token came from GitHub sign-in, for the grant link
 */
export async function searchRepos(token, userId, q, clientId) {
  if (!token) return { repos: [], needs_github: true };
  const bundle = await cached(`repos:${REPOS_CACHE_VERSION}:${userId}`, REPOS_CACHE_SECONDS, async () => {
    const [listing, orgs, user] = await Promise.all([
      fetchRepoPages(token),
      getOr(`${GITHUB_API}/user/orgs?per_page=${MAX_ORGS}`, token, []),
      getOr(`${GITHUB_API}/user`, token, null),
    ]);
    return { ...listing, orgs: orgs.map((/** @type {any} */ org) => org.login), login: user?.login || null };
  });

  const needle = q.trim().toLowerCase();
  /** @type {any[]} */
  let repos = needle ? bundle.repos.filter((/** @type {any} */ repo) => repo.full_name.toLowerCase().includes(needle)) : bundle.repos;
  if (needle && bundle.truncated) {
    const seen = new Set(repos.map((repo) => repo.full_name));
    repos = repos.concat((await searchByName(token, userId, bundle, needle)).filter((/** @type {any} */ repo) => !seen.has(repo.full_name)));
  }

  // Unknowable once the listing is truncated: an org's repos may simply be past the cap.
  const owners = new Set(bundle.repos.map((/** @type {any} */ repo) => repo.owner.toLowerCase()));
  const restricted = bundle.truncated ? [] : bundle.orgs.filter((/** @type {string} */ org) => !owners.has(org.toLowerCase()));
  return {
    repos: repos.slice(0, MAX_RESULTS),
    needs_github: false,
    org_access: {
      url: clientId ? `${APP_CONNECTION_URL}${encodeURIComponent(clientId)}` : APPLICATIONS_URL,
      restricted_orgs: restricted,
      missing_scopes: missingScopes(bundle.scopes),
    },
  };
}

/**
 * Checks a repo exists and is visible with this token (or publicly).
 * @param {string | null} token
 * @param {string} repo
 */
export async function getRepo(token, repo) {
  assertRepo(repo);
  const response = await fetch(`${GITHUB_API}/repos/${repo}`, { headers: headers(token) });
  // An organization that restricts OAuth apps answers 404 for its private repos, same as a missing repo.
  if (response.status === 404) throw new HttpError(404, `${repo} was not found. If it is private or belongs to an organization, check that wordsmith has access to it`);
  if (!response.ok) await fail(response);
  const data = await response.json();
  return { full_name: data.full_name, description: data.description || '', private: data.private, html_url: data.html_url, default_branch: data.default_branch };
}

/** GraphQL PR node -> wordsmith shape. @param {any} node */
function fromGraphql(node) {
  return {
    number: node.number,
    title: String(node.title).slice(0, MAX_TITLE),
    url: node.url,
    draft: node.isDraft,
    author: node.author?.login || 'ghost',
    avatar_url: node.author?.avatarUrl || null,
    branch: node.headRefName,
    additions: node.additions,
    deletions: node.deletions,
    review: node.reviewDecision ? node.reviewDecision.toLowerCase() : null,
    checks: node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state?.toLowerCase() ?? null,
    labels: node.labels?.nodes?.map((/** @type {any} */ label) => label.name) ?? [],
    created_at: Date.parse(node.createdAt),
    updated_at: Date.parse(node.updatedAt),
    merged_at: node.mergedAt ? Date.parse(node.mergedAt) : null,
  };
}

/** REST PR -> wordsmith shape (no checks, review or diff size: those cost a request each). @param {any} pr */
function fromRest(pr) {
  return {
    number: pr.number,
    title: String(pr.title).slice(0, MAX_TITLE),
    url: pr.html_url,
    draft: Boolean(pr.draft),
    author: pr.user?.login || 'ghost',
    avatar_url: pr.user?.avatar_url || null,
    branch: pr.head?.ref || '',
    additions: null,
    deletions: null,
    review: null,
    checks: null,
    labels: (pr.labels || []).map((/** @type {any} */ label) => label.name),
    created_at: Date.parse(pr.created_at),
    updated_at: Date.parse(pr.updated_at),
    merged_at: pr.merged_at ? Date.parse(pr.merged_at) : null,
  };
}

/**
 * Open and recently merged PRs for a repo.
 * @param {string | null} token
 * @param {string} userId
 * @param {string} repo
 */
export async function repoPulls(token, userId, repo) {
  assertRepo(repo);
  return cached(`pulls:${userId}:${repo}`, PULLS_CACHE_SECONDS, async () => {
    const [owner, name] = repo.split('/');
    if (token) {
      const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: { ...headers(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: PULLS_QUERY, variables: { owner, name, open: OPEN_LIMIT, merged: MERGED_LIMIT } }),
      });
      if (!response.ok) await fail(response);
      const { data, errors } = await response.json();
      if (!data?.repository) throw new HttpError(404, errors?.[0]?.message || 'GitHub repo not found');
      return { source: 'graphql', fetched_at: Date.now(), open: data.repository.open.nodes.map(fromGraphql), merged: data.repository.merged.nodes.map(fromGraphql) };
    }
    const [open, closed] = await Promise.all([
      fetch(`${GITHUB_API}/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=${OPEN_LIMIT}`, { headers: headers(null) }),
      fetch(`${GITHUB_API}/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${MERGED_LIMIT * 3}`, { headers: headers(null) }),
    ]);
    if (!open.ok) await fail(open);
    if (!closed.ok) await fail(closed);
    const merged = (await closed.json()).filter((/** @type {any} */ pr) => pr.merged_at).slice(0, MERGED_LIMIT);
    return { source: 'rest', fetched_at: Date.now(), open: (await open.json()).map(fromRest), merged: merged.map(fromRest) };
  });
}
