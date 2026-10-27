// What is wrong with sync right now, in plain words. Shared by the sidebar sync icon (SyncStatus) and the phone
// menu badge (TopBar). null means nothing to explain: the icon stays a plain "sync now" button.

// Server errors that mean the session or account is the problem, not the network.
const AUTH_HINT = /sign|session|auth|forbidden|unauthori|permission/i;

/** @typedef {{ title: string, detail: string, advice: string }} SyncProblem */

/**
 * @param {{ online: boolean, pending: number, error: string }} state the sync fields of the store
 * @returns {SyncProblem | null}
 */
export function syncProblem({ online, pending, error }) {
  const waiting = `${pending} change${pending === 1 ? '' : 's'}`;
  if (!online && pending) {
    return {
      title: "You're offline",
      detail: `${waiting} ${pending === 1 ? 'is' : 'are'} saved on this device but not on your other devices yet.`,
      advice: 'Nothing is lost. Reconnect to the internet and they sync on their own, or press Retry once you are back online.',
    };
  }
  if (error && AUTH_HINT.test(error)) {
    return {
      title: 'Sign-in problem',
      detail: `The server turned this device away: ${error}`,
      advice: 'Press Retry. If it keeps happening, sign out and back in from Settings. Unsynced notes stay on this device.',
    };
  }
  if (error) {
    return {
      title: "Sync didn't finish",
      detail: pending ? `${error}. ${waiting} still waiting to sync.` : error,
      advice: 'Press Retry. If it keeps failing, check your connection or try again in a few minutes. Your notes stay on this device.',
    };
  }
  return null;
}
