// GET /api/v1/notes/:id/analysis - an agent's triage of one note. POST - write it:
// { difficulty? (0 unrated, 1 trivial to 5 epic), batch?, analysis? (replaces), analysis_append? (adds a paragraph) }.
// Stamps analyzed_at and logs an "analyzed" timeline event, so the next agent can see what was decided and when.
import { getNote, updateNote } from '../../../../../lib/agent.js';
import { json, readJson } from '../../../../../lib/http.js';
import { DIFFICULTY_LABELS } from '../../../../../../src/lib/models.js';

const WRITABLE = ['difficulty', 'batch', 'analysis', 'analysis_append'];

/** The triage part of a note. @param {Record<string, any>} note */
function triage(note) {
  const { id, title, state, status, priority, difficulty, batch, analysis, analyzed_at, pull_requests } = note;
  return { id, title, state, status, priority, difficulty, difficulty_label: DIFFICULTY_LABELS[difficulty], batch, analysis, analyzed_at, pull_requests };
}

/** @param {{ env: Record<string, any>, data: Record<string, any>, params: { id: string } }} context */
export async function onRequestGet({ env, data, params }) {
  return json({ analysis: triage(await getNote(env, data.auth.user.id, params.id)) });
}

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any>, params: { id: string } }} context */
export async function onRequestPost({ request, env, data, params }) {
  const input = await readJson(request);
  const picked = Object.fromEntries(WRITABLE.filter((field) => input[field] !== undefined).map((field) => [field, input[field]]));
  return json({ analysis: triage(await updateNote(env, data.auth.user.id, data.actor, params.id, picked)) });
}
