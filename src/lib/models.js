// API contract shared by the Svelte app and the Worker in api/.
// Tables and columns live only in api/migrations/*.sql; this file says which of those columns a client
// may write, their limits and allowed values. Client defaults and server validation both read it.

export const NOTE_KINDS = ['note', 'feature'];
export const FEATURE_STATES = ['requested', 'in_progress', 'complete'];
// Display names of the states. Boards start with one column per state under these names.
export const STATE_LABELS = { requested: 'Requested', in_progress: 'In progress', complete: 'Complete' };
export const PR_STATES = ['open', 'merged', 'closed'];
// Card and label tints. Each maps to a --color-tint-* token in src/styles/theme.css.
export const COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
export const PROVIDERS = ['github', 'google', 'apple'];
// Timeline entries in note_events, written by the server on every interaction.
export const EVENT_TYPES = ['created', 'edited', 'state', 'status', 'claimed', 'assigned', 'pr_linked', 'pr_merged', 'pr_closed', 'archived', 'unarchived', 'deleted', 'restored', 'attached', 'detached', 'published', 'unpublished', 'analyzed'];

// Attachments: images, videos and documents on notes, stored in R2. SVG is left out on purpose (it can carry script).
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
// Kept small on purpose so R2 stays within the free tier: the app shrinks images to fit before uploading (src/lib/compress.js)
// and the server rejects anything larger.
export const MAX_IMAGE_BYTES = 1 * 1024 * 1024;
// Videos can't be re-encoded in the browser without a large library, so they're only capped: about a minute of 720p screen recording.
export const MAX_VIDEO_BYTES = 10 * 1024 * 1024;
// Images up to this size are accepted for shrinking on the device before upload.
export const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024;
// Documents: each type and the file extensions it may carry. The server requires both to match, and never serves
// HTML, so nothing uploaded can run as a page. Browsers report .md (and sometimes .docx) with an empty or odd type,
// so the app names the type from the extension (documentType) before uploading.
export const DOCUMENT_TYPES = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'text/markdown': ['.md', '.markdown'],
  'text/plain': ['.txt'],
};
// Documents aren't shrunk on the device, so they're only capped; 5 MB covers long specs and exported PDFs.
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
// The file pickers' accept list: every type, plus document extensions for systems that don't know the types.
export const ACCEPT_ATTACHMENTS = [...IMAGE_TYPES, ...VIDEO_TYPES, ...Object.keys(DOCUMENT_TYPES), ...Object.values(DOCUMENT_TYPES).flat()].join(',');

/** The lowercase extension of a file name, with its dot ('' when none). @param {string} name */
export const fileExtension = (name) => (/\.[^.]+$/.exec(name)?.[0] || '').toLowerCase();

/**
 * The document type a file name stands for ('' when it isn't a document). @param {string} name
 * @returns {string}
 */
export function documentType(name) {
  const extension = fileExtension(name);
  if (!extension) return '';
  return Object.keys(DOCUMENT_TYPES).find((type) => DOCUMENT_TYPES[/** @type {keyof typeof DOCUMENT_TYPES} */ (type)].includes(extension)) || '';
}

/** 'image', 'video', 'document', or '' for a type that can't be attached. @param {string} type */
export function attachmentKind(type) {
  if (IMAGE_TYPES.includes(type)) return 'image';
  if (VIDEO_TYPES.includes(type)) return 'video';
  return Object.hasOwn(DOCUMENT_TYPES, type) ? 'document' : '';
}

/**
 * The type a picked file uploads as: images and videos keep the browser's type, documents are named by their
 * extension. '' when the file can't be attached. @param {{ name: string, type: string }} file
 */
export const uploadType = (file) => (IMAGE_TYPES.includes(file.type) || VIDEO_TYPES.includes(file.type) ? file.type : documentType(file.name));
export const MAX_ATTACHMENTS_PER_NOTE = 20;
export const MAX_FILE_NAME = 200;
export const ACTOR_TYPES = ['user', 'agent', 'github'];

