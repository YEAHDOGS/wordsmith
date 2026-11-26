// GET /api/tokens - your agent API tokens (never the secrets).
// POST /api/tokens { name } - creates one and returns the secret exactly once.
import { API_TOKEN_PREFIX, requireAuth } from '../../../lib/auth.js';
import { randomToken, sha256 } from '../../../lib/crypto.js';
import { HttpError, json, readJson } from '../../../lib/http.js';
import { rateLimit } from '../../../lib/rate-limit.js';
import { MAX_NAME } from '../../../../src/lib/models.js';

const MAX_TOKENS = 25;
const PREFIX_LENGTH = API_TOKEN_PREFIX.length + 6;
const CREATE_LIMIT = 20;
const CREATE_WINDOW_MS = 3_600_000;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestGet(context) {
  const { user } = await requireAuth(context);
  const { results } = await context.env.DB.prepare(
    'SELECT id, name, prefix, color, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC',
  ).bind(user.id).all();
  return json({ tokens: results });
}

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost(context) {
  const { user } = await requireAuth(context);
  const { env, request } = context;
  await rateLimit(env, `token:${user.id}`, CREATE_LIMIT, CREATE_WINDOW_MS);
  const { name } = await readJson(request);
  const cleanName = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '';
  if (!cleanName) throw new HttpError(400, 'Give the token a name, like "claude" or "codex"');
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL').bind(user.id).first();
  if (Number(count?.n) >= MAX_TOKENS) throw new HttpError(400, `Revoke a token first (limit ${MAX_TOKENS})`);

  const token = randomToken(API_TOKEN_PREFIX);
  const row = { id: crypto.randomUUID(), name: cleanName, prefix: token.slice(0, PREFIX_LENGTH), color: 'default', created_at: Date.now(), last_used_at: null };
  await env.DB.prepare('INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(row.id, user.id, row.name, await sha256(token), row.prefix, row.created_at).run();
  return json({ token: row, secret: token }, 201);
}
