// The free trial countdown in the top bar (TopBar.svelte): time left as "4d 13h 22m 05s", leading empty units dropped.
const UNITS = [
  { key: 'd', ms: 86_400_000 },
  { key: 'h', ms: 3_600_000 },
  { key: 'm', ms: 60_000 },
  { key: 's', ms: 1_000 },
];
// Phones show the two biggest units that are left ("4d 13h", then "13h 22m", then "22m 05s").
const SHORT_UNITS = 2;
const PAD = 2;

/**
 * Time left, written out in full and short.
 * @param {number} ms time left (never below 0)
 * @param {Record<string, string>} labels unit letters by key (d, h, m, s), from paywall.json
 * @returns {{ full: string, short: string }}
 */
export function countdown(ms, labels) {
  let rest = Math.max(0, ms);
  const values = UNITS.map(({ key, ms: size }) => {
    const value = Math.floor(rest / size);
    rest -= value * size;
    return { key, value };
  });
  // Minutes and seconds always show, so the last stretch reads "0m 05s".
  const lastStart = values.length - SHORT_UNITS;
  const biggest = values.findIndex(({ value }) => value > 0);
  const shown = values.slice(biggest < 0 || biggest > lastStart ? lastStart : biggest);
  // Every unit after the first is two digits, so the pill keeps its width as the seconds tick.
  const parts = shown.map(({ key, value }, index) => `${index ? String(value).padStart(PAD, '0') : value}${labels[key]}`);
  return { full: parts.join(' '), short: parts.slice(0, SHORT_UNITS).join(' ') };
}
