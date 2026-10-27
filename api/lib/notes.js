// Every note write (app sync, agent API, PR poll, GitHub webhook) goes through saveNotes, which applies the
// feature lifecycle, stamps started_at / completed_at and appends note_events in the same D1 batch.
import { LEGACY_PRIORITY, cleanRow, newRow } from '../../src/lib/models.js';
import { HttpError } from './http.js';
import { upsertStatement } from './rows.js';

// Autosave sends many small edits; only one "edited" event is logged per note per window.
const EDIT_EVENT_WINDOW_MS = 600_000;
const STATE_IN_PROGRESS = 'in_progress';
const STATE_COMPLETE = 'complete';

/** @typedef {{ type: 'user' | 'agent' | 'github', name: string }} Actor */

/** Who is acting, for the timeline. @param {import('./auth.js').Auth} auth @param {string} [tokenName] @returns {Actor} */
export function actorFor(auth, tokenName = '') {
  return auth.via === 'token' ? { type: 'agent', name: tokenName || 'agent' } : { type: 'user', name: auth.user.name || 'you' };
}

/** Looks up the name of the API token in use, so agent events say which agent acted. @param {Record<string, any>} env @param {import('./auth.js').Auth} auth */
export async function actorForRequest(env, auth) {
  if (auth.via !== 'token') return actorFor(auth);
  const row = await env.DB.prepare('SELECT name FROM api_tokens WHERE token_hash = ?').bind(auth.tokenHash).first();
  return actorFor(auth, row?.name);
}

/**
 * Applies lifecycle rules to the next version of a note and lists the events the change produced.
 * @param {Record<string, any> | null} before
 * @param {Record<string, any>} after mutated in place
 * @param {number} now
 * @param {Actor} actor
 */
function lifecycle(before, after, now, actor) {
  /** @type {{ type: string, data: Record<string, any>, actor?: Actor }[]} */
  const events = [];
  if (!before) events.push({ type: 'created', data: { kind: after.kind, state: after.state } });

  const beforePrs = new Map((before?.pull_requests || []).map((/** @type {any} */ pr) => [pr.url, pr]));
  for (const pr of after.pull_requests) {
    const previous = beforePrs.get(pr.url);
    if (!previous) events.push({ type: 'pr_linked', data: { url: pr.url, number: pr.number, repo: pr.repo } });
    if (pr.state === 'merged' && previous?.state !== 'merged') events.push({ type: 'pr_merged', data: { url: pr.url, merged_at: pr.merged_at } });
    if (pr.state === 'closed' && previous && previous.state !== 'closed') events.push({ type: 'pr_closed', data: { url: pr.url } });
  }

  // Every linked PR merged -> the feature files itself away as complete.
  const prs = after.pull_requests;
  const allMerged = after.kind === 'feature' && prs.length > 0 && prs.every((/** @type {any} */ pr) => pr.state === 'merged');
  const newlyMerged = prs.some((/** @type {any} */ pr) => pr.state === 'merged' && beforePrs.get(pr.url)?.state !== 'merged');
  if (allMerged && newlyMerged && after.state !== STATE_COMPLETE) {
    after.state = STATE_COMPLETE;
    events.push({ type: 'state', data: { from: before?.state ?? 'requested', to: STATE_COMPLETE, reason: 'all pull requests merged' }, actor: { type: 'github', name: 'github' } });
  } else if (before && before.state !== after.state) {
    events.push({ type: 'state', data: { from: before.state, to: after.state } });
  }

  if (after.state === STATE_IN_PROGRESS && !after.started_at) after.started_at = now;
  if (after.state === STATE_COMPLETE && !after.completed_at) after.completed_at = now;
  if (after.state !== STATE_COMPLETE) after.completed_at = null;

  if (!before) return events;
  // Triage written or changed (POST /api/v1/notes/:id/analysis, or PATCH): stamp it and put it on the timeline.
  if (!after.deleted_at && ((before.analysis ?? '') !== after.analysis || (before.batch ?? '') !== after.batch)) {
    after.analyzed_at = now;
    events.push({ type: 'analyzed', data: { difficulty: after.difficulty, batch: after.batch } });
  }
  if (before.status !== after.status && after.status) events.push({ type: 'status', data: { text: after.status } });
  if (before.assignee !== after.assignee && after.assignee) events.push({ type: 'assigned', data: { to: after.assignee } });
  if (Boolean(before.public) !== Boolean(after.public)) events.push({ type: after.public ? 'published' : 'unpublished', data: {} });
  if (before.archived !== after.archived) events.push({ type: after.archived ? 'archived' : 'unarchived', data: {} });
  if (!before.deleted_at && after.deleted_at) events.push({ type: 'deleted', data: {} });
  if (before.deleted_at && !after.deleted_at) events.push({ type: 'restored', data: {} });
  const contentChanged = before.title !== after.title || before.body !== after.body;
  if (contentChanged && now - before.updated_at > EDIT_EVENT_WINDOW_MS && actor.type !== 'github') events.push({ type: 'edited', data: {} });
  return events;
}

