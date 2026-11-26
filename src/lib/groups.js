// Note groups: named, colored bundles of a project's notes that fold away under one header (the note_groups table and
// notes.group_id). The selection bar makes them; the board and the notes page draw each one as a collapsible band.
// Every group also has a label, "[project name] - [group name]" (labels.group_id), so its notes filter from the sidebar
// like any label, whichever board column they're in. A note gets it on joining the group and loses it on leaving (every
// membership change goes through joinGroup). Deleting the label leaves the group alone; the next note in makes a new
// one. Deleting the group trashes its label.
import { store } from './store.svelte.js';
import { MAX_LABELS_PER_NOTE, MAX_NAME } from './models.js';

const LABEL_SEPARATOR = ' - ';

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

/** A group's live label, if it has one. @param {string} groupId */
function labelOf(groupId) {
  return store.labels.find((label) => label.group_id === groupId && !label.deleted_at);
}

/** "[project name] - [group name]", or just the group's name outside a project. @param {any} group */
function labelName(group) {
  const project = group.project_id ? store.find('projects', group.project_id) : null;
  return (project && !project.deleted_at ? project.name + LABEL_SEPARATOR + group.name : group.name).slice(0, MAX_NAME);
}

/**
 * The patch that moves a note into a group (null: out of every group): its group_id, and its labels with the old
 * group's label swapped for the new one's, made if the group has none yet. A note at the label cap keeps its labels.
 * @param {any} note @param {string | null} groupId
 */
export function joinGroup(note, groupId) {
  const group = groupId ? store.find('note_groups', groupId) : null;
  const old = note.group_id && note.group_id !== groupId ? labelOf(note.group_id) : null;
  const label = group && !group.deleted_at ? labelOf(group.id) ?? store.create('labels', { name: labelName(group), color: group.color, group_id: group.id }) : null;
  const labelIds = note.label_ids.filter((/** @type {string} */ id) => id !== old?.id);
  if (label && !labelIds.includes(label.id) && labelIds.length < MAX_LABELS_PER_NOTE) labelIds.push(label.id);
  return { group_id: groupId, label_ids: labelIds };
}

/**
 * Moves notes into a group, or out of every group with null. A group left with no notes is deleted, so empty headers
 * never linger.
 * @param {any[]} notes @param {string | null} groupId
 */
export function assignGroup(notes, groupId) {
  const left = notes.map((note) => note.group_id).filter((id) => id && id !== groupId);
  for (const note of notes) if ((note.group_id ?? null) !== groupId) store.update('notes', note.id, joinGroup(note, groupId));
  pruneGroups(left);
}

/** Deletes a group and trashes its label. @param {string} id */
function removeGroup(id) {
  store.remove('note_groups', id);
  const label = labelOf(id);
  if (label) store.remove('labels', label.id);
}

/** Deletes each of these groups that no live note is in any more (after a drag out of it, say). @param {(string | null | undefined)[]} ids */
export function pruneGroups(ids) {
  for (const id of new Set(ids)) if (id && !store.notes.some((note) => note.group_id === id && !note.deleted_at)) removeGroup(id);
}

/** Renames or recolors a group, and its label with it. @param {any} group @param {string} name @param {string} color */
export function editGroup(group, name, color) {
  store.update('note_groups', group.id, { name, color });
  const label = labelOf(group.id);
  if (label) store.update('labels', label.id, { name: labelName({ ...group, name }), color });
}

/** Renames a project's group labels after the project is renamed. @param {string} projectId */
export function relabelProject(projectId) {
  for (const group of groupsIn(projectId)) {
    const label = labelOf(group.id);
    if (label) store.update('labels', label.id, { name: labelName(group) });
  }
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

/** Deletes a group (and its label); its notes go back to the ungrouped list. @param {any} group */
export function ungroup(group) {
  for (const note of store.notes.filter((row) => row.group_id === group.id)) store.update('notes', note.id, joinGroup(note, null));
  removeGroup(group.id);
}
