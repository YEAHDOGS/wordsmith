// Markdown editing for plain textareas: toolbar formatting and list auto-formatting.
// Enter on a list item starts the next one (numbers count up, check boxes come back empty); Enter on an empty item
// ends the list or steps out one level. Tab / Shift+Tab nest and un-nest list items. Ctrl/Cmd+B and +I format.
// Edits go through execCommand('insertText') so the browser's own undo and redo keep working.
import { LIST_ITEM } from './markdown.js';

// Inline markers the toolbar and shortcuts wrap text in.
export const MARKERS = { bold: '**', italic: '_', code: '`' };
const PLACEHOLDER = 'text';
const MAX_HEADING = 3;
const HEADING_PREFIX = /^#{1,6}\s+/;

/** @typedef {{ from: number, to: number, insert: string, selStart: number, selEnd: number }} Edit */
/** @typedef {'bullet' | 'number' | 'check'} ListKind */

/**
 * Applies an edit to a textarea, keeping undo history, and fires input so bound values update.
 * @param {HTMLTextAreaElement} textarea
 * @param {Edit} edit
 */
export function applyEdit(textarea, { from, to, insert, selStart, selEnd }) {
  textarea.focus();
  textarea.setSelectionRange(from, to);
  const changed = from === to && !insert ? true : document.execCommand(insert ? 'insertText' : 'delete', false, insert);
  if (!changed) {
    textarea.setRangeText(insert, from, to, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  textarea.setSelectionRange(selStart, selEnd);
}

/** Start and end of the full lines a selection touches. @param {string} value @param {number} start @param {number} end */
function lineSpan(value, start, end) {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const newline = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
  return { from, to: newline === -1 ? value.length : newline };
}

/**
 * Rewrites each selected line, keeping the caret or selection on the same text.
 * @param {HTMLTextAreaElement} textarea
 * @param {(line: string, index: number, lines: string[]) => string} transform
 * @returns {Edit}
 */
function mapLines(textarea, transform) {
  const { value, selectionStart: start, selectionEnd: end } = textarea;
  const { from, to } = lineSpan(value, start, end);
  const lines = value.slice(from, to).split('\n');
  const next = lines.map(transform);
  const insert = next.join('\n');
  const firstShift = next[0].length - lines[0].length;
  return { from, to, insert, selStart: Math.max(from, start + firstShift), selEnd: Math.max(from, end + insert.length - (to - from)) };
}

/**
 * Wraps the selection in a marker (or unwraps it when it is already wrapped).
 * @param {HTMLTextAreaElement} textarea
 * @param {string} marker
 * @returns {Edit}
 */
export function wrap(textarea, marker) {
  const { value, selectionStart: start, selectionEnd: end } = textarea;
  const size = marker.length;
  const selected = value.slice(start, end);
  if (selected.length >= size * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(size, -size);
    return { from: start, to: end, insert: inner, selStart: start, selEnd: start + inner.length };
  }
  if (value.slice(start - size, start) === marker && value.slice(end, end + size) === marker) {
    return { from: start - size, to: end + size, insert: selected, selStart: start - size, selEnd: end - size };
  }
  const text = selected || PLACEHOLDER;
  return { from: start, to: end, insert: `${marker}${text}${marker}`, selStart: start + size, selEnd: start + size + text.length };
}


/**
 * Text size: cycles the selected lines through normal -> H1 -> H2 -> H3 -> normal.
 * @param {HTMLTextAreaElement} textarea
 */
export function cycleHeading(textarea) {
  const { value, selectionStart } = textarea;
  const current = HEADING_PREFIX.exec(value.slice(value.lastIndexOf('\n', selectionStart - 1) + 1))?.[0].trim().length ?? 0;
  const level = (current + 1) % (MAX_HEADING + 1);
  applyEdit(textarea, mapLines(textarea, (line) => {
    const text = line.replace(HEADING_PREFIX, '');
    return level && line.trim() ? `${'#'.repeat(level)} ${text}` : text;
  }));
}

/**
 * Turns the selected lines into a list of one kind, or back into plain lines when they already are one.
 * @param {HTMLTextAreaElement} textarea
 * @param {ListKind} kind
 */
export function toggleList(textarea, kind) {
  /** @param {string} line */
  const kindOf = (line) => {
    const match = LIST_ITEM.exec(line);
    if (!match) return '';
    return match[3] !== undefined ? 'check' : /\d/.test(match[2]) ? 'number' : 'bullet';
  };
  const { value, selectionStart, selectionEnd } = textarea;
  const { from, to } = lineSpan(value, selectionStart, selectionEnd);
  const filled = value.slice(from, to).split('\n').filter((line) => line.trim());
  const removing = filled.length > 0 && filled.every((line) => kindOf(line) === kind);
  let count = 0;
  applyEdit(textarea, mapLines(textarea, (line) => {
    const match = LIST_ITEM.exec(line);
    const indent = match ? match[1] : /^\s*/.exec(line)?.[0] ?? '';
    const text = match ? match[4] : line.trimStart();
    if (removing) return indent + text;
    if (!line.trim() && filled.length) return line;
    count++;
    const marker = kind === 'number' ? `${count}. ` : kind === 'check' ? '- [ ] ' : '- ';
    return indent + marker + text;
  }));
}

/** The list marker that comes after a matched item. @param {RegExpExecArray} match */
function nextMarker(match) {
  const [, , marker, check] = match;
  const number = /^(\d+)([.)])$/.exec(marker);
  const bullet = number ? `${Number(number[1]) + 1}${number[2]}` : marker;
  return `${bullet} ${check === undefined ? '' : '[ ] '}`;
}

/**
 * Enter on a list line. Returns an edit, or null to let the browser insert a plain newline.
 * @param {HTMLTextAreaElement} textarea
 * @returns {Edit | null}
 */
function enterEdit(textarea) {
  const { value, selectionStart: start, selectionEnd: end } = textarea;
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const newline = value.indexOf('\n', start);
  const to = newline === -1 ? value.length : newline;
  const match = LIST_ITEM.exec(value.slice(from, to));
  if (!match || start - from < match[0].length - match[4].length) return null;

  if (!match[4].trim()) {
    // An empty item: step out one level, or end the list at the top level.
    const indent = match[1];
    if (!indent) return { from, to, insert: '', selStart: from, selEnd: from };
    // One nesting step is the width of the marker plus its space. The item then continues the parent list,
    // e.g. "3. Ship" above a nested list -> "4. ".
    const outdented = indent.slice(Math.min(indent.length, match[2].length + 1));
    const parent = value.slice(0, from).split('\n').reverse().map((above) => LIST_ITEM.exec(above))
      .find((above) => !above || above[1].length <= outdented.length);
    const marker = parent && parent[1].length === outdented.length ? nextMarker(parent) : value.slice(from + indent.length, to);
    const line = outdented + marker;
    return { from, to, insert: line, selStart: from + line.length, selEnd: from + line.length };
  }
  const insert = `\n${match[1]}${nextMarker(match)}`;
  return { from: start, to: end, insert, selStart: start + insert.length, selEnd: start + insert.length };
}

/**
 * Tab / Shift+Tab on list lines. Null when the selection isn't all list items (so Tab still moves focus).
 * @param {HTMLTextAreaElement} textarea
 * @param {boolean} outdent
 * @returns {Edit | null}
 */
function indentEdit(textarea, outdent) {
  const { value, selectionStart, selectionEnd } = textarea;
  const { from, to } = lineSpan(value, selectionStart, selectionEnd);
  const lines = value.slice(from, to).split('\n');
  const matches = lines.map((line) => LIST_ITEM.exec(line));
  if (matches.some((match) => !match)) return null;
  if (outdent && matches.every((match) => !match?.[1])) return null;
  return mapLines(textarea, (line, index) => {
    const match = /** @type {RegExpExecArray} */ (matches[index]);
    const step = match[2].length + 1;
    if (outdent) return line.slice(Math.min(match[1].length, step));
    // A nested numbered list starts again at 1.
    return ' '.repeat(step) + line.replace(/^(\s*)\d+([.)])/, (_, indent, delimiter) => `${indent}1${delimiter}`);
  });
}

/**
 * Svelte action for a Markdown textarea: list continuation, Tab nesting and formatting shortcuts.
 * @param {HTMLTextAreaElement} textarea
 */
export function markdownKeys(textarea) {
  /** @param {KeyboardEvent} event */
  const onkeydown = (event) => {
    if (event.isComposing || event.altKey) return;
    const shortcut = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    /** @type {Edit | null} */
    let edit = null;
    if (shortcut && key === 'b') edit = wrap(textarea, MARKERS.bold);
    else if (shortcut && key === 'i') edit = wrap(textarea, MARKERS.italic);
    else if (!shortcut && event.key === 'Enter' && !event.shiftKey) edit = enterEdit(textarea);
    else if (!shortcut && event.key === 'Tab') edit = indentEdit(textarea, event.shiftKey);
    if (!edit) return;
    event.preventDefault();
    applyEdit(textarea, edit);
  };
  textarea.addEventListener('keydown', onkeydown);
  return { destroy: () => textarea.removeEventListener('keydown', onkeydown) };
}
