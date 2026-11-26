// POST /api/tapes/:id/transcribe -> { tape, used, limit }: transcribes a stored tape with wordsmith cloud (Workers AI's
// Whisper) and saves the transcript on it, for devices with no local speech model (the web app, phones). Each account
// gets a few free minutes a day (cloudLimits in api/lib/tapes.js); the desktop apps transcribe every tape on the device.
// Only tapes the app shrank to Ogg Opus go: their length is counted from the audio itself, so what's charged is what
// the model hears, whatever the app said at upload. Workers AI keeps none of the audio.
// 429 { code: TAPE_CLOUD_ALLOWANCE } once today's minutes are used up, 413 when a tape is longer than a day's minutes.
import { requireAuth } from '../../../../lib/auth.js';
import { bucket } from '../../../../lib/attachments.js';
import { HttpError, json } from '../../../../lib/http.js';
import { rateLimit } from '../../../../lib/rate-limit.js';
import { toApi } from '../../../../lib/rows.js';
import { EVERYONE, adjust, reserve, today, used } from '../../../../lib/ai-usage.js';
import { NEURONS_PER_AUDIO_MINUTE, TAPES_EVERYONE, TAPE_CLOUD_MODEL, cloudKey, cloudLimits, opusMinutes, tapeKey } from '../../../../lib/tapes.js';
import { CLOUD_TRANSCRIPT_MODEL, MAX_TRANSCRIPT, TAPE_CLOUD_ALLOWANCE, TAPE_TYPE } from '../../../../../src/lib/models.js';

// A person presses Transcribe on one tape at a time; this stops a loop well before the allowance does.
const REQUESTS_PER_HOUR = 60;
const HOUR_MS = 3_600_000;
// A day's minutes at the app's bitrate are a few MB; anything far bigger isn't a tape the free minutes could cover,
// and this keeps the base64 copy well inside a Worker's memory.
const MAX_CLOUD_TAPE_BYTES = 8 * 1024 * 1024;
// The length is counted from the packets; this covers the model's rounding.
const RESERVE_MARGIN = 1.05;
// The shortest length charged, in minutes.
const MIN_MINUTES = 0.1;
// A failure this fast did no work (a full queue, a model being swapped): everything goes back.
const FAST_FAILURE_MS = 1_000;
const BASE64_CHUNK = 0x8000;
const LINE_BREAK = '\n';
const TENTHS = 10;
const DESKTOP = 'The wordsmith desktop app transcribes every tape on your computer, free and without a limit.';
const USED_UP = `Today's free cloud minutes are used up; they reset at midnight UTC. ${DESKTOP}`;
const USED_UP_EVERYONE = `wordsmith cloud is out of allowance for today; it resets at midnight UTC. ${DESKTOP}`;
const NOT_OPUS = `This tape is stored in its original format, which cloud transcripts don't take. ${DESKTOP}`;

/** Bytes as base64: the runtime's own encoder where there is one, else in chunks. @param {Uint8Array} bytes */
function base64(bytes) {
  const native = /** @type {any} */ (bytes).toBase64;
  if (typeof native === 'function') return native.call(bytes);
  let binary = '';
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK) binary += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK));
  return btoa(binary);
}

/** Minutes used today, to a tenth. @param {number} neurons */
const minutes = (neurons) => Math.round((neurons / NEURONS_PER_AUDIO_MINUTE) * TENTHS) / TENTHS;

/** One utterance per line, as the desktop apps write them. @param {any} answer */
function transcriptOf(answer) {
  const segments = Array.isArray(answer?.segments) ? answer.segments.map((/** @type {any} */ segment) => String(segment?.text ?? '').trim()).filter(Boolean) : [];
  return (segments.length ? segments.join(LINE_BREAK) : String(answer?.text ?? '').trim()).slice(0, MAX_TRANSCRIPT);
}

/** @param {{ request: Request, env: Record<string, any>, params: Record<string, string>, waitUntil: (promise: Promise<any>) => void }} context */
export async function onRequestPost(context) {
  const { user } = await requireAuth(context);
  const { env, params } = context;
  if (!env.AI) throw new HttpError(503, 'wordsmith cloud is not set up on this server');
  await rateLimit(env, `tape-cloud:${user.id}`, REQUESTS_PER_HOUR, HOUR_MS);
  const tape = await env.DB.prepare('SELECT * FROM tapes WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(params.id, user.id).first();
  if (!tape || !(Number(tape.audio_size) > 0)) throw new HttpError(404, 'Tape not found');
  if (tape.audio_type !== TAPE_TYPE) throw new HttpError(415, NOT_OPUS);
  const limits = cloudLimits(env);
  const tooLong = `This tape is longer than a day's ${limits.minutes} free cloud minutes. ${DESKTOP}`;
  if (Number(tape.audio_size) > MAX_CLOUD_TAPE_BYTES) throw new HttpError(413, tooLong);

  const object = await bucket(env).get(tapeKey(user.id, tape.id));
  if (!object) throw new HttpError(404, "This tape's audio is missing from storage");
  const bytes = new Uint8Array(await object.arrayBuffer());
  const length = opusMinutes(bytes);
  if (length === null) throw new HttpError(415, NOT_OPUS);
  const worst = Math.max(length, MIN_MINUTES) * NEURONS_PER_AUDIO_MINUTE * RESERVE_MARGIN;
  if (worst > limits.neurons) throw new HttpError(413, tooLong);

  // Reserved on every account together, then all tapes together, then this account; a step that doesn't fit gives
  // back the ones before it.
  const key = cloudKey(user.id);
  const day = today();
  /** @type {[string, number, string][]} */
  const rows = [[EVERYONE, limits.everyone, USED_UP_EVERYONE], [TAPES_EVERYONE, limits.tapes, USED_UP_EVERYONE], [key, limits.neurons, USED_UP]];
  /** @type {string[]} */
  const held = [];
  for (const [row, cap, message] of rows) {
    if (!(await reserve(env, day, row, worst, cap))) {
      if (held.length) await adjust(env, day, held, -worst, -1);
      throw new HttpError(429, message, TAPE_CLOUD_ALLOWANCE);
    }
    held.push(row);
  }

  // The model call, the count it settles and the saved transcript all run under waitUntil, so a paid-for transcript
  // is kept and counted even if the app hangs up first.
  const started = Date.now();
  const settled = (async () => {
    /** @type {any} */
    let answer;
    try {
      answer = await env.AI.run(TAPE_CLOUD_MODEL, { audio: base64(bytes) });
    } catch (error) {
      // A slow failure may have been billed, so its reservation stays counted.
      if (Date.now() - started < FAST_FAILURE_MS) await adjust(env, day, held, -worst, -1);
      throw error;
    }
    // An answer that doesn't say what it cost counts as its whole reservation, so the count never runs low.
    await adjust(env, day, held, (Number(answer?.usage?.neurons) || worst) - worst);
    const now = Date.now();
    return env.DB.prepare('UPDATE tapes SET transcript = ?, transcript_model = ?, transcribed_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL RETURNING *')
      .bind(transcriptOf(answer), CLOUD_TRANSCRIPT_MODEL, now, now, tape.id, user.id).first();
  })();
  context.waitUntil(settled.catch(() => {}));
  const saved = await settled;
  if (!saved) throw new HttpError(404, 'Tape not found');
  return json({ tape: toApi(saved), used: minutes(await used(env, day, key)), limit: limits.minutes });
}
