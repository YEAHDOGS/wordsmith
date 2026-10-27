// POST /api/github/webhook - GitHub "Pull requests" webhook. Point a repo or org webhook here with
// content type application/json and the GITHUB_WEBHOOK_SECRET; merges then complete features instantly.
import { applyPullRequestWebhook } from '../../../lib/github.js';
import { HttpError, json } from '../../../lib/http.js';

const MAX_PAYLOAD_BYTES = 5_000_000;
const SIGNATURE_PREFIX = 'sha256=';

/** Constant-time HMAC-SHA256 check of GitHub's X-Hub-Signature-256. @param {string} secret @param {string} body @param {string} signature */
async function verifySignature(secret, body, signature) {
  if (!signature.startsWith(SIGNATURE_PREFIX)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const hex = signature.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(body));
}

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_WEBHOOK_SECRET) throw new HttpError(404, 'Webhook not configured');
  const body = await request.text();
  if (body.length > MAX_PAYLOAD_BYTES) throw new HttpError(413, 'Payload too large');
  if (!(await verifySignature(env.GITHUB_WEBHOOK_SECRET, body, request.headers.get('X-Hub-Signature-256') || ''))) throw new HttpError(401, 'Bad signature');

  const event = request.headers.get('X-GitHub-Event');
  if (event === 'ping') return json({ ok: true });
  if (event !== 'pull_request') return json({ ignored: event });
  const updated = await applyPullRequestWebhook(env, JSON.parse(body));
  return json({ updated });
}
