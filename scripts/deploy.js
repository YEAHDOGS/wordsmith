// Workers Builds "Deploy command" for master: `node scripts/deploy.js`.
// Applies pending D1 migrations to production, deploys the Worker, then the short-domain redirect Worker
// (redirect/wrangler.jsonc: ws., word. and smith.dogs.red -> wordsmith.dogs.red). Migrations always run first, so new code
// never meets an old schema; a failed migration stops the deploy and production keeps running the previous version.
// Migrations must stay additive and backward compatible (AGENTS.md): the old Worker serves traffic on the new schema
// for the few seconds between the two steps.
import { spawnSync } from 'node:child_process';

const PRODUCTION_DB = 'wordsmith-production';
const REDIRECT_CONFIG = 'redirect/wrangler.jsonc';
const STEPS = [
  `npx --yes wrangler d1 migrations apply ${PRODUCTION_DB} --remote`,
  'npx --yes wrangler deploy',
  `npx --yes wrangler deploy --config ${REDIRECT_CONFIG}`,
];

for (const command of STEPS) {
  console.log(`> ${command}`);
  // CI=true makes Wrangler skip its confirmation prompt instead of waiting on stdin.
  const run = spawnSync(command, { shell: true, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
