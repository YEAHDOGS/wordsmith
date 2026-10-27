// POST /api/auth/device/poll { device_id, secret } - returns { token } once the browser login finished,
// 202 while it is pending, 410 once it expired. The session token is handed out exactly once.
import { HttpError, json, readJson } from '../../../../lib/http.js';
import { sha256 } from '../../../../lib/crypto.js';
import { loadState } from '../../../../lib/login.js';

const PENDING_STATUS = 202;
const GONE_STATUS = 410;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost({ request, env }) {
  const { device_id: deviceId, secret } = await readJson(request);
  if (typeof deviceId !== 'string' || typeof secret !== 'string') throw new HttpError(400, 'device_id and secret are required');
  const row = await loadState(env, deviceId);
  if (!row || row.device_secret_hash !== (await sha256(secret))) return json({ error: 'Login expired' }, GONE_STATUS);
  if (!row.session_token) return json({ pending: true }, PENDING_STATUS);
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(deviceId).run();
  return json({ token: row.session_token });
}
