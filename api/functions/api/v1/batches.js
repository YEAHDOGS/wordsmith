// GET /api/v1/batches - notes grouped by the batch agents put them in: what ships together, what's left, which PRs.
import { listBatches } from '../../../lib/agent.js';
import { json } from '../../../lib/http.js';

/** @param {{ env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestGet({ env, data }) {
  return json({ batches: await listBatches(env, data.auth.user.id) });
}
