// The app version, worked out at build time: v1.0.0.NN, where NN goes up by one for every pull request merged
// into master (two digits, zero-padded, and it simply grows past 99). GitHub Actions stay manual-only, so
// nothing bumps a file on merge: Workers Builds runs `npm run build` on every push to master, and vite.config.js
// calls readVersion() to bake the result in (see src/lib/version.js).
// Source of truth is master's own history: first-parent commits GitHub wrote for a merged PR ("Merge pull request #N"
// or a squash ending in "(#N)"). No API, so no rate limits or tokens. Workers Builds clones shallow, so a build
// deepens the clone from the public repo first; offline (the dev server) it counts what's there. If git is missing
// or the history is still shallow, the version is VERSION_PREFIX + "dev". It never throws.
// Run `node scripts/version.js` to print what a build would use.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPO = 'YEAHDOGS/wordsmith';
const REPO_URL = `https://github.com/${REPO}`;
const BASE_BRANCH = 'master';
// Refs tried, in order, to find the master a branch build is based on. FETCH_HEAD is master after deepen().
const BASE_REFS = [`origin/${BASE_BRANCH}`, BASE_BRANCH, 'FETCH_HEAD'];
const VERSION_PREFIX = '1.0.0.';
const DEV_VERSION = `${VERSION_PREFIX}dev`;
// Merged PRs on master when this pipeline shipped, at which point the app was v1.0.0.01.
const BASELINE_MERGED = 1;
const BUILD_NUMBER_DIGITS = 2;
// Subjects GitHub writes on master for a merged PR: a merge commit, or a squash merge.
const MERGE_SUBJECT = /^Merge pull request #(\d+) /;
const SQUASH_SUBJECT = /^(.*) \(#(\d+)\)$/;
// Fields of one commit in `git log` output, split on a unit separator.
const FIELD_SEPARATOR = '\x1f';
const LOG_FORMAT = ['%s', '%b', '%ct'].join('%x1f') + '%x1e';
const RECORD_SEPARATOR = '\x1e';
const MS_PER_SECOND = 1000;

/** @typedef {{ number: number, title: string, url: string, mergedAt: number }} PullRequestRef */
/** @typedef {{ version: string, latestPr: PullRequestRef | null, source: 'git' | 'none' }} AppVersion */

/** @param {string[]} args */
function git(args) {
  const run = spawnSync('git', args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args[0]} failed`);
  return run.stdout.trim();
}

/** Turns a shallow clone (Workers Builds) into a full one, fetching master from the public repo. */
function deepen() {
  if (git(['rev-parse', '--is-shallow-repository']) !== 'true') return;
  git(['fetch', '--quiet', '--unshallow', REPO_URL, BASE_BRANCH]);
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

/** Master's merged PRs, newest first, read from its first-parent history. @returns {PullRequestRef[]} */
function mergedPullRequests() {
  const log = git(['log', '--first-parent', `--format=${LOG_FORMAT}`, baseCommit()]);
  return log.split(RECORD_SEPARATOR).flatMap((record) => {
    const [subject = '', body = '', time = ''] = record.trim().split(FIELD_SEPARATOR);
    const merge = subject.match(MERGE_SUBJECT);
    const squash = subject.match(SQUASH_SUBJECT);
    const number = Number(merge?.[1] ?? squash?.[2]);
    if (!number) return [];
    const title = merge ? body.trim().split('\n')[0] || subject : /** @type {RegExpMatchArray} */ (squash)[1];
    return [{ number, title, url: `${REPO_URL}/pull/${number}`, mergedAt: Number(time) * MS_PER_SECOND }];
  });
}

/**
 * Works out the build's version. Pass { offline: true } to skip the network (the dev server does).
 * @param {{ offline?: boolean }} [options]
 * @returns {Promise<AppVersion>}
 */
export async function readVersion({ offline = false } = {}) {
  try {
    if (!offline) deepen();
    if (git(['rev-parse', '--is-shallow-repository']) === 'true') throw new Error('shallow clone');
    const pulls = mergedPullRequests();
    const build = String(Math.max(1, pulls.length - BASELINE_MERGED + 1)).padStart(BUILD_NUMBER_DIGITS, '0');
    return { version: `${VERSION_PREFIX}${build}`, latestPr: pulls[0] ?? null, source: 'git' };
  } catch (error) {
    console.warn(`[version] ${/** @type {Error} */ (error).message}; using ${DEV_VERSION}.`);
    return { version: DEV_VERSION, latestPr: null, source: 'none' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await readVersion(), null, 2));
