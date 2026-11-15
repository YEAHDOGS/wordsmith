// POST /api/tapes/:id/transcribe -> { tape, used, limit }: transcribes a stored tape with wordsmith cloud (Workers AI's
// Whisper) and saves the transcript on it, for devices with no local speech model (the web app, phones). Each account
// gets a few free minutes a day (cloudLimits in api/lib/tapes.js); the desktop apps transcribe every tape on the device.
// The tape's audio is sent to Workers AI, which keeps none of it. 429 { code: TAPE_CLOUD_ALLOWANCE } once today's
// minutes are used up, 413 when the tape is longer than a whole day's allowance.
import { requireAuth } from '../../../../lib/auth.js';
import { bucket } from '../../../../lib/attachments.js';
import { HttpError, json } from '../../../../lib/http.js';
import { rateLimit } from '../../../../lib/rate-limit.js';
import { toApi } from '../../../../lib/rows.js';
import { EVERYONE, adjust, reserve, today, used } from '../../../../lib/ai-usage.js';
import { MS_PER_MINUTE, NEURONS_PER_AUDIO_MINUTE, TAPE_CLOUD_MODEL, cloudKey, cloudLimits, tapeKey } from '../../../../lib/tapes.js';
import { CLOUD_TRANSCRIPT_MODEL, MAX_TRANSCRIPT, TAPE_CLOUD_ALLOWANCE } from '../../../../../src/lib/models.js';

// A person presses Transcribe on one tape at a time; this stops a loop well before the allowance does.
const REQUESTS_PER_HOUR = 60;
const HOUR_MS = 3_600_000;
// The tape's length is what the app said when it uploaded; Whisper bills what it hears. The reservation leaves room
// for the difference and is corrected to the real cost afterwards.
const RESERVE_MARGIN = 1.1;
// A failure this fast did no work (a full queue, a model being swapped): everything goes back.
const FAST_FAILURE_MS = 1_000;
const BASE64_CHUNK = 0x8000;
const LINE_BREAK = '\n';
const TENTHS = 10;
const USED_UP = "Today's free cloud minutes are used up; they reset at midnight UTC. The wordsmith desktop app transcribes every tape on your computer, free and without a limit.";
const USED_UP_EVERYONE = 'wordsmith cloud is out of allowance for today; it resets at midnight UTC. The wordsmith desktop app transcribes every tape on your computer, free and without a limit.';

/** Bytes as base64, in chunks so a long tape doesn't overflow the call stack. @param {Uint8Array} bytes */
function base64(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK) binary += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK));
  return btoa(binary);
}

/** Minutes used today, to a tenth. @param {number} neurons */
const minutes = (neurons) => Math.round((neurons / NEURONS_PER_AUDIO_MINUTE) * TENTHS) / TENTHS;

/** @param {{ request: Request, env: Record<string, any>, params: Record<string, string>, waitUntil: (promise: Promise<any>) => void }} context */
export async function onRequestPost(context) {
  const { user } = await requireAuth(context);
  const { env, params } = context;
  if (!env.AI) throw new HttpError(503, 'wordsmith cloud is not set up on this server');
  await rateLimit(env, `tape-cloud:${user.id}`, REQUESTS_PER_HOUR, HOUR_MS);
  const tape = await env.DB.prepare('SELECT * FROM tapes WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(params.id, user.id).first();
  if (!tape || !(Number(tape.audio_size) > 0)) throw new HttpError(404, 'Tape not found');

  const limits = cloudLimits(env);
  const key = cloudKey(user.id);
  const worst = Math.max(1, Number(tape.duration_ms) / MS_PER_MINUTE) * NEURONS_PER_AUDIO_MINUTE * RESERVE_MARGIN;
  if (worst > limits.neurons) throw new HttpError(413, `This tape is longer than a day's ${limits.minutes} free cloud minutes. The wordsmith desktop app transcribes it on your computer, free.`);
  const day = today();
  if (!(await reserve(env, day, EVERYONE, worst, limits.everyone))) throw new HttpError(429, USED_UP_EVERYONE, TAPE_CLOUD_ALLOWANCE);
  if (!(await reserve(env, day, key, worst, limits.neurons))) {
    await adjust(env, day, [EVERYONE], -worst, -1);
    throw new HttpError(429, USED_UP, TAPE_CLOUD_ALLOWANCE);
  }

  // The model call and the count it settles run under waitUntil, so the count is put right even if the app hangs up.
  const started = Date.now();
  const settled = (async () => {
    try {
      const object = await bucket(env).get(tapeKey(user.id, tape.id));
      if (!object) throw new HttpError(404, 'This tape\'s audio is missing from storage');
      const answer = await env.AI.run(TAPE_CLOUD_MODEL, { audio: base64(new Uint8Array(await object.arrayBuffer())) });
      // An answer that doesn't say what it cost counts as its whole reservation, so the count never runs low.
      const neurons = Number(answer?.usage?.neurons) || worst;
      await adjust(env, day, [EVERYONE, key], neurons - worst);
      return answer;
    } catch (error) {
      if (Date.now() - started < FAST_FAILURE_MS || error instanceof HttpError) await adjust(env, day, [EVERYONE, key], -worst, -1);
      throw error;
    }
  })();
  context.waitUntil(settled.catch(() => {}));
  const answer = await settled;

  // One utterance per line, as the desktop apps write them.
  const segments = Array.isArray(answer?.segments) ? answer.segments.map((/** @type {any} */ segment) => String(segment?.text ?? '').trim()).filter(Boolean) : [];
  const transcript = (segments.length ? segments.join(LINE_BREAK) : String(answer?.text ?? '').trim()).slice(0, MAX_TRANSCRIPT);
  const now = Date.now();
  const saved = await env.DB.prepare('UPDATE tapes SET transcript = ?, transcript_model = ?, transcribed_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL RETURNING *')
    .bind(transcript, CLOUD_TRANSCRIPT_MODEL, now, now, tape.id, user.id).first();
  if (!saved) throw new HttpError(404, 'Tape not found');
  return json({ tape: toApi(saved), used: minutes(await used(env, day, key)), limit: limits.minutes });
}
