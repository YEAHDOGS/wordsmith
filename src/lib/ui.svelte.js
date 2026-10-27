// UI preferences and transient UI state shared across components: theme, search, the mobile drawer, selected notes.
import { SvelteSet } from 'svelte/reactivity';

const THEME_KEY = 'ws_theme';
const THEMES = ['system', 'dark', 'light'];
const SORT_KEY = 'ws_sort';
// Note grid order: newest created, most recently updated, or grouped by project.
export const SORTS = /** @type {const} */ (['updated', 'created', 'project']);
// Must match --ws-app in src/styles/theme.css for each theme: tints the browser and OS chrome.
const THEME_COLOR_META = 'meta[name="theme-color"]';

class Ui {
  /** @type {'system' | 'dark' | 'light'} */
  theme = $state(/** @type {any} */ (localStorage.getItem(THEME_KEY)) || 'system');
  query = $state('');
  drawerOpen = $state(false);
  /** @type {'updated' | 'created' | 'project'} */
  sort = $state(/** @type {any} */ (SORTS.includes(/** @type {any} */ (localStorage.getItem(SORT_KEY))) ? localStorage.getItem(SORT_KEY) : 'updated'));
  /** The project just created from the sidebar: its page opens the GitHub repo picker once. */
  newProjectId = $state('');
  /** Ids of the notes picked for bulk actions (copy, archive). Non-empty = selection mode. */
  selected = new SvelteSet();
  #media = matchMedia('(prefers-color-scheme: light)');

  constructor() {
    this.#media.addEventListener('change', () => this.apply());
    this.apply();
  }

  /** Resolved theme after following the system setting. */
  get resolved() {
    if (this.theme !== 'system') return this.theme;
    return this.#media.matches ? 'light' : 'dark';
  }

  apply() {
    document.documentElement.dataset.theme = this.resolved;
    const app = getComputedStyle(document.documentElement).getPropertyValue('--ws-app').trim();
    document.querySelector(THEME_COLOR_META)?.setAttribute('content', app);
  }

  /** @param {'updated' | 'created' | 'project'} sort */
  setSort(sort) {
    this.sort = sort;
    localStorage.setItem(SORT_KEY, sort);
  }

  /** @param {string} id */
  toggleSelected(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
  }

  /** @param {string[]} ids */
  selectAll(ids) {
    for (const id of ids) this.selected.add(id);
  }

  cycleTheme() {
    this.theme = /** @type {any} */ (THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length]);
    localStorage.setItem(THEME_KEY, this.theme);
    this.apply();
  }
}

export const ui = new Ui();
