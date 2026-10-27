// Workers Builds "Deploy command" for master: `node scripts/deploy.js`.
// Applies pending D1 migrations to production, then deploys the Worker. Migrations always run first, so new code
// never meets an old schema; a failed migration stops the deploy and production keeps running the previous version.
// Migrations must stay additive and backward compatible (AGENTS.md): the old Worker serves traffic on the new schema
// for the few seconds between the two steps.
// Deploy only the app's own config from here. Workers Builds pins every `wrangler deploy` in this build to the connected
// Worker (wordsmith), whatever `name` a config says, so deploying any other config replaces the app and its custom domains.
import { spawnSync } from 'node:child_process';

const PRODUCTION_DB = 'wordsmith-production';
const STEPS = [
  `npx --yes wrangler d1 migrations apply ${PRODUCTION_DB} --remote`,
  'npx --yes wrangler deploy',
];

for (const command of STEPS) {
  console.log(`> ${command}`);
  // CI=true makes Wrangler skip its confirmation prompt instead of waiting on stdin.
  const run = spawnSync(command, { shell: true, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
