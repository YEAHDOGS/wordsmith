// "Download my data": everything an account holds, as one .zip made on the device. It works when the account is
// locked too (free trial over), from the paywall. GET /api/export answers with every row; each attached file and tape
// is then fetched and packed beside a Markdown copy of every note:
//   wordsmith/README.txt             what is in the zip
//   wordsmith/data.json              every row as the server holds it (projects, labels, notes, boards, timeline...)
//   wordsmith/notes/<project>/…md    one file per note, readable anywhere
//   wordsmith/files/<note>/…         the files attached to each note
//   wordsmith/tapes/…                tape recordings, with their transcripts as .txt
// Files are added until MAX_ZIP_BYTES; any left out are listed in README.txt (they are still on the server).
import { ApiError, IS_NATIVE, api, apiUrl, sessionToken } from './api.js';
import { STATE_LABELS } from './models.js';
import { MAX_ZIP_FILES, zip } from './zip.js';

const ROOT = 'wordsmith';
const NO_PROJECT = 'No project';
const UNTITLED = 'Untitled';
// Kept in memory while it is built, so it stops well short of what a phone can hold (and of zip's 4 GB).
const MAX_ZIP_BYTES = 1024 * 1024 * 1024;
const MAX_NAME_CHARS = 60;
const ID_CHARS = 8;
const TAPE_EXTENSIONS = { 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav', 'audio/webm': '.webm', 'audio/flac': '.flac', 'audio/aac': '.aac' };
// Characters no file system accepts in a name, and Windows' reserved device names.
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]+/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const REVOKE_AFTER_MS = 60_000;

