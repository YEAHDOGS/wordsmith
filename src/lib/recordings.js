// Full-quality originals of Scribe sessions, kept on this device in IndexedDB (localStorage holds only a few MB). The
// tape in R2 is a small Opus copy (src/lib/scribe-tapes.svelte.js); the original WAV stays here, keyed by the tape's
// id, so the Tapes page can offer it for download. One database per account, apart from the notes database, so
// adding it needed no upgrade there; signing out deletes it with the rest (store.wipe).

const DB_PREFIX = 'wordsmith-recordings-';
const DB_VERSION = 1;
const STORE = 'originals';

/** @typedef {{ id: string, name: string, blob: Blob, at: number }} Original */

/** @param {IDBRequest} request @returns {Promise<any>} */
function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** @param {string} userId @returns {Promise<IDBDatabase>} */
function open(userId) {
  const request = indexedDB.open(DB_PREFIX + userId, DB_VERSION);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
  return done(request);
}

/** @param {string} userId @param {IDBTransactionMode} mode @param {(store: IDBObjectStore) => IDBRequest} run */
async function withStore(userId, mode, run) {
  const db = await open(userId);
  try {
    return await done(run(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
}

/** Keeps an original. Asks the browser not to evict this site's storage the first time. @param {string} userId @param {Original} original */
export async function keepOriginal(userId, original) {
  await navigator.storage?.persist?.().catch(() => false);
  await withStore(userId, 'readwrite', (store) => store.put(original));
}

/** @param {string} userId @param {string} id @returns {Promise<Original | undefined>} */
export const getOriginal = (userId, id) => withStore(userId, 'readonly', (store) => store.get(id));

/** Whether this device holds the original. @param {string} userId @param {string} id @returns {Promise<boolean>} */
export async function hasOriginal(userId, id) {
  return Boolean(await withStore(userId, 'readonly', (store) => store.getKey(id)).catch(() => undefined));
}

/** @param {string} userId @param {string} id */
export const removeOriginal = (userId, id) => withStore(userId, 'readwrite', (store) => store.delete(id));

/** Deletes every original this account kept here (signing out). @param {string} userId */
export const forgetOriginals = (userId) => done(indexedDB.deleteDatabase(DB_PREFIX + userId));
