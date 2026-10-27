// Appearance preferences (Settings → Appearance): custom colors per theme, corner style and UI size.
// Defaults come from src/styles/theme.css at runtime; user picks are stored as data and applied by overriding
// the --ws-* custom properties on <html>. Corners and size are <html data-corners / data-size>, mapped in theme.css.
import { contrast, fixContrast, mix, parseHex, toHex } from './color-math.js';

const STORAGE_KEY = 'ws_appearance';
// Must match --ws-app: tints the browser and OS chrome
const THEME_COLOR_META = 'meta[name="theme-color"]';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
/** The editable colors, each a --ws-<key> token in theme.css. */
export const COLOR_KEYS = /** @type {const} */ (['app', 'surface', 'ink', 'accent']);
export const CORNERS = /** @type {const} */ (['square', 'soft', 'rounded']);
/** UI sizes, smallest first; each maps to a root font scale in theme.css. */
export const SIZES = /** @type {const} */ (['xs', 's', 'm', 'l', 'xl']);
const DEFAULT_CORNERS = 'square';
const DEFAULT_SIZE = 'm';
// WCAG 2.2 AA: 4.5:1 for text. The accent is used as text (errors, links), so it gets the text ratio too.
export const TEXT_CONTRAST = 4.5;
// Derived shades: how far each one sits between its two source colors (0 = first, 1 = second)
const MUTED_INK_MIX = 0.32;
const FAINT_INK_MIX = 0.48;
const LINE_MIX = 0.12;
const LINE_STRONG_MIX = 0.24;
const RAISED_MIX = 0.06;
const ACCENT_HOVER_MIX = 0.18;
const ACCENT_SOFT_MIX = 0.84;

/** @typedef {typeof COLOR_KEYS[number]} ColorKey */
/** @typedef {Partial<Record<ColorKey, string>>} ColorPicks */
/** @typedef {{ pair: 'ink-app' | 'ink-surface' | 'accent-app' | 'accent-ink', ratio: number, ok: boolean }} ContrastCheck */

/** Every token apply() may override, so it can clear them all before reading the stylesheet defaults. */
const OVERRIDDEN = ['app', 'surface', 'surface-raised', 'line', 'line-strong', 'ink', 'ink-muted', 'ink-faint',
  'accent', 'accent-hover', 'accent-ink', 'accent-soft'].map((name) => `--ws-${name}`);

/** @returns {{ colors: { dark: ColorPicks, light: ColorPicks }, corners: string, size: string }} */
function load() {
  const empty = { colors: { dark: {}, light: {} }, corners: DEFAULT_CORNERS, size: DEFAULT_SIZE };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const clean = (/** @type {any} */ picks) => Object.fromEntries(COLOR_KEYS.filter((key) => HEX_COLOR.test(picks?.[key])).map((key) => [key, picks[key]]));
    return {
      colors: { dark: clean(saved.colors?.dark), light: clean(saved.colors?.light) },
      corners: CORNERS.includes(saved.corners) ? saved.corners : DEFAULT_CORNERS,
      size: SIZES.includes(saved.size) ? saved.size : DEFAULT_SIZE,
    };
  } catch {
    return empty;
  }
}

/**
 * The full set of token overrides for a theme: the picked colors plus the shades derived from them.
 * A derived group is only recomputed when one of its sources was picked, so untouched tokens keep their tuned defaults.
 * @param {Record<ColorKey, string>} defaults @param {ColorPicks} picks
 * @returns {Record<string, string>}
 */
function overridesFor(defaults, picks) {
  if (!Object.keys(picks).length) return {};
  const color = (/** @type {ColorKey} */ key) => parseHex(picks[key] || defaults[key]) || [0, 0, 0];
  const [app, surface, ink, accent] = COLOR_KEYS.map(color);
  /** @type {Record<string, string>} */
  const tokens = {};
  for (const key of COLOR_KEYS) if (picks[key]) tokens[`--ws-${key}`] = /** @type {string} */ (picks[key]);
  // Muted and faint text are checked against the surface too, so a new surface alone re-derives them.
  if (picks.ink || picks.app || picks.surface) {
    tokens['--ws-ink-muted'] = toHex(fixContrast(mix(ink, app, MUTED_INK_MIX), [app, surface], TEXT_CONTRAST));
    tokens['--ws-ink-faint'] = toHex(fixContrast(mix(ink, app, FAINT_INK_MIX), [app, surface], TEXT_CONTRAST));
  }
  if (picks.ink || picks.app) {
    tokens['--ws-line'] = toHex(mix(app, ink, LINE_MIX));
    tokens['--ws-line-strong'] = toHex(mix(app, ink, LINE_STRONG_MIX));
  }
  if (picks.surface || picks.ink) tokens['--ws-surface-raised'] = toHex(mix(surface, ink, RAISED_MIX));
  if (picks.accent || picks.app || picks.ink) {
    tokens['--ws-accent-hover'] = toHex(mix(accent, ink, ACCENT_HOVER_MIX));
    tokens['--ws-accent-ink'] = toHex(contrast(accent, app) >= contrast(accent, ink) ? app : ink);
    tokens['--ws-accent-soft'] = toHex(mix(accent, app, ACCENT_SOFT_MIX));
  }
  return tokens;
}

