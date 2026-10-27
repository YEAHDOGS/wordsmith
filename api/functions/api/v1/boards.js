// GET /api/v1/boards - every board (the Features page and each project) with its columns in order. Each column has a
// role (state); PATCH /api/v1/notes/:id with { column } moves a note into one.
import { listBoards } from '../../../lib/agent.js';
import { json } from '../../../lib/http.js';

/** @param {{ env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestGet({ env, data }) {
  return json({ boards: await listBoards(env, data.auth.user.id) });
}
