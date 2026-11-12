// Scribe's conversation with the language model, the parts with no state: the instructions, the message for one
// stretch of speech, the request to an OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp and others serve
// /v1/chat/completions), and reading the answer back into checked actions. wordsmith's Worker builds the same
// messages for wordsmith cloud (api/functions/api/scribe.js), so the prompt and its limits live only here.
// The model answers in JSON rather than tool calls, because small local models follow a JSON shape far more reliably.
// It is never told about wordsmith's API: it only says what to create or update, and the app makes those changes.
import { FEATURE_STATES, MAX_BODY, MAX_PRIORITY, MAX_TITLE, PRIORITY_LABELS } from './models.js';

// Low, so the same speech gives the same tickets.
export const TEMPERATURE = 0.2;
// How much of a ticket's body the model sees when deciding whether to update it: enough to tell tickets apart.
const BODY_PREVIEW = 120;
// Tickets the model may update. Every request carries them, so they are most of its size.
export const MAX_TICKETS = 12;
// How much already-handled speech rides along as context.
export const EARLIER_CHARS = 300;
// The most of a ticket's body a request carries. The model sees only BODY_PREVIEW of it once spaces are squeezed;
// this leaves room for that and bounds the upload.
export const MAX_TICKET_BODY = 1_000;
// The most speech one request carries; more waits for the next.
export const MAX_SPEECH_CHARS = 2_000;
// The longest a ticket title or project name may be in a request (the model only needs to recognize them).
export const MAX_NAME_CHARS = 200;
// The longest answer a request may produce. Ten tickets of JSON fit well inside; a model that rambles is cut off
// rather than running up a bill.
export const MAX_ANSWER_TOKENS = 800;
// Tickets need no hidden reasoning first: asking for none answered about 40 times faster with about 50 times fewer
// tokens in testing, and the tickets came out the same.
const NO_REASONING = 'none';
const BAD_REQUEST = 400;
// Hesitations and thinking-aloud openers: a line made only of these asks for nothing.
const FILLER = /^(u+[hm]+|e+r+m+|h+m+|m{2,}|a+h+|o+h+|ok(ay)?|so|yeah|well)$/i;
// A local model that hasn't answered by now is stuck or still loading; the speech stays queued for the next try.
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_ACTIONS = 10;
const OPS = ['create', 'update', 'none'];
// Models that can't write tickets: embedding and speech models that servers list beside the chat ones.
export const NOT_CHAT = /embed|whisper|rerank|tts/i;
// Looking for a model server on this machine gives each address this long to answer.
const PROBE_TIMEOUT_MS = 1_500;

const SYSTEM = `You are Scribe. A developer is thinking out loud, and you turn what they say into tickets in their notes app while they keep talking.

Each message gives you the tickets you may change and the new speech. Answer with JSON only, in this shape:
{"actions":[ ... ]}

Actions:
{"op":"create","title":"...","body":"...","priority":0}
{"op":"update","ref":"T2","title":"...","body":"...","append":"...","priority":0,"state":"requested"}
{"op":"none"}

Rules:
- One ticket per distinct piece of work. Several in one breath means several creates.
- title: an instruction under 80 characters, like "Add offline mode to the editor".
- body: Markdown. What they asked for in their own meaning, then acceptance criteria as a short checklist when they gave any. Never invent requirements they did not say.
- If the speech refines, corrects or adds to a ticket in the list, update that ticket by its ref instead of creating a new one. Use "append" to add a paragraph, "body" only to rewrite the whole body. Leave out every field you are not changing.
- Update only a ticket the speech is clearly about (it names the same feature or problem). New work gets a create, even when a listed ticket is in the same area. Never retitle a ticket to mean something else.
- priority: 0 none, 1 low, 2 normal, 3 high, 4 urgent, 5 critical. Set it only when they say how important it is.
- state: ${FEATURE_STATES.join(', ')}. Set it only when they say work started or finished.
- Filler, half sentences, thinking aloud and anything that is not about work to do: {"actions":[{"op":"none"}]}.
- The speech comes from speech recognition. Fix obvious mishearings from context, and write code names the way a developer would.`;

/**
 * @typedef {{ ref: string, id: string, title: string, body: string, state: string, priority_level: number }} Ticket a note the model may change, under a short ref
 * @typedef {{ op: 'create', title: string, body: string, priority: number }} CreateAction
 * @typedef {{ op: 'update', ref: string, title?: string, body?: string, append?: string, priority?: number, state?: string }} UpdateAction
 * @typedef {CreateAction | UpdateAction} Action
 */

/**
 * The chat messages for one stretch of speech.
 * @param {{ project: string, tickets: Ticket[], earlier: string, speech: string }} turn
 */
export function scribeMessages({ project, tickets, earlier, speech }) {
  const list = tickets.map((ticket) => {
    const body = ticket.body.replace(/\s+/g, ' ').trim();
    const preview = body.length > BODY_PREVIEW ? `${body.slice(0, BODY_PREVIEW)}…` : body;
    return `${ticket.ref} [${ticket.state}, priority ${PRIORITY_LABELS[ticket.priority_level] ?? PRIORITY_LABELS[0]}] ${ticket.title || 'Untitled'}${preview ? ` | ${preview}` : ''}`;
  });
  const user = [
    `Project: ${project || 'none'}`,
    `Tickets:\n${list.length ? list.join('\n') : '(none yet)'}`,
    earlier ? `Earlier speech (already handled, for context only):\n${earlier}` : '',
    `New speech:\n${speech}`,
  ].filter(Boolean).join('\n\n');
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

/** A whole number held between 0 and the top priority, or undefined when it isn't a number. @param {unknown} value */
function priorityOf(value) {
  const level = Number(value);
  return value === undefined || value === null || value === '' || !Number.isFinite(level) ? undefined : Math.min(MAX_PRIORITY, Math.max(0, Math.round(level)));
}

/** Text, trimmed and cut to a limit, or undefined when it isn't text. @param {unknown} value @param {number} max */
const textOf = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined);

