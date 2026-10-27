// Every /api/v1 route: resolve the caller (app session or agent token) once, and rate-limit writes.
import { requireAuth } from '../../../lib/auth.js';
import { actorFor } from '../../../lib/notes.js';
import { rateLimit } from '../../../lib/rate-limit.js';

const WRITE_LIMIT = 600;
const WRITE_WINDOW_MS = 3_600_000;

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any>, next: () => Promise<Response> }} context */
export async function onRequest(context) {
  const auth = await requireAuth(context, { allowToken: true });
  if (context.request.method !== 'GET') await rateLimit(context.env, `v1:${auth.user.id}`, WRITE_LIMIT, WRITE_WINDOW_MS);
  context.data.auth = auth;
  context.data.actor = actorFor(auth);
  return context.next();
}
