// Note groups: named, colored bundles of a project's notes that fold away under one header (the note_groups table and
// notes.group_id). The selection bar makes them; the board and the notes page draw each one as a collapsible band.
import { store } from './store.svelte.js';

/** A project's live groups, oldest first. @param {string | null | undefined} projectId */
export function groupsIn(projectId) {
  if (!projectId) return [];
  return store.note_groups.filter((group) => group.project_id === projectId && !group.deleted_at).sort((a, b) => a.created_at - b.created_at);
}

/**
 * Splits notes into each group's members, keeping their order, and the rest. A note pointing at a group that isn't in
 * `groups` (deleted, or another project's) counts as ungrouped.
 * @param {any[]} notes @param {any[]} groups
 */
export function splitByGroup(notes, groups) {
  /** @type {Map<string, any[]>} */
  const members = new Map(groups.map((group) => [group.id, []]));
  /** @type {any[]} */
  const rest = [];
  for (const note of notes) (members.get(note.group_id) ?? rest).push(note);
  return { members, rest };
}

/**
 * Moves notes into a group, or out of every group with null. A group left with no notes is deleted, so empty headers
 * never linger.
 * @param {any[]} notes @param {string | null} groupId
 */
export function assignGroup(notes, groupId) {
  const left = notes.map((note) => note.group_id).filter((id) => id && id !== groupId);
  for (const note of notes) if ((note.group_id ?? null) !== groupId) store.update('notes', note.id, { group_id: groupId });
  pruneGroups(left);
}

/** Deletes each of these groups that no live note is in any more (after a drag out of it, say). @param {(string | null | undefined)[]} ids */
export function pruneGroups(ids) {
  for (const id of new Set(ids)) if (id && !store.notes.some((note) => note.group_id === id && !note.deleted_at)) store.remove('note_groups', id);
}

/**
 * Makes a group in a project and moves the notes into it.
 * @param {string} projectId @param {string} name @param {string} color @param {any[]} notes
 */
export function createGroup(projectId, name, color, notes) {
  const group = store.create('note_groups', { project_id: projectId, name, color });
  assignGroup(notes, group.id);
  return group;
}

/** Deletes a group; its notes go back to the ungrouped list. @param {any} group */
export function ungroup(group) {
  for (const note of store.notes.filter((row) => row.group_id === group.id)) store.update('notes', note.id, { group_id: null });
  store.remove('note_groups', group.id);
}
