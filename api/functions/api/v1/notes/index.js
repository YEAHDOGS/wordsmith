// GET /api/v1/notes - notes and features with search and filters. POST - capture a plain note from anywhere.
import { createNote, listNotes } from '../../../../lib/agent.js';
import { json, readJson } from '../../../../lib/http.js';

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestGet({ request, env, data }) {
  const query = new URL(request.url).searchParams;
  const kind = query.get('kind');
  return json({ notes: await listNotes(env, data.auth.user.id, query, kind === 'note' || kind === 'feature' ? kind : null) });
}

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestPost({ request, env, data }) {
  const input = await readJson(request);
  const note = await createNote(env, data.auth.user.id, data.actor, input, input.kind === 'feature' ? 'feature' : 'note');
  return json({ note }, 201);
}
