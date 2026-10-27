// POST /api/v1/notes/:id/claim - claims one requested feature. 409 when it was already taken.
import { claimFeature, getNote } from '../../../../../lib/agent.js';
import { json } from '../../../../../lib/http.js';

const CONFLICT_STATUS = 409;

/** @param {{ env: Record<string, any>, data: Record<string, any>, params: { id: string } }} context */
export async function onRequestPost({ env, data, params }) {
  const userId = data.auth.user.id;
  await getNote(env, userId, params.id);
  const feature = await claimFeature(env, userId, data.actor, params.id);
  if (!feature) return json({ error: 'Already claimed or not a requested feature', note: await getNote(env, userId, params.id) }, CONFLICT_STATUS);
  return json({ feature });
}
