// GET /api/v1/notes/:id/events - the note's timestamped timeline, oldest first.
import { getNote, noteEvents } from '../../../../../lib/agent.js';
import { json } from '../../../../../lib/http.js';

/** @param {{ env: Record<string, any>, data: Record<string, any>, params: { id: string } }} context */
export async function onRequestGet({ env, data, params }) {
  await getNote(env, data.auth.user.id, params.id);
  return json({ events: await noteEvents(env, data.auth.user.id, params.id) });
}
