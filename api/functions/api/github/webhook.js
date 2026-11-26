// POST /api/github/webhook - GitHub "Pull requests" webhook. Point a repo or org webhook here with
// content type application/json and the GITHUB_WEBHOOK_SECRET; merges then complete features instantly.
import { applyPullRequestWebhook } from '../../../lib/github.js';
import { verifyHmacSha256 } from '../../../lib/crypto.js';
import { HttpError, json } from '../../../lib/http.js';

const MAX_PAYLOAD_BYTES = 5_000_000;
const SIGNATURE_PREFIX = 'sha256=';

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_WEBHOOK_SECRET) throw new HttpError(404, 'Webhook not configured');
  const body = await request.text();
  if (body.length > MAX_PAYLOAD_BYTES) throw new HttpError(413, 'Payload too large');
  const signature = request.headers.get('X-Hub-Signature-256') || '';
  if (!signature.startsWith(SIGNATURE_PREFIX) || !(await verifyHmacSha256(env.GITHUB_WEBHOOK_SECRET, body, signature.slice(SIGNATURE_PREFIX.length)))) throw new HttpError(401, 'Bad signature');

  const event = request.headers.get('X-GitHub-Event');
  if (event === 'ping') return json({ ok: true });
  if (event !== 'pull_request') return json({ ignored: event });
  const updated = await applyPullRequestWebhook(env, JSON.parse(body));
  return json({ updated });
}
