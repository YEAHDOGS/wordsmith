// GET /api/tapes/transcription -> { available, used, limit }: how many minutes of wordsmith cloud transcripts this account
// has used today and may use (they reset at midnight UTC). Devices without a local speech model use them; the desktop
// apps transcribe on the device, without a limit.
import { requireAuth } from '../../../lib/auth.js';
import { json } from '../../../lib/http.js';
import { today, used } from '../../../lib/ai-usage.js';
import { NEURONS_PER_AUDIO_MINUTE, cloudKey, cloudLimits } from '../../../lib/tapes.js';

// Minutes are reported to a tenth.
const TENTHS = 10;

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestGet(context) {
  const { user } = await requireAuth(context);
  const { env } = context;
  const neurons = await used(env, today(), cloudKey(user.id));
  return json({ available: Boolean(env.AI), used: Math.round((neurons / NEURONS_PER_AUDIO_MINUTE) * TENTHS) / TENTHS, limit: cloudLimits(env).minutes });
}
