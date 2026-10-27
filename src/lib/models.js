// API contract shared by the Svelte app and the Worker in api/.
// Tables and columns live only in api/migrations/*.sql; this file says which of those columns a client
// may write, their limits and allowed values. Client defaults and server validation both read it.

export const NOTE_KINDS = ['note', 'feature'];
export const FEATURE_STATES = ['requested', 'in_progress', 'complete'];
export const PR_STATES = ['open', 'merged', 'closed'];
// Card and label tints. Each maps to a --color-tint-* token in src/styles/theme.css.
export const COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
export const PROVIDERS = ['github', 'google', 'apple'];
// Timeline entries in note_events, written by the server on every interaction.
export const EVENT_TYPES = ['created', 'edited', 'state', 'status', 'claimed', 'assigned', 'pr_linked', 'pr_merged', 'pr_closed', 'archived', 'unarchived', 'deleted', 'restored', 'attached', 'detached', 'published', 'unpublished'];

// Attachments: images and videos on notes, stored in R2. SVG is left out on purpose (it can carry script).
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// Workers accept request bodies up to 100 MB on the free plan.
export const MAX_VIDEO_BYTES = 95 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_NOTE = 20;
export const MAX_FILE_NAME = 200;
export const ACTOR_TYPES = ['user', 'agent', 'github'];

export const MAX_TITLE = 300;
export const MAX_BODY = 100_000;
export const MAX_NAME = 80;
export const MAX_STATUS = 500;
export const MAX_REPO = 140;
export const MAX_LABELS_PER_NOTE = 30;
export const MAX_PRS_PER_NOTE = 20;
export const MAX_SYNC_BATCH = 200;
// Note priority: 0 = none, then 1..5 where 5 is the most important. Index = stored value; every UI reads these.
export const PRIORITY_LABELS = ['None', 'Low', 'Normal', 'High', 'Urgent', 'Critical'];
export const MAX_PRIORITY = PRIORITY_LABELS.length - 1;

/** @typedef {{ type: 'text', max: number } | { type: 'enum', values: string[] } | { type: 'bool' } | { type: 'int', min: number, max: number } | { type: 'real', nullable?: boolean } | { type: 'id', nullable?: boolean } | { type: 'ids', max: number } | { type: 'prs', max: number }} FieldRule */

/** Writable fields per synced table, with defaults for new rows. @type {Record<string, Record<string, FieldRule & { default: any }>>} */
export const MODELS = {
  projects: {
    name: { type: 'text', max: MAX_NAME, default: '' },
    description: { type: 'text', max: MAX_STATUS, default: '' },
    color: { type: 'enum', values: COLORS, default: 'default' },
    repo: { type: 'text', max: MAX_REPO, default: '' },
  },
  labels: {
    name: { type: 'text', max: MAX_NAME, default: '' },
    color: { type: 'enum', values: COLORS, default: 'default' },
  },
  notes: {
    project_id: { type: 'id', nullable: true, default: null },
    kind: { type: 'enum', values: NOTE_KINDS, default: 'note' },
    title: { type: 'text', max: MAX_TITLE, default: '' },
    body: { type: 'text', max: MAX_BODY, default: '' },
    color: { type: 'enum', values: COLORS, default: 'default' },
    label_ids: { type: 'ids', max: MAX_LABELS_PER_NOTE, default: [] },
    pinned: { type: 'bool', default: false },
    archived: { type: 'bool', default: false },
    // Readable by anyone at /n/<id>. Only the signed-in app may change it (see saveNotes in api/lib/notes.js).
    public: { type: 'bool', default: false },
    state: { type: 'enum', values: FEATURE_STATES, default: 'requested' },
    status: { type: 'text', max: MAX_STATUS, default: '' },
    priority: { type: 'int', min: 0, max: MAX_PRIORITY, default: 0 },
    // Manual order from hold-and-drag. Lower sorts first; null = never placed by hand (fall back to the active sort).
    position: { type: 'real', nullable: true, default: null },
    pull_requests: { type: 'prs', max: MAX_PRS_PER_NOTE, default: [] },
    assignee: { type: 'text', max: MAX_NAME, default: '' },
  },
};

