// wordsmith cloud for Scribe: turns a stretch of speech into ticket actions with Workers AI, for people who run no model
// of their own. The prompt is built here from the same code the app uses for local models (src/lib/scribe-llm.js), so
// the route answers Scribe's question and nothing else, and every field is bounded. Each account gets a daily
// allowance of Workers AI neurons, and all accounts together stay under SCRIBE_DAILY_NEURONS, so Scribe can never
// spend the account's whole free allowance. Each request reserves its worst-case cost (the longest answer allowed) in the
// same statement that checks the cap, so requests arriving together can never carry the total past it; the
// reservation is then corrected to what the request really used, and given back if it fails.
// GET  /api/scribe -> { available, models: [{ id, name, note }], default, used, limit }
// POST /api/scribe { model?, project, tickets: [{ ref, title, body, state, priority_level }], earlier, speech }
//   -> { content, used, limit }   429 { code: 'scribe_allowance' } once today's allowance is spent
import { requireAuth } from '../../lib/auth.js';
import { HttpError, json, readJson } from '../../lib/http.js';
import { rateLimit } from '../../lib/rate-limit.js';
import { EARLIER_CHARS, MAX_ANSWER_TOKENS, MAX_NAME_CHARS, MAX_SPEECH_CHARS, MAX_TICKETS, TEMPERATURE, scribeMessages } from '../../../src/lib/scribe-llm.js';
import { FEATURE_STATES, MAX_PRIORITY } from '../../../src/lib/models.js';
import CLOUD from '../../../src/lib/scribe-cloud-models.json';

const EVERYONE = '*';
const ALLOWANCE_CODE = 'scribe_allowance';
// Defaults when the Worker's vars don't say (wrangler.jsonc sets them per environment).
const DEFAULT_USER_NEURONS = 1_500;
const DEFAULT_DAILY_NEURONS = 4_000;
const TOKENS_PER_MILLION = 1_000_000;
// The models here tokenize bytes (byte-level BPE, or SentencePiece with byte fallback), so a text never has more
// tokens than UTF-8 bytes, in any language. Each message adds a few tokens of chat template; this covers them.
const TEMPLATE_TOKENS_PER_MESSAGE = 32;
const UTF8 = new TextEncoder();
// Changes a row of today's usage by ?3 neurons and ?4 requests: negative gives a reservation back.
const ADJUST = 'UPDATE scribe_usage SET neurons = MAX(0, neurons + ?3), requests = MAX(0, requests + ?4) WHERE day = ?1 AND user_id = ?2';
const USED_UP_MINE = 'Today\'s wordsmith cloud allowance is used up. It resets at midnight UTC; a local model keeps working meanwhile.';
const USED_UP_EVERYONE = 'wordsmith cloud is out of allowance for today. It resets at midnight UTC; a local model keeps working meanwhile.';
// A person talking sends a request every few seconds at most; this stops a runaway loop well before the allowance does.
const REQUEST_LIMIT = 30;
const REQUEST_WINDOW_MS = 60_000;
// Ticket bodies the model sees are cut much shorter than this by scribeMessages; this only bounds what is sent.
const MAX_TICKET_BODY = 4_000;
const KEEP_DAYS = 7;
// Old days are swept now and then rather than on every request, to keep writes down.
const CLEANUP_CHANCE = 0.02;
const DAY_MS = 86_400_000;
const ISO_DATE_LENGTH = 10;

/** @typedef {{ id: string, name: string, note: string, input: number, output: number, suffix?: string, options?: Record<string, any> }} CloudModel */

/** @type {CloudModel[]} */
const MODELS = CLOUD.models;

/** @param {Record<string, any>} env */
function limits(env) {
  return {
    user: Number(env.SCRIBE_USER_NEURONS) || DEFAULT_USER_NEURONS,
    everyone: Number(env.SCRIBE_DAILY_NEURONS) || DEFAULT_DAILY_NEURONS,
  };
}

/**
 * Adds `neurons` to a row of today's usage only if the total stays within `cap`, in one statement, so two requests
 * can't both slip under it. Returns false when it would go over.
 * @param {Record<string, any>} env @param {string} day @param {string} userId @param {number} neurons @param {number} cap
 */
async function reserve(env, day, userId, neurons, cap) {
  if (neurons > cap) return false;
  const row = await env.DB.prepare(
    `INSERT INTO scribe_usage (day, user_id, neurons, requests) VALUES (?1, ?2, ?3, 1)
     ON CONFLICT(day, user_id) DO UPDATE SET neurons = neurons + ?3, requests = requests + 1 WHERE neurons + ?3 <= ?4
     RETURNING neurons`,
  ).bind(day, userId, neurons, cap).first();
  return Boolean(row);
}

/** Today's usage for this account and for everyone. @param {Record<string, any>} env @param {string} userId @param {string} day */
async function usage(env, userId, day) {
  const { results } = await env.DB.prepare('SELECT user_id, neurons FROM scribe_usage WHERE day = ?1 AND user_id IN (?2, ?3)').bind(day, userId, EVERYONE).all();
  const of = (/** @type {string} */ id) => Number(results.find((row) => row.user_id === id)?.neurons ?? 0);
  return { mine: of(userId), everyone: of(EVERYONE) };
}

