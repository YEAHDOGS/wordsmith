// Agent-facing reads and writes behind /api/v1. Agents authenticate with a personal API token.
import { DEFAULT_COLUMNS, DIFFICULTY_LABELS, FEATURES_SCOPE, FEATURE_STATES, MAX_DIFFICULTY, MAX_TITLE, MAX_PROJECTS, STATE_LABELS, cleanRow, columnOf, isId, newRow, parsePullRequestUrl, projectKey } from '../../src/lib/models.js';
import { presentAttachment } from './attachments.js';
import { HttpError } from './http.js';
import { refreshPullRequests } from './github.js';
import { saveNotes } from './notes.js';
import { safeJson, toApi } from './rows.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const CLAIM_CANDIDATES = 5;
const MAX_EVENTS = 200;
const MAX_BATCH_NOTES = 500;
// Triage fields an agent can write, through PATCH or the analysis endpoint.
const TRIAGE_FIELDS = ['difficulty', 'analysis', 'batch'];
// A GitHub repo as owner/name, the form the app stores in projects.repo: owner letters, digits and hyphens; the repo
// name not '.' or '..'.
const REPO_PATTERN = /^[A-Za-z0-9-]+\/(?!\.\.?$)[\w.-]+$/;
// Claim order for features: priority first, then hand-placed order (src/lib/reorder.svelte.js orderKey), then age.
const CLAIM_ORDER = 'priority_level DESC, COALESCE(position, created_at) ASC, created_at ASC';

/**
 * Finds a project by id or case-insensitive name.
 * @param {Record<string, any>} env
 * @param {string} userId
 * @param {unknown} ref
 */
export async function resolveProject(env, userId, ref) {
  if (ref === undefined || ref === null || ref === '') return null;
  const key = projectKey(ref);
  // By id, or by name_key (indexed; the usual case).
  const direct = await env.DB.prepare('SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL AND (id = ? OR name_key = ?) LIMIT 1')
    .bind(userId, String(ref), key).first();
  if (direct) return toApi(direct);
  // Miss: compare live names with projectKey (at most MAX_PROJECTS rows). Catches keys an old Worker left empty and legacy
  // non-ASCII names the migration's SQL backfill folded A-Z only.
  const { results } = await env.DB.prepare('SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL').bind(userId).all();
  const named = results.find((/** @type {any} */ project) => projectKey(project.name) === key);
  if (!named) throw new HttpError(404, `No project "${ref}"`);
  return toApi(named);
}

/**
 * Creates a project for an agent: { name, description?, color?, repo? (owner/name) }. Names are unique per user
 * (projectKey: Unicode, case-insensitive, trimmed), so an agent asking for a project it already has gets
 * { existing } back and can use that one. The duplicate check, the MAX_PROJECTS cap and the insert are one statement,
 * so two agents creating the same name at once can't both succeed.
 * @param {Record<string, any>} env
 * @param {string} userId
 * @param {unknown} input
 * @returns {Promise<{ project: Record<string, any> } | { existing: { id: string, name: string } }>}
 */
