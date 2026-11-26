// Runs before every /api route: answers CORS preflights, adds CORS headers for trusted app origins,
// and turns thrown errors into JSON responses.
import { HttpError, corsHeaders, json } from '../../lib/http.js';

const PREFLIGHT_STATUS = 204;

/** @param {{ request: Request, env: Record<string, any>, next: () => Promise<Response> }} context */
export async function onRequest({ request, env, next }) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: PREFLIGHT_STATUS, headers: cors });

  let response;
  try {
    response = await next();
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    response = json({ error: status === 500 ? 'Something went wrong' : /** @type {Error} */ (error).message, code: error instanceof HttpError ? error.code : undefined }, status);
  }
  if (!Object.keys(cors).length) return response;
  const withCors = new Response(response.body, response);
  for (const [key, value] of Object.entries(cors)) withCors.headers.set(key, value);
  return withCors;
}
