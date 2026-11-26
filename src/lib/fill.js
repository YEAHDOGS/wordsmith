// UI strings with {placeholders}, filled from the .json string files beside each component.

/** "{count} in the trash" + { count: 3 } -> "3 in the trash". Unknown keys become empty. @param {string} text @param {Record<string, string | number>} values */
export function fill(text, values) {
  return text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}