export async function createProject(env, userId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Send a JSON object: { name, description?, color?, repo? }');
  const body = /** @type {Record<string, unknown>} */ (input);
  for (const field of ['name', 'description', 'color', 'repo']) {
    if (body[field] !== undefined && typeof body[field] !== 'string') throw new HttpError(400, `${field} must be text`);
  }
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'name is required');
  const repo = String(body.repo ?? '').trim();
  if (repo && !REPO_PATTERN.test(repo)) throw new HttpError(400, 'repo must look like owner/name');
  let fields;
  try {
    fields = cleanRow('projects', { name, repo, description: body.description ?? '', color: body.color ?? 'default' });
  } catch (error) {
    throw new HttpError(400, /** @type {Error} */ (error).message);
  }
  const key = projectKey(name);
  // Compare with every live name using projectKey first (at most MAX_PROJECTS rows): name_key can be missing (an old
  // Worker mid-deploy) or folded A-Z only (the migration's backfill), and the atomic insert below only sees name_key.
  const { results: live } = await env.DB.prepare('SELECT id, name FROM projects WHERE user_id = ? AND deleted_at IS NULL').bind(userId).all();
  const same = live.find((/** @type {any} */ project) => projectKey(project.name) === key);
  if (same) return { existing: { id: String(same.id), name: String(same.name) } };
  const row = { ...newRow('projects', fields), user_id: userId, name_key: key };
  const columns = Object.keys(row);
  const result = await env.DB.prepare(
    `INSERT INTO projects (${columns.join(', ')}) SELECT ${columns.map(() => '?').join(', ')}
     WHERE NOT EXISTS (SELECT 1 FROM projects WHERE user_id = ? AND deleted_at IS NULL AND name_key = ?)
       AND (SELECT COUNT(*) FROM projects WHERE user_id = ? AND deleted_at IS NULL) < ?`,
  ).bind(...columns.map((column) => row[column]), userId, key, userId, MAX_PROJECTS).run()
    // The unique index (user_id, name_key) caught a write that slipped in between: same answer as a taken name.
    .catch((/** @type {Error} */ error) => { if (/UNIQUE/i.test(error.message)) return { meta: { changes: 0 } }; throw error; });
  if (result.meta.changes) {
    const { user_id: _owner, ...project } = row;
    return { project };
  }
  const existing = await env.DB.prepare('SELECT id, name FROM projects WHERE user_id = ? AND deleted_at IS NULL AND name_key = ? LIMIT 1').bind(userId, key).first();
  if (!existing) throw new HttpError(409, `You can have at most ${MAX_PROJECTS} projects`);
  return { existing: { id: String(existing.id), name: String(existing.name) } };
}
/** Labels, projects and board columns keyed by id or scope, for readable agent output. @param {Record<string, any>} env @param {string} userId */
async function lookups(env, userId) {
  const [projects, labels, boards] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, repo FROM projects WHERE user_id = ? AND deleted_at IS NULL').bind(userId),
    env.DB.prepare('SELECT id, name, color FROM labels WHERE user_id = ? AND deleted_at IS NULL').bind(userId),
    env.DB.prepare('SELECT scope, columns FROM boards WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at').bind(userId),
  ]);
  /** @type {Map<string, { id: string, name: string, state: string }[]>} */
  const columns = new Map();
  // First board per scope wins, the same as the app (src/lib/board.js columnsFor).
  for (const row of boards.results) if (!columns.has(row.scope)) columns.set(row.scope, safeJson(row.columns, DEFAULT_COLUMNS));
  return {
    projects: new Map(projects.results.map((/** @type {any} */ row) => [row.id, row])),
    labels: new Map(labels.results.map((/** @type {any} */ row) => [row.id, row.name])),
    labelRows: labels.results,
    columns,
  };
}

/** The columns of a note's board: its project's, or the Features page's. @param {Awaited<ReturnType<typeof lookups>>} maps @param {string | null} projectId */
function boardOf(maps, projectId) {
  const scope = projectId || FEATURES_SCOPE;
  return { scope, columns: maps.columns.get(scope) ?? DEFAULT_COLUMNS };
}

/**
 * A note as agents see it: project, label and board column names inlined, and priority on the 0..5 scale (the same
 * value as priority_level; the old 0..3 column that older app builds still use is not shown to agents).
 * @param {Record<string, any>} note
 * @param {Awaited<ReturnType<typeof lookups>>} maps
 */
function present(note, maps) {
  const project = note.project_id ? maps.projects.get(note.project_id) : null;
  const column = columnOf(note, boardOf(maps, note.project_id).columns);
  return {
    ...note,
    priority: note.priority_level,
    project: project ? { id: project.id, name: project.name, repo: project.repo } : null,
    labels: note.label_ids.map((/** @type {string} */ id) => maps.labels.get(id)).filter(Boolean),
    column: column ? { id: column.id, name: column.name, state: column.state } : null,
  };
}

/** Every board: the Features page and each project, with its columns (the default three if never edited). @param {Record<string, any>} env @param {string} userId */
export async function listBoards(env, userId) {
  const maps = await lookups(env, userId);
  const scopes = [{ scope: FEATURES_SCOPE, project: null }, ...[...maps.projects.values()].map((project) => ({ scope: project.id, project: { id: project.id, name: project.name } }))];
  return scopes.map(({ scope, project }) => ({ scope, project, custom: maps.columns.has(scope), columns: maps.columns.get(scope) ?? DEFAULT_COLUMNS }));
}

/** Every label. @param {Record<string, any>} env @param {string} userId */
export async function listLabels(env, userId) {
  return (await lookups(env, userId)).labelRows;
}

/**
 * Lists notes or features with filters from the query string.
 * @param {Record<string, any>} env
 * @param {string} userId
 * @param {URLSearchParams} query
 * @param {'note' | 'feature' | null} kind
 */
