// Notes as Markdown for the clipboard, shaped to paste straight into Claude Code or any agent prompt.
// One note is a "# Title" section; several are joined with horizontal rules.
import { store } from './store.svelte.js';
import { STATE_STYLE } from './colors.js';
import { PRIORITY_LABELS } from './models.js';

const NOTE_SEPARATOR = '\n\n---\n\n';
const UNTITLED = 'Untitled note';

/**
 * One note as Markdown: title, feature details, body, pull requests, labels.
 * @param {any} note
 */
export function noteMarkdown(note) {
  const project = note.project_id ? store.find('projects', note.project_id) : null;
  const labels = note.label_ids.map((/** @type {string} */ id) => store.find('labels', id)).filter((/** @type {any} */ label) => label && !label.deleted_at);
  const lines = [`# ${note.title.trim() || UNTITLED}`];

  const details = [];
  if (note.kind === 'feature') details.push(`Feature: ${STATE_STYLE[/** @type {keyof typeof STATE_STYLE} */ (note.state)]?.label ?? note.state}`);
  if (note.kind === 'feature' && note.priority) details.push(`Priority: ${PRIORITY_LABELS[note.priority]}`);
  if (project && !project.deleted_at) details.push(`Project: ${project.name}${project.repo ? ` (${project.repo})` : ''}`);
  if (note.assignee) details.push(`Assignee: ${note.assignee}`);
  if (note.kind === 'feature') details.push(`wordsmith id: \`${note.id}\``);
  if (details.length) lines.push('', `> ${details.join(' · ')}`);
  if (note.kind === 'feature' && note.status) lines.push(`> Status: ${note.status}`);

  if (note.body.trim()) lines.push('', note.body.trim());
  if (note.pull_requests.length) {
    lines.push('', '**Pull requests**', ...note.pull_requests.map((/** @type {any} */ pr) => `- [${pr.title || `${pr.repo}#${pr.number}`}](${pr.url}) (${pr.state})`));
  }
  if (labels.length) lines.push('', `Labels: ${labels.map((/** @type {any} */ label) => label.name).join(', ')}`);
  return lines.join('\n');
}

/** @param {any[]} notes */
export const notesMarkdown = (notes) => notes.map(noteMarkdown).join(NOTE_SEPARATOR);

/**
 * Copies text, falling back to a hidden textarea where the async Clipboard API is missing or blocked.
 * @param {string} text
 * @returns {Promise<boolean>} whether it worked
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}
