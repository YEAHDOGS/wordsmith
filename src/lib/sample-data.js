// The synthetic sample workspace: staging's seed rows (scripts/seed-staging.js) and the demo's in-memory data come
// from this one builder, so both always show the same thing. Rows are built from MODELS (models.js), the schema the app syncs.
import { LEGACY_PRIORITY, newRow, projectKey } from './models.js';
import SAMPLE from './sample-data.json' with { type: 'json' };

const SAMPLE_REPO = 'YEAHDOGS/wordsmith';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const NOTE_ID_DIGITS = 2;

/**
 * Every sample row for one user. Ids are fixed per prefix, so re-seeding never duplicates anything.
 * updated_at is now: sync only pulls rows changed after a device's cursor, so a backdated row is never seen.
 * @param {string} prefix id prefix for this user's rows
 * @param {string} userId
 * @param {number} now
 * @returns {{ projects: any[], labels: any[], notes: any[] }}
 */
export function sampleRows(prefix, userId, now) {
  const at = (/** @type {number} */ daysAgo, /** @type {number} */ offsetHours = 0) => now - daysAgo * DAY_MS + offsetHours * HOUR_MS;
  const projectIds = Object.fromEntries(SAMPLE.projects.map((/** @type {any} */ p) => [p.key, `${prefix}-p-${p.key}`]));
  const labelIds = Object.fromEntries(SAMPLE.labels.map((/** @type {any} */ l) => [l.key, `${prefix}-l-${l.key}`]));

  const projects = SAMPLE.projects.map((/** @type {any} */ { key, ...values }) =>
    newRow('projects', { ...values, id: projectIds[key], user_id: userId, name_key: projectKey(values.name), created_at: at(40), updated_at: now }));
  const labels = SAMPLE.labels.map((/** @type {any} */ { key, ...values }) =>
    newRow('labels', { ...values, id: labelIds[key], user_id: userId, created_at: at(40), updated_at: now }));
  const notes = SAMPLE.notes.map((/** @type {any} */ { project, labels: names = [], daysAgo, pr, ...values }, /** @type {number} */ index) => {
    const created = at(daysAgo, -index);
    const started = values.state === 'in_progress' || values.state === 'complete' ? created + HOUR_MS : null;
    const completed = values.state === 'complete' ? created + DAY_MS : null;
    const pullRequests = pr ? [{
      url: `https://github.com/${SAMPLE_REPO}/pull/${pr.number}`, repo: SAMPLE_REPO, number: pr.number, title: pr.title,
      state: pr.state, merged_at: pr.state === 'merged' ? completed : null,
    }] : [];
    return newRow('notes', {
      ...values, priority: LEGACY_PRIORITY[values.priority_level ?? 0], id: `${prefix}-n${String(index).padStart(NOTE_ID_DIGITS, '0')}`, user_id: userId,
      project_id: project ? projectIds[project] : null, label_ids: names.map((/** @type {string} */ name) => labelIds[name]),
      pull_requests: pullRequests, started_at: started, completed_at: completed, created_at: created, updated_at: now,
    });
  });
  return { projects, labels, notes };
}
