// UI preferences and transient UI state shared across components: theme, search, the mobile drawer.

const THEME_KEY = 'ws_theme';
const THEMES = ['system', 'dark', 'light'];
// Must match --ws-app in src/styles/theme.css for each theme: tints the browser and OS chrome.
const THEME_COLOR_META = 'meta[name="theme-color"]';

class Ui {
  /** @type {'system' | 'dark' | 'light'} */
  theme = $state(/** @type {any} */ (localStorage.getItem(THEME_KEY)) || 'system');
  query = $state('');
  drawerOpen = $state(false);
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

  cycleTheme() {
    this.theme = /** @type {any} */ (THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length]);
    localStorage.setItem(THEME_KEY, this.theme);
    this.apply();
  }
}

export const ui = new Ui();
