// The MCP tools (api/functions/api/mcp.js). Each one is a row pointing at an /api/v1 handler, which it calls in-process
// with the caller's own auth, so MCP and REST share every check (validation, ownership, the add-only token rules) and
// can never drift. Arguments named in `path` fill the URL, the ones in `query` become ?params, the rest are the body.
import * as v1Projects from '../functions/api/v1/projects.js';
import * as v1Features from '../functions/api/v1/features/index.js';
import * as v1FeaturesNext from '../functions/api/v1/features/next.js';
import * as v1Notes from '../functions/api/v1/notes/index.js';
import * as v1Note from '../functions/api/v1/notes/[id]/index.js';
import * as v1NoteEvents from '../functions/api/v1/notes/[id]/events.js';
import * as v1NoteClaim from '../functions/api/v1/notes/[id]/claim.js';
import * as v1NoteAnalysis from '../functions/api/v1/notes/[id]/analysis.js';
import * as v1Batches from '../functions/api/v1/batches.js';
import * as v1Boards from '../functions/api/v1/boards.js';
import * as v1Labels from '../functions/api/v1/labels.js';
import * as v1Events from '../functions/api/v1/events.js';
import * as v1Context from '../functions/api/v1/context.js';
import * as v1ProjectContext from '../functions/api/v1/projects/[project]/context.js';
import { COLORS, DIFFICULTY_LABELS, FEATURE_STATES, PRIORITY_LABELS } from '../../src/lib/models.js';

const STRING = { type: 'string' };
const ID = { type: 'string', description: 'Note or feature id' };
const PROJECT = { type: 'string', description: 'Project id or name' };
const PRIORITY = { type: 'integer', minimum: 0, maximum: PRIORITY_LABELS.length - 1, description: `0 none to ${PRIORITY_LABELS.length - 1} critical` };
const DIFFICULTY = { type: 'integer', minimum: 0, maximum: DIFFICULTY_LABELS.length - 1, description: DIFFICULTY_LABELS.map((label, level) => `${level} ${label}`).join(', ') };
const LABELS = { type: 'array', items: STRING, description: 'Label names. Tokens can add labels, never remove them: send every current one plus the new ones.' };
const FORMAT = { type: 'string', enum: ['json', 'md'], description: 'md for one Markdown document' };

/**
 * @typedef {object} Tool
 * @property {string} name
 * @property {string} description
 * @property {'GET' | 'POST' | 'PATCH' | 'PUT'} method
 * @property {any} module the /api/v1 handler module
 * @property {string} path with :params filled from the arguments
 * @property {Record<string, any>} [properties] argument schemas
 * @property {string[]} [required]
 * @property {string[]} [query] arguments sent as the query string
 */

