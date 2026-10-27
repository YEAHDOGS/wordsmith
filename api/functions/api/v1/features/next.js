// POST /api/v1/features/next { project? } - claims the next requested feature for the calling agent.
import { claimNext } from '../../../../lib/agent.js';
import { json, readJson } from '../../../../lib/http.js';

const EMPTY_QUEUE_STATUS = 204;

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestPost({ request, env, data }) {
  const { project } = await readJson(request);
  const feature = await claimNext(env, data.auth.user.id, data.actor, project);
  if (!feature) return new Response(null, { status: EMPTY_QUEUE_STATUS });
  return json({ feature });
}
