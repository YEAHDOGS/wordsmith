// Context for agents in as few calls as possible: one project's whole picture (mission, open features with their
// triage, recent history, attachments) in one payload, a since-feed of everything that happened across projects, and
// the owner's standing context, the one doc every agent reads before it starts.
import { featuresMarkdown, listNotes, resolveProject } from './agent.js';
import { presentAttachment } from './attachments.js';
import { HttpError } from './http.js';
import { safeJson, toApi } from './rows.js';
import { toMermaid } from '../../src/lib/diagram.js';
import { MAX_CONTEXT } from '../../src/lib/models.js';

const OPEN_STATES = 'requested,in_progress';
const MAX_FEATURES = 200;
const DEFAULT_EVENTS = 50;
const MAX_EVENTS = 200;
// Architecture diagrams carried in a project bundle, newest change first.
const MAX_BUNDLE_DIAGRAMS = 5;
// Attachment links carried in a project bundle (open features only), newest first.
const MAX_ATTACHMENTS = 500;
// A bundle past this many characters drops its oldest events, then its lowest-ranked features, and says so.
const MAX_BUNDLE_CHARS = 200_000;
const NOT_FOUND = 404;

/** @param {URLSearchParams} query @param {string} name @param {number} fallback @param {number} max */
function bounded(query, name, fallback, max) {
  return Math.min(max, Math.max(1, Number(query.get(name)) || fallback));
}

/** One timeline row as agents read it. @param {any} row */
const presentEvent = (row) => ({ ...row, data: safeJson(row.data, {}) });

/**
 * Everything that happened since a moment, across the caller's projects: claims, state changes, analyses, PRs.
 * Oldest first; pass `cursor` back as `since` and `after` back as `after` to continue. Several events often share one
 * timestamp (a save stamps all of its events alike), so the page boundary is a (time, id) pair: `after` is the id of
 * the last event returned, and the next page resumes inside that timestamp instead of skipping the rest of it.
 * @param {Record<string, any>} env @param {string} userId @param {URLSearchParams} query
 */
export async function eventsFeed(env, userId, query) {
  const since = Math.max(0, Number(query.get('since')) || 0);
  const after = query.get('after') || '';
  const limit = bounded(query, 'limit', DEFAULT_EVENTS, MAX_EVENTS);
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.note_id, n.title AS note_title, n.project_id, e.type, e.actor_type, e.actor_name, e.data, e.created_at
     FROM note_events e LEFT JOIN notes n ON n.id = e.note_id AND n.user_id = e.user_id
     WHERE e.user_id = ?1 AND (e.created_at > ?2 OR (?3 != '' AND e.created_at = ?2 AND e.id > ?3)) ORDER BY e.created_at, e.id LIMIT ?4`,
  ).bind(userId, since, after, limit + 1).all();
  const more = results.length > limit;
  const events = results.slice(0, limit).map(presentEvent);
  const last = events.at(-1);
  return { events, cursor: last ? last.created_at : since, after: last ? last.id : after, more };
}

/**
 * One project's whole working picture: its mission statement, every open feature with its analysis, recent events and
 * attachment links. Large projects are cut down predictably (truncated says what was dropped).
 * @param {Record<string, any>} env @param {string} userId @param {string} ref project id or name @param {URLSearchParams} query
 */
export async function projectContext(env, userId, ref, query) {
  const project = await resolveProject(env, userId, ref);
  if (!project) throw new HttpError(NOT_FOUND, 'Project not found');
  const features = await listNotes(env, userId, new URLSearchParams({ project: project.id, state: OPEN_STATES, limit: String(MAX_FEATURES) }), 'feature');
  const since = Math.max(0, Number(query.get('events_since')) || 0);
  // Joined on the project rather than listing note ids: D1 caps bound parameters at 100.
  const { results: files } = await env.DB.prepare(
    `SELECT a.* FROM attachments a JOIN notes n ON n.id = a.note_id AND n.user_id = a.user_id
     WHERE a.user_id = ? AND n.project_id = ? AND a.deleted_at IS NULL AND n.deleted_at IS NULL AND n.state != 'complete' AND n.archived = 0
     ORDER BY a.created_at DESC LIMIT ?`,
  ).bind(userId, project.id, MAX_ATTACHMENTS).all();
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.note_id, n.title AS note_title, e.type, e.actor_type, e.actor_name, e.data, e.created_at
     FROM note_events e JOIN notes n ON n.id = e.note_id AND n.user_id = e.user_id
     WHERE e.user_id = ? AND n.project_id = ? AND e.created_at > ? ORDER BY e.created_at DESC LIMIT ?`,
  ).bind(userId, project.id, since, bounded(query, 'events_limit', DEFAULT_EVENTS, MAX_EVENTS)).all();
  const { results: drawn } = await env.DB.prepare('SELECT * FROM diagrams WHERE user_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?')
    .bind(userId, project.id, MAX_BUNDLE_DIAGRAMS).all();
  const bundle = {
    project: { id: project.id, name: project.name, repo: project.repo, mission: project.description },
    // The project's architecture as Mermaid source; GET /api/v1/diagrams/:id has the boxes and arrows themselves.
    diagrams: drawn.map(toApi).map((diagram) => ({ id: diagram.id, name: diagram.name, description: diagram.description, mermaid: toMermaid(/** @type {any} */ (diagram)) })),
    features: features.map((note) => ({ ...note, attachments: files.filter((file) => file.note_id === note.id).map(presentAttachment) })),
    events: results.map(presentEvent).reverse(),
    truncated: { events: 0, features: 0 },
  };
  // Over the cap: oldest events go first, then the features at the end of the claim order.
  while (JSON.stringify(bundle).length > MAX_BUNDLE_CHARS && (bundle.events.length || bundle.features.length > 1)) {
    if (bundle.events.length) bundle.events.shift(), bundle.truncated.events++;
    else bundle.features.pop(), bundle.truncated.features++;
  }
  return bundle;
}