class Appearance {
  #saved = load();
  /** Custom colors per resolved theme, as #rrggbb. Missing keys use the theme.css default. */
  colors = $state(this.#saved.colors);
  /** @type {typeof CORNERS[number]} */
  corners = $state(/** @type {any} */ (this.#saved.corners));
  /** @type {typeof SIZES[number]} */
  size = $state(/** @type {any} */ (this.#saved.size));
  /** The current theme's stylesheet colors, read from theme.css on every apply(). @type {Record<ColorKey, string>} */
  defaults = $state({ app: '', surface: '', ink: '', accent: '' });
  /** Resolved theme the picks below belong to. @type {'dark' | 'light'} */
  theme = $state('dark');

  /** Picks for the theme on screen. */
  get picks() {
    return this.colors[this.theme];
  }

  /** What each editable color currently is, custom or default, as #rrggbb. */
  get effective() {
    return /** @type {Record<ColorKey, string>} */ (Object.fromEntries(COLOR_KEYS.map((key) => {
      const rgb = parseHex(this.picks[key] || this.defaults[key]);
      return [key, rgb ? toHex(rgb) : ''];
    })));
  }

  /** WCAG 2.2 AA check of every text and accent pair with the current colors (the accent button label included). */
  get checks() {
    const effective = this.effective;
    const [app, surface, ink, accent] = COLOR_KEYS.map((key) => parseHex(effective[key]));
    if (!app || !surface || !ink || !accent) return /** @type {ContrastCheck[]} */ ([]);
    const accentInk = contrast(accent, app) >= contrast(accent, ink) ? app : ink;
    /** @type {[ContrastCheck['pair'], number][]} */
    const pairs = [
      ['ink-app', contrast(ink, app)],
      ['ink-surface', contrast(ink, surface)],
      ['accent-app', contrast(accent, app)],
      ['accent-ink', contrast(accent, accentInk)],
    ];
    return pairs.map(([pair, ratio]) => /** @type {ContrastCheck} */ ({ pair, ratio, ok: ratio >= TEXT_CONTRAST }));
  }

  get customized() {
    return Object.keys(this.colors.dark).length + Object.keys(this.colors.light).length > 0 || this.corners !== DEFAULT_CORNERS || this.size !== DEFAULT_SIZE;
  }

  /** Re-reads the stylesheet defaults for the theme on <html data-theme> and layers the user's picks on top. */
  apply() {
    const root = document.documentElement;
    root.dataset.corners = this.corners;
    root.dataset.size = this.size;
    this.theme = root.dataset.theme === 'light' ? 'light' : 'dark';
    for (const name of OVERRIDDEN) root.style.removeProperty(name);
    const styles = getComputedStyle(root);
    this.defaults = /** @type {Record<ColorKey, string>} */ (Object.fromEntries(COLOR_KEYS.map((key) => [key, styles.getPropertyValue(`--ws-${key}`).trim()])));
    for (const [name, value] of Object.entries(overridesFor(this.defaults, this.picks))) root.style.setProperty(name, value);
    document.querySelector(THEME_COLOR_META)?.setAttribute('content', getComputedStyle(root).getPropertyValue('--ws-app').trim());
  }

  #save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ colors: this.colors, corners: this.corners, size: this.size }));
    this.apply();
  }

  /** Live while dragging the native picker, so no view transition here. @param {ColorKey} key @param {string} hex */
  setColor(key, hex) {
    if (!HEX_COLOR.test(hex)) return;
    this.colors[this.theme][key] = hex;
    this.#save();
  }

  /** @param {typeof CORNERS[number]} corners */
  setCorners(corners) {
    crossfade(() => {
      this.corners = corners;
      this.#save();
    });
  }

  /** @param {typeof SIZES[number]} size */
  setSize(size) {
    crossfade(() => {
      this.size = size;
      this.#save();
    });
  }

  /** Nudges the ink and accent lightness (hue kept) until every pair passes AA against the backgrounds. */
  autoFix() {
    const effective = this.effective;
    const [app, surface, ink, accent] = COLOR_KEYS.map((key) => parseHex(effective[key]) || [0, 0, 0]);
    const fixedInk = fixContrast(ink, [app, surface], TEXT_CONTRAST);
    const fixedAccent = fixContrast(accent, [app], TEXT_CONTRAST);
    const picks = this.colors[this.theme];
    if (toHex(fixedInk) !== effective.ink) picks.ink = toHex(fixedInk);
    if (toHex(fixedAccent) !== effective.accent) picks.accent = toHex(fixedAccent);
    crossfade(() => this.#save());
  }

  /** Back to theme.css: clears colors for both themes, square corners and medium size. */
  reset() {
    crossfade(() => {
      this.colors = { dark: {}, light: {} };
      this.corners = DEFAULT_CORNERS;
      this.size = DEFAULT_SIZE;
      localStorage.removeItem(STORAGE_KEY);
      this.apply();
    });
  }
}

/**
 * Runs a whole-page restyle inside a View Transition, so the old look crossfades into the new one (opacity only,
 * nothing reflows mid-animation). Browsers without the API, or with reduced motion, just apply it.
 * @param {() => void} change
 */
export function crossfade(change) {
  if (!document.startViewTransition || matchMedia(REDUCED_MOTION).matches) {
    change();
    return;
  }
  document.startViewTransition(change);
}

export const appearance = new Appearance();