export const MAX_TITLE = 300;
export const MAX_BODY = 100_000;
export const MAX_NAME = 80;
const MAX_ID = 64;
export const MAX_STATUS = 500;
// A project's mission statement (projects.description): Markdown, what the project is, why, and how to build it.
export const MAX_MISSION = 20_000;
// Projects per user: bounds every projects query and sync download (agents can create projects, see api/lib/agent.js).
export const MAX_PROJECTS = 200;
// Why sync refused a project row, so the app knows what to do: rename a clashing new project, or just say so.
export const NAME_TAKEN = 'name_taken';
export const PROJECT_LIMIT = 'project_limit';
// Why a GitHub route failed: GitHub rejected the stored sign-in token, and signing in with GitHub again replaces it.
export const GITHUB_RECONNECT = 'github_reconnect';
export const MAX_REPO = 140;
export const MAX_LABELS_PER_NOTE = 30;
export const MAX_PRS_PER_NOTE = 20;
export const MAX_SYNC_BATCH = 200;
// Feature boards (the boards table): the Features page uses scope FEATURES_SCOPE, a project uses its id. Each column
// plays one state's role; a board needs every state at least once so any feature has somewhere to sit.
export const FEATURES_SCOPE = 'features';
export const MAX_COLUMNS = 8;
export const DEFAULT_COLUMNS = FEATURE_STATES.map((state) => ({ id: state, name: STATE_LABELS[/** @type {keyof typeof STATE_LABELS} */ (state)], state }));
// Note priority (notes.priority_level): 0 = none, then 1..5 where 5 is the most important. Index = stored value;
// every UI reads these.
export const PRIORITY_LABELS = ['None', 'Low', 'Normal', 'High', 'Urgent', 'Critical'];
export const MAX_PRIORITY = PRIORITY_LABELS.length - 1;
// From this level up a priority is drawn in the accent (card meter, priority pickers).
export const LOUD_PRIORITY = PRIORITY_LABELS.indexOf('High');
// Builds from before migration 20261027040000 use the old 0..3 scale (0 none, 1 High, 2 Urgent, 3 Critical) in
// notes.priority. LEGACY_PRIORITY[level] is that old value for each level; indexOf(old) converts back up. The server
// keeps the two columns in step (saveNotes in api/lib/notes.js).
export const LEGACY_PRIORITY = [0, 0, 0, 1, 2, 3];
export const MAX_LEGACY_PRIORITY = Math.max(...LEGACY_PRIORITY);
// Note difficulty (notes.difficulty): 0 = unrated, then 1..5. Index = stored value. Agents triage with it: up to
// SMALL_DIFFICULTY is a small fix that can ship in the day's batch PR; above it waits for a talk with the owner.
export const DIFFICULTY_LABELS = ['Unrated', 'Trivial', 'Easy', 'Medium', 'Hard', 'Epic'];
export const MAX_DIFFICULTY = DIFFICULTY_LABELS.length - 1;
export const SMALL_DIFFICULTY = DIFFICULTY_LABELS.indexOf('Easy');
export const MAX_ANALYSIS = 20_000;
// Trash: deleted rows of these tables stay recoverable for TRASH_DAYS, then the server purges them (api/lib/trash.js).
export const TRASH_DAYS = 30;
export const DAY_MS = 86_400_000;
export const TRASH_MS = TRASH_DAYS * DAY_MS;
export const TRASH_TABLES = ['notes', 'projects', 'labels', 'note_groups'];

/** @typedef {{ type: 'text', max: number } | { type: 'enum', values: string[] } | { type: 'bool' } | { type: 'int', min: number, max: number } | { type: 'real', nullable?: boolean } | { type: 'id', nullable?: boolean } | { type: 'ids', max: number } | { type: 'prs', max: number } | { type: 'columns', max: number }} FieldRule */

