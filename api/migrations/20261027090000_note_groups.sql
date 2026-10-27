-- Note groups: a named, colored bundle of a project's notes that folds away under one header on the board and the
-- notes page ("Group" in the selection bar).
--   note_groups.project_id  the project the group belongs to.
--   note_groups.collapsed   1 = its notes are hidden under the header, on every device.
--   notes.group_id          the group a note is in; NULL, or a group that's gone, = not grouped.
-- Recovery: additive only. Old Workers and app builds never read the new table or column, and their upserts leave the
-- column alone (they only write the columns they know), so rolling the code back needs no database change.
CREATE TABLE note_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'default',
  collapsed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX note_groups_user_updated ON note_groups(user_id, updated_at);

ALTER TABLE notes ADD COLUMN group_id TEXT;
