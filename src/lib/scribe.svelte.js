// Scribe (beta): talk, and tickets write themselves while you are still talking. One press starts the microphone;
// the browser's own speech recognition turns speech into text; every finished thought goes straight to a language
// model on the owner's machine (src/lib/scribe-llm.js), which answers with tickets to create or update; those are
// applied to the store at once, so they show on the board and sync like any other edit. Nothing waits for the
// microphone to stop.
// One session for the whole app (the page and the floating pill share it), so it keeps running while you move
// between pages and watch the board fill in. Settings stay on this device: a local model's address means nothing on
// another machine.
// The model can be any provider in scribe-providers.json: wordsmith cloud (Workers AI through wordsmith's Worker), a
// model server on this machine, or any OpenAI-compatible server. Each provider remembers its own address and model.
import { auth } from './auth.svelte.js';
import { api } from './api.js';
import { store } from './store.svelte.js';
import { topPosition } from './reorder.svelte.js';
import { EARLIER_CHARS, MAX_SPEECH_CHARS, MAX_TICKETS, NOT_CHAT, askModel, listModels, meaningfulWords, parseActions, scribeMessages } from './scribe-llm.js';
import PROVIDERS from './scribe-providers.json';

const SETTINGS_KEY = 'ws_scribe';
const CLOUD_PATH = '/api/scribe';
const CLOUD_KIND = 'wordsmith';
// New setups start on wordsmith cloud: it needs nothing installed and works on phones.
const DEFAULT_PROVIDER = 'cloud';
const CUSTOM_PROVIDER = 'custom';
// What the Worker answers when this account's (or everyone's) wordsmith cloud allowance for today is used up.
export const ALLOWANCE_CODE = 'scribe_allowance';
// A thought is sent this long after its last word, so a breath mid-sentence doesn't split it, and each request carries
// a whole thought rather than a phrase.
const FLUSH_MS = 2_500;
// Long monologues are sent in pieces once this much text has piled up, without waiting for a pause.
const FLUSH_CHARS = 600;
// Speech with fewer meaningful words than this waits, however long the pause, and goes out with whatever is said next
// ("and the login page" on its own asks for nothing yet). Stopping the mic sends it anyway.
const MIN_WORDS = 4;
const MAX_LOG = 100;
// A ticket Scribe just wrote stays announced (beside the mic, on the pill) this long.
const RECENT_MS = 5_000;
const MAX_RECENT = 3;
// A short buzz for each ticket, on phones that let pages vibrate (not iPhones).
const BUZZ_MS = 35;
// The live caption beside the mic: the newest words, this many characters at most.
const CAPTION_CHARS = 160;
const MAX_TRANSCRIPT = 200;
// Recognition errors that are part of normal use: silence, and our own stop().
const QUIET_ERRORS = ['no-speech', 'aborted'];
const DENIED_ERRORS = ['not-allowed', 'service-not-allowed'];
const UNDO_FIELDS = ['title', 'body', 'priority_level', 'state'];

/** @typedef {{ id: string, kind: 'created' | 'updated', noteId: string, title: string, at: number, before: Record<string, any> | null, undone: boolean }} LogEntry */

const Recognition = typeof window === 'undefined' ? null : /** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition || null;

/**
 * @typedef {{ id: string, kind: 'wordsmith' | 'openai', name: string, note: string, endpoint?: string, local?: boolean, key?: boolean }} Provider
 * @typedef {{ endpoint: string, model: string, key: string }} Connection what one provider is set to
 * @typedef {Connection & { provider: string, projectId: string, saved: Record<string, Connection> }} Settings
 */

/** @type {Provider[]} */
export const SCRIBE_PROVIDERS = PROVIDERS.providers;

/** A provider by id, or the default one. @param {string} id */
export function providerOf(id) {
  return SCRIBE_PROVIDERS.find((provider) => provider.id === id) ?? /** @type {Provider} */ (SCRIBE_PROVIDERS.find((provider) => provider.id === DEFAULT_PROVIDER));
}

/** What a provider is set to before you change anything. @param {Provider} provider @returns {Connection} */
function fresh(provider) {
  return { endpoint: provider.endpoint ?? '', model: '', key: '' };
}

