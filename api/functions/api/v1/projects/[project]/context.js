// GET /api/v1/projects/:project/context?format=md&events_since=&events_limit= - one project's whole picture in one call:
// mission statement, open features with their triage, recent events and attachment links. :project is an id or a name.
import { projectContext, projectContextMarkdown } from '../../../../../lib/context.js';
import { json } from '../../../../../lib/http.js';

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any>, params: { project: string } }} context */
export async function onRequestGet({ request, env, data, params }) {
  const query = new URL(request.url).searchParams;
  const bundle = await projectContext(env, data.auth.user.id, params.project, query);
  if (query.get('format') !== 'md') return json(bundle);
  return new Response(projectContextMarkdown(bundle), { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}