/** A bounded string from the request, or ''. @param {unknown} value @param {number} max */
function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

/** The tickets from the request, checked field by field. @param {unknown} value */
function tickets(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TICKETS).map((ticket, index) => ({
    ref: `T${index + 1}`,
    id: '',
    title: text(ticket?.title, MAX_NAME_CHARS),
    body: text(ticket?.body, MAX_TICKET_BODY),
    state: FEATURE_STATES.includes(ticket?.state) ? ticket.state : FEATURE_STATES[0],
    priority_level: Math.min(MAX_PRIORITY, Math.max(0, Math.round(Number(ticket?.priority_level) || 0))),
  }));
}

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestGet(context) {
  const { user } = await requireAuth(context);
  const { env } = context;
  const day = new Date().toISOString().slice(0, ISO_DATE_LENGTH);
  const { mine } = await usage(env, user.id, day);
  return json({
    available: Boolean(env.AI),
    models: MODELS.map(({ id, name, note }) => ({ id, name, note })),
    default: CLOUD.default,
    used: Math.round(mine),
    limit: limits(env).user,
  });
}

/** @param {{ request: Request, env: Record<string, any> }} context */
export async function onRequestPost(context) {
  const { user } = await requireAuth(context);
  const { env, request } = context;
  if (!env.AI) throw new HttpError(503, 'wordsmith cloud is not set up on this server');
  await rateLimit(env, `scribe:${user.id}`, REQUEST_LIMIT, REQUEST_WINDOW_MS);
  const body = await readJson(request);
  const model = MODELS.find((candidate) => candidate.id === (body.model || CLOUD.default));
  if (!model) throw new HttpError(400, 'Pick one of the wordsmith cloud models');
  const speech = text(body.speech, MAX_SPEECH_CHARS).trim();
  if (!speech) throw new HttpError(400, 'Send some speech');

  const messages = scribeMessages({ project: text(body.project, MAX_NAME_CHARS), tickets: tickets(body.tickets), earlier: text(body.earlier, EARLIER_CHARS), speech });
  // The switch that turns this model's hidden reasoning off, where it is a few words at the end of the request.
  if (model.suffix) messages[messages.length - 1].content += model.suffix;

  // The most this request can cost: a token for every byte of input (the most any of these tokenizers makes), and
  // the longest answer allowed. Real use is far lower, and the reservation is corrected to it afterwards, so a
  // request can never cost more than it reserved and the caps hold whatever the language.
  const maxTokensIn = messages.reduce((sum, message) => sum + UTF8.encode(message.content).length + TEMPLATE_TOKENS_PER_MESSAGE, 0);
  const worst = (maxTokensIn * model.input + MAX_ANSWER_TOKENS * model.output) / TOKENS_PER_MILLION;
  const day = new Date().toISOString().slice(0, ISO_DATE_LENGTH);
  const cap = limits(env);
  if (!(await reserve(env, day, EVERYONE, worst, cap.everyone))) throw new HttpError(429, USED_UP_EVERYONE, ALLOWANCE_CODE);
  if (!(await reserve(env, day, user.id, worst, cap.user))) {
    await env.DB.prepare(ADJUST).bind(day, EVERYONE, -worst, -1).run();
    throw new HttpError(429, USED_UP_MINE, ALLOWANCE_CODE);
  }

  let answer;
  try {
    answer = await env.AI.run(model.id, {
      messages, temperature: TEMPERATURE, max_tokens: MAX_ANSWER_TOKENS, response_format: { type: 'json_object' }, ...model.options,
    });
  } catch (error) {
    // Nothing was used: the reservation goes back.
    await env.DB.batch([env.DB.prepare(ADJUST).bind(day, EVERYONE, -worst, -1), env.DB.prepare(ADJUST).bind(day, user.id, -worst, -1)]);
    throw error;
  }
  const content = answer?.choices?.[0]?.message?.content ?? answer?.response ?? '';
  const tokensIn = Number(answer?.usage?.prompt_tokens) || 0;
  const tokensOut = Number(answer?.usage?.completion_tokens) || 0;
  const neurons = Number(answer?.usage?.neurons) || (tokensIn * model.input + tokensOut * model.output) / TOKENS_PER_MILLION;
  // The reservation becomes what the request really cost.
  await env.DB.batch([env.DB.prepare(ADJUST).bind(day, EVERYONE, neurons - worst, 0), env.DB.prepare(ADJUST).bind(day, user.id, neurons - worst, 0)]);
  if (Math.random() < CLEANUP_CHANCE) {
    const oldest = new Date(Date.now() - KEEP_DAYS * DAY_MS).toISOString().slice(0, ISO_DATE_LENGTH);
    await env.DB.prepare('DELETE FROM scribe_usage WHERE day < ?').bind(oldest).run();
  }
  if (typeof content !== 'string' || !content) throw new HttpError(502, 'The model sent no answer; your words are kept for the next try');
  const { mine } = await usage(env, user.id, day);
  return json({ content, used: Math.round(mine), limit: cap.user });
}
