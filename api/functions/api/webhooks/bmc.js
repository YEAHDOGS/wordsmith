// POST /api/webhooks/bmc - Buy Me a Coffee webhook: memberships unlock wordsmith without anyone approving them.
// Set up on Buy Me a Coffee (Settings > Webhooks): this URL on the production site, the membership events
// (membership.started, .updated, .cancelled, .paused), and its signing secret stored as the Worker secret
// BMC_WEBHOOK_SECRET (`npx wrangler secret put BMC_WEBHOOK_SECRET`). Each event is signed: x-signature-sha256 is the hex
// HMAC-SHA256 of the raw body under that secret. Each one saves the supporter's membership in the memberships table
// (api/migrations/20261118000000_memberships.sql), keyed by their email, and any account with that email gets the plan
// it pays for (src/lib/models.js planOf) on its next request. Other events are acknowledged and ignored. Buy Me a
// Coffee retries anything but a 2xx, so a bad request answers 4xx and a database hiccup 5xx (retried later).
import { verifyHmacSha256 } from '../../../lib/crypto.js';
import { HttpError, json } from '../../../lib/http.js';

const SIGNATURE_HEADER = 'x-signature-sha256';
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MEMBERSHIP_EVENT = /^membership\.(started|updated|cancelled|paused)$/;
const MAX_EMAIL = 320;
const MAX_LEVEL_NAME = 100;
const MAX_CURRENCY = 8;
const DURATIONS = ['month', 'year'];
const SECOND_MS = 1000;
const TRUE = 'true';
// Saves the membership, unless a newer event for the same supporter is already saved (retries can arrive late).
const SAVE = `INSERT INTO memberships (email, level_id, level_name, duration, amount, currency, status, period_end, live, event_at, updated_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
  ON CONFLICT(email) DO UPDATE SET level_id = ?2, level_name = ?3, duration = ?4, amount = ?5, currency = ?6, status = ?7,
    period_end = ?8, live = ?9, event_at = ?10, updated_at = ?11 WHERE ?10 >= memberships.event_at`;

/** A Unix time in seconds as ms, or null. @param {unknown} seconds */
function millis(seconds) {
  const value = Number(seconds);
  return seconds !== null && seconds !== undefined && Number.isFinite(value) && value > 0 ? value * SECOND_MS : null;
}

/**
 * Where a membership stands. Buy Me a Coffee sends its flags as the strings "true" and "false", and spells the event
 * "cancelled" but the status "canceled".
 * @param {string} type @param {Record<string, any>} data
 */
function standing(type, data) {
  if (type === 'membership.paused' || data.status === 'paused' || data.paused === TRUE) return 'paused';
  if (type === 'membership.cancelled' || data.status === 'canceled' || data.canceled === TRUE) return 'canceled';
  return 'active';
}

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost({ request, env }) {
  if (!env.BMC_WEBHOOK_SECRET) throw new HttpError(404, 'Webhook not configured');
  const body = await request.text();
  if (body.length > MAX_PAYLOAD_BYTES) throw new HttpError(413, 'Payload too large');
  if (!(await verifyHmacSha256(env.BMC_WEBHOOK_SECRET, body, request.headers.get(SIGNATURE_HEADER) || ''))) throw new HttpError(401, 'Bad signature');

  /** @type {Record<string, any> | null} */
  let event = null;
  try {
    event = JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Not JSON');
  }
  const type = String(event?.type ?? '');
  if (!MEMBERSHIP_EVENT.test(type)) return json({ ignored: type });
  const data = event?.data ?? {};
  const email = typeof data.supporter_email === 'string' ? data.supporter_email.trim().toLowerCase() : '';
  if (!email || email.length > MAX_EMAIL || !email.includes('@')) throw new HttpError(400, 'No supporter email');
  const eventAt = millis(event?.created);
  if (eventAt === null) throw new HttpError(400, 'No event time');

  const level = Number(data.membership_level_id);
  const amount = Number(data.amount);
  await env.DB.prepare(SAVE).bind(
    email,
    Number.isInteger(level) ? level : null,
    String(data.membership_level_name ?? '').slice(0, MAX_LEVEL_NAME),
    DURATIONS.includes(data.duration_type) ? data.duration_type : DURATIONS[0],
    Number.isFinite(amount) && amount > 0 ? amount : 0,
    String(data.currency ?? '').slice(0, MAX_CURRENCY),
    standing(type, data),
    millis(data.current_period_end),
    event?.live_mode === false ? 0 : 1,
    eventAt,
    Date.now(),
  ).run();
  return json({ ok: true });
}
