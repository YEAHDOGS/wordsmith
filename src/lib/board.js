// Feature boards: which columns a page shows and which column each feature sits in. Columns live in the synced boards
// table, one row per scope (FEATURES_SCOPE for the Features page, a project id for a project), and default to one column
// per state until someone edits them. Used by the board itself and by the board settings page.
import { DEFAULT_COLUMNS } from './models.js';
import { store } from './store.svelte.js';

/** @typedef {{ id: string, name: string, state: string }} Column */

/** The columns a scope's board shows, in order. @param {string} scope @returns {Column[]} */
export function columnsFor(scope) {
  return store.boards.find((board) => board.scope === scope && !board.deleted_at)?.columns ?? DEFAULT_COLUMNS;
}

/** Saves a scope's columns, creating its board row on the first edit. @param {string} scope @param {Column[]} columns */
export function saveColumns(scope, columns) {
  const board = store.boards.find((row) => row.scope === scope && !row.deleted_at);
  if (board) return store.update('boards', board.id, { columns });
  return store.create('boards', { scope, columns });
}
