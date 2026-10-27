// GET /api/v1/notes/:id - one note. PATCH - update it (state, status, pr_url, body_append, ...).
import { getNote, updateNote } from '../../../../../lib/agent.js';
import { json, readJson } from '../../../../../lib/http.js';

/** @param {{ env: Record<string, any>, data: Record<string, any>, params: { id: string } }} context */
export async function onRequestGet({ env, data, params }) {
  return json({ note: await getNote(env, data.auth.user.id, params.id) });
}

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any>, params: { id: string } }} context */
export async function onRequestPatch({ request, env, data, params }) {
  return json({ note: await updateNote(env, data.auth.user.id, data.actor, params.id, await readJson(request)) });
}
