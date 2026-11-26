// Recordings made in the app wait here, on the device, until they upload: unlike an import there is no original on
// disk to fall back on, so a closed tab, a dropped connection or an expired session must not lose them. Each one
// belongs to the account that recorded it (userId) and only goes back into that account's import queue
// (src/lib/tapes.svelte.js claim). Its own small database, apart from the per-account notes copy (idb.js), so a
// sign-out that wipes the notes copy doesn't take an hour of audio with it; the upload removes the entry.

const DB_NAME = 'wordsmith-recordings';
const DB_VERSION = 1;
const STORE = 'pending';

/** @typedef {{ id: string, userId: string, name: string, type: string, lastModified: number, durationMs: number, encoded: boolean, blob: Blob }} PendingRecording */

/** @type {Promise<IDBDatabase> | null} */
let opening = null;

/** @param {IDBRequest} request @returns {Promise<any>} */
function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function database() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

/** @param {IDBTransactionMode} mode */
async function store(mode) {
  return (await database()).transaction(STORE, mode).objectStore(STORE);
}

/** Keeps a recording until it uploads. Resolves once it is safely written. @param {PendingRecording} recording */
export async function keepRecording(recording) {
  await done((await store('readwrite')).put(recording));
}

/** Forgets a recording once the server has it. @param {string} id */
export async function forgetRecording(id) {
  await done((await store('readwrite')).delete(id));
}

/** One account's recordings still waiting to upload, oldest first. @param {string} userId @returns {Promise<PendingRecording[]>} */
export async function waitingRecordings(userId) {
  /** @type {PendingRecording[]} */
  const all = await done((await store('readonly')).getAll());
  return all.filter((recording) => recording.userId === userId).sort((a, b) => a.lastModified - b.lastModified);
}
