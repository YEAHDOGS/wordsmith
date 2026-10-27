// npm run seed:staging [-- <user id>]: fills the STAGING D1 database with the synthetic sample data in
// seed-staging.json, for every staging user (or just the one given). Additive only: rows get fixed ids per user and
// are written with INSERT OR IGNORE, so running it again never duplicates or overwrites anything, and nothing is
// ever deleted. Rows are built from MODELS (src/lib/models.js), the same schema the app syncs, so they stay valid.
// Hard-wired to staging: there is deliberately no way to point it at production.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOOL_FIELDS, JSON_FIELDS, LEGACY_PRIORITY, newRow } from '../src/lib/models.js';
import { columnsOf } from '../api/lib/rows.js';

const STAGING_DB = 'wordsmith-staging';
const WRANGLER = `npx --yes wrangler d1 execute ${STAGING_DB} --remote --env preview`;
const SEED = JSON.parse(readFileSync(new URL('./seed-staging.json', import.meta.url), 'utf8'));
const SAMPLE_REPO = 'YEAHDOGS/wordsmith';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const ID_HASH_LENGTH = 10;
const SQL_FILE = join(tmpdir(), 'wordsmith-seed-staging.sql');

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
  const prefix = `seed-${createHash('sha256').update(userId).digest('hex').slice(0, ID_HASH_LENGTH)}`;
  const at = (/** @type {number} */ daysAgo, /** @type {number} */ offsetHours = 0) => now - daysAgo * DAY_MS + offsetHours * HOUR_MS;
  const projectIds = Object.fromEntries(SEED.projects.map((/** @type {any} */ p) => [p.key, `${prefix}-p-${p.key}`]));
  const labelIds = Object.fromEntries(SEED.labels.map((/** @type {any} */ l) => [l.key, `${prefix}-l-${l.key}`]));

  const projects = SEED.projects.map((/** @type {any} */ { key, ...values }) =>
    insert('projects', newRow('projects', { ...values, id: projectIds[key], user_id: userId, created_at: at(40), updated_at: now })));
  const labels = SEED.labels.map((/** @type {any} */ { key, ...values }) =>
    insert('labels', newRow('labels', { ...values, id: labelIds[key], user_id: userId, created_at: at(40), updated_at: now })));
  const notes = SEED.notes.map((/** @type {any} */ { project, labels: names = [], daysAgo, pr, ...values }, /** @type {number} */ index) => {
    const created = at(daysAgo, -index);
    const started = values.state === 'in_progress' || values.state === 'complete' ? created + HOUR_MS : null;
    const completed = values.state === 'complete' ? created + DAY_MS : null;
    const pullRequests = pr ? [{
      url: `https://github.com/${SAMPLE_REPO}/pull/${pr.number}`, repo: SAMPLE_REPO, number: pr.number, title: pr.title,
      state: pr.state, merged_at: pr.state === 'merged' ? completed : null,
    }] : [];
    return insert('notes', newRow('notes', {
      ...values, priority: LEGACY_PRIORITY[values.priority_level ?? 0], id: `${prefix}-n${String(index).padStart(2, '0')}`, user_id: userId,
      project_id: project ? projectIds[project] : null, label_ids: names.map((/** @type {string} */ name) => labelIds[name]),
      // updated_at must be now: sync only pulls rows changed after a device's cursor, so a backdated row is never seen.
      pull_requests: pullRequests, started_at: started, completed_at: completed, created_at: created, updated_at: now,
    }));
  });
  return [...projects, ...labels, ...notes];
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
console.log(`Seeded ${SEED.projects.length} projects, ${SEED.labels.length} labels and ${SEED.notes.length} notes for ${users.length} staging user(s). Reload the app (or tap sync) to see them.`);
