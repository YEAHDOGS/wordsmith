// UI preferences and transient UI state shared across components: theme, search, the mobile drawer, selected notes.
import { SvelteSet } from 'svelte/reactivity';

const THEME_KEY = 'ws_theme';
const THEMES = ['system', 'dark', 'light'];
const SORT_KEY = 'ws_sort';
const GROUP_KEY = 'ws_group';
// Note grid controls: the left button cycles the order, the right one cycles the grouping.
// manual = the order notes were dragged into (notes.position); priority = highest first, manual order within a level.
export const ORDERS = /** @type {const} */ (['updated', 'created', 'priority', 'manual']);
/** Orders a drag can't express: picking a card up switches to manual so the drop sticks. */
export const TIME_ORDERS = /** @type {const} */ (['updated', 'created']);
export const GROUPS = /** @type {const} */ (['all', 'project', 'season']);
// Before grouping existed, "project" was a sort; carry that choice over.
const LEGACY_PROJECT_SORT = 'project';
// Must match --ws-app in src/styles/theme.css for each theme: tints the browser and OS chrome.
const THEME_COLOR_META = 'meta[name="theme-color"]';

class Ui {
  /** @type {'system' | 'dark' | 'light'} */
  theme = $state(/** @type {any} */ (localStorage.getItem(THEME_KEY)) || 'system');
  query = $state('');
  drawerOpen = $state(false);
  /** @type {'updated' | 'created' | 'priority' | 'manual'} */
  order = $state(/** @type {any} */ (ORDERS.includes(/** @type {any} */ (localStorage.getItem(SORT_KEY))) ? localStorage.getItem(SORT_KEY) : 'updated'));
  /** @type {'all' | 'project' | 'season'} */
  group = $state(/** @type {any} */ (localStorage.getItem(SORT_KEY) === LEGACY_PROJECT_SORT ? 'project'
    : GROUPS.includes(/** @type {any} */ (localStorage.getItem(GROUP_KEY))) ? localStorage.getItem(GROUP_KEY) : 'all'));
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

  /** @param {'updated' | 'created' | 'priority' | 'manual'} order */
  setOrder(order) {
    this.order = order;
    localStorage.setItem(SORT_KEY, order);
  }

  /** @param {'all' | 'project' | 'season'} group */
  setGroup(group) {
    this.group = group;
    localStorage.setItem(GROUP_KEY, group);
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
