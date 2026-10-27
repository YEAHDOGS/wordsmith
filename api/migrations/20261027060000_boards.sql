-- Custom feature boards: any number of renamable columns, for the Features page and for each project.
--   boards.scope     'features' (the all-projects Features page) or a project id. One live board per scope per user.
--   boards.columns   JSON list of { id, name, state }: the column order on screen. state is the lifecycle role the
--                    column plays (requested, in_progress, complete), so agents, claims and merged PRs keep working.
--                    Several columns can share a role, e.g. New and Requested both hold requested features.
--   notes.column_id  which column a feature sits in. Empty, or a column that's gone or plays another role, falls back to
--                    the first column with the note's state, so agent state changes always land somewhere sensible.
-- No board row = the default three columns (Requested, In progress, Complete), so nothing changes until someone edits.
-- Recovery: additive only. Old Workers and app builds never read the new table or column, and their upserts leave the
-- column alone (they only list the columns they know), so rolling the code back needs no database change.
CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  columns TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX boards_user_updated ON boards(user_id, updated_at);

ALTER TABLE notes ADD COLUMN column_id TEXT NOT NULL DEFAULT '';
