// Hash router. Routes: #/notes, #/features, #/project/<id>, #/label/<id>, #/archive, #/trash, #/settings, and the board
// settings pages #/features-settings and #/project-settings/<id>.
// An open note adds ?note=<id>, so the back button and mobile back-swipe close it.

const DEFAULT_VIEW = 'notes';
const VIEWS = ['notes', 'features', 'project', 'label', 'archive', 'trash', 'settings', 'features-settings', 'project-settings'];
const RETURN_VIEWS = new Set(['archive', 'trash', 'settings']);

/** @typedef {{ view: string, id: string, note: string }} Route */

/** @returns {Route} */
function parse() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [view, id = ''] = path.split('/');
  const note = new URLSearchParams(query).get('note') || '';
  return { view: VIEWS.includes(view) ? view : DEFAULT_VIEW, id: decodeURIComponent(id), note };
}

/** @param {Route} route */
function format({ view, id, note }) {
  return `#/${view}${id ? `/${encodeURIComponent(id)}` : ''}${note ? `?note=${encodeURIComponent(note)}` : ''}`;
}

class Router {
  route = $state(parse());
  /** True while the open note was pushed by us, so closing can step back instead of stacking history. */
  #pushedNote = false;
  /** @type {Route | null} */
  #returnRoute = null;

  constructor() {
    addEventListener('hashchange', () => {
      const next = parse();
      if (RETURN_VIEWS.has(next.view) && next.view !== this.route.view) this.#returnRoute = { ...this.route };
      if (!RETURN_VIEWS.has(next.view)) this.#returnRoute = null;
      this.route = next;
      if (!this.route.note) this.#pushedNote = false;
    });
  }

  /** @param {string} view @param {string} [id] */
  go(view, id = '') {
    if (RETURN_VIEWS.has(view) && this.route.view === view) {
      const target = this.#returnRoute ?? { view: DEFAULT_VIEW, id: '', note: '' };
      this.#returnRoute = null;
      this.#replace(target);
      return;
    }
    if (RETURN_VIEWS.has(view)) this.#returnRoute = { ...this.route };
    else this.#returnRoute = null;
    location.hash = format({ view, id, note: '' });
  }

  /** @param {Route} route Replace the current destination without leaving a stale settings page in browser history. */
  #replace(route) {
    history.replaceState(null, '', format(route));
    this.route = route;
    this.#returnRoute = null;
    if (!route.note) this.#pushedNote = false;
  }

  /** @param {string} view @param {string} [id] */
  replace(view, id = '') {
    this.#replace({ view, id, note: '' });
  }

  /** @param {string} noteId */
  openNote(noteId) {
    this.#pushedNote = true;
    location.hash = format({ ...this.route, note: noteId });
  }

  closeNote() {
    if (this.#pushedNote) history.back();
    else history.replaceState(null, '', format({ ...this.route, note: '' }));
    this.#pushedNote = false;
    this.route = { ...this.route, note: '' };
  }
}

export const router = new Router();