/**
 * Validates and saves note changes with their timeline events in one batch.
 * @param {Record<string, any>} env
 * @param {string} userId
 * @param {Actor} actor
 * @param {{ before: Record<string, any> | null, patch: Record<string, any>, extraEvents?: { type: string, data: Record<string, any> }[] }[]} changes
 * @returns {Promise<Record<string, any>[]>} saved notes, API shaped
 */
export async function saveNotes(env, userId, actor, changes) {
  const now = Date.now();
  const statements = [];
  const saved = [];
  for (const { before, patch, extraEvents = [] } of changes) {
    // A bad field from an agent (difficulty 9, unknown state) is the caller's mistake: 400 with the reason, not a 500.
    let cleaned;
    try {
      cleaned = cleanRow('notes', patch);
    } catch (error) {
      throw new HttpError(400, /** @type {Error} */ (error).message);
    }
    // Publishing is the owner's call: agent tokens and GitHub can never make a note public.
    if (actor.type !== 'user') delete cleaned.public;
    const base = before ?? newRow('notes', { id: patch.id, created_at: Math.min(Number(patch.created_at) || now, now) });
    const after = { ...base, ...cleaned, user_id: userId, updated_at: now };
    if (patch.deleted_at !== undefined) after.deleted_at = patch.deleted_at ? Math.min(Number(patch.deleted_at), now) : null;
    // Deleted notes keep only their tombstone on the server.
    if (after.deleted_at) Object.assign(after, { title: '', body: '', analysis: '', public: false });
    if (patch.prs_checked_at !== undefined) after.prs_checked_at = patch.prs_checked_at;
    // Two priority columns while old builds are around (migration 20261027040000): a patch without priority_level
    // comes from an old build, or a row cached before the upgrade, so a changed old-scale value is converted up.
    // Either way the old column then follows the level.
    if (cleaned.priority_level === undefined && cleaned.priority !== undefined && cleaned.priority !== (before?.priority ?? 0)) {
      after.priority_level = Math.max(0, LEGACY_PRIORITY.indexOf(cleaned.priority));
    }
    after.priority = LEGACY_PRIORITY[after.priority_level] ?? 0;

    const events = [...extraEvents, ...lifecycle(before, after, now, actor)];
    statements.push(upsertStatement(env, 'notes', after));
    for (const event of events) {
      const who = /** @type {any} */ (event).actor ?? actor;
      statements.push(env.DB.prepare('INSERT INTO note_events (id, user_id, note_id, type, actor_type, actor_name, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), userId, after.id, event.type, who.type, who.name, JSON.stringify(event.data), now));
    }
    const { user_id: _owner, ...apiRow } = after;
    saved.push(apiRow);
  }
  if (statements.length) await env.DB.batch(statements);
  return saved;
}