/** @returns {Settings} */
function loadSettings() {
  /** @type {Record<string, any>} */
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    // Unreadable settings start over.
  }
  if (stored.provider) {
    const provider = providerOf(stored.provider);
    return { ...fresh(provider), saved: {}, projectId: '', ...stored, provider: provider.id };
  }
  // Settings from before providers existed name only an address and a model. A model that was set keeps its server
  // (whichever provider lives at that address); with none set, Scribe starts on the default, wordsmith cloud.
  const provider = stored.model
    ? SCRIBE_PROVIDERS.find((candidate) => candidate.endpoint && candidate.endpoint === stored.endpoint) ?? providerOf(CUSTOM_PROVIDER)
    : providerOf(DEFAULT_PROVIDER);
  const kept = stored.model ? { endpoint: String(stored.endpoint ?? ''), model: String(stored.model) } : {};
  return { ...fresh(provider), ...kept, saved: {}, projectId: String(stored.projectId ?? ''), provider: provider.id };
}

class Scribe {
  /** False where the browser has no speech recognition (Firefox, some WebViews); typing still works. */
  canListen = Boolean(Recognition);
  settings = $state(loadSettings());
  listening = $state(false);
  /** A request to the model is in flight. */
  thinking = $state(false);
  /** Finished lines of speech, oldest first. @type {{ id: string, text: string, handled: boolean }[]} */
  transcript = $state([]);
  /** Words heard but not yet final. */
  interim = $state('');
  /** What Scribe did, newest first. @type {LogEntry[]} */
  log = $state([]);
  /** Tickets written in the last few seconds, newest first, for the announcements beside the mic and on the pill. @type {LogEntry[]} */
  recent = $state([]);
  /** 'mic-denied', 'mic', 'model', 'allowance' (wordsmith cloud's daily allowance is used up) or ''; `detail` carries the message. */
  problem = $state('');
  detail = $state('');
  /**
   * wordsmith cloud as the Worker describes it: its models and today's allowance. Null until asked (loadCloud).
   * @type {{ available: boolean, models: { id: string, name: string, note: string }[], default: string, used: number, limit: number } | null}
   */
  cloud = $state(null);

  /** @type {any} */ #recognition = null;
  /** Counts sessions: reset() moves it on, and anything still arriving from the session before is ignored. */ #run = 0;
  /** The model request in flight. @type {AbortController | null} */ #request = null;
  /** The account this session belongs to (see claim). @type {string | undefined} */ #owner;
  /** Speech waiting to go to the model. */ #pending = '';
  /** Speech already handled, for context. */ #earlier = '';
  /** Notes this session created or changed, most recent last. @type {string[]} */ #touched = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */ #timer;

  /** The provider Scribe sends speech to. */
  get provider() {
    return providerOf(this.settings.provider);
  }

  /** True when the provider can be asked: wordsmith cloud needs you signed in, every other one an address and a model. */
  get ready() {
    if (this.provider.kind === CLOUD_KIND) return Boolean(auth.user);
    return Boolean(this.settings.endpoint.trim() && this.settings.model.trim());
  }

  /**
   * With no model chosen yet, looks for a model server already running on this machine and picks its first chat model,
   * so Scribe works without typing an address. Leaves a chosen model, and wordsmith cloud, alone.
   * @returns {Promise<boolean>} true when one was found and set
   */
  async detect() {
    if (this.provider.kind === CLOUD_KIND || this.settings.model.trim()) return false;
    const local = SCRIBE_PROVIDERS.filter((provider) => provider.local);
    // The chosen provider first, then every other one on this machine.
    for (const provider of [this.provider, ...local.filter((candidate) => candidate !== this.provider)]) {
      const endpoint = provider === this.provider ? this.settings.endpoint : provider.endpoint ?? '';
      if (!endpoint) continue;
      const models = await listModels(endpoint, true).catch(() => []);
      const model = models.find((name) => !NOT_CHAT.test(name));
      // Chosen by hand while we were looking: that wins.
      if (this.settings.model.trim() || this.provider.kind === CLOUD_KIND) return false;
      if (!model) continue;
      if (provider !== this.provider) this.configure({ provider: provider.id });
      this.configure({ endpoint, model });
      return true;
    }
    return false;
  }

