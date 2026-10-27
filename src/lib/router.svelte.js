// Hash router. Routes: #/notes, #/features, #/project/<id>, #/label/<id>, #/archive, #/settings.
// An open note adds ?note=<id>, so the back button and mobile back-swipe close it.

const DEFAULT_VIEW = 'notes';
const VIEWS = ['notes', 'features', 'project', 'label', 'archive', 'settings'];

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

  constructor() {
    addEventListener('hashchange', () => {
      this.route = parse();
      if (!this.route.note) this.#pushedNote = false;
    });
  }

  /** @param {string} view @param {string} [id] */
  go(view, id = '') {
    location.hash = format({ view, id, note: '' });
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
