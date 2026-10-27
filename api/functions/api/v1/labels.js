// GET /api/v1/labels - every label, by id, name and color. Notes list their labels by name.
import { listLabels } from '../../../lib/agent.js';
import { json } from '../../../lib/http.js';

/** @param {{ env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestGet({ env, data }) {
  return json({ labels: await listLabels(env, data.auth.user.id) });
}
