-- Trash: deleted projects, labels, notes and note groups stay recoverable for TRASH_DAYS (src/lib/models.js) after
-- deleted_at, then the server purges them (api/lib/trash.js): content blanked, attachments removed from R2, purged_at
-- stamped. The tombstone row stays, so devices that were offline still learn about the delete through sync.
--   <table>.purged_at  when the row was purged (by age, "Delete forever" or "Empty trash"); NULL = still in the trash,
--                      or never deleted. Restoring a row clears it.
-- The partial indexes hold only rows waiting in the trash, so the purge check reads almost nothing.
-- Recovery: additive only. Old Workers and app builds never read the new column or indexes, and their upserts only write
-- the columns they know, so rolling the code back needs no database change. To undo: drop the four indexes; the
-- columns are ignored by older code.
ALTER TABLE notes ADD COLUMN purged_at INTEGER;
ALTER TABLE projects ADD COLUMN purged_at INTEGER;
ALTER TABLE labels ADD COLUMN purged_at INTEGER;
ALTER TABLE note_groups ADD COLUMN purged_at INTEGER;

CREATE INDEX notes_trash ON notes(user_id, deleted_at) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
CREATE INDEX projects_trash ON projects(user_id, deleted_at) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
CREATE INDEX labels_trash ON labels(user_id, deleted_at) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
CREATE INDEX note_groups_trash ON note_groups(user_id, deleted_at) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
