// Small, safe Markdown renderer shared by the editor preview and the public note page (api/functions/n/[id].js).
// Covers what notes use: headings, bold, italic, strikethrough, code, links, quotes, rules and nested
// bullet, numbered and check lists. Every character of input is HTML-escaped before any tag is added, and
// links only allow http(s) and mailto, so the output is safe for {@html} and server pages.

// "  - [ ] text" -> indent, marker, check box state, text. The editor's list shortcuts use it too.
export const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;
const SAFE_URL = /^(https?:|mailto:)/i;
const PLACEHOLDER = /\u0000(\d+)\u0000/g;
const TAB_WIDTH = 4;
const SUMMARY_CHARS = 200;

/** @param {string} text */
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Columns of leading whitespace, tabs counted as TAB_WIDTH. @param {string} indent */
const width = (indent) => indent.replace(/\t/g, ' '.repeat(TAB_WIDTH)).length;

/** @param {string} url escaped URL @param {string} label escaped label */
const link = (url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;

/**
 * Inline Markdown on one line. Code spans and links are swapped for placeholders first, so emphasis never
 * reaches inside code or into an href.
 * @param {string} text raw text
 */
function inline(text) {
  /** @type {string[]} */
  const tokens = [];
  /** @param {string} html */
  const hold = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  const html = escapeHtml(text)
    .replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, url) => (SAFE_URL.test(url) ? hold(link(url, label)) : whole))
    .replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,:;!?)])/g, (_, before, url) => before + hold(link(url, url)))
    .replace(/\*\*(\S(?:.*?\S)?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(\S(?:.*?\S)?)__/g, '<strong>$1</strong>')
    .replace(/\*(\S(?:[^*]*?\S)?)\*/g, '<em>$1</em>')
    .replace(/(^|\W)_(\S(?:[^_]*?\S)?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(\S(?:.*?\S)?)~~/g, '<del>$1</del>');
  // Twice: a link label can hold a code span.
  const restore = (/** @type {string} */ value) => value.replace(PLACEHOLDER, (_, index) => tokens[Number(index)]);
  return restore(restore(html));
}

/** @typedef {{ indent: number, ordered: boolean, start: number, check: string | undefined, text: string }} ListItem */

/**
 * Nested list from items in document order: deeper items belong to the item above them.
 * @param {ListItem[]} items
 * @returns {string}
 */
function renderList(items) {
  let html = '';
  /** @type {string} */
  let tag = '';
  let index = 0;
  while (index < items.length) {
    const item = items[index++];
    const children = [];
    while (index < items.length && items[index].indent > item.indent) children.push(items[index++]);
    // Switching between bullets and numbers at the same level starts a new list.
    const wanted = item.ordered ? 'ol' : 'ul';
    if (wanted !== tag) {
      if (tag) html += `</${tag}>`;
      tag = wanted;
      html += `<${tag}${item.ordered && item.start !== 1 ? ` start="${item.start}"` : ''}>`;
    }
    const box = item.check === undefined ? '' : `<input type="checkbox" disabled${item.check.trim() ? ' checked' : ''}> `;
    html += `<li${item.check === undefined ? '' : ' class="task"'}>${box}${inline(item.text)}${children.length ? renderList(children) : ''}</li>`;
  }
  return `${html}</${tag}>`;
}

/** @param {string} line */
const startsBlock = (line) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line);

/**
 * Renders Markdown to safe HTML.
 * @param {string} source
 * @returns {string}
 */
export function renderMarkdown(source) {
  const lines = String(source || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const code = [];
      index++;
      while (index < lines.length && !lines[index].trimStart().startsWith(fence[1])) code.push(lines[index++]);
      index++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      index++;
      continue;
    }

    if (RULE.test(line)) {
      out.push('<hr>');
      index++;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted = [];
      while (index < lines.length && QUOTE.test(lines[index])) quoted.push(lines[index++].replace(QUOTE, ''));
      out.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      /** @type {ListItem[]} */
      const items = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = LIST_ITEM.exec(current);
        if (match) {
          items.push({ indent: width(match[1]), ordered: /\d/.test(match[2]), start: parseInt(match[2], 10) || 1, check: match[3], text: match[4] });
        } else if (current.trim() && /^\s/.test(current) && items.length) {
          items[items.length - 1].text += ` ${current.trim()}`;
        } else if (!current.trim() && LIST_ITEM.test(lines[index + 1] || '')) {
          // A blank line between items keeps the list going.
        } else {
          break;
        }
        index++;
      }
      out.push(renderList(items));
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && (paragraph.length === 0 || !startsBlock(lines[index]))) paragraph.push(lines[index++]);
    out.push(`<p>${paragraph.map((text) => inline(text.trim())).join('<br>')}</p>`);
  }
  return out.join('\n');
}

/**
 * Markdown flattened to one line of plain text, for link-preview descriptions.
 * @param {string} source
 * @param {number} [max]
 */
export function plainText(source, max = SUMMARY_CHARS) {
  const text = String(source || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