/**
 * Reads the model's answer into checked actions. Anything malformed is dropped rather than guessed at: a create needs
 * a title, an update needs a ref from the list and at least one change.
 * @param {string} content the assistant message
 * @param {Ticket[]} tickets
 * @returns {Action[]}
 */
export function parseActions(content, tickets) {
  // Some models wrap JSON in a code fence or add a sentence around it; take the outermost object.
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The model did not answer with JSON');
  let parsed;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new Error('The model answered with JSON that could not be read');
  }
  const raw = Array.isArray(parsed?.actions) ? parsed.actions : OPS.includes(parsed?.op) ? [parsed] : [];
  /** @type {Action[]} */
  const actions = [];
  for (const item of raw.slice(0, MAX_ACTIONS)) {
    if (item?.op === 'create') {
      const title = textOf(item.title, MAX_TITLE);
      if (title) actions.push({ op: 'create', title, body: textOf(item.body, MAX_BODY) ?? '', priority: priorityOf(item.priority) ?? 0 });
    }
    if (item?.op === 'update') {
      const ref = String(item.ref ?? '').trim().toUpperCase();
      if (!tickets.some((ticket) => ticket.ref === ref)) continue;
      /** @type {UpdateAction} */
      const update = { op: 'update', ref };
      const title = textOf(item.title, MAX_TITLE);
      const body = textOf(item.body, MAX_BODY);
      const append = textOf(item.append, MAX_BODY);
      const priority = priorityOf(item.priority);
      if (title) update.title = title;
      if (body) update.body = body;
      if (append) update.append = append;
      if (priority !== undefined) update.priority = priority;
      if (FEATURE_STATES.includes(item.state)) update.state = item.state;
      if (Object.keys(update).length > 2) actions.push(update);
    }
  }
  return actions;
}

/** The endpoint's base without a trailing slash: "http://localhost:11434/v1". @param {string} endpoint */
const base = (endpoint) => endpoint.trim().replace(/\/+$/, '');

/** Servers and models that refused the reasoning and length options ("endpoint model"), so they are asked plainly. */
const plain = new Set();

/**
 * How many words in a stretch of speech carry meaning: not filler, not a stray letter or recognizer noise. Uses the
 * browser's word breaking where it has one, so languages written without spaces count too.
 * @param {string} text
 */
export function meaningfulWords(text) {
  const words = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].filter((part) => part.isWordLike).map((part) => part.segment)
    : text.split(/\s+/);
  return words.filter((word) => {
    const bare = word.replace(/[^\p{L}\p{N}]/gu, '');
    return bare.length > 1 && !FILLER.test(bare);
  }).length;
}

/**
 * Asks a model on an OpenAI-compatible server what to do with a stretch of speech. It is asked to skip hidden
 * reasoning and keep its answer short; a server or model that refuses those options is asked again without them.
 * @param {{ endpoint: string, model: string, key?: string }} settings `key` is sent as a bearer token when set
 * @param {{ role: string, content: string }[]} messages
 * @param {AbortSignal} [cancel] gives the request up early (the session ended)
 * @returns {Promise<string>} the assistant's message
 */
export async function askModel({ endpoint, model, key }, messages, cancel) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const giveUp = () => controller.abort();
  cancel?.addEventListener('abort', giveUp, { once: true });
  const known = `${base(endpoint)} ${model}`;
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json' };
  if (key?.trim()) headers.Authorization = `Bearer ${key.trim()}`;
  const ask = (/** @type {boolean} */ lean) => fetch(`${base(endpoint)}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model, messages, temperature: TEMPERATURE, stream: false, response_format: { type: 'json_object' },
      ...(lean ? { reasoning_effort: NO_REASONING, max_tokens: MAX_ANSWER_TOKENS } : {}),
    }),
    signal: controller.signal,
  });
  try {
    let response = await ask(!plain.has(known));
    if (response.status === BAD_REQUEST && !plain.has(known)) {
      plain.add(known);
      response = await ask(false);
    }
    if (!response.ok) throw new Error(`The model server answered ${response.status}`);
    const content = (await response.json())?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('The model server sent no message');
    return content;
  } finally {
    clearTimeout(timer);
    cancel?.removeEventListener('abort', giveUp);
  }
}

/**
 * The models the server offers, for the settings picker.
 * @param {string} endpoint
 * @param {boolean} [quick] give up after PROBE_TIMEOUT_MS (used when looking for a server, not when asked to list one)
 * @param {string} [key] sent as a bearer token when set
 * @returns {Promise<string[]>}
 */
export async function listModels(endpoint, quick = false, key = '') {
  // A timer rather than AbortSignal.timeout, which Chrome 99, Firefox 97 and Safari 15.4 don't have.
  const controller = new AbortController();
  const timer = quick ? setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS) : undefined;
  let response;
  try {
    response = await fetch(`${base(endpoint)}/models`, { headers: key.trim() ? { Authorization: `Bearer ${key.trim()}` } : {}, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`The model server answered ${response.status}`);
  const { data } = await response.json();
  return Array.isArray(data) ? data.map((model) => String(model?.id ?? '')).filter(Boolean) : [];
}
