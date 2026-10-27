// The app version, worked out at build time: v1.0.0.NN, where NN goes up by one for every pull request merged
// into master (two digits, zero-padded, and it simply grows past 99). GitHub Actions stay manual-only, so
// nothing bumps a file on merge: Workers Builds runs `npm run build` on every push to master, and vite.config.js
// calls readVersion() to bake the result in (see src/lib/version.js).
// Source of truth is the GitHub API (merged PRs into master on REPO), authenticated with GITHUB_PR_TOKEN or
// GITHUB_TOKEN when either is set. Offline or rate-limited, it counts first-parent merge commits instead, and if
// that is impossible too (no git, shallow clone) the version is VERSION_PREFIX + "dev". It never throws.
// Run `node scripts/version.js` to print what a build would use.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPO = 'YEAHDOGS/wordsmith';
const BASE_BRANCH = 'master';
// Refs tried, in order, to find the master a branch build is based on (the git fallback).
const BASE_REFS = [`origin/${BASE_BRANCH}`, BASE_BRANCH];
const GITHUB_API = 'https://api.github.com';
const VERSION_PREFIX = '1.0.0.';
const DEV_VERSION = `${VERSION_PREFIX}dev`;
// Merged PRs into master when this pipeline shipped, at which point the app was v1.0.0.01.
const BASELINE_MERGED = 1;
// First-parent merge commits on master at the same moment, for the offline fallback.
const BASELINE_GIT_MERGES = 1;
const BUILD_NUMBER_DIGITS = 2;
const FETCH_TIMEOUT_MS = 8_000;
const LATEST_PR_PAGE_SIZE = 30;

/** @typedef {{ number: number, title: string, url: string, mergedAt: number }} PullRequestRef */
/** @typedef {{ version: string, latestPr: PullRequestRef | null, source: 'github' | 'git' | 'none' }} AppVersion */

/** @param {number} merged @param {number} baseline */
const versionFrom = (merged, baseline) => `${VERSION_PREFIX}${String(Math.max(1, merged - baseline + 1)).padStart(BUILD_NUMBER_DIGITS, '0')}`;

/** @param {string} path */
async function github(path) {
  const token = process.env.GITHUB_PR_TOKEN || process.env.GITHUB_TOKEN;
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'wordsmith-build' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${GITHUB_API}${path}`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GitHub ${response.status} for ${path}`);
  return response.json();
}

/**
 * Merged PR count from search, plus the most recently merged PR from the pulls list (search can't sort by merge time).
 * The search index trails new merges by seconds to minutes, and the build for a merge starts right after it, so merged
 * PRs from the real-time pulls list that closed after the newest indexed one and are missing from search are added on.
 */
async function fromGitHub() {
  const query = encodeURIComponent(`repo:${REPO} is:pr is:merged base:${BASE_BRANCH}`);
  const [search, pulls] = await Promise.all([
    github(`/search/issues?q=${query}&sort=updated&order=desc&per_page=${LATEST_PR_PAGE_SIZE}`),
    github(`/repos/${REPO}/pulls?state=closed&base=${BASE_BRANCH}&sort=updated&direction=desc&per_page=${LATEST_PR_PAGE_SIZE}`),
  ]);
  if (!Number.isInteger(search?.total_count) || !Array.isArray(search.items) || !Array.isArray(pulls)) throw new Error('Unexpected GitHub response');
  const merged = pulls.filter((pull) => pull.merged_at).sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at));
  const indexed = new Set(search.items.map((/** @type {any} */ item) => item.number));
  const newestIndexed = Math.max(0, ...search.items.map((/** @type {any} */ item) => Date.parse(item.closed_at) || 0));
  const lagging = merged.filter((pull) => !indexed.has(pull.number) && Date.parse(pull.merged_at) > newestIndexed).length;
  const latest = merged[0];
  return {
    version: versionFrom(search.total_count + lagging, BASELINE_MERGED),
    latestPr: latest ? { number: latest.number, title: String(latest.title), url: latest.html_url, mergedAt: Date.parse(latest.merged_at) } : null,
    source: /** @type {const} */ ('github'),
  };
}

/** @param {string[]} args */
function git(args) {
  const run = spawnSync('git', args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args[0]} failed`);
  return run.stdout.trim();
}

/**
 * The master commit this checkout is built on: HEAD itself on master, else where the branch left master, so a
 * feature branch's own merge commits don't count. With no master ref at all it falls back to HEAD.
 */
function baseCommit() {
  if (git(['rev-parse', '--abbrev-ref', 'HEAD']) === BASE_BRANCH) return 'HEAD';
  for (const ref of BASE_REFS) {
    try {
      return git(['merge-base', 'HEAD', ref]);
    } catch {
      // That ref doesn't exist here; try the next one.
    }
  }
  return 'HEAD';
}

/** Counts first-parent merges on master locally. A shallow clone would undercount, so it refuses one. */
function fromGit() {
  if (git(['rev-parse', '--is-shallow-repository']) === 'true') throw new Error('shallow clone');
  const merges = Number(git(['rev-list', '--count', '--first-parent', '--merges', baseCommit()]));
  if (!Number.isInteger(merges)) throw new Error('no merge count');
  return { version: versionFrom(merges, BASELINE_GIT_MERGES), latestPr: null, source: /** @type {const} */ ('git') };
}

/**
 * Works out the build's version. Pass { offline: true } to skip the network (the dev server does).
 * @param {{ offline?: boolean }} [options]
 * @returns {Promise<AppVersion>}
 */
export async function readVersion({ offline = false } = {}) {
  if (!offline) {
    try {
      return await fromGitHub();
    } catch (error) {
      console.warn(`[version] GitHub lookup failed (${/** @type {Error} */ (error).message}); falling back to git.`);
    }
  }
  try {
    return fromGit();
  } catch {
    return { version: DEV_VERSION, latestPr: null, source: 'none' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await readVersion(), null, 2));