/** A file or folder name safe on every system. @param {unknown} text @param {string} fallback */
function safeName(text, fallback) {
  const name = String(text ?? '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, MAX_NAME_CHARS).trim();
  return !name || RESERVED.test(name) ? fallback : name;
}

/** @param {number | null | undefined} ms */
const iso = (ms) => (ms ? new Date(ms).toISOString() : '');

/**
 * One note as a Markdown file: a header of its details, then the body, its pull requests and attached files.
 * @param {any} note @param {{ project: string, labels: string[], files: string[] }} context
 */
function noteFile(note, { project, labels, files }) {
  const details = [
    `- State: ${STATE_LABELS[/** @type {keyof typeof STATE_LABELS} */ (note.state)] ?? note.state}`,
    `- Project: ${project}`,
    labels.length ? `- Labels: ${labels.join(', ')}` : '',
    note.priority_level ? `- Priority: ${note.priority_level} of 5` : '',
    note.difficulty ? `- Difficulty: ${note.difficulty} of 5` : '',
    note.status ? `- Status: ${note.status}` : '',
    note.assignee ? `- Assignee: ${note.assignee}` : '',
    `- Created: ${iso(note.created_at)}`,
    `- Updated: ${iso(note.updated_at)}`,
    note.started_at ? `- Started: ${iso(note.started_at)}` : '',
    note.completed_at ? `- Completed: ${iso(note.completed_at)}` : '',
    note.archived ? '- Archived' : '',
    `- Id: ${note.id}`,
  ].filter(Boolean);
  const lines = [`# ${String(note.title || '').trim() || UNTITLED}`, '', ...details];
  if (String(note.body || '').trim()) lines.push('', note.body.trim());
  if (String(note.analysis || '').trim()) lines.push('', '## Agent analysis', '', note.analysis.trim());
  if (note.pull_requests?.length) lines.push('', '## Pull requests', '', ...note.pull_requests.map((/** @type {any} */ pr) => `- ${pr.url} (${pr.state})`));
  if (files.length) lines.push('', '## Files', '', ...files.map((file) => `- ${file}`));
  return `${lines.join('\n')}\n`;
}

/** Fetches one stored file with the session, as bytes. @param {string} path */
async function fileBytes(path) {
  const token = sessionToken.get();
  const response = await fetch(apiUrl(path), { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: token ? 'omit' : 'same-origin' });
  if (!response.ok) throw new ApiError(response.status, `Could not download ${path}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Builds the zip. Reports progress as files arrive.
 * @param {(done: number, total: number) => void} [onProgress] files fetched so far, of how many
 * @returns {Promise<{ blob: Blob, name: string, notes: number, files: number, skipped: string[] }>}
 */
export async function buildExport(onProgress = () => {}) {
  const data = await api('/api/export');
  const encoder = new TextEncoder();
  /** @type {{ name: string, data: Uint8Array, date?: Date }[]} */
  const entries = [];
  /** Names already used, so two notes with one title never overwrite each other. @type {Set<string>} */
  const used = new Set();
  /**
   * Adds a file under a path of its own and returns that path: "name (2).ext" when the name is taken (compared
   * without case, as Windows does), so nothing in the zip ever overwrites anything else when it is unpacked.
   * @param {string} path @param {Uint8Array} bytes @param {number} [at]
   */
  const add = (path, bytes, at) => {
    let free = path;
    for (let copy = 2; used.has(free.toLowerCase()); copy++) free = path.replace(/(\.[^./]*)?$/, ` (${copy})$1`);
    used.add(free.toLowerCase());
    entries.push({ name: free, data: bytes, date: at ? new Date(at) : undefined });
    return free;
  };
  const projects = new Map(data.projects.map((/** @type {any} */ project) => [project.id, safeName(project.name, NO_PROJECT)]));
  const labels = new Map(data.labels.map((/** @type {any} */ label) => [label.id, label.name]));
  /**
   * Each note's folder-safe name, shared by its Markdown file and its files folder: its title and the start of its
   * id, or its whole id when two notes would share that name. @type {Map<string, string>}
   */
  const noteNames = new Map();
  const takenNames = new Set();
  for (const note of data.notes) {
    const title = safeName(note.title, UNTITLED);
    const short = `${title} ${String(note.id).slice(0, ID_CHARS)}`;
    const name = takenNames.has(short.toLowerCase()) ? `${title} ${safeName(note.id, 'note')}` : short;
    takenNames.add(name.toLowerCase());
    noteNames.set(note.id, name);
  }

  // Files first, so the Markdown can list what made it in. One at a time: steady memory, and gentle on the server.
  const wanted = [
    ...data.attachments.filter((/** @type {any} */ file) => noteNames.has(file.note_id)).map((/** @type {any} */ file) => ({
      path: `${ROOT}/files/${noteNames.get(file.note_id)}/${safeName(file.name, file.id)}`, url: `/api/attachments/${file.id}`, size: Number(file.size), at: file.created_at, note: file.note_id })),
    ...data.tapes.filter((/** @type {any} */ tape) => Number(tape.audio_size) > 0).map((/** @type {any} */ tape) => ({
      path: `${ROOT}/tapes/${safeName(tape.title || tape.source_name, UNTITLED)} ${String(tape.id).slice(0, ID_CHARS)}${TAPE_EXTENSIONS[/** @type {keyof typeof TAPE_EXTENSIONS} */ (tape.audio_type)] ?? ''}`,
      url: `/api/tapes/${tape.id}/audio`, size: Number(tape.audio_size), at: tape.recorded_at || tape.created_at, note: '' })),
  ];
  /** @type {string[]} */
  const skipped = [];
  /** @type {Map<string, string[]>} */
  const filesOf = new Map();
  let bytes = 0;
  let done = 0;
  // Every note and tape transcript takes an entry too; files past the zip's room are left out and listed.
  const room = MAX_ZIP_FILES - data.notes.length - data.tapes.length - 2;
  for (const file of wanted) {
    onProgress(done++, wanted.length);
    if (bytes + file.size > MAX_ZIP_BYTES || entries.length >= room) {
      skipped.push(file.path);
      continue;
    }
    try {
      const content = await fileBytes(file.url);
      bytes += content.length;
      const path = add(file.path, content, file.at);
      if (file.note) filesOf.set(file.note, [...(filesOf.get(file.note) ?? []), path.slice(ROOT.length + 1)]);
    } catch {
      skipped.push(file.path);
    }
  }
  onProgress(wanted.length, wanted.length);

  for (const note of data.notes) {
    const project = projects.get(note.project_id) ?? NO_PROJECT;
    const text = noteFile(note, { project, labels: (note.label_ids ?? []).map((/** @type {string} */ id) => labels.get(id)).filter(Boolean), files: filesOf.get(note.id) ?? [] });
    add(`${ROOT}/notes/${project}/${noteNames.get(note.id)}.md`, encoder.encode(text), note.updated_at);
  }
  for (const tape of data.tapes) {
    if (!String(tape.transcript || tape.body || '').trim()) continue;
    const text = [tape.body, tape.transcript].map((part) => String(part || '').trim()).filter(Boolean).join('\n\n---\n\n');
    add(`${ROOT}/tapes/${safeName(tape.title || tape.source_name, UNTITLED)} ${String(tape.id).slice(0, ID_CHARS)}.txt`, encoder.encode(`${text}\n`), tape.updated_at);
  }
  add(`${ROOT}/data.json`, encoder.encode(JSON.stringify(data, null, 2)));
  const readme = [
    `wordsmith export for ${data.user.email || data.user.name || data.user.id}`,
    `Made ${iso(data.exported_at)}`,
    '',
    `notes/   ${data.notes.length} notes as Markdown, one folder per project`,
    `files/   the files attached to each note (${data.attachments.length})`,
    `tapes/   ${data.tapes.length} tape recordings, with transcripts as .txt`,
    'data.json  every row as the server holds it: projects, labels, notes, boards, groups, designs, tapes, timeline',
    ...(data.truncated.length ? ['', `These tables were too long to export whole: ${data.truncated.join(', ')}.`] : []),
    ...(skipped.length ? ['', 'Left out (too large for one zip, or the download failed). They are still on the server:', ...skipped.map((path) => `- ${path}`)] : []),
    '',
  ].join('\n');
  add(`${ROOT}/README.txt`, encoder.encode(readme));
  const day = new Date(data.exported_at).toISOString().slice(0, 10);
  return { blob: zip(entries), name: `wordsmith-export-${day}.zip`, notes: data.notes.length, files: entries.length - data.notes.length - 2, skipped };
}

/**
 * Builds the export and hands it to the browser as a download.
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function downloadExport(onProgress) {
  const result = await buildExport(onProgress);
  const url = URL.createObjectURL(result.blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: result.name });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  return result;
}

/** Whether this build can save the zip: the native shells have no download folder wired up yet. */
export const CAN_EXPORT = !IS_NATIVE;
