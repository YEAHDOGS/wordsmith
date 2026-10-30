// Every /api/v1 route: resolve the caller (app session or agent token) once, and rate-limit writes.
import { requireAuth } from '../../../lib/auth.js';
import { actorFor } from '../../../lib/notes.js';
import { rateLimit } from '../../../lib/rate-limit.js';
import { MAX_NAME } from '../../../../src/lib/models.js';

const WRITE_LIMIT = 600;
const WRITE_WINDOW_MS = 3_600_000;
// Several sessions can share one token. Each names itself in this header, so claims and timelines tell them apart.
const SESSION_HEADER = 'X-Agent-Session';
const SESSION_PATTERN = /^[\w.-]{1,32}$/;

/** @param {{ request: Request, env: Record<string, any>, data: Record<string, any>, next: () => Promise<Response> }} context */
export async function onRequest(context) {
  const auth = await requireAuth(context, { allowToken: true });
  if (context.request.method !== 'GET') await rateLimit(context.env, `v1:${auth.user.id}`, WRITE_LIMIT, WRITE_WINDOW_MS);
  context.data.auth = auth;
  const actor = actorFor(auth);
  const session = context.request.headers.get(SESSION_HEADER);
  if (auth.via === 'token' && session && SESSION_PATTERN.test(session)) actor.name = `${actor.name} · ${session}`.slice(0, MAX_NAME);
  context.data.actor = actor;
  return context.next();
}
