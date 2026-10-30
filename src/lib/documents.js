// Document attachments (pdf, docx, md, txt) in the app: their icon and short tag, readable sizes, and a cheap text
// excerpt for plain text and Markdown. Excerpts are always shown as text, never rendered as HTML.
import FileText from '@lucide/svelte/icons/file-text';
import FilePen from '@lucide/svelte/icons/file-pen';
import FileCode from '@lucide/svelte/icons/file-code';
import FileType from '@lucide/svelte/icons/file-type';
import { fileExtension } from './models.js';

const KB = 1024;
const MB = KB * KB;
export const PDF = 'application/pdf';
const TEXT_TYPES = ['text/plain', 'text/markdown'];
// Only the start of a text file is fetched for its excerpt (the server honours Range), so a 5 MB log costs 4 KB.
const EXCERPT_BYTES = 4 * KB;
const ICONS = {
  'application/pdf': FileText,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': FilePen,
  'text/markdown': FileCode,
  'text/plain': FileType,
};

/** The lucide icon for a document type. @param {string} type */
export const documentIcon = (type) => ICONS[/** @type {keyof typeof ICONS} */ (type)] || FileText;

/** 'PDF', 'DOCX', 'MD'... from the file name. @param {string} name */
export const documentTag = (name) => fileExtension(name).slice(1).toUpperCase();

/** 12 KB, 3.4 MB. @param {number} bytes */
export const fileSize = (bytes) => (bytes < MB ? `${Math.ceil(bytes / KB)} KB` : `${(bytes / MB).toFixed(1)} MB`);

/** Whether a document has a text excerpt worth showing. @param {string} type */
export const hasExcerpt = (type) => TEXT_TYPES.includes(type);

/**
 * The first few KB of a text attachment as a string, '…' added when the file goes on.
 * @param {string} src a same-origin path or blob URL from mediaUrl
 * @param {number} size the file's full size in bytes
 */
export async function textExcerpt(src, size) {
  const response = await fetch(src, { headers: { Range: `bytes=0-${EXCERPT_BYTES - 1}` } });
  if (!response.ok) throw new Error('Could not load the file');
  // Blob URLs may ignore Range, so the slice keeps the excerpt short either way.
  const bytes = new Uint8Array(await response.arrayBuffer()).subarray(0, EXCERPT_BYTES);
  const text = new TextDecoder().decode(bytes);
  return size > EXCERPT_BYTES ? `${text.replace(/�$/, '')}…` : text;
}