export async function listNotes(env, userId, query, kind) {
  const where = ['user_id = ?', 'deleted_at IS NULL'];
  /** @type {any[]} */
  const binds = [userId];
  if (kind) where.push('kind = ?'), binds.push(kind);
  if (query.get('archived') !== 'true') where.push('archived = 0');
  const project = await resolveProject(env, userId, query.get('project'));
  if (project) where.push('project_id = ?'), binds.push(project.id);
  const states = (query.get('state') || '').split(',').filter((state) => FEATURE_STATES.includes(state));
  if (states.length) where.push(`state IN (${states.map(() => '?').join(', ')})`), binds.push(...states);
  // Triage filters: one batch, unanalyzed only (analyzed=false), or at most some difficulty (max_difficulty=2).
  if (query.has('batch')) where.push('batch = ?'), binds.push(query.get('batch'));
  if (query.get('analyzed') === 'false') where.push('analyzed_at IS NULL');
  if (query.get('analyzed') === 'true') where.push('analyzed_at IS NOT NULL');
  const maxDifficulty = Number(query.get('max_difficulty'));
  if (query.has('max_difficulty') && Number.isInteger(maxDifficulty)) where.push('difficulty BETWEEN 1 AND ?'), binds.push(Math.min(MAX_DIFFICULTY, maxDifficulty));
  const since = Number(query.get('since'));
  if (since > 0) where.push('updated_at > ?'), binds.push(since);
  const search = (query.get('q') || '').slice(0, MAX_TITLE);
  // instr, not LIKE: D1 rejects LIKE patterns over 50 bytes.
  if (search) where.push('(instr(lower(title), lower(?)) > 0 OR instr(lower(body), lower(?)) > 0)'), binds.push(search, search);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.get('limit')) || DEFAULT_LIMIT));

  const order = kind === 'feature' ? CLAIM_ORDER : 'pinned DESC, updated_at DESC';
  const { results } = await env.DB.prepare(`SELECT * FROM notes WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`).bind(...binds, limit).all();
  const maps = await lookups(env, userId);
  const label = query.get('label');
  return results.map((row) => present(toApi(row), maps))
    .filter((note) => !label || note.labels.some((/** @type {string} */ name) => name.toLowerCase() === label.toLowerCase()));
}

/**
 * One note with its attachments, as agents see it.
 * @param {Record<string, any>} env @param {string} userId @param {string} id
 * @param {Awaited<ReturnType<typeof lookups>> | null} [maps] reuse a lookup the caller already made
 */
export async function getNote(env, userId, id, maps = null) {
  if (!isId(id)) throw new HttpError(400, 'Bad id');
  const [notes, files] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(id, userId),
    env.DB.prepare('SELECT * FROM attachments WHERE note_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY created_at').bind(id, userId),
  ]);
  const row = notes.results[0];
  if (!row) throw new HttpError(404, 'Note not found');
  // Agents download these with the same bearer token, e.g. to look at a screenshot of the bug.
  return { ...present(toApi(row), maps ?? await lookups(env, userId)), attachments: files.results.map(presentAttachment) };
}

/** Timeline for one note, oldest first. @param {Record<string, any>} env @param {string} userId @param {string} noteId */
export async function noteEvents(env, userId, noteId) {
  const { results } = await env.DB.prepare('SELECT id, type, actor_type, actor_name, data, created_at FROM note_events WHERE user_id = ? AND note_id = ? ORDER BY created_at LIMIT ?')
    .bind(userId, noteId, MAX_EVENTS).all();
  return results.map((/** @type {any} */ event) => ({ ...event, data: safeJson(event.data, {}) }));
}

/** Label names -> ids, ignoring unknown names. @param {Awaited<ReturnType<typeof lookups>>} maps @param {unknown} names */
function labelIds(maps, names) {
  if (!Array.isArray(names)) return undefined;
  const wanted = names.map((name) => String(name).toLowerCase());
  return [...maps.labels].filter(([, name]) => wanted.includes(String(name).toLowerCase())).map(([id]) => id);
}

/**
 * Creates a note or feature from an agent or script.
 * @param {Record<string, any>} env
 * @param {string} userId
 * @param {import('./notes.js').Actor} actor
 * @param {Record<string, any>} input
 * @param {'note' | 'feature'} kind
 */
