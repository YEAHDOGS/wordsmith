// Color math for custom themes: parse and format #rrggbb, mix, WCAG 2.2 contrast and a lightness nudge that fixes it.
// Pure functions over [r, g, b] channel arrays (0-255); no color values live here, only arithmetic.

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i;
const CHANNEL_MAX = 255;
const HEX_RADIX = 16;
// WCAG relative luminance: sRGB linearization constants and channel weights
const SRGB_KNEE = 0.04045;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_GAMMA = 2.4;
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722];
const CONTRAST_FLARE = 0.05;
// Auto-fix walks lightness in 1% steps, at most from black to white
const LIGHTNESS_STEP = 0.01;
const LIGHTNESS_STEPS = 100;
// Middle grey (18% luminance): on darker backgrounds the fix tries lighter first, otherwise darker
const MID_GREY_LUMINANCE = 0.18;

/** @typedef {[number, number, number]} Rgb */

/** "#abc" or "#aabbcc" (an alpha pair is ignored) -> [r, g, b], or null when it isn't a hex color. @param {string} hex @returns {Rgb | null} */
export function parseHex(hex) {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join('') : match[1];
  return /** @type {Rgb} */ ([0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), HEX_RADIX)));
}

/** [r, g, b] -> "#rrggbb", the format <input type="color"> needs. @param {Rgb} rgb */
export function toHex(rgb) {
  return `#${rgb.map((channel) => Math.round(Math.min(CHANNEL_MAX, Math.max(0, channel))).toString(HEX_RADIX).padStart(2, '0')).join('')}`;
}

/** Blends a toward b; amount 0 = a, 1 = b. @param {Rgb} a @param {Rgb} b @param {number} amount @returns {Rgb} */
export function mix(a, b, amount) {
  return /** @type {Rgb} */ (a.map((channel, index) => channel + (b[index] - channel) * amount));
}

/** WCAG relative luminance, 0 (black) to 1 (white). @param {Rgb} rgb */
export function luminance(rgb) {
  return rgb.reduce((sum, channel, index) => {
    const value = channel / CHANNEL_MAX;
    const linear = value <= SRGB_KNEE ? value / SRGB_LINEAR_DIVISOR : ((value + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_GAMMA;
    return sum + linear * LUMA_WEIGHTS[index];
  }, 0);
}

/** WCAG contrast ratio between two colors, 1 to 21. @param {Rgb} a @param {Rgb} b */
export function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + CONTRAST_FLARE) / (dark + CONTRAST_FLARE);
}

/** @param {Rgb} rgb @returns {[number, number, number]} hue (0-1), saturation, lightness */
function toHsl(rgb) {
  const [r, g, b] = rgb.map((channel) => channel / CHANNEL_MAX);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue / 6, saturation, lightness];
}

/** @param {number} p @param {number} q @param {number} t */
function hueChannel(p, q, t) {
  const wrapped = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
  if (wrapped < 1 / 2) return q;
  if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
  return p;
}

/** @param {number} hue @param {number} saturation @param {number} lightness @returns {Rgb} */
function fromHsl(hue, saturation, lightness) {
  if (saturation === 0) return [lightness * CHANNEL_MAX, lightness * CHANNEL_MAX, lightness * CHANNEL_MAX];
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return /** @type {Rgb} */ ([hue + 1 / 3, hue, hue - 1 / 3].map((t) => hueChannel(p, q, t) * CHANNEL_MAX));
}

/**
 * Nudges a color's lightness (keeping its hue) until it reaches `target` contrast against every background.
 * Tries the direction away from the backgrounds first, then the other; returns the best found if neither gets there.
 * @param {Rgb} color @param {Rgb[]} backgrounds @param {number} target
 * @returns {Rgb}
 */
export function fixContrast(color, backgrounds, target) {
  const worst = (/** @type {Rgb} */ candidate) => Math.min(...backgrounds.map((background) => contrast(candidate, background)));
  if (worst(color) >= target) return color;
  const [hue, saturation, lightness] = toHsl(color);
  const darkBackground = luminance(backgrounds[0]) < MID_GREY_LUMINANCE;
  let best = color;
  for (const direction of darkBackground ? [1, -1] : [-1, 1]) {
    for (let step = 1; step <= LIGHTNESS_STEPS; step++) {
      const next = lightness + direction * step * LIGHTNESS_STEP;
      if (next < 0 || next > 1) break;
      const candidate = fromHsl(hue, saturation, next);
      if (worst(candidate) >= target) return candidate;
      if (worst(candidate) > worst(best)) best = candidate;
    }
  }
  return best;
}