// Columns only the server writes (lifecycle timestamps). Clients read them but never send them.
/** @type {Record<string, string[]>} */
export const SERVER_FIELDS ={ projects: [], labels: [], notes: ['started_at', 'completed_at', 'prs_checked_at'] };

// Columns stored as JSON text in D1 and as real arrays everywhere else.
export const JSON_FIELDS = ['label_ids', 'pull_requests'];
export const BOOL_FIELDS = ['pinned', 'archived', 'public'];
// Public notes are served at this path on the app's origin.
export const SHARE_PATH = '/n/';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PR_URL_PATTERN = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?$/;

/**
 * Parses a GitHub pull request URL into its repo and number, or null.
 * @param {string} url
 */
export function parsePullRequestUrl(url) {
  const match = PR_URL_PATTERN.exec(String(url).trim());
  if (!match) return null;
  return { url: `https://github.com/${match[1]}/pull/${match[2]}`, repo: match[1], number: Number(match[2]) };
}

/** @param {unknown} value */
export const isId = (value) => typeof value === 'string' && ID_PATTERN.test(value);

/**
 * Checks one field against its rule and returns the cleaned value, or throws with a readable message.
 * @param {string} name
 * @param {FieldRule} rule
 * @param {any} value
 */
function cleanField(name, rule, value) {
  if (rule.type === 'text') {
    if (typeof value !== 'string') throw new Error(`${name} must be text`);
    if (value.length > rule.max) throw new Error(`${name} is longer than ${rule.max} characters`);
    return value;
  }
  if (rule.type === 'enum') {
    if (!rule.values.includes(value)) throw new Error(`${name} must be one of ${rule.values.join(', ')}`);
    return value;
  }
  if (rule.type === 'bool') return Boolean(value);
  if (rule.type === 'int') {
    const number = Number(value);
    if (!Number.isInteger(number) || number < rule.min || number > rule.max) throw new Error(`${name} must be ${rule.min}-${rule.max}`);
    return number;
  }
  if (rule.type === 'real') {
    if (value === null && rule.nullable) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a number`);
    return value;
  }
  if (rule.type === 'id') {
    if (value === null && rule.nullable) return null;
    if (!isId(value)) throw new Error(`${name} must be an id`);
    return value;
  }
  if (!Array.isArray(value) || value.length > rule.max) throw new Error(`${name} must be a list of at most ${rule.max}`);
  if (rule.type === 'ids') {
    if (!value.every(isId)) throw new Error(`${name} must contain ids`);
    return [...new Set(value)];
  }
  return value.map((pr) => {
    const parsed = parsePullRequestUrl(pr?.url);
    if (!parsed) throw new Error(`${name} must contain GitHub pull request URLs`);
    return {
      ...parsed,
      title: typeof pr.title === 'string' ? pr.title.slice(0, MAX_TITLE) : '',
      state: PR_STATES.includes(pr.state) ? pr.state : 'open',
      merged_at: Number.isFinite(pr.merged_at) ? pr.merged_at : null,
    };
  });
}

/**
 * Validates a partial row for a synced table. Unknown fields are dropped.
 * @param {keyof typeof MODELS} table
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
export function cleanRow(table, input) {
  const rules = MODELS[table];
  /** @type {Record<string, any>} */
  const out = {};
  for (const [name, rule] of Object.entries(rules)) {
    if (input[name] === undefined) continue;
    out[name] = cleanField(name, rule, input[name]);
  }
  return out;
}

/**
 * A new row for a synced table with every writable field at its default.
 * @param {keyof typeof MODELS} table
 * @param {Record<string, any>} [values]
 */
export function newRow(table, values = {}) {
  const now = Date.now();
  /** @type {Record<string, any>} */
  const row = { id: crypto.randomUUID(), created_at: now, updated_at: now, deleted_at: null };
  for (const [name, rule] of Object.entries(MODELS[table])) row[name] = structuredClone(rule.default);
  for (const name of SERVER_FIELDS[table]) row[name] = null;
  return Object.assign(row, values);
}