export async function createNote(env, userId, actor, input, kind) {
  const project = await resolveProject(env, userId, input.project);
  const maps = await lookups(env, userId);
  const patch = {
    id: crypto.randomUUID(),
    kind,
    project_id: project?.id ?? null,
    title: input.title ?? '',
    body: input.body ?? '',
    priority_level: input.priority ?? 0,
    status: input.status ?? '',
    label_ids: labelIds(maps, input.labels) ?? [],
  };
  if (!patch.title && !patch.body) throw new HttpError(400, 'title or body is required');
  const [saved] = await saveNotes(env, userId, actor, [{ before: null, patch }]);
  return getNote(env, userId, saved.id, maps);
}

/**
 * Updates a note. Besides plain fields, agents can send pr_url (attach a PR), body_append and labels by name.
 * @param {Record<string, any>} env
 * @param {string} userId
 * @param {import('./notes.js').Actor} actor
 * @param {string} id
 * @param {Record<string, any>} input
 */
export async function updateNote(env, userId, actor, id, input) {
  // One lookup of projects, labels and boards serves the whole update (it used to run up to four times).
  const maps = await lookups(env, userId);
  const before = await getNote(env, userId, id, maps);
  /** @type {Record<string, any>} */
  const patch = {};
  for (const field of ['title', 'body', 'state', 'status', 'archived', 'pinned', 'assignee', ...TRIAGE_FIELDS]) {
    if (input[field] !== undefined) patch[field] = input[field];
  }
  if (typeof input.analysis_append === 'string') patch.analysis = `${patch.analysis ?? before.analysis}\n\n${input.analysis_append}`.trim();
  // Agents speak the 0..5 scale as "priority"; it is stored as priority_level.
  if (input.priority !== undefined) patch.priority_level = input.priority;
  if (typeof input.body_append === 'string') patch.body = `${patch.body ?? before.body}\n\n${input.body_append}`.trim();
  if (input.project !== undefined) patch.project_id = (await resolveProject(env, userId, input.project))?.id ?? null;
  // Move to a column (id or name) on the note's board, its project's or the Features page's; the column's role sets the state.
  if (input.column !== undefined) {
    const { columns } = boardOf(maps, patch.project_id !== undefined ? patch.project_id : before.project?.id ?? null);
    const wanted = String(input.column).toLowerCase();
    const column = columns.find((entry) => entry.id === input.column || entry.name.toLowerCase() === wanted);
    if (!column) throw new HttpError(400, `No column "${input.column}" on this board. GET /api/v1/boards lists them.`);
    Object.assign(patch, { column_id: column.id, state: column.state });
  }
  const ids = labelIds(maps, input.labels);
  if (ids) patch.label_ids = ids;

  let linkedPr = false;
  if (input.pr_url !== undefined) {
    const pr = parsePullRequestUrl(input.pr_url);
    if (!pr) throw new HttpError(400, 'pr_url must look like https://github.com/owner/repo/pull/123');
    if (!before.pull_requests.some((/** @type {any} */ existing) => existing.url === pr.url)) {
      patch.pull_requests = [...before.pull_requests, { ...pr, title: '', state: 'open', merged_at: null }];
      linkedPr = true;
    }
  }
  await saveNotes(env, userId, actor, [{ before, patch }]);
  // Look the new PR up right away so its title and state show up without waiting for the next poll.
  if (linkedPr) await refreshPullRequests(env, userId, [id]).catch(() => []);
  return getNote(env, userId, id, maps);
}

/**
 * Atomically moves a requested feature to in_progress for one agent. Returns null if someone else got it first.
 * @param {Record<string, any>} env
 * @param {string} userId
 * @param {import('./notes.js').Actor} actor
 * @param {string} id
 */
