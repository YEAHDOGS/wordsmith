// Fixed-window rate limiting in D1, used on login and token routes to protect free-tier quotas.
import { HttpError } from './http.js';

const CLEANUP_CHANCE = 0.01;
const CLEANUP_AGE_MS = 86_400_000;

/**
 * Counts a hit for key and throws 429 once it passes limit within windowMs.
 * @param {Record<string, any>} env
 * @param {string} key
 * @param {number} limit
 * @param {number} windowMs
 */
export async function rateLimit(env, key, limit, windowMs) {
  const now = Date.now();
  const windowStart = now - (now % windowMs);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = ?2 THEN count + 1 ELSE 1 END, window_start = ?2
     RETURNING count`,
  ).bind(key, windowStart).first();
  if (Math.random() < CLEANUP_CHANCE) {
    await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - CLEANUP_AGE_MS).run();
  }
  if (Number(row?.count) > limit) throw new HttpError(429, 'Too many requests, slow down');
}

/** Caller IP as seen by Cloudflare. @param {Request} request */
export const clientIp = (request) => request.headers.get('CF-Connecting-IP') || 'local';
