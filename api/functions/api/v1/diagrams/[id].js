// GET /api/v1/diagrams/:id - one diagram with its nodes, edges and Mermaid source (?format=mermaid for the source alone).
// PATCH - change it: { name?, description?, project?, nodes?, add_nodes?, remove_nodes?, edges?, add_edges?, remove_edges? }.
// DELETE - remove it from every device.
import { deleteDiagram, getDiagram, updateDiagram } from '../../../../lib/diagrams.js';
import { json, readJson } from '../../../../lib/http.js';

const MERMAID = 'mermaid';
const TEXT_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' };

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any>, params: { id: string } }} context */
export async function onRequestGet({ request, env, data, params }) {
  const diagram = await getDiagram(env, data.auth.user.id, params.id);
  if (new URL(request.url).searchParams.get('format') === MERMAID) return new Response(diagram.mermaid, { headers: TEXT_HEADERS });
  return json({ diagram });
}

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any>, params: { id: string } }} context */
export async function onRequestPatch({ request, env, data, params }) {
  return json({ diagram: await updateDiagram(env, data.auth.user.id, params.id, await readJson(request)) });
}

/** @param {{ env: Record<string, any>, data: Record<string, any>, params: { id: string } }} context */
export async function onRequestDelete({ env, data, params }) {
  return json(await deleteDiagram(env, data.auth.user.id, params.id));
}
