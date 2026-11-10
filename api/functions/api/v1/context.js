// GET /api/v1/context - the owner's standing context: preferences, facts and pointers every agent reads first.
// PUT /api/v1/context { body } - the owner saves it from Settings. Agent tokens read it but never write it.
import { readContext, writeContext } from '../../../lib/context.js';
import { HttpError, json, readJson } from '../../../lib/http.js';

const FORBIDDEN = 403;

/** @param {{ env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestGet({ env, data }) {
  return json(await readContext(env, data.auth.user.id));
}

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestPut({ request, env, data }) {
  if (data.auth.via === 'token') throw new HttpError(FORBIDDEN, 'Only the owner edits standing context, in Settings');
  const { body } = await readJson(request);
  return json(await writeContext(env, data.auth.user.id, body));
}