/** Writable fields per synced table, with defaults for new rows. @type {Record<string, Record<string, FieldRule & { default: any }>>} */
export const MODELS = {
  projects: {
    name: { type: 'text', max: MAX_NAME, default: '' },
    // Shown and edited as the mission statement in project settings; agents read it from GET /api/v1/projects.
    description: { type: 'text', max: MAX_MISSION, default: '' },
    color: { type: 'enum', values: COLORS, default: 'default' },
    repo: { type: 'text', max: MAX_REPO, default: '' },
  },
  labels: {
    name: { type: 'text', max: MAX_NAME, default: '' },
    color: { type: 'enum', values: COLORS, default: 'default' },
  },
  notes: {
    project_id: { type: 'id', nullable: true, default: null },
    // Every note is a feature now; 'note' is only still accepted from older builds (the server stores it as a feature).
    kind: { type: 'enum', values: NOTE_KINDS, default: 'feature' },
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
    priority_level: { type: 'int', min: 0, max: MAX_PRIORITY, default: 0 },
    // The old 0..3 copy of priority_level, for older builds. New code never sets it; the server derives it.
    priority: { type: 'int', min: 0, max: MAX_LEGACY_PRIORITY, default: 0 },
    // Manual order from hold-and-drag. Lower sorts first; null = never placed by hand (fall back to the active sort).
    position: { type: 'real', nullable: true, default: null },
    // An agent's open question to the owner ("Needs you"). Lines "1. ..." to "9. ..." are one-key options.
    ask: { type: 'text', max: MAX_STATUS, default: '' },
    // Hidden from "Needs you" until this time (ms). Set by the owner in the app; agents can't snooze.
    snoozed_until: { type: 'real', nullable: true, default: null },
    pull_requests: { type: 'prs', max: MAX_PRS_PER_NOTE, default: [] },
    assignee: { type: 'text', max: MAX_NAME, default: '' },
    difficulty: { type: 'int', min: 0, max: MAX_DIFFICULTY, default: 0 },
    // An agent's triage notes (scope, files, plan, work done) and the batch it ships in. See POST /api/v1/notes/:id/analysis.
    analysis: { type: 'text', max: MAX_ANALYSIS, default: '' },
    batch: { type: 'text', max: MAX_NAME, default: '' },
    // Board column the feature sits in (boards.columns[].id). '' = the first column with its state.
    column_id: { type: 'text', max: MAX_ID, default: '' },
    // The note group it's in (note_groups.id). null, or a group that's gone, = not grouped.
    group_id: { type: 'id', nullable: true, default: null },
  },
  boards: {
    scope: { type: 'text', max: MAX_ID, default: FEATURES_SCOPE },
    columns: { type: 'columns', max: MAX_COLUMNS, default: DEFAULT_COLUMNS },
  },
  // Named, colored bundles of a project's notes that fold away under one header (src/lib/groups.js).
  note_groups: {
    project_id: { type: 'id', nullable: true, default: null },
    name: { type: 'text', max: MAX_NAME, default: '' },
    color: { type: 'enum', values: COLORS, default: 'default' },
    collapsed: { type: 'bool', default: false },
  },
};

// Columns only the server writes (lifecycle timestamps). Clients read them but never send them.
// purged_at: when a deleted row left the trash for good (migration 20261028100000); restoring it clears it.
/** @type {Record<string, string[]>} */
export const SERVER_FIELDS = { projects: ['name_key', 'purged_at'], labels: ['purged_at'], notes: ['started_at', 'completed_at', 'prs_checked_at', 'analyzed_at', 'purged_at', 'created_by', 'created_by_type'], boards: [], note_groups: ['purged_at'] };

// Columns stored as JSON text in D1 and as real arrays everywhere else.
export const JSON_FIELDS = ['label_ids', 'pull_requests', 'columns'];
export const BOOL_FIELDS = ['pinned', 'archived', 'public', 'collapsed'];
// Public notes are served at this path on the app's origin.
export const SHARE_PATH = '/n/';
// The one real address: GitHub OAuth only accepts callbacks there. The short names are sent to it by the app itself
// (src/main.js for pages, api/worker.js for API and share links). All four are custom domains in wrangler.jsonc.
export const APP_HOST = 'wordsmith.dogs.red';
export const SHORT_HOSTS = ['ws.dogs.red', 'word.dogs.red', 'smith.dogs.red'];

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

/**
 * The column a feature sits in: the one it was put in, while that column exists and plays the feature's state;
 * otherwise the first column for its state (an agent moved it, or its column was deleted or changed role).
 * @param {any} note @param {{ id: string, name: string, state: string }[]} columns
 */
export function columnOf(note, columns) {
  const own = columns.find((column) => column.id === note.column_id);
  if (own?.state === note.state) return own;
  return columns.find((column) => column.state === note.state) ?? columns[0];
}

/**
 * A project name folded for comparison: Unicode NFC, trimmed, lowercased, so "Café", "café" and " CAFÉ " match.
 * The server stores it as projects.name_key (unique per user among live projects); the app checks it before creating
 * or renaming. One rule everywhere, since SQLite's lower() only folds A-Z.
 * @param {unknown} name
 */
export function projectKey(name) {
  return String(name ?? '').normalize('NFC').trim().toLowerCase();
}

/** @param {unknown} value */
export const isId = (value) => typeof value === 'string' && ID_PATTERN.test(value);

/**
 * Board columns: unique ids, a name each, a known state each, and every state at least once.
 * @param {string} name @param {any[]} value
 */
function cleanColumns(name, value) {
  const columns = value.map((column) => ({ id: column?.id, name: String(column?.name ?? '').trim().slice(0, MAX_NAME), state: column?.state }));
  if (columns.some((column) => !isId(column.id) || !column.name || !FEATURE_STATES.includes(column.state))) throw new Error(`${name} need an id, a name and a state each`);
  if (new Set(columns.map((column) => column.id)).size !== columns.length) throw new Error(`${name} need unique ids`);
  if (FEATURE_STATES.some((state) => !columns.some((column) => column.state === state))) throw new Error(`${name} need at least one column for every state`);
  return columns;
}

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
  if (rule.type === 'columns') return cleanColumns(name, value);
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
