// GET /api/v1/diagrams?project= - architecture diagrams (boxes and arrows are counted, not listed).
// POST - create one: { name, project?, description?, nodes?, edges? }. Positions are optional: the server lays out the rest.
import { createDiagram, listDiagrams } from '../../../../lib/diagrams.js';
import { json, readJson } from '../../../../lib/http.js';

const CREATED = 201;

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestGet({ request, env, data }) {
  return json({ diagrams: await listDiagrams(env, data.auth.user.id, new URL(request.url).searchParams) });
}

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestPost({ request, env, data }) {
  return json({ diagram: await createDiagram(env, data.auth.user.id, await readJson(request)) }, CREATED);
}
