// "Share to wordsmith": the PWA manifest (public/site.webmanifest share_target) opens the app with ?share_title=,
// ?share_text=, ?share_url= when a page or text is shared from another app. The params are stripped at once and held
// in sessionStorage, so a share that has to sign in first survives the sign-in redirect, then filed as a note labeled
// "research" (no project) at the top of the list, and opened.
import { store } from './lib/store.svelte.js';
import { router } from './lib/router.svelte.js';
import { topPosition } from './lib/reorder.svelte.js';
import { MAX_BODY, MAX_TITLE } from './lib/models.js';

const PARAMS = { title: 'share_title', text: 'share_text', url: 'share_url' };
const PENDING_KEY = 'ws_pending_share';
const RESEARCH_LABEL = 'research';

const query = new URLSearchParams(location.search);
if (Object.values(PARAMS).some((name) => query.has(name))) {
  const share = Object.fromEntries(Object.entries(PARAMS).map(([key, name]) => [key, (query.get(name) || '').trim()]));
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(share));
  for (const name of Object.values(PARAMS)) query.delete(name);
  history.replaceState(null, '', location.pathname + (query.size ? `?${query}` : '') + location.hash);
}

/** Files a waiting share as a note once the signed-in user's store is open. */
export function fileShare() {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return;
  sessionStorage.removeItem(PENDING_KEY);
  /** @type {{ title: string, text: string, url: string }} */
  const share = JSON.parse(raw);
  // Phones often put the link inside the text; add it only when it isn't there already.
  const body = [share.text, share.url && !share.text.includes(share.url) ? share.url : ''].filter(Boolean).join('\n\n');
  const title = share.title || body.split('\n')[0];
  if (!title && !body) return;
  const label = store.labels.find((row) => !row.deleted_at && row.name.toLowerCase() === RESEARCH_LABEL) ?? store.create('labels', { name: RESEARCH_LABEL });
  const note = store.create('notes', { title: title.slice(0, MAX_TITLE), body: body.slice(0, MAX_BODY), label_ids: [label.id], position: topPosition() });
  router.openNote(note.id);
}
