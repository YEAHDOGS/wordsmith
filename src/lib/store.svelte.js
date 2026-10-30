// Offline-first data store. Every edit lands in memory and IndexedDB first, joins an outbox, and syncs to
// Cloudflare in the background: push the outbox, then pull everything changed since the last cursor.
// Sync runs on edits (debounced), on focus, on reconnect, and on a slow poll so agent updates show up.
// Every request counts against Cloudflare's free tier, so sync is frugal: edits wait for a pause in typing, a push
// skips the pull right after it when one ran recently, the poll slows down once you stop using the app and stops
// while it's hidden, and coming back only syncs if the last pull is a little stale. The server answers "nothing
// new" polls with a single small query (api/functions/api/sync.js).
import { api, uploadFile } from './api.js';
import { LocalDb } from './idb.js';
import { prepareForUpload } from './compress.js';
import { LEGACY_PRIORITY, MAX_NAME, MAX_SYNC_BATCH, NAME_TAKEN, newRow, projectKey } from './models.js';

const SYNCED = /** @type {const} */ (['projects', 'labels', 'notes', 'boards', 'note_groups']);
const SYNC_DEBOUNCE_MS = 2_500;
// Poll every minute while you're using the app, every five once you've been idle for five.
const POLL_MS = 60_000;
const IDLE_POLL_MS = 300_000;
const IDLE_AFTER_MS = 300_000;
// A push skips its follow-up pull when the last pull is this fresh; focus only syncs when it's older than FOCUS_STALE_MS.
const PULL_AFTER_PUSH_MS = 30_000;
const FOCUS_STALE_MS = 15_000;
const PURGE_SYNC_WAIT_MS = 30_000;
const SYNC_WAIT_POLL_MS = 50;
// The GitHub webhook makes merges instant; this re-check is the fallback for repos without it.
const PR_REFRESH_MS = 600_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown'];
const UNAUTHORIZED = 401;
// A project created offline under a name that's taken is renamed "<name> (2)", (3)... from this number.
const FIRST_COPY = 2;
// An earlier " (n)" is replaced rather than stacked: "Café (2)" becomes "Café (3)", not "Café (2) (2)".
const COPY_SUFFIX = / \(\d+\)$/;
const BLOCKED_UPGRADE = 'Another wordsmith tab is open on an older version. Close or reload it to finish updating.';

/** @typedef {'projects' | 'labels' | 'notes' | 'boards' | 'note_groups'} Table */

/** @param {any} value */
const plain = (value) => JSON.parse(JSON.stringify(value));

class Store {
  /** @type {any[]} */ projects = $state([]);
  /** @type {any[]} */ labels = $state([]);
  /** @type {any[]} */ notes = $state([]);
  /** Custom feature boards, one per scope (models.js FEATURES_SCOPE or a project id). @type {any[]} */ boards = $state([]);
  /** Note groups in projects (src/lib/groups.js). @type {any[]} */ note_groups = $state([]);
  /** @type {any[]} */ events = $state([]);
  /** @type {any[]} */ attachments = $state([]);
  /** Uploads in flight: { id, noteId, name, progress, error }. @type {any[]} */ uploads = $state([]);
  syncing = $state(false);
  online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  lastSync = $state(0);
  pending = $state(0);
  error = $state('');
  /** Called when the server says the session is gone. */
  onUnauthorized = () => {};
  /** Called when the server's signed-in user isn't the one this store opened for (start-up trusted a stale cache). */
  onOtherUser = () => {};

  /** @type {LocalDb | null} */ #db = null;
  /** @type {Map<string, number>} outbox key "table:id" -> local version */ #outbox = new Map();
  #version = 0;
  #cursor = 0;
  #again = false;
  #lastPrRefresh = 0;
  #lastPull = 0;
  /** A full sync (push and pull) was asked for and hasn't run yet. */
  #fullPending = false;
  #userId = '';
  /** Projects renamed after a name clash during the current push (each at most once). */
  #renamed = new Set();
  /** The server has confirmed it is signed in as #userId; nothing is pushed before that. */
  #verified = false;
  #lastActivity = Date.now();
  /** @type {ReturnType<typeof setTimeout> | undefined} */ #debounce;
  /** @type {ReturnType<typeof setInterval> | undefined} */ #poll;