/** The bundle as one Markdown document, ready to drop into an agent's context. @param {Awaited<ReturnType<typeof projectContext>>} bundle */
export function projectContextMarkdown(bundle) {
  const { project, diagrams, features, events, truncated } = bundle;
  const lines = [`# ${project.name}${project.repo ? ` (${project.repo})` : ''}`, '', '## Mission', '', project.mission || '_No mission statement yet._', ''];
  for (const diagram of diagrams) {
    lines.push(`## Architecture: ${diagram.name || 'Untitled'} (diagram ${diagram.id})`, '', ...(diagram.description ? [diagram.description, ''] : []), '```mermaid', diagram.mermaid, '```', '');
  }
  lines.push(`## Open features (${features.length}, claim order)`, '', featuresMarkdown(features).split('\n').slice(2).join('\n'), '');
  lines.push(`## Recent events (${events.length})`, '');
  for (const event of events) {
    lines.push(`- ${new Date(event.created_at).toISOString()} ${event.actor_name} ${event.type} "${event.note_title || 'Untitled'}"${Object.keys(event.data).length ? ` ${JSON.stringify(event.data)}` : ''}`);
  }
  if (truncated.events || truncated.features) lines.push('', `_Cut to fit: ${truncated.features} features and ${truncated.events} older events left out. Narrow with events_since or read features one by one._`);
  return lines.join('\n');
}

/** The owner's standing context, '' when there is none. @param {Record<string, any>} env @param {string} userId */
export async function readContext(env, userId) {
  const row = await env.DB.prepare('SELECT body, updated_at FROM user_context WHERE user_id = ?').bind(userId).first();
  return { body: String(row?.body ?? ''), updated_at: row ? Number(row.updated_at) : null };
}

/** Saves the owner's standing context (people only; the route refuses agent tokens). @param {Record<string, any>} env @param {string} userId @param {unknown} body */
export async function writeContext(env, userId, body) {
  if (typeof body !== 'string') throw new HttpError(400, 'body must be a string');
  if (body.length > MAX_CONTEXT) throw new HttpError(413, `Standing context is limited to ${MAX_CONTEXT} characters`);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO user_context (user_id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at')
    .bind(userId, body, now).run();
  return { body, updated_at: now };
}