  /**
   * Changes settings. Switching provider keeps what the old one was set to and brings back what the new one had.
   * @param {Partial<Settings>} patch
   */
  configure(patch) {
    let next = { ...this.settings, ...patch };
    if (patch.provider && patch.provider !== this.settings.provider) {
      const { endpoint, model, key } = this.settings;
      const saved = { ...this.settings.saved, [this.settings.provider]: { endpoint, model, key } };
      next = { ...next, ...(saved[patch.provider] ?? fresh(providerOf(patch.provider))), saved };
    }
    this.settings = next;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    if (this.provider.kind === CLOUD_KIND && !this.cloud) this.loadCloud();
    // Speech that was waiting for a model to be set goes out as soon as one is.
    if (this.problem === 'model' && !this.detail && this.ready) this.retry();
  }

  /** Asks the Worker for wordsmith cloud's models and today's allowance. Signed out, there is nothing to ask. */
  async loadCloud() {
    if (!auth.user) return;
    try {
      this.cloud = await api(CLOUD_PATH);
    } catch {
      this.cloud = { available: false, models: [], default: '', used: 0, limit: 0 };
    }
  }

  /**
   * Asks the chosen provider what to do with a turn of speech.
   * @param {{ project: string, tickets: import('./scribe-llm.js').Ticket[], earlier: string, speech: string }} turn
   * @param {AbortSignal} cancel
   * @returns {Promise<string>} the model's answer
   */
  async #ask(turn, cancel) {
    if (this.provider.kind !== CLOUD_KIND) return askModel(this.settings, scribeMessages(turn), cancel);
    const tickets = turn.tickets.map(({ ref, title, body, state, priority_level }) => ({ ref, title, body, state, priority_level }));
    const answer = await api(CLOUD_PATH, { method: 'POST', body: { ...turn, tickets, model: this.settings.model || undefined } });
    // A session reset while this was in flight drops the answer by itself (#flush checks its run).
    if (this.cloud) this.cloud = { ...this.cloud, used: answer.used, limit: answer.limit };
    return answer.content;
  }

  /** One press: start listening, or stop. Speech already heard is still sent after a stop. */
  toggle() {
    if (this.listening) return this.stop();
    if (!Recognition) return;
    this.problem = '';
    this.detail = '';
    this.listening = true;
    this.#listen();
  }

  stop() {
    this.listening = false;
    this.interim = '';
    this.#recognition?.stop();
    this.#recognition = null;
    this.#flush();
  }

  /**
   * Ties the session to the signed-in account. A different account than before (signed in from another tab, say,
   * without this one ever signing out) gets a clean session: the Shell calls this whenever the account changes.
   * @param {string | undefined} userId
   */
  claim(userId) {
    if (userId === this.#owner) return;
    this.reset();
    this.#owner = userId;
  }

  /**
   * Ends the session for good and forgets it: signing out, or the account changing. Unlike stop(), nothing heard is
   * sent on; a request in flight is given up and its answer ignored, so one account's speech can never become a ticket
   * in the next one's notes, and its transcript and activity are gone.
   */
  reset() {
    this.#run++;
    this.#request?.abort();
    this.#request = null;
    clearTimeout(this.#timer);
    this.listening = false;
    this.thinking = false;
    this.interim = '';
    this.#recognition?.stop();
    this.#recognition = null;
    this.clear();
  }

  #listen() {
    const run = this.#run;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (/** @type {any} */ event) => {
      // Words still arriving from a session that was reset belong to nobody now.
      if (run !== this.#run) return;
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) this.hear(result[0].transcript);
        else interim += result[0].transcript;
      }
      this.interim = interim.trim();
    };
    recognition.onerror = (/** @type {any} */ event) => {
      // An error from a recognizer that is no longer the one listening (reset, or replaced) is nobody's problem.
      if (run !== this.#run || this.#recognition !== recognition) return;
      if (QUIET_ERRORS.includes(event.error)) return;
      this.problem = DENIED_ERRORS.includes(event.error) ? 'mic-denied' : 'mic';
      this.detail = event.error;
      this.listening = false;
    };
    // Browsers end a session after a silence or a few minutes: carry straight on while the mic is meant to be on.
    recognition.onend = () => {
      if (this.#recognition !== recognition) return;
      this.#recognition = null;
      if (this.listening) this.#listen();
    };
    this.#recognition = recognition;
    try {
      recognition.start();
    } catch {
      this.problem = 'mic';
      this.listening = false;
    }
  }

  /**
   * Takes one finished line of speech (or typed text) and queues it for the model. A line of only filler ("um", "okay
   * so") or recognizer noise shows in the transcript but is never sent. Typed text goes at once.
   * @param {string} text @param {boolean} [typed]
   */
  hear(text, typed = false) {
    const line = text.trim();
    if (!line) return;
    const meaningful = meaningfulWords(line) > 0;
    this.transcript.push({ id: crypto.randomUUID(), text: line, handled: !meaningful });
    if (this.transcript.length > MAX_TRANSCRIPT) this.transcript.shift();
    if (!meaningful) return;
    this.#pending = `${this.#pending} ${line}`.trim();
    clearTimeout(this.#timer);
    if (typed || this.#pending.length >= FLUSH_CHARS) this.#flush(true);
    else this.#timer = setTimeout(() => this.#flush(), FLUSH_MS);
  }

  /** The tickets the model may update, under short refs (T1, T2...). @returns {import('./scribe-llm.js').Ticket[]} */
  #tickets() {
    const live = store.notes.filter((note) => !note.deleted_at && !note.archived);
    const touched = this.#touched.map((id) => live.find((note) => note.id === id)).filter(Boolean).reverse();
    const recent = live.filter((note) => note.state !== 'complete' && (note.project_id || '') === this.settings.projectId && !this.#touched.includes(note.id))
      .sort((a, b) => b.updated_at - a.updated_at);
    return [...touched, ...recent].slice(0, MAX_TICKETS).map((note, index) => ({ ref: `T${index + 1}`, id: note.id, title: note.title, body: note.body, state: note.state, priority_level: note.priority_level }));
  }

  /**
   * Sends the waiting speech to the model, one request at a time; speech that arrives meanwhile goes in the next.
   * While listening, too few meaningful words wait for more; `force` (stopped, typed, retried) sends them anyway.
   * @param {boolean} [force]
   */
  async #flush(force = false) {
    clearTimeout(this.#timer);
    if (this.thinking || !this.#pending) return;
    if (!force && this.listening && meaningfulWords(this.#pending) < MIN_WORDS) return;
    if (!this.ready) {
      this.problem = 'model';
      this.detail = '';
      return;
    }
    // A very long backlog goes a piece at a time, cut between words.
    const cut = this.#pending.length <= MAX_SPEECH_CHARS ? this.#pending.length : this.#pending.lastIndexOf(' ', MAX_SPEECH_CHARS) + 1 || MAX_SPEECH_CHARS;
    const speech = this.#pending.slice(0, cut).trim();
    this.#pending = this.#pending.slice(cut).trim();
    // Lines are marked sent once nothing of them is left waiting.
    const lines = this.#pending ? [] : this.transcript.filter((line) => !line.handled).map((line) => line.id);
    const run = this.#run;
    // The account the speech belongs to: its answer is only ever written while that account is still the one signed in.
    const owner = auth.user?.id;
    const request = new AbortController();
    this.#request = request;
    this.thinking = true;
    try {
      const tickets = this.#tickets();
      const target = this.settings.projectId ? store.find('projects', this.settings.projectId) : null;
      // A project trashed since it was picked takes no more tickets.
      if (this.settings.projectId && (!target || target.deleted_at)) this.configure({ projectId: '' });
      const project = target && !target.deleted_at ? target.name : '';
      const answer = await this.#ask({ project, tickets, earlier: this.#earlier, speech }, request.signal);
      // The session was reset, or the account changed, while the model was thinking: this answer is for someone gone.
      if (run !== this.#run || auth.user?.id !== owner) return;
      this.#apply(parseActions(answer, tickets), tickets);
      this.#earlier = `${this.#earlier} ${speech}`.trim().slice(-EARLIER_CHARS);
      for (const line of this.transcript) if (lines.includes(line.id)) line.handled = true;
      this.problem = '';
      this.detail = '';
    } catch (error) {
      if (run !== this.#run) return;
      // Keep the speech: it goes out again with whatever is said next, or on Retry.
      this.#pending = `${speech} ${this.#pending}`.trim();
      const failure = /** @type {Error & { code?: string }} */ (error);
      this.problem = failure.code === ALLOWANCE_CODE ? 'allowance' : 'model';
      this.detail = failure.name === 'AbortError' ? 'timeout' : failure.message;
    } finally {
      if (run === this.#run) this.thinking = false;
    }
    // Speech that came in meanwhile follows; once the mic is off, short speech no longer waits for more.
    if (this.#pending && !this.problem) this.#flush(!this.listening);
  }

  /** Sends speech that is still waiting after a failed request. */
  retry() {
    this.problem = '';
    this.#flush(true);
  }

  /** True while speech is waiting on a failed request. */
  get waiting() {
    return this.transcript.some((line) => !line.handled);
  }

  /**
   * Writes the model's actions to the store and the log.
   * @param {import('./scribe-llm.js').Action[]} actions @param {import('./scribe-llm.js').Ticket[]} tickets
   */
  #apply(actions, tickets) {
    for (const action of actions) {
      if (action.op === 'create') {
        const note = store.create('notes', { project_id: this.settings.projectId || null, title: action.title, body: action.body, priority_level: action.priority, position: topPosition() });
        this.#record('created', note, null);
        continue;
      }
      const note = store.find('notes', tickets.find((ticket) => ticket.ref === action.ref)?.id ?? '');
      if (!note || note.deleted_at) continue;
      const before = Object.fromEntries(UNDO_FIELDS.map((field) => [field, note[field]]));
      /** @type {Record<string, any>} */
      const patch = {};
      if (action.title) patch.title = action.title;
      if (action.body) patch.body = action.body;
      if (action.append) patch.body = `${patch.body ?? note.body}\n\n${action.append}`.trim();
      if (action.priority !== undefined) patch.priority_level = action.priority;
      if (action.state) patch.state = action.state;
      const saved = store.update('notes', note.id, patch);
      if (saved) this.#record('updated', saved, before);
    }
  }

  /** @param {'created' | 'updated'} kind @param {any} note @param {Record<string, any> | null} before */
  #record(kind, note, before) {
    this.#touched = [...this.#touched.filter((id) => id !== note.id), note.id];
    const entry = { id: crypto.randomUUID(), kind, noteId: note.id, title: note.title, at: Date.now(), before, undone: false };
    this.log.unshift(entry);
    if (this.log.length > MAX_LOG) this.log.pop();
    // Announced at once, so a ticket appearing is impossible to miss while you talk.
    this.recent = [entry, ...this.recent].slice(0, MAX_RECENT);
    setTimeout(() => {
      this.recent = this.recent.filter((shown) => shown.id !== entry.id);
    }, RECENT_MS);
    navigator.vibrate?.(BUZZ_MS);
  }

  /** Tickets this session created or changed, not counting undone ones. */
  get made() {
    return this.log.filter((entry) => !entry.undone).length;
  }

  /** The newest words for the caption beside the mic: the last finished line, then what is being heard now. */
  get caption() {
    const last = this.transcript.at(-1)?.text ?? '';
    const said = this.interim ? `${last} ${this.interim}`.trim() : last;
    return said.length > CAPTION_CHARS ? `…${said.slice(-CAPTION_CHARS)}` : said;
  }

  /** Takes one action back: a created ticket goes to the trash, an updated one gets its old text back. @param {string} entryId */
  undo(entryId) {
    const entry = this.log.find((candidate) => candidate.id === entryId);
    if (!entry || entry.undone) return;
    if (entry.kind === 'created') store.remove('notes', entry.noteId);
    else if (entry.before) store.update('notes', entry.noteId, entry.before);
    entry.undone = true;
  }

  /** Clears the session's transcript and log (tickets stay). */
  clear() {
    this.transcript = [];
    this.log = [];
    this.recent = [];
    this.#pending = '';
    this.#earlier = '';
    this.#touched = [];
    this.problem = '';
    this.detail = '';
  }
}

export const scribe = new Scribe();
