// Scribe (beta): talk, and tickets write themselves while you are still talking. One press starts the microphone;
// the browser's own speech recognition turns speech into text; every finished thought goes straight to a language
// model on the owner's machine (src/lib/scribe-llm.js), which answers with tickets to create or update; those are
// applied to the store at once, so they show on the board and sync like any other edit. Nothing waits for the
// microphone to stop.
// One session for the whole app (the page and the floating pill share it), so it keeps running while you move
// between pages and watch the board fill in. Settings stay on this device: a local model's address means nothing on
// another machine.
import { store } from './store.svelte.js';
import { topPosition } from './reorder.svelte.js';
import { askModel, parseActions, scribeMessages } from './scribe-llm.js';

const SETTINGS_KEY = 'ws_scribe';
// Ollama's OpenAI-compatible address; LM Studio uses http://localhost:1234/v1.
const DEFAULT_ENDPOINT = 'http://localhost:11434/v1';
// A thought is sent this long after its last word, so a breath mid-sentence doesn't split it.
const FLUSH_MS = 1_200;
// Long monologues are sent in pieces once this much text has piled up, without waiting for a pause.
const FLUSH_CHARS = 600;
// Tickets the model may update: the ones this session touched, then the project's most recently changed open ones.
const MAX_TICKETS = 25;
// How much already-handled speech rides along as context.
const EARLIER_CHARS = 600;
const MAX_LOG = 100;
const MAX_TRANSCRIPT = 200;
// Recognition errors that are part of normal use: silence, and our own stop().
const QUIET_ERRORS = ['no-speech', 'aborted'];
const DENIED_ERRORS = ['not-allowed', 'service-not-allowed'];
const UNDO_FIELDS = ['title', 'body', 'priority_level', 'state'];

/** @typedef {{ id: string, kind: 'created' | 'updated', noteId: string, title: string, at: number, before: Record<string, any> | null, undone: boolean }} LogEntry */

const Recognition = typeof window === 'undefined' ? null : /** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition || null;

/** @returns {{ endpoint: string, model: string, projectId: string }} */
function loadSettings() {
  try {
    return { endpoint: DEFAULT_ENDPOINT, model: '', projectId: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { endpoint: DEFAULT_ENDPOINT, model: '', projectId: '' };
  }
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
  /** 'mic-denied', 'mic', 'model' or ''; `detail` carries the model's message. */
  problem = $state('');
  detail = $state('');

  /** @type {any} */ #recognition = null;
  /** Speech waiting to go to the model. */ #pending = '';
  /** Speech already handled, for context. */ #earlier = '';
  /** Notes this session created or changed, most recent last. @type {string[]} */ #touched = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */ #timer;

  get ready() {
    return Boolean(this.settings.endpoint.trim() && this.settings.model.trim());
  }

  /** @param {Partial<{ endpoint: string, model: string, projectId: string }>} patch */
  configure(patch) {
    this.settings = { ...this.settings, ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    // Speech that was waiting for a model to be set goes out as soon as one is.
    if (this.problem === 'model' && !this.detail && this.ready) this.retry();
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

  #listen() {
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (/** @type {any} */ event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) this.hear(result[0].transcript);
        else interim += result[0].transcript;
      }
      this.interim = interim.trim();
    };
    recognition.onerror = (/** @type {any} */ event) => {
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

  /** Takes one finished line of speech (or typed text) and queues it for the model. @param {string} text */
  hear(text) {
    const line = text.trim();
    if (!line) return;
    this.transcript.push({ id: crypto.randomUUID(), text: line, handled: false });
    if (this.transcript.length > MAX_TRANSCRIPT) this.transcript.shift();
    this.#pending = `${this.#pending} ${line}`.trim();
    clearTimeout(this.#timer);
    if (this.#pending.length >= FLUSH_CHARS) this.#flush();
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

  /** Sends the waiting speech to the model, one request at a time; speech that arrives meanwhile goes in the next. */
  async #flush() {
    clearTimeout(this.#timer);
    if (this.thinking || !this.#pending) return;
    if (!this.ready) {
      this.problem = 'model';
      this.detail = '';
      return;
    }
    const speech = this.#pending;
    const lines = this.transcript.filter((line) => !line.handled).map((line) => line.id);
    this.#pending = '';
    this.thinking = true;
    try {
      const tickets = this.#tickets();
      const project = this.settings.projectId ? store.find('projects', this.settings.projectId)?.name ?? '' : '';
      const answer = await askModel(this.settings, scribeMessages({ project, tickets, earlier: this.#earlier, speech }));
      this.#apply(parseActions(answer, tickets), tickets);
      this.#earlier = `${this.#earlier} ${speech}`.trim().slice(-EARLIER_CHARS);
      for (const line of this.transcript) if (lines.includes(line.id)) line.handled = true;
      this.problem = '';
      this.detail = '';
    } catch (error) {
      // Keep the speech: it goes out again with whatever is said next, or on Retry.
      this.#pending = `${speech} ${this.#pending}`.trim();
      this.problem = 'model';
      this.detail = /** @type {Error} */ (error).name === 'AbortError' ? 'timeout' : /** @type {Error} */ (error).message;
    } finally {
      this.thinking = false;
    }
    if (this.#pending && !this.problem) this.#flush();
  }

  /** Sends speech that is still waiting after a failed request. */
  retry() {
    this.problem = '';
    this.#flush();
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
    this.log.unshift({ id: crypto.randomUUID(), kind, noteId: note.id, title: note.title, at: Date.now(), before, undone: false });
    if (this.log.length > MAX_LOG) this.log.pop();
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
    this.#pending = '';
    this.#earlier = '';
    this.#touched = [];
    this.problem = '';
    this.detail = '';
  }
}

export const scribe = new Scribe();
