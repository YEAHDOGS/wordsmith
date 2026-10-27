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
const REPO_LIMIT = 100;
const MAX_TITLE = 300;

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

/**
 * Repos the user can see, most recently pushed first, filtered by q. Needs a GitHub token.
 * @param {string | null} token
 * @param {string} userId
 * @param {string} q
 */
export async function searchRepos(token, userId, q) {
  if (!token) return { repos: [], needs_github: true };
  const all = await cached(`repos:${userId}`, REPOS_CACHE_SECONDS, async () => {
    const response = await fetch(`${GITHUB_API}/user/repos?sort=pushed&per_page=${REPO_LIMIT}&affiliation=owner,collaborator,organization_member`, { headers: headers(token) });
    if (!response.ok) await fail(response);
    return (await response.json()).map((/** @type {any} */ repo) => ({
      full_name: repo.full_name, description: repo.description || '', private: repo.private, pushed_at: Date.parse(repo.pushed_at), html_url: repo.html_url,
    }));
  });
  const needle = q.trim().toLowerCase();
  return { repos: needle ? all.filter((/** @type {any} */ repo) => repo.full_name.toLowerCase().includes(needle)) : all, needs_github: false };
}

/**
 * Checks a repo exists and is visible with this token (or publicly).
 * @param {string | null} token
 * @param {string} repo
 */
export async function getRepo(token, repo) {
  assertRepo(repo);
  const response = await fetch(`${GITHUB_API}/repos/${repo}`, { headers: headers(token) });
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
