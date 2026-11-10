// GET /api/v1/events?since=<ms>&limit= - everything that happened across your projects since a moment, oldest first.
// Pass cursor back as since to continue; more says another page is waiting.
import { eventsFeed } from '../../../lib/context.js';
import { json } from '../../../lib/http.js';

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any> }} context */
export async function onRequestGet({ request, env, data }) {
  return json(await eventsFeed(env, data.auth.user.id, new URL(request.url).searchParams));
}
