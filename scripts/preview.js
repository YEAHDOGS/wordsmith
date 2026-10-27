// Workers Builds "Preview command" for every non-production branch: `node scripts/preview.js`.
// Applies pending D1 migrations to staging, then runs `npx wrangler preview` (a branch-isolated Worker Preview on staging data, see "previews" in wrangler.jsonc),
// then writes the Preview URL and a link to this build onto the first line of the branch's open pull request.
// The PR step needs the build secret GITHUB_PR_TOKEN (fine-grained token, Pull requests: read and write, this repo
// only). Without it, or before the PR exists, the Preview still deploys and the step is skipped.
import { spawnSync } from 'node:child_process';

const REPO = 'YEAHDOGS/wordsmith';
const WORKER = 'wordsmith';
const STAGING_DB = 'wordsmith-staging';
const GITHUB_API = 'https://api.github.com';
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
// The first line of a PR body starting with this is ours and gets replaced on every push.
const MARKER = '**Preview:**';
const SHORT_SHA = 7;

const { WORKERS_CI_BRANCH: branch, WORKERS_CI_BUILD_UUID: buildId, WORKERS_CI_COMMIT_SHA: sha = '', GITHUB_PR_TOKEN: githubToken } = process.env;

// Pending migrations go to staging first, so the Preview never runs against an older schema. A failed migration
// fails the build before anything deploys. All Previews share staging D1, so migrations must stay additive.
const migrate = spawnSync(`npx --yes wrangler d1 migrations apply ${STAGING_DB} --remote --env preview`, { shell: true, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

// Wrangler prints build logs on stderr and the result as JSON on stdout.
const run = spawnSync('npx --yes wrangler preview --json', { shell: true, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
if (run.status !== 0) {
  process.stdout.write(run.stdout || '');
  process.exit(run.status ?? 1);
}

let result = {};
try {
  result = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));
} catch {
  console.warn('Preview deployed, but its output was not JSON; skipping the pull request link.');
  process.exit(0);
}
const url = result.preview?.urls?.[0] ?? result.deployment?.urls?.[0] ?? '';
console.log(`Preview ${result.preview?.name ?? branch}: ${url || 'deployed, no URL yet (preview_urls applies after the next production deploy)'}`);

if (!githubToken || !branch) {
  console.log('No GITHUB_PR_TOKEN or branch: skipping the pull request link.');
  process.exit(0);
}

/** The dashboard link to this build. The account id comes from the build's own Cloudflare token. */
async function buildLink() {
  if (!buildId) return '';
  let account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!account && process.env.CLOUDFLARE_API_TOKEN) {
    const response = await fetch(`${CLOUDFLARE_API}/accounts`, { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } });
    account = response.ok ? (await response.json()).result?.[0]?.id : '';
  }
  return account ? `https://dash.cloudflare.com/${account}/workers/services/view/${WORKER}/production/builds/${buildId}` : '';
}

/** @param {string} path @param {RequestInit} [init] */
const github = (path, init = {}) => fetch(`${GITHUB_API}${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...init.headers },
});

try {
  const owner = REPO.split('/')[0];
  const pulls = await github(`/repos/${REPO}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`).then((response) => response.json());
  const pull = Array.isArray(pulls) ? pulls[0] : null;
  if (!pull) {
    console.log(`No open pull request for ${branch} yet; the next push will link it.`);
    process.exit(0);
  }

  const build = await buildLink();
  const line = [`${MARKER} ${url || 'deployed (URL appears after the next production deploy)'}`, build && `[Build](${build})`, sha && `\`${sha.slice(0, SHORT_SHA)}\``]
    .filter(Boolean).join(' · ');
  const body = String(pull.body || '');
  const rest = body.startsWith(MARKER) ? body.slice(body.indexOf('\n') === -1 ? body.length : body.indexOf('\n') + 1) : body;
  const response = await github(`/repos/${REPO}/pulls/${pull.number}`, { method: 'PATCH', body: JSON.stringify({ body: `${line}\n${rest.startsWith('\n') ? '' : '\n'}${rest}` }) });
  console.log(response.ok ? `Linked the Preview on pull request #${pull.number}.` : `Could not update pull request #${pull.number} (${response.status}).`);
} catch (error) {
  // The Preview is already live; a failed link must not fail the build.
  console.warn(`Skipping the pull request link: ${/** @type {Error} */ (error).message}`);
}