export async function claimFeature(env, userId, actor, id) {
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE notes SET state = 'in_progress', assignee = ?, started_at = COALESCE(started_at, ?), updated_at = ?
     WHERE id = ? AND user_id = ? AND kind = 'feature' AND state = 'requested' AND deleted_at IS NULL AND archived = 0`,
  ).bind(actor.name, now, now, id, userId).run();
  if (!result.meta.changes) return null;
  const insert = 'INSERT INTO note_events (id, user_id, note_id, type, actor_type, actor_name, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  await env.DB.batch([
    env.DB.prepare(insert).bind(crypto.randomUUID(), userId, id, 'claimed', actor.type, actor.name, JSON.stringify({ by: actor.name }), now),
    env.DB.prepare(insert).bind(crypto.randomUUID(), userId, id, 'state', actor.type, actor.name, JSON.stringify({ from: 'requested', to: 'in_progress' }), now),
  ]);
  return getNote(env, userId, id);
}

/**
 * Claims the most important, oldest requested feature (optionally within one project).
 * @param {Record<string, any>} env
 * @param {string} userId
 * @param {import('./notes.js').Actor} actor
 * @param {unknown} projectRef
 */
export async function claimNext(env, userId, actor, projectRef) {
  const project = await resolveProject(env, userId, projectRef);
  const query = project
    ? env.DB.prepare(`SELECT id FROM notes WHERE user_id = ? AND project_id = ? AND kind = 'feature' AND state = 'requested' AND deleted_at IS NULL AND archived = 0 ORDER BY ${CLAIM_ORDER} LIMIT ?`).bind(userId, project.id, CLAIM_CANDIDATES)
    : env.DB.prepare(`SELECT id FROM notes WHERE user_id = ? AND kind = 'feature' AND state = 'requested' AND deleted_at IS NULL AND archived = 0 ORDER BY ${CLAIM_ORDER} LIMIT ?`).bind(userId, CLAIM_CANDIDATES);
  const { results } = await query.all();
  for (const { id } of results) {
    const claimed = await claimFeature(env, userId, actor, String(id));
    if (claimed) return claimed;
  }
  return null;
}

/**
 * Notes grouped by batch, so an agent sees what ships together, what's done and which PRs carry it. Batches with
 * open work come first, then newest triage first.
 * @param {Record<string, any>} env
 * @param {string} userId
 */
export async function listBatches(env, userId) {
  const { results } = await env.DB.prepare(`SELECT * FROM notes WHERE user_id = ? AND batch != '' AND deleted_at IS NULL ORDER BY ${CLAIM_ORDER} LIMIT ?`)
    .bind(userId, MAX_BATCH_NOTES).all();
  const maps = await lookups(env, userId);
  /** @type {Map<string, { batch: string, open: number, analyzed_at: number, pull_requests: string[], notes: any[] }>} */
  const batches = new Map();
  for (const row of results) {
    const note = present(toApi(row), maps);
    if (!batches.has(note.batch)) batches.set(note.batch, { batch: note.batch, open: 0, analyzed_at: 0, pull_requests: [], notes: [] });
    const group = /** @type {any} */ (batches.get(note.batch));
    if (note.state !== 'complete') group.open++;
    group.analyzed_at = Math.max(group.analyzed_at, note.analyzed_at || 0);
    for (const pr of note.pull_requests) if (!group.pull_requests.includes(pr.url)) group.pull_requests.push(pr.url);
    group.notes.push({ id: note.id, title: note.title, state: note.state, priority: note.priority, difficulty: note.difficulty, status: note.status, project: note.project?.name ?? null });
  }
  return [...batches.values()].sort((a, b) => Number(b.open > 0) - Number(a.open > 0) || b.analyzed_at - a.analyzed_at);
}

/**
 * Markdown checklist of features, easy to paste into an agent prompt.
 * @param {Record<string, any>[]} features
 */
export function featuresMarkdown(features) {
  const iso = (/** @type {number | null} */ ms) => (ms ? new Date(ms).toISOString() : '');
  const lines = ['# wordsmith feature requests', ''];
  for (const note of features) {
    const box = note.state === 'complete' ? 'x' : ' ';
    lines.push(`- [${box}] **${note.title || 'Untitled'}** (${STATE_LABELS[/** @type {keyof typeof STATE_LABELS} */ (note.state)]}, priority ${note.priority}) id: \`${note.id}\``);
    if (note.project) lines.push(`  - project: ${note.project.name}${note.project.repo ? ` (${note.project.repo})` : ''}`);
    lines.push(`  - requested: ${iso(note.created_at)}${note.started_at ? `, started: ${iso(note.started_at)}` : ''}${note.completed_at ? `, completed: ${iso(note.completed_at)}` : ''}`);
    if (note.assignee) lines.push(`  - assignee: ${note.assignee}`);
    if (note.status) lines.push(`  - status: ${note.status}`);
    if (note.difficulty) lines.push(`  - difficulty: ${note.difficulty} (${DIFFICULTY_LABELS[note.difficulty]})`);
    if (note.batch) lines.push(`  - batch: ${note.batch}`);
    if (note.analysis) lines.push('  - analysis:', ...note.analysis.split('\n').map((/** @type {string} */ line) => `    > ${line}`));
    for (const pr of note.pull_requests) lines.push(`  - PR (${pr.state}): ${pr.url}`);
    if (note.body) lines.push('', ...note.body.split('\n').map((/** @type {string} */ line) => `    ${line}`), '');
  }
  return lines.join('\n');
}
