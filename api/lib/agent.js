// Agent-facing reads and writes behind /api/v1. Agents authenticate with a personal API token.
import { FEATURE_STATES, MAX_TITLE, isId, parsePullRequestUrl } from '../../src/lib/models.js';
import { presentAttachment } from './attachments.js';
import { HttpError } from './http.js';
import { refreshPullRequests } from './github.js';
import { saveNotes } from './notes.js';
import { safeJson, toApi } from './rows.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const CLAIM_CANDIDATES = 5;
const MAX_EVENTS = 200;
const STATE_LABELS = { requested: 'Requested', in_progress: 'In progress', complete: 'Complete' };

/**
 * Finds a project by id or case-insensitive name.
 * @param {Record<string, any>} env
 * @param {string} userId
 * @param {unknown} ref
 */
export async function resolveProject(env, userId, ref) {
  if (ref === undefined || ref === null || ref === '') return null;
  const row = await env.DB.prepare('SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL AND (id = ? OR lower(name) = lower(?)) LIMIT 1')
    .bind(userId, String(ref), String(ref)).first();
  if (!row) throw new HttpError(404, `No project "${ref}"`);
  return toApi(row);
}

/** Labels and projects keyed by id, for readable agent output. @param {Record<string, any>} env @param {string} userId */
async function lookups(env, userId) {
  const [projects, labels] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, repo FROM projects WHERE user_id = ? AND deleted_at IS NULL').bind(userId),
    env.DB.prepare('SELECT id, name FROM labels WHERE user_id = ? AND deleted_at IS NULL').bind(userId),
  ]);
  return {
    projects: new Map(projects.results.map((/** @type {any} */ row) => [row.id, row])),
    labels: new Map(labels.results.map((/** @type {any} */ row) => [row.id, row.name])),
  };
}

/**
 * A note as agents see it: project and label names inlined.
 * @param {Record<string, any>} note
 * @param {Awaited<ReturnType<typeof lookups>>} maps
 */
function present(note, maps) {
  const project = note.project_id ? maps.projects.get(note.project_id) : null;
  return {
    ...note,
    project: project ? { id: project.id, name: project.name, repo: project.repo } : null,
    labels: note.label_ids.map((/** @type {string} */ id) => maps.labels.get(id)).filter(Boolean),
  };
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
  const since = Number(query.get('since'));
  if (since > 0) where.push('updated_at > ?'), binds.push(since);
  const search = (query.get('q') || '').slice(0, MAX_TITLE);
  // instr, not LIKE: D1 rejects LIKE patterns over 50 bytes.
  if (search) where.push('(instr(lower(title), lower(?)) > 0 OR instr(lower(body), lower(?)) > 0)'), binds.push(search, search);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.get('limit')) || DEFAULT_LIMIT));

  const order = kind === 'feature' ? 'priority DESC, created_at ASC' : 'pinned DESC, updated_at DESC';
  const { results } = await env.DB.prepare(`SELECT * FROM notes WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`).bind(...binds, limit).all();
  const maps = await lookups(env, userId);
  const label = query.get('label');
  return results.map((row) => present(toApi(row), maps))
    .filter((note) => !label || note.labels.some((/** @type {string} */ name) => name.toLowerCase() === label.toLowerCase()));
}

/** @param {Record<string, any>} env @param {string} userId @param {string} id */
export async function getNote(env, userId, id) {
  if (!isId(id)) throw new HttpError(400, 'Bad id');
  const [notes, files] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(id, userId),
    env.DB.prepare('SELECT * FROM attachments WHERE note_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY created_at').bind(id, userId),
  ]);
  const row = notes.results[0];
  if (!row) throw new HttpError(404, 'Note not found');
  // Agents download these with the same bearer token, e.g. to look at a screenshot of the bug.
  return { ...present(toApi(row), await lookups(env, userId)), attachments: files.results.map(presentAttachment) };
}

/** Timeline for one note, oldest first. @param {Record<string, any>} env @param {string} userId @param {string} noteId */
export async function noteEvents(env, userId, noteId) {
  const { results } = await env.DB.prepare('SELECT id, type, actor_type, actor_name, data, created_at FROM note_events WHERE user_id = ? AND note_id = ? ORDER BY created_at LIMIT ?')
    .bind(userId, noteId, MAX_EVENTS).all();
  return results.map((/** @type {any} */ event) => ({ ...event, data: safeJson(event.data, {}) }));
}

/** Label names -> ids, ignoring unknown names. @param {Record<string, any>} env @param {string} userId @param {unknown} names */
async function labelIds(env, userId, names) {
  if (!Array.isArray(names)) return undefined;
  const maps = await lookups(env, userId);
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
  const patch = {
    id: crypto.randomUUID(),
    kind,
    project_id: project?.id ?? null,
    title: input.title ?? '',
    body: input.body ?? '',
    priority: input.priority ?? 0,
    status: input.status ?? '',
    label_ids: (await labelIds(env, userId, input.labels)) ?? [],
  };
  if (!patch.title && !patch.body) throw new HttpError(400, 'title or body is required');
  const [saved] = await saveNotes(env, userId, actor, [{ before: null, patch }]);
  return getNote(env, userId, saved.id);
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
  const before = await getNote(env, userId, id);
  /** @type {Record<string, any>} */
  const patch = {};
  for (const field of ['title', 'body', 'state', 'status', 'priority', 'archived', 'pinned', 'assignee']) {
    if (input[field] !== undefined) patch[field] = input[field];
  }
  if (typeof input.body_append === 'string') patch.body = `${patch.body ?? before.body}\n\n${input.body_append}`.trim();
  if (input.project !== undefined) patch.project_id = (await resolveProject(env, userId, input.project))?.id ?? null;
  const ids = await labelIds(env, userId, input.labels);
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
  return getNote(env, userId, id);
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
    ? env.DB.prepare("SELECT id FROM notes WHERE user_id = ? AND project_id = ? AND kind = 'feature' AND state = 'requested' AND deleted_at IS NULL AND archived = 0 ORDER BY priority DESC, created_at ASC LIMIT ?").bind(userId, project.id, CLAIM_CANDIDATES)
    : env.DB.prepare("SELECT id FROM notes WHERE user_id = ? AND kind = 'feature' AND state = 'requested' AND deleted_at IS NULL AND archived = 0 ORDER BY priority DESC, created_at ASC LIMIT ?").bind(userId, CLAIM_CANDIDATES);
  const { results } = await query.all();
  for (const { id } of results) {
    const claimed = await claimFeature(env, userId, actor, String(id));
    if (claimed) return claimed;
  }
  return null;
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
    for (const pr of note.pull_requests) lines.push(`  - PR (${pr.state}): ${pr.url}`);
    if (note.body) lines.push('', ...note.body.split('\n').map((/** @type {string} */ line) => `    ${line}`), '');
  }
  return lines.join('\n');
}
