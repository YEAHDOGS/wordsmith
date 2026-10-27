// GET /api/v1/features - feature requests (format=md for a checklist). POST - file a new one.
import { createNote, featuresMarkdown, listNotes } from '../../../../lib/agent.js';
import { json, readJson } from '../../../../lib/http.js';

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestGet({ request, env, data }) {
  const query = new URL(request.url).searchParams;
  const features = await listNotes(env, data.auth.user.id, query, 'feature');
  if (query.get('format') !== 'md') return json({ features });
  return new Response(featuresMarkdown(features), { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestPost({ request, env, data }) {
  const note = await createNote(env, data.auth.user.id, data.actor, await readJson(request), 'feature');
  return json({ feature: note }, 201);
}
