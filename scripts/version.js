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

/** @typedef {{ number: number, title: string, url: string }} PullRequestRef */
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

/** Merged PR count from search, plus the most recently merged PR from the pulls list (search can't sort by merge time). */
async function fromGitHub() {
  const query = encodeURIComponent(`repo:${REPO} is:pr is:merged base:${BASE_BRANCH}`);
  const [search, pulls] = await Promise.all([
    github(`/search/issues?q=${query}&per_page=1`),
    github(`/repos/${REPO}/pulls?state=closed&base=${BASE_BRANCH}&sort=updated&direction=desc&per_page=${LATEST_PR_PAGE_SIZE}`),
  ]);
  if (!Number.isInteger(search?.total_count) || !Array.isArray(pulls)) throw new Error('Unexpected GitHub response');
  const merged = pulls.filter((pull) => pull.merged_at).sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at));
  const latest = merged[0];
  return {
    version: versionFrom(search.total_count, BASELINE_MERGED),
    latestPr: latest ? { number: latest.number, title: String(latest.title), url: latest.html_url } : null,
    source: /** @type {const} */ ('github'),
  };
}

/** @param {string[]} args */
function git(args) {
  const run = spawnSync('git', args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args[0]} failed`);
  return run.stdout.trim();
}

/** Counts first-parent merges on master locally. A shallow clone would undercount, so it refuses one. */
function fromGit() {
  if (git(['rev-parse', '--is-shallow-repository']) === 'true') throw new Error('shallow clone');
  const merges = Number(git(['rev-list', '--count', '--first-parent', '--merges', 'HEAD']));
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
