// Scribe's conversation with the language model, the parts with no state: the instructions, the message for one
// stretch of speech, the request to an OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp and others serve
// /v1/chat/completions), and reading the answer back into checked actions. wordsmith's Worker builds the same
// messages for wordsmith cloud (api/functions/api/scribe.js), so the prompt and its limits live only here.
// The model answers in JSON rather than tool calls, because small local models follow a JSON shape far more reliably.
// It is never told about wordsmith's API: it only says what to create or update, and the app makes those changes.
import { FEATURE_STATES, MAX_BODY, MAX_PRIORITY, MAX_TITLE, PRIORITY_LABELS } from './models.js';
import WORK from './scribe-work-words.json' with { type: 'json' };

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
// The work words, and the common words a ticket title's words must not be (soundsLikeWork).
const WORK_WORDS = new Set(WORK.words);
const IGNORED_WORDS = new Set(WORK.ignore);
// A ticket title's or project name's word counts as a sign of work from this many letters (shorter ones are "the",
// "for"...).
const MIN_NAME_WORD = 4;
// Endings dropped to find a word's base form: "pages", "crashes", "loading", "broke" + "d"...
const ENDINGS = [['s', ''], ['es', ''], ['ing', ''], ['ing', 'e'], ['ed', ''], ['ed', 'e'], ['d', '']];
// Things only code looks like: camelCase, snake_case, a file name or a path.
const CODE_LIKE = /[a-z][A-Z]|\w[_./]\w/;
// A spoken list (a bar count, a stocktake) needs at least this many item + amount pairs in a row before the speech
// is treated as one list rather than talk that happens to mention numbers.
const MIN_LIST_ITEMS = 3;
// How much of the speech the pairs must account for: a list is nearly all items and amounts, so a sentence that
// only mentions a number or two stays ordinary speech.
const LIST_COVERAGE = 0.7;
// The longest run of words that can name one item. "Maker's Mark" is two; a whole clause is not an item name.
const MAX_ITEM_WORDS = 4;
// Speech that opens by telling someone to do something is work talk, not a count, however many numbers follow.
const WORK_OPENER = /^(fix|add|update|create|remove|delete|change|make|build|implement|write|send|check|test|ship|move|rename|refactor|debug|install|run|set|put|upgrade|deploy|review|merge|revert)\b/i;
// Words that can pad the edges of an item name without being part of it.
const ITEM_PADDING = new Set(['and', 'a', 'an', 'the', 'then', 'uh', 'um']);
// Asks that can open the first item of a list ("I need 2 eggs..."): the ask is not part of the item's name.
const FIRST_ITEM_ASK = /^(i|we) (need|want|got)\s*/i;
// Spoken whole numbers, the way speech recognition writes them when it doesn't use digits.
const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// Spoken fractions that stand as an amount on their own ("Jameson, 3 quarters"; "vodka, half").
const FRACTION_WORDS = { half: 0.5, halves: 0.5, quarter: 0.25, quarters: 0.25 };

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
- The new speech may finish a request begun in the earlier speech: then write the ticket for the whole request.
- Update only a ticket the speech is clearly about (it names the same feature or problem). New work gets a create, even when a listed ticket is in the same area. Never retitle a ticket to mean something else.
- priority: 0 none, 1 low, 2 normal, 3 high, 4 urgent, 5 critical. Set it only when they say how important it is.
- state: ${FEATURE_STATES.join(', ')}. Set it only when they say work started or finished.
- Spoken lists: when the speech counts or names items one after another (an inventory count, a shopping run), that is ONE ticket for the whole list, never one ticket per item: the title names what is being counted or collected, and the body is the list itself, one Markdown line per item as "- name — amount", amounts as digits, every item kept.
- Filler, half sentences, thinking aloud and anything that is not about work to do: {"actions":[{"op":"none"}]}.
- The speech comes from speech recognition. Fix obvious mishearings from context, and write code names the way a developer would.`;

/**
 * @typedef {{ ref: string, id: string, title: string, body: string, state: string, priority_level: number }} Ticket a note the model may change, under a short ref
 * @typedef {{ op: 'create', title: string, body: string, priority: number }} CreateAction
 * @typedef {{ op: 'update', ref: string, title?: string, body?: string, append?: string, priority?: number, state?: string }} UpdateAction
 * @typedef {CreateAction | UpdateAction} Action
 */

/**
 * @typedef {{ item: string, amount: number }} ListItem one line of a spoken list: what was counted, and how much
 */

/**
 * The words of a stretch of speech, punctuation dropped, original spelling kept for item names.
 * @param {string} speech
 * @returns {{ raw: string, lower: string }[]}
 */
function speechTokens(speech) {
  return (speech.match(/[a-z]+(?:'[a-z]+)?|\d+(?:\.\d+)?/gi) ?? []).map((raw) => ({ raw, lower: raw.toLowerCase() }));
}

/**
 * An amount starting at a token: digits ("2", "0.8"), number words ("twenty five"), decimals spoken as "point"
 * ("zero point 8", a bare "point 4" for 0.4), and fractions ("3 quarters", a bare "half").
 * @param {{ raw: string, lower: string }[]} tokens
 * @param {number} at
 * @returns {{ value: number, next: number } | null} the amount and the first token after it
 */
function amountAt(tokens, at) {
  let index = at;
  let value;
  const first = tokens[index];
  if (!first) return null;
  if (/^\d/.test(first.raw)) {
    value = Number(first.raw);
    index++;
  } else if (first.lower in NUMBER_WORDS) {
    value = NUMBER_WORDS[first.lower];
    index++;
    // Compound numbers: "twenty five". A tens word can take one ones word after it.
    if (value >= 20 && tokens[index] && tokens[index].lower in NUMBER_WORDS && NUMBER_WORDS[tokens[index].lower] < 10) {
      value += NUMBER_WORDS[tokens[index].lower];
      index++;
    }
  } else if (first.lower in FRACTION_WORDS) {
    return { value: FRACTION_WORDS[first.lower], next: at + 1 };
  } else if (first.lower !== 'point') {
    return null;
  }
  // Decimals after "point", digit by digit: "point 8" is 0.8, "point 8 5" is 0.85. With no whole part said, the
  // whole part is zero ("Makers point 4" is a bottle at 0.4).
  if (tokens[index]?.lower === 'point') {
    let digits = '';
    let cursor = index + 1;
    while (tokens[cursor] && (/^\d$/.test(tokens[cursor].raw) || (tokens[cursor].lower in NUMBER_WORDS && NUMBER_WORDS[tokens[cursor].lower] < 10))) {
      digits += String(/^\d$/.test(tokens[cursor].raw) ? tokens[cursor].raw : NUMBER_WORDS[tokens[cursor].lower]);
      cursor++;
    }
    if (!digits) return null;
    value = Number(`${value ?? 0}.${digits}`);
    index = cursor;
  }
  if (value === undefined) return null;
  // A counted fraction: "3 quarters" is 0.75.
  const fraction = tokens[index]?.lower;
  if (fraction && fraction in FRACTION_WORDS) return { value: value * FRACTION_WORDS[fraction], next: index + 1 };
  return { value, next: index };
}

/**
 * An item name from the words beside an amount: edge padding dropped, and null when what is left is empty or a
 * whole clause rather than a name.
 * @param {{ raw: string, lower: string }[]} words
 * @returns {string | null}
 */
function itemName(words) {
  const parts = words.filter((word) => !ITEM_PADDING.has(word.lower)).map((word) => word.raw);
  return parts.length && parts.length <= MAX_ITEM_WORDS ? parts.join(' ') : null;
}

/**
 * @typedef {{ items: ListItem[], covered: number, orphans: number }} ListParse one reading of the speech as a
 * list: its items, how many tokens they and their amounts account for, and how many words fit nowhere
 */

/**
 * The item-first reading: each amount closes the item named just before it ("Tito's, zero point 8").
 * @param {{ raw: string, lower: string }[]} tokens
 * @returns {ListParse | null}
 */
function itemsFirst(tokens) {
  /** @type {ListItem[]} */
  const items = [];
  /** @type {{ raw: string, lower: string }[]} */
  let words = [];
  let covered = 0;
  let index = 0;
  while (index < tokens.length) {
    const amount = amountAt(tokens, index);
    if (!amount) {
      words.push(tokens[index]);
      index++;
      continue;
    }
    // An ask can ride on the first item ("I need eggs, 2"): it is not part of the name.
    if (items.length === 0 && words.length > 2 && /^(i|we)$/.test(words[0].lower) && /^(need|want|got)$/.test(words[1].lower)) words = words.slice(2);
    const name = itemName(words);
    if (!name) return null;
    items.push({ item: name, amount: amount.value });
    covered += words.length + (amount.next - index);
    words = [];
    index = amount.next;
  }
  // Words after the last amount belong to no item.
  return { items, covered, orphans: words.length };
}

/**
 * The amount-first reading: each amount opens an item named just after it ("2 eggs, 3 apples"). Words before the
 * first amount are an opener ("I need..."), not an item; any that are not padding or a known ask are orphans.
 * @param {{ raw: string, lower: string }[]} tokens
 * @returns {ListParse | null}
 */
function amountsFirst(tokens) {
  /** @type {ListItem[]} */
  const items = [];
  let covered = 0;
  let orphans = 0;
  let index = 0;
  /** @type {{ raw: string, lower: string }[]} */
  let opener = [];
  while (index < tokens.length && !amountAt(tokens, index)) {
    opener.push(tokens[index]);
    index++;
  }
  const openerText = opener.map((word) => word.raw).join(' ').replace(FIRST_ITEM_ASK, '');
  orphans += openerText.split(' ').filter((word) => word && !ITEM_PADDING.has(word.toLowerCase())).length;
  while (index < tokens.length) {
    const amount = amountAt(tokens, index);
    if (!amount) return null;
    covered += amount.next - index;
    index = amount.next;
    /** @type {{ raw: string, lower: string }[]} */
    let words = [];
    while (index < tokens.length && !amountAt(tokens, index)) {
      words.push(tokens[index]);
      index++;
    }
    if (!words.length) {
      // An amount with nothing after it names no item; it counts against this reading rather than ending it.
      orphans++;
      continue;
    }
    const name = itemName(words);
    if (!name) return null;
    items.push({ item: name, amount: amount.value });
    covered += words.length;
  }
  return { items, covered, orphans };
}

/**
 * Reads a stretch of speech as a spoken list — items counted one after another, the way a bartender calls a
 * bottle count ("Tito's zero point 8, Makers point 4, Jameson 3 quarters, Bacardi one") or a shopper a grocery
 * run ("2 eggs, 3 apples") — and returns its items, or null when the speech is anything else. Both word orders
 * are read and the one that accounts for the speech better wins. Deliberately strict: at least MIN_LIST_ITEMS
 * item + amount pairs, nearly the whole stretch accounted for by them, short item names, and no imperative
 * opener. A missed list just becomes an ordinary ticket; a false one would mangle ordinary dictation, so every
 * doubt answers null.
 * @param {string} speech
 * @returns {ListItem[] | null}
 */
export function spokenList(speech) {
  if (typeof speech !== 'string') return null;
  const trimmed = speech.trim();
  if (!trimmed || WORK_OPENER.test(trimmed)) return null;
  const tokens = speechTokens(trimmed);
  const readings = [itemsFirst(tokens), amountsFirst(tokens)].filter((reading) => reading !== null && reading.items.length >= MIN_LIST_ITEMS && reading.covered / tokens.length >= LIST_COVERAGE);
  if (!readings.length) return null;
  readings.sort((a, b) => b.items.length - a.items.length || a.orphans - b.orphans || b.covered - a.covered);
  return readings[0].items;
}

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
  // A spoken list is counted here, deterministically, rather than left for the model to notice: small local
  // models miss the shape, and a counted list handed over as lines only has to be copied into one ticket.
  const counted = spokenList(speech);
  const countedLines = counted ? counted.map(({ item, amount }) => `- ${item} — ${Number(amount.toFixed(4))}`).join('\n') : '';
  const user = [
    `Project: ${project || 'none'}`,
    `Tickets:\n${list.length ? list.join('\n') : '(none yet)'}`,
    earlier ? `Earlier speech (already handled, for context only):\n${earlier}` : '',
    `New speech:\n${speech}`,
    counted ? `The new speech is a spoken list, counted by the app:\n${countedLines}\nAnswer with ONE create for the whole list: a title naming what is being counted or collected, and the body exactly this list.` : '',
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

/** How many words in a stretch of speech carry meaning: not filler, not a stray letter or recognizer noise. @param {string} text */
export function meaningfulWords(text) {
  return wordsOf(text).filter((word) => word.length > 1 && !FILLER.test(word)).length;
}

/**
 * A text's words, letters and digits only. Uses the browser's word breaking where it has one, so languages written
 * without spaces split too.
 * @param {string} text
 */
function wordsOf(text) {
  const words = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].filter((part) => part.isWordLike).map((part) => part.segment)
    : text.split(/\s+/);
  return words.map((word) => word.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
}

/**
 * Whether speech could be about work, checked on this device before it costs a request: it names something from
 * software work (scribe-work-words.json), a word from one of the tickets or the project, or looks like code. "I need
 * to get to a dentist" doesn't. Errs on the side of sending: a wrong yes costs one request, while a wrong no keeps
 * a ticket back until you press Send anyway.
 * @param {string} text
 * @param {string[]} names the listed tickets' titles and the project's name
 */
export function soundsLikeWork(text, names) {
  if (CODE_LIKE.test(text)) return true;
  const known = new Set(names.flatMap((name) => wordsOf(name.toLowerCase())).filter((word) => word.length >= MIN_NAME_WORD && !IGNORED_WORDS.has(word)));
  return wordsOf(text.toLowerCase()).some((word) => {
    const forms = [word, ...ENDINGS.filter(([ending]) => word.endsWith(ending)).map(([ending, base]) => word.slice(0, -ending.length) + base)];
    return forms.some((form) => WORK_WORDS.has(form) || known.has(form));
  });
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
    if (!response.ok) throw Object.assign(new Error(`The model server answered ${response.status}`), { status: response.status });
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
