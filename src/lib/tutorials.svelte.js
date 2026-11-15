// First-run tutorials (TUTORIALS in src/lib/models.js): each shows once per account, on every device. D1 is the record
// (tutorials_seen, through /api/tutorials). A tutorial is only offered once D1 has said, this app start, that it is
// still unseen: the session answer (auth.tutorials) says so for free when the app fetched one, otherwise one GET asks.
// This device keeps a copy per account, so once every tutorial is seen it never asks again. A tutorial dismissed while
// offline is kept here as pending and sent on the next check. Demo mode keeps it on the device only.
import { api } from './api.js';
import { auth } from './auth.svelte.js';
import { TUTORIALS } from './models.js';

const STORAGE_PREFIX = 'ws_tutorials:';
const TUTORIALS_PATH = '/api/tutorials';

/** @typedef {{ seen: string[], pending: string[] }} SavedTutorials */

/** @param {string} userId @returns {SavedTutorials} */
function load(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + userId) || '{}');
    const clean = (/** @type {any} */ list) => (Array.isArray(list) ? list.filter((id) => TUTORIALS.includes(id)) : []);
    return { seen: clean(saved.seen), pending: clean(saved.pending) };
  } catch {
    return { seen: [], pending: [] };
  }
}

class Tutorials {
  /** Tutorials the signed-in account has seen. @type {string[]} */
  seen = $state([]);
  /** D1 answered for this account during this app start (or demo mode), so an unseen tutorial may be offered. */
  known = $state(false);
  /** @type {string | undefined} */ #userId;
  /** @type {Promise<void> | null} */ #checking = null;

  /** @param {string} userId @param {SavedTutorials} saved */
  #save(userId, saved) {
    localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(saved));
  }

  /** Loads what the signed-in account has seen. Safe to call often: it asks D1 at most once per app start. */
  check() {
    const userId = auth.user?.id;
    if (!userId) return Promise.resolve();
    if (userId !== this.#userId) {
      this.#userId = userId;
      this.#checking = null;
      this.known = false;
    }
    this.#checking ??= this.#check(userId);
    return this.#checking;
  }

  /** @param {string} userId */
  async #check(userId) {
    const saved = load(userId);
    this.seen = [...new Set([...saved.seen, ...(auth.tutorials ?? [])])];
    if (auth.demo || (!saved.pending.length && TUTORIALS.every((tutorial) => this.seen.includes(tutorial)))) {
      this.known = true;
      return;
    }
    try {
      for (const tutorial of saved.pending) await api(TUTORIALS_PATH, { method: 'POST', body: { tutorial } });
      const answer = auth.tutorials ? { tutorials: auth.tutorials } : await api(TUTORIALS_PATH);
      if (this.#userId !== userId) return;
      this.seen = [...new Set([...this.seen, ...answer.tutorials])];
      this.known = true;
      this.#save(userId, { seen: this.seen, pending: [] });
    } catch {
      // Offline: nothing is offered, and the next check tries again.
      if (this.#userId === userId) this.#checking = null;
    }
  }

  /** @param {string} tutorial */
  shouldShow(tutorial) {
    return this.known && !this.seen.includes(tutorial);
  }

  /** Finished or skipped: never again for this account, on any device. @param {string} tutorial */
  async markSeen(tutorial) {
    const userId = this.#userId;
    if (!userId || this.seen.includes(tutorial)) return;
    this.seen = [...this.seen, tutorial];
    const pending = auth.demo ? [] : [...new Set([...load(userId).pending, tutorial])];
    this.#save(userId, { seen: this.seen, pending });
    if (auth.demo) return;
    try {
      await api(TUTORIALS_PATH, { method: 'POST', body: { tutorial } });
      const saved = load(userId);
      this.#save(userId, { ...saved, pending: saved.pending.filter((id) => id !== tutorial) });
    } catch {
      // Kept as pending: sent on the next check.
    }
  }
}

export const tutorials = new Tutorials();
