// Tiny promise wrapper over IndexedDB: the on-device copy of your notes. One database per signed-in user.

const DB_PREFIX = 'wordsmith-';
// v2 adds attachments (metadata only; the files themselves are cached by the browser's HTTP cache).
const DB_VERSION = 2;
export const STORES = ['projects', 'labels', 'notes', 'events', 'attachments', 'meta'];

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
  /** @param {string} userId */
  constructor(userId) {
    this.name = DB_PREFIX + userId;
    /** @type {Promise<IDBDatabase>} */
    this.ready = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, DB_VERSION);
      request.onupgradeneeded = () => {
        for (const store of STORES) {
          if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: store === 'meta' ? 'key' : 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
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
