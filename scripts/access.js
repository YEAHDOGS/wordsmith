// Plans by hand (users.access and users.plan, src/lib/models.js). Buy Me a Coffee memberships unlock accounts by
// themselves (api/functions/api/webhooks/bmc.js); this is for everything else: someone who joined with a different
// email, a gift, a ban. Runs wrangler against production D1 (or staging with --staging), so it needs your own
// Cloudflare login (`npx wrangler login`); nothing here ships.
//   npm run access -- list                    accounts and where they stand, with any Buy Me a Coffee membership
//   npm run access -- approve <email> [plan]  give a plan by hand (rockstar, animal or megaman; GRANTED_PLAN if left out)
//   npm run access -- lapse <email>           locked, whatever they hold (the app shows the paywall)
//   npm run access -- trial <email>           take back what was given by hand: the trial clock (from when they signed
//                                             up) and any membership decide again
// Add --staging to use the staging database instead, or --local for the machine-local one.
import { execFileSync } from 'node:child_process';
import { DAY_MS, GRANTED_PLAN, PLANS, TRIAL_MS, membershipPlan } from '../src/lib/models.js';

const DATABASES = { production: 'wordsmith-production', staging: 'wordsmith-staging' };
const LEVELS = { approve: 'member', lapse: 'lapsed', trial: 'trial' };
// Letters, digits and . _ + - only: nothing a shell or SQL would read as syntax.
const EMAIL = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;
// `list` shows at most this many accounts, newest first.
const LIST_LIMIT = 500;
// An active membership this long past its paid period gets flagged in `list`.
const STALE_AFTER_MS = 3 * DAY_MS;
const USAGE = `Usage: npm run access -- list | approve <email> [${Object.keys(PLANS).filter((plan) => PLANS[plan].level !== null).join('|')}] | lapse <email> | trial <email> [--staging | --local]`;

const args = process.argv.slice(2);
const [command, email, planArg] = args.filter((arg) => !arg.startsWith('--'));
const plan = planArg ?? GRANTED_PLAN;
const staging = args.includes('--staging');
const local = args.includes('--local');
const where = local ? ['--local', '--persist-to', '.wrangler/state'] : ['--remote', ...(staging ? ['--env', 'preview'] : [])];
const database = staging ? DATABASES.staging : DATABASES.production;

/**
 * Runs SQL through wrangler and returns the rows. --command, not --file: against the real databases wrangler runs a
 * file as a bulk import, which returns no rows and pauses the database while it runs. Windows runs npx through a
 * shell, so the statement is wrapped in double quotes there; it can't break out, because it never holds a double quote
 * or a %: its only values are fixed words, digits, and an email that matched EMAIL.
 * @param {string} sql
 */
function query(sql) {
  const windows = process.platform === 'win32';
  const out = execFileSync('npx', ['--yes', 'wrangler', 'd1', 'execute', database, ...where, '--json', '--command', windows ? `"${sql}"` : sql], { encoding: 'utf8', shell: windows });
  return JSON.parse(out)[0]?.results ?? [];
}

if (command === 'list') {
  const rows = query(`SELECT u.email, u.access, u.plan, u.created_at, m.level_id, m.level_name, m.duration, m.amount, m.currency, m.status, m.period_end, m.live FROM users u LEFT JOIN memberships m ON m.email = lower(u.email) ORDER BY u.created_at DESC LIMIT ${LIST_LIMIT}`);
  const now = Date.now();
  for (const row of rows) {
    const left = Math.ceil((Number(row.created_at) + TRIAL_MS - now) / DAY_MS);
    const trial = left > 0 ? `trial, ${left} day(s) left` : 'trial over';
    const given = row.access === 'member' ? `given ${row.plan ?? GRANTED_PLAN}` : row.access === 'lapsed' ? 'LAPSED (locked)' : trial;
    // An active membership past its period end may be a cancellation that never arrived: check it on Buy Me a Coffee.
    const stale = row.status === 'active' && Number(row.period_end) && Number(row.period_end) < now - STALE_AFTER_MS ? ' (period ended, no renewal seen: check it)' : '';
    const paid = row.status ? ` · Buy Me a Coffee: ${row.level_name || row.level_id} ${row.status}${membershipPlan(row, now) ? '' : ' (not paid up)'}${stale}${row.live ? '' : ' (test event)'}` : '';
    console.log(`${String(row.email ?? '(no email)').padEnd(40)} ${given}${paid}`);
  }
  console.log('Memberships reach accounts through verified sign-in emails (identities), so one not shown here may still apply.');
// Object.hasOwn, not `in`: `in` also matches inherited names like toString, which would write junk into access.
} else if (Object.hasOwn(LEVELS, command ?? '') && EMAIL.test(email ?? '') && (command === 'approve' ? Object.hasOwn(PLANS, plan) && plan !== 'trial' : !planArg)) {
  // The email matched EMAIL above (letters, digits and . _ + - only) and the plan is a PLANS key, so both are safe to
  // put in the statement. Only approve sets a plan; the others clear it.
  const given = command === 'approve' ? `'${plan}'` : 'NULL';
  const rows = query(`UPDATE users SET access = '${LEVELS[/** @type {keyof typeof LEVELS} */ (command)]}', plan = ${given}, access_changed_at = ${Date.now()} WHERE lower(email) = lower('${email}') RETURNING email, access, plan`);
  console.log(rows.length ? `${rows[0].email}: ${rows[0].access}${rows[0].plan ? ` (${rows[0].plan})` : ''}` : `No account with the email ${email}.`);
} else {
  console.error(USAGE);
  process.exit(1);
}
