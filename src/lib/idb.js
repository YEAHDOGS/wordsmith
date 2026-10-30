// Tiny promise wrapper over IndexedDB: the on-device copy of your notes. One database per signed-in user.

const DB_PREFIX = 'wordsmith-';
// v2 adds attachments (metadata only; the files themselves are cached by the browser's HTTP cache). v3 adds boards, v4 note_groups.
// v5 adds nothing: it re-pulls once on devices that skipped note groups while their older build didn't know the table.
const DB_VERSION = 5;
// Every upgrade forgets the sync cursor, so rows of tables the old build ignored come down on the next pull.
const CURSOR_KEY = 'cursor';
export const STORES = ['projects', 'labels', 'notes', 'boards', 'note_groups', 'events', 'attachments', 'meta'];

/** @param {IDBRequest} request @returns {Promise<any>} */
function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** @param {IDBTransaction} tx @returns {Promise<void>} */
function committed(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Local database for one user. */
export class LocalDb {
  /**
   * @param {string} userId
   * @param {() => void} [onblocked] another tab still holds an older version open, so the upgrade waits for it
   */
  constructor(userId, onblocked = () => {}) {
    this.name = DB_PREFIX + userId;
    /** @type {Promise<IDBDatabase>} */
    this.ready = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, DB_VERSION);
      request.onupgradeneeded = (event) => {
        for (const store of STORES) {
          if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: store === 'meta' ? 'key' : 'id' });
        }
        if (event.oldVersion) request.transaction?.objectStore('meta').delete(CURSOR_KEY);
      };
      // The upgrade resumes by itself once the other tab closes or reloads.
      request.onblocked = onblocked;
      request.onsuccess = () => {
        // A newer build opened in another tab: step aside and reload into it, so its upgrade never waits on this tab.
        request.result.onversionchange = () => {
          request.result.close();
          location.reload();
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /** @param {string} store */
  async all(store) {
    const db = await this.ready;
    return done(db.transaction(store).objectStore(store).getAll());
  }

  /** @param {string} store @param {any[]} rows */
  async put(store, rows) {
    if (!rows.length) return;
    const db = await this.ready;
    const tx = db.transaction(store, 'readwrite');
    // $state proxies can't be structured-cloned; snapshot them to plain objects first.
    for (const row of rows) tx.objectStore(store).put(JSON.parse(JSON.stringify(row)));
    await committed(tx);
  }

  /** @param {string} key */
  async getMeta(key) {
    const db = await this.ready;
    const row = await done(db.transaction('meta').objectStore('meta').get(key));
    return row?.value;
  }

  /** @param {string} key @param {any} value */
  setMeta(key, value) {
    return this.put('meta', [{ key, value }]);
  }

  /** Deletes this user's local copy (sign out). */
  async destroy() {
    (await this.ready).close();
    await done(indexedDB.deleteDatabase(this.name));
  }
}