/** @type {Tool[]} */
export const TOOLS = [
  { name: 'get_context', description: "The owner's standing context: preferences, facts and pointers. Read it first, every session.", method: 'GET', module: v1Context, path: '/api/v1/context' },
  { name: 'list_projects', description: 'Projects with their mission statements (description, Markdown) and feature counts per state.', method: 'GET', module: v1Projects, path: '/api/v1/projects' },
  { name: 'get_project_context', description: "One project's whole picture in one call: mission, open features with their triage, recent events, attachment links. Load this before working a project.",
    method: 'GET', module: v1ProjectContext, path: '/api/v1/projects/:project/context', properties: { project: PROJECT, format: FORMAT, events_since: { type: 'integer', description: 'Only events after this time (ms)' }, events_limit: { type: 'integer' } },
    required: ['project'], query: ['format', 'events_since', 'events_limit'] },
  { name: 'list_features', description: 'Feature requests, most important and oldest first (the claim order).', method: 'GET', module: v1Features, path: '/api/v1/features',
    properties: { project: PROJECT, state: { type: 'string', description: `Comma-separated: ${FEATURE_STATES.join(', ')}` }, analyzed: { type: 'boolean', description: 'false: not triaged yet' }, max_difficulty: DIFFICULTY, batch: STRING, q: STRING, limit: { type: 'integer' }, format: FORMAT },
    query: ['project', 'state', 'analyzed', 'max_difficulty', 'batch', 'q', 'limit', 'format'] },
  { name: 'list_notes', description: 'Notes and features together, with search.', method: 'GET', module: v1Notes, path: '/api/v1/notes',
    properties: { q: STRING, label: STRING, project: PROJECT, limit: { type: 'integer' } }, query: ['q', 'label', 'project', 'limit'] },
  { name: 'get_note', description: 'One note or feature with its project, labels, PRs and attachments.', method: 'GET', module: v1Note, path: '/api/v1/notes/:id', properties: { id: ID }, required: ['id'] },
  { name: 'get_note_events', description: "One note's timeline, oldest first.", method: 'GET', module: v1NoteEvents, path: '/api/v1/notes/:id/events', properties: { id: ID }, required: ['id'] },
  { name: 'get_events', description: 'Everything that happened across your projects since a moment (claims, states, analyses, PRs), oldest first. Pass cursor back as since.',
    method: 'GET', module: v1Events, path: '/api/v1/events', properties: { since: { type: 'integer', description: 'Time in ms' }, limit: { type: 'integer' } }, query: ['since', 'limit'] },
  { name: 'get_analysis', description: "A note's triage: difficulty, batch, analysis notes. Read it before you start.", method: 'GET', module: v1NoteAnalysis, path: '/api/v1/notes/:id/analysis', properties: { id: ID }, required: ['id'] },
  { name: 'list_batches', description: 'Notes grouped by batch: what ships together, how much is open, which PRs carry it.', method: 'GET', module: v1Batches, path: '/api/v1/batches' },
  { name: 'list_boards', description: 'Every board with its columns in order.', method: 'GET', module: v1Boards, path: '/api/v1/boards' },
  { name: 'list_labels', description: 'Every label: id, name, color.', method: 'GET', module: v1Labels, path: '/api/v1/labels' },
  { name: 'claim_next', description: 'Claim the next requested feature (atomic: two agents never get the same one). Empty when the queue is.', method: 'POST', module: v1FeaturesNext, path: '/api/v1/features/next', properties: { project: PROJECT } },
  { name: 'claim_note', description: 'Claim one specific requested feature. Fails if it is taken.', method: 'POST', module: v1NoteClaim, path: '/api/v1/notes/:id/claim', properties: { id: ID }, required: ['id'] },
  { name: 'update_note', description: 'Report progress, ask the owner (ask), or move work along. Tokens only add: title, body and analysis can be filled while empty, then appended to (body_append); overwriting, removing labels and archiving are refused.',
    method: 'PATCH', module: v1Note, path: '/api/v1/notes/:id',
    properties: { id: ID, state: { type: 'string', enum: FEATURE_STATES }, column: { type: 'string', description: 'Board column id or name' }, status: { type: 'string', description: 'What is happening right now' }, ask: { type: 'string', description: 'A question for the owner, shown in their Needs you view. Options as "1. ..." lines. Their answer is appended to the body and ask clears.' }, pr_url: { type: 'string', description: 'https://github.com/owner/repo/pull/123' }, body_append: STRING, title: STRING, body: STRING, priority: PRIORITY, difficulty: DIFFICULTY, labels: LABELS, project: PROJECT },
    required: ['id'] },
  { name: 'post_analysis', description: 'Triage a note: difficulty, batch, and your notes (scope, files, plan, blockers, work done). analysis_append adds a paragraph.',
    method: 'POST', module: v1NoteAnalysis, path: '/api/v1/notes/:id/analysis', properties: { id: ID, difficulty: DIFFICULTY, batch: STRING, analysis: STRING, analysis_append: STRING }, required: ['id'] },
  { name: 'create_feature', description: 'File a new feature request.', method: 'POST', module: v1Features, path: '/api/v1/features',
    properties: { project: PROJECT, title: STRING, body: STRING, priority: PRIORITY, labels: LABELS }, required: ['title'] },
  { name: 'create_note', description: 'Capture a note, e.g. research to act on later.', method: 'POST', module: v1Notes, path: '/api/v1/notes', properties: { title: STRING, body: STRING, project: PROJECT, labels: LABELS } },
  { name: 'create_project', description: 'Create a project. If the name is taken, the existing project comes back: use that one.', method: 'POST', module: v1Projects, path: '/api/v1/projects',
    properties: { name: STRING, description: { type: 'string', description: 'Mission statement, Markdown' }, color: { type: 'string', enum: COLORS }, repo: { type: 'string', description: 'owner/name' } }, required: ['name'] },
];
