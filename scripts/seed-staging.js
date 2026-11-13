// npm run seed:staging [-- <user id>]: fills the STAGING D1 database with the synthetic sample workspace
// (src/lib/sample-data.js, the same rows the demo shows), for every staging user (or just the one given). Additive only:
// rows get fixed ids per user and are written with INSERT OR IGNORE, so running it again never duplicates or overwrites
// anything, and nothing is ever deleted. Hard-wired to staging: there is deliberately no way to point it at production.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOOL_FIELDS, JSON_FIELDS } from '../src/lib/models.js';
import { sampleRows } from '../src/lib/sample-data.js';
import { columnsOf } from '../api/lib/rows.js';

const STAGING_DB = 'wordsmith-staging';
const WRANGLER = `npx --yes wrangler d1 execute ${STAGING_DB} --remote --env preview`;
const ID_HASH_LENGTH = 10;
const SQL_FILE = join(tmpdir(), 'wordsmith-seed-staging.sql');
const TABLES = /** @type {const} */ (['projects', 'labels', 'notes']);

/** Runs a wrangler d1 command against staging and returns stdout. @param {string} args */
function wrangler(args) {
  const run = spawnSync(`${WRANGLER} ${args}`, { shell: true, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], env: { ...process.env, CI: 'true' } });
  if (run.status !== 0) {
    process.stdout.write(run.stdout || '');
    process.exit(run.status ?? 1);
  }
  return run.stdout;
}

/** SQL literal for one value as D1 stores it. @param {string} column @param {any} value */
function literal(column, value) {
  if (value === null || value === undefined) return 'NULL';
  if (BOOL_FIELDS.includes(column)) return value ? '1' : '0';
  if (JSON_FIELDS.includes(column)) return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** @param {'projects' | 'labels' | 'notes'} table @param {Record<string, any>} row */
function insert(table, row) {
  const columns = columnsOf(table);
  return `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((column) => literal(column, row[column])).join(', ')});`;
}

/** Every statement that seeds one user. @param {string} userId @param {number} now */
function statementsFor(userId, now) {
  const rows = sampleRows(`seed-${createHash('sha256').update(userId).digest('hex').slice(0, ID_HASH_LENGTH)}`, userId, now);
  return TABLES.flatMap((table) => rows[table].map((row) => insert(table, row)));
}

const userArg = process.argv[2];
const users = userArg ? [userArg] : JSON.parse(wrangler('--json --command "SELECT id FROM users"'))[0].results.map((/** @type {any} */ row) => row.id);
if (!users.length) {
  console.log('No users in staging yet. Sign in once (npm run dev, then "Local dev" or GitHub) and run this again.');
  process.exit(0);
}

const now = Date.now();
writeFileSync(SQL_FILE, users.flatMap((userId) => statementsFor(userId, now)).join('\n'));
try {
  wrangler(`--file "${SQL_FILE}"`);
} finally {
  rmSync(SQL_FILE, { force: true });
}
console.log(`Seeded the sample workspace for ${users.length} staging user(s). Reload the app (or tap sync) to see them.`);