  #onFocus = () => document.visibilityState === 'visible' && Date.now() - this.#lastPull > FOCUS_STALE_MS && this.sync();
  #onActivity = () => (this.#lastActivity = Date.now());
  /** Every minute: sync if visible and the last pull is older than the active or idle poll interval. */
  #onTick = () => {
    if (document.visibilityState !== 'visible') return;
    const interval = Date.now() - this.#lastActivity > IDLE_AFTER_MS ? IDLE_POLL_MS : POLL_MS;
    if (Date.now() - this.#lastPull >= interval - SYNC_DEBOUNCE_MS) this.sync();
  };
  #onOnline = () => {
    this.online = navigator.onLine;
    if (this.online) this.sync();
  };

  /** Loads the local copy for a user, then syncs. @param {string} userId */
  async open(userId) {
    this.close();
    this.#userId = userId;
    this.#verified = false;
    // An older wordsmith tab holding the local database blocks its upgrade: say so instead of sitting empty.
    this.#db = new LocalDb(userId, () => (this.error = BLOCKED_UPGRADE));
    const [projects, labels, notes, boards, note_groups, events, attachments, cursor, outbox] = await Promise.all([
      this.#db.all('projects'), this.#db.all('labels'), this.#db.all('notes'), this.#db.all('boards'), this.#db.all('note_groups'), this.#db.all('events'), this.#db.all('attachments'),
      this.#db.getMeta('cursor'), this.#db.getMeta('outbox'),
    ]);
    // Notes cached before migration 20261027040000 only carry the old 0..3 priority; derive the 0..5 level.
    for (const note of notes) note.priority_level ??= Math.max(0, LEGACY_PRIORITY.indexOf(note.priority));
    Object.assign(this, { projects, labels, notes, boards, note_groups, events, attachments });
    this.#cursor = cursor || 0;
    this.#outbox = new Map((outbox || []).map((/** @type {string} */ key) => [key, 0]));
    this.pending = this.#outbox.size;
    addEventListener('online', this.#onOnline);
    addEventListener('offline', this.#onOnline);
    document.addEventListener('visibilitychange', this.#onFocus);
    for (const type of ACTIVITY_EVENTS) addEventListener(type, this.#onActivity, { passive: true });
    this.#poll = setInterval(this.#onTick, POLL_MS);
    this.sync();
  }

  close() {
    removeEventListener('online', this.#onOnline);
    removeEventListener('offline', this.#onOnline);
    document.removeEventListener('visibilitychange', this.#onFocus);
    for (const type of ACTIVITY_EVENTS) removeEventListener(type, this.#onActivity);
    clearInterval(this.#poll);
    clearTimeout(this.#debounce);
  }

  /** Signs out: forget everything on this device. */
  async wipe() {
    this.close();
    await this.#db?.destroy().catch(() => {});
    this.#db = null;
    Object.assign(this, { projects: [], labels: [], notes: [], boards: [], note_groups: [], events: [], attachments: [], uploads: [], pending: 0, lastSync: 0 });
    this.#outbox.clear();
    this.#cursor = 0;
  }

  /** @param {Table} table @param {string} id */
  find(table, id) {
    return this[table].find((row) => row.id === id);
  }

  /** True while a local change to this row hasn't reached the server. Reads `pending` so callers stay reactive. @param {Table} table @param {string} id */
  isPending(table, id) {
    return this.pending > 0 && this.#outbox.has(`${table}:${id}`);
  }

  /** @param {Table} table @param {any} row */
  #upsertLocal(table, row) {
    const list = this[table];
    const index = list.findIndex((existing) => existing.id === row.id);
    if (index === -1) list.push(row);
    else list[index] = row;
  }

  /**
   * Saves a row locally and queues it for sync.
   * @param {Table} table
   * @param {any} row
   */
  #save(table, row) {
    const next = { ...plain(row), updated_at: Date.now() };
    this.#upsertLocal(table, next);
    this.#db?.put(table, [next]);
    this.#outbox.set(`${table}:${next.id}`, ++this.#version);
    this.#persistOutbox();
    clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => this.sync(), SYNC_DEBOUNCE_MS);
    return next;
  }

  /** @param {Table} table @param {Record<string, any>} [values] */
  create(table, values = {}) {
    return this.#save(table, newRow(table, values));
  }

  /** @param {Table} table @param {string} id @param {Record<string, any>} patch */
  update(table, id, patch) {
    const current = this.find(table, id);
    if (!current) return null;
    return this.#save(table, { ...plain(current), ...patch });
  }

  /** Tombstones a row; every device drops it on its next sync. @param {Table} table @param {string} id */
  remove(table, id) {
    return this.update(table, id, { deleted_at: Date.now() });
  }

  /**
   * Deletes trashed rows for good on the server ("Delete forever", "Empty trash"), in batches the server accepts.
   * Needs a connection: purging removes attachment files, which only the server can do. Deletes still waiting in the
   * outbox are pushed first, since the server only purges rows it knows are deleted.
   * @param {Partial<Record<Table, string[]>>} rows
   */
  async purge(rows) {
    const ids = Object.entries(rows).flatMap(([table, list]) => (list || []).map((id) => [table, id]));
    if (ids.some(([table, id]) => this.#outbox.has(`${table}:${id}`))) {
      const deadline = Date.now() + PURGE_SYNC_WAIT_MS;
      while (this.syncing && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, SYNC_WAIT_POLL_MS));
      if (this.syncing) throw new Error('Sync is taking too long. Try deleting forever again when it finishes.');
      await this.sync();
      while (this.syncing && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, SYNC_WAIT_POLL_MS));
      if (this.syncing || ids.some(([table, id]) => this.#outbox.has(`${table}:${id}`))) {
        throw new Error('The deletion has not synced yet. Try deleting forever again when sync is complete.');
      }
    }
    for (let start = 0; start < ids.length; start += MAX_SYNC_BATCH) {
      /** @type {Record<string, string[]>} */
      const body = {};
      for (const [table, id] of ids.slice(start, start + MAX_SYNC_BATCH)) (body[table] ||= []).push(id);
      const result = await api('/api/trash', { method: 'POST', body });
      for (const table of SYNCED) {
        const saved = result.saved[table] || [];
        for (const row of saved) this.#upsertLocal(table, row);
        await this.#db?.put(table, saved);
      }
    }
    this.sync();
  }

  #persistOutbox() {
    this.pending = this.#outbox.size;
    this.#db?.setMeta('outbox', [...this.#outbox.keys()]);
  }

  /**
   * Push the outbox, then pull changes. Safe to call often; overlapping calls coalesce.
   * @param {boolean} [full] always pull after the push (closing a note), even if a pull ran moments ago
   */
  async sync(full = false) {
    if (!this.#db) return;
    if (full) this.#fullPending = true;
    if (this.syncing) {
      this.#again = true;
      return;
    }
    if (!navigator.onLine) {
      this.online = false;
      return;
    }
    this.syncing = true;
    try {
      // First sync after opening: pull first, so the server confirms whose data this is before anything is pushed.
      if (!this.#verified) await this.#pull();
      if (!this.#verified) return;
      const pushed = await this.#push();
      // The push already returned the saved rows; other devices' changes can wait for the next poll.
      const full = this.#fullPending;
      this.#fullPending = false;
      if (full || !pushed || Date.now() - this.#lastPull > PULL_AFTER_PUSH_MS) await this.#pull();
      this.online = true;
      this.lastSync = Date.now();
      this.error = '';
      await this.#refreshPullRequests();
    } catch (error) {
      const failure = /** @type {any} */ (error);
      if (failure.status === UNAUTHORIZED) this.onUnauthorized();
      else if (failure instanceof TypeError) this.online = false;
      else this.error = failure.message;
    } finally {
      this.syncing = false;
      if (this.#again) {
        this.#again = false;
        this.sync();
      }
    }
  }

  /** Sends the outbox in batches. @returns {Promise<boolean>} whether anything was sent */
  async #push() {
    let sent = false;
    this.#renamed.clear();
    while (this.#outbox.size) {
      sent = true;
      const batch = [...this.#outbox].slice(0, MAX_SYNC_BATCH);
      /** @type {Record<string, any[]>} */
      const body = Object.fromEntries(SYNCED.map((table) => [table, /** @type {any[]} */ ([])]));
      for (const [key] of batch) {
        const [table, id] = key.split(':');
        const row = this.find(/** @type {Table} */ (table), id);
        if (row) body[table].push(plain(row));
      }
      const result = await api('/api/sync', { method: 'POST', body });
      const saved = [];
      for (const table of SYNCED) {
        for (const row of result.saved[table] || []) {
          const key = `${table}:${row.id}`;
          const sentVersion = batch.find(([sent]) => sent === key)?.[1];
          // Edited again while this push was in flight? Keep the newer local copy queued.
          if (this.#outbox.get(key) !== sentVersion) continue;
          this.#outbox.delete(key);
          this.#upsertLocal(table, row);
          saved.push([table, row]);
        }
      }
      for (const { id, table: refusedTable, error, current, code } of result.rejected) {
        for (const table of SYNCED) this.#outbox.delete(`${table}:${id}`);
        this.error = `A change was rejected: ${error}`;
        if (refusedTable === 'projects') await this.#settleProject(id, current, code);
      }
      // Anything left from this batch that the server didn't mention would loop forever; drop it.
      for (const [key, version] of batch) if (this.#outbox.get(key) === version) this.#outbox.delete(key);
      for (const table of SYNCED) await this.#db?.put(table, saved.filter(([name]) => name === table).map(([, row]) => row));
      this.#persistOutbox();
    }
    return sent;
  }

  /**
   * The server refused a project. With its copy (a refused rename, or another field it couldn't take), show that: a
   * refused rename keeps every other edit, which the server saved. Without one, and only because the name was taken
   * (a project created here, never saved), keep it and its notes under a free name, "Café (2)", which syncs on the
   * next pass of this push. Each project is renamed at most once per push, so a clash can never loop.
   * @param {string} id @param {any} current @param {string} [code]
   */
  async #settleProject(id, current, code) {
    if (current) {
      this.#upsertLocal('projects', current);
      await this.#db?.put('projects', [current]);
      return;
    }
    const project = this.find('projects', id);
    if (code !== NAME_TAKEN || !project || this.#renamed.has(id)) return;
    this.#renamed.add(id);
    const taken = new Set(this.projects.filter((other) => other.id !== id && !other.deleted_at).map((other) => projectKey(other.name)));
    const base = project.name.replace(COPY_SUFFIX, '');
    let copy = FIRST_COPY;
    while (taken.has(projectKey(`${base} (${copy})`))) copy++;
    const suffix = ` (${copy})`;
    const name = base.slice(0, MAX_NAME - suffix.length).trimEnd() + suffix;
    this.update('projects', id, { name });
    this.error = `"${project.name}" already existed, so this device's copy is now "${name}".`;
  }
  async #pull() {
    let more = true;
    while (more) {
      const result = await api(`/api/sync?since=${this.#cursor}`);
      if (result.user_id && result.user_id !== this.#userId) {
        this.onOtherUser();
        return;
      }
      this.#verified = true;
      for (const table of SYNCED) {
        const incoming = (result[table] || []).filter((/** @type {any} */ row) => !this.#outbox.has(`${table}:${row.id}`));
        for (const row of incoming) this.#upsertLocal(table, row);
        await this.#db?.put(table, incoming);
      }
      const known = new Set(this.events.map((event) => event.id));
      const fresh = result.events.filter((/** @type {any} */ event) => !known.has(event.id));
      if (fresh.length) {
        this.events.push(...fresh);
        await this.#db?.put('events', fresh);
      }
      this.#mergeAttachments(result.attachments || []);
      await this.#db?.put('attachments', result.attachments || []);
      this.#cursor = result.cursor;
      more = result.more;
    }
    await this.#db?.setMeta('cursor', this.#cursor);
    // Only a pull that finished counts as fresh; a failed one (offline, error) lets the next tick or focus retry.
    this.#lastPull = Date.now();
  }

  /** Asks the server to re-check open PRs on GitHub, so merges show up even without the webhook. */
  async #refreshPullRequests() {
    if (Date.now() - this.#lastPrRefresh < PR_REFRESH_MS) return;
    const hasOpen = this.notes.some((note) => !note.deleted_at && note.pull_requests?.some((/** @type {any} */ pr) => pr.state === 'open'));
    if (!hasOpen) return;
    this.#lastPrRefresh = Date.now();
    const { updated } = await api('/api/prs/refresh', { method: 'POST' });
    if (updated) await this.#pull();
  }

  /** @param {any[]} rows */
  #mergeAttachments(rows) {
    for (const row of rows) {
      const index = this.attachments.findIndex((existing) => existing.id === row.id);
      if (index === -1) this.attachments.push(row);
      else this.attachments[index] = row;
    }
  }

  /** Live attachments on a note, oldest first. @param {string} noteId */
  attachmentsFor(noteId) {
    return this.attachments.filter((file) => file.note_id === noteId && !file.deleted_at).sort((a, b) => a.created_at - b.created_at);
  }

  /**
   * Uploads files to a note. The note must exist on the server first, so unsynced notes are pushed before uploading.
   * Uploads need a connection; they are not queued offline.
   * @param {string} noteId
   * @param {File[]} files
   */
  async upload(noteId, files) {
    if (this.#outbox.has(`notes:${noteId}`)) await this.sync();
    await Promise.all(files.map(async (file) => {
      const entry = { id: crypto.randomUUID(), noteId, name: file.name, progress: 0, error: '' };
      this.uploads.push(entry);
      const live = () => this.uploads.find((upload) => upload.id === entry.id);
      try {
        // Shrink images to fit, and refuse what can't fit, before anything is sent (src/lib/compress.js).
        const ready = await prepareForUpload(file);
        const { attachment } = await uploadFile(`/api/notes/${noteId}/attachments`, ready, (fraction) => { const upload = live(); if (upload) upload.progress = fraction; });
        this.#mergeAttachments([attachment]);
        await this.#db?.put('attachments', [attachment]);
        this.uploads = this.uploads.filter((upload) => upload.id !== entry.id);
        this.sync();
      } catch (error) {
        const upload = live();
        if (upload) upload.error = /** @type {Error} */ (error).message;
      }
    }));
  }

  /** @param {string} uploadId */
  dismissUpload(uploadId) {
    this.uploads = this.uploads.filter((upload) => upload.id !== uploadId);
  }

  /** Deletes an attachment everywhere (needs a connection). @param {string} id */
  async deleteAttachment(id) {
    await api(`/api/attachments/${id}`, { method: 'DELETE' });
    const row = this.attachments.find((file) => file.id === id);
    if (row) row.deleted_at = Date.now();
    if (row) await this.#db?.put('attachments', [row]);
    this.sync();
  }

  /** Timeline for one note, oldest first. @param {string} noteId */
  eventsFor(noteId) {
    return this.events.filter((event) => event.note_id === noteId).sort((a, b) => a.created_at - b.created_at);
  }
}

export const store = new Store();
