// What the Trash page lists: deleted notes, projects and labels still inside their TRASH_DAYS, newest delete first.
// Note groups go to the trash too (and are purged on the same clock), but aren't listed: a group only holds notes, and
// it is deleted once it's empty or ungrouped, so restoring one would only bring back an empty header.
import { DAY_MS, TRASH_MS, projectKey } from '../lib/models.js';
import { store } from '../lib/store.svelte.js';

export const TRASH_KINDS = /** @type {const} */ (['notes', 'projects', 'labels']);
const SNIPPET_LENGTH = 140;

/** @typedef {{ table: typeof TRASH_KINDS[number], id: string, title: string, snippet: string, color: string, group: boolean, deletedAt: number, daysAgo: number, daysLeft: number }} TrashItem */

/**
 * Every listable row in the trash right now.
 * @param {number} now
 * @returns {TrashItem[]}
 */
export function trashItems(now) {
  /** @type {TrashItem[]} */
  const items = [];
  for (const table of TRASH_KINDS) {
    for (const row of store[table]) {
      if (!row.deleted_at || row.purged_at || now - row.deleted_at >= TRASH_MS) continue;
      const title = table === 'notes' ? row.title.trim() : row.name.trim();
      const snippet = table === 'notes' ? row.body.trim().slice(0, SNIPPET_LENGTH) : table === 'projects' ? row.repo : '';
      // Notes left empty are dropped by the editor on close, and notes deleted before the trash existed were blanked
      // by the server: neither has anything to bring back.
      if (table === 'notes' && !title && !snippet && !store.attachmentsFor(row.id).length) continue;
      items.push({
        table, id: row.id, title, snippet, color: row.color,
        // A note group's label (labels.group_id), shown with the group icon
        group: table === 'labels' && Boolean(row.group_id),
        deletedAt: row.deleted_at,
        daysAgo: Math.max(0, Math.floor((now - row.deleted_at) / DAY_MS)),
        daysLeft: Math.max(1, Math.ceil((row.deleted_at + TRASH_MS - now) / DAY_MS)),
      });
    }
  }
  return items.sort((a, b) => b.deletedAt - a.deletedAt);
}

/**
 * Trash items as the ids store.purge takes, per table. "Empty trash" sends only what this device lists, so the count
 * the person confirmed is the count erased.
 * @param {TrashItem[]} items
 */
export function idsByTable(items) {
  /** @type {Partial<Record<TrashItem['table'], string[]>>} */
  const rows = {};
  for (const item of items) (rows[item.table] ||= []).push(item.id);
  return rows;
}

/**
 * Why a row can't come back right now, or '' when it can. A project can't share a name with a live one.
 * @param {TrashItem} item
 */
export function restoreBlocker(item) {
  if (item.table !== 'projects') return '';
  const key = projectKey(item.title);
  const clash = store.projects.some((project) => !project.deleted_at && project.id !== item.id && projectKey(project.name) === key);
  return clash ? item.title : '';
}
