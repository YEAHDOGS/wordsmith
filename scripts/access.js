// Free trial memberships, approved by hand (users.access, src/lib/models.js). Runs wrangler against production D1
// (or staging with --staging), so it needs your own Cloudflare login (`npx wrangler login`); nothing here ships.
//   npm run access -- list                 accounts and where they stand (trial days left, member, lapsed)
//   npm run access -- approve <email>      full access: they subscribed to DOGS on Buy Me a Coffee
//   npm run access -- lapse <email>        membership ended: locked again (the app shows the paywall)
//   npm run access -- trial <email>        back on the trial clock (from when they signed up)
// Add --staging to use the staging database instead, or --local for the machine-local one.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TRIAL_MS } from '../src/lib/models.js';

const DATABASES = { production: 'wordsmith-production', staging: 'wordsmith-staging' };
const LEVELS = { approve: 'member', lapse: 'lapsed', trial: 'trial' };
// Letters, digits and . _ + - only: nothing a shell or SQL would read as syntax.
const EMAIL = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;
const DAY_MS = 86_400_000;
const USAGE = 'Usage: npm run access -- list | approve <email> | lapse <email> | trial <email> [--staging | --local]';

const args = process.argv.slice(2);
const [command, email] = args.filter((arg) => !arg.startsWith('--'));
const staging = args.includes('--staging');
const local = args.includes('--local');
const where = local ? ['--local', '--persist-to', '.wrangler/state'] : ['--remote', ...(staging ? ['--env', 'preview'] : [])];
const database = staging ? DATABASES.staging : DATABASES.production;

/**
 * Runs SQL through wrangler and returns the rows. The statement goes in a temporary file (--file), so the only
 * arguments the shell sees are fixed ones (Windows runs npx through a shell).
 * @param {string} sql
 */
function query(sql) {
  const folder = mkdtempSync(join(tmpdir(), 'wordsmith-access-'));
  const file = join(folder, 'query.sql');
  writeFileSync(file, sql);
  try {
    const windows = process.platform === 'win32';
    // Quoted for the shell in case the temp folder's path has a space in it (it can't hold a quote).
    const out = execFileSync('npx', ['--yes', 'wrangler', 'd1', 'execute', database, ...where, '--json', '--file', windows ? `"${file}"` : file], { encoding: 'utf8', shell: windows });
    return JSON.parse(out)[0]?.results ?? [];
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

if (command === 'list') {
  const rows = query('SELECT email, name, access, created_at, access_changed_at FROM users ORDER BY created_at DESC LIMIT 500');
  const now = Date.now();
  for (const row of rows) {
    const left = Math.ceil((Number(row.created_at) + TRIAL_MS - now) / DAY_MS);
    const standing = row.access === 'trial' ? (left > 0 ? `trial, ${left} day(s) left` : 'trial over: locked') : row.access;
    console.log(`${String(row.email ?? '(no email)').padEnd(40)} ${standing}`);
  }
} else if (command in LEVELS && EMAIL.test(email ?? '')) {
  // The email matched EMAIL above (letters, digits and . _ + - only), so it is safe to put in the statement.
  const rows = query(`UPDATE users SET access = '${LEVELS[/** @type {keyof typeof LEVELS} */ (command)]}', access_changed_at = ${Date.now()} WHERE lower(email) = lower('${email}') RETURNING email, access`);
  console.log(rows.length ? `${rows[0].email}: ${rows[0].access}` : `No account with the email ${email}.`);
} else {
  console.error(USAGE);
  process.exit(1);
}
