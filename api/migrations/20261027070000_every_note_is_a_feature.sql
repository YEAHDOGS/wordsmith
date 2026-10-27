-- Notes and features are one thing now: every note is a feature, on the board and in the agent queue. Plain notes
-- become requested features (their state column already defaults to requested). The server keeps it that way: saveNotes
-- in api/lib/notes.js stores every note as a feature, including ones old app builds or the agent API send as "note".
-- Backup and recovery: legacy_kind keeps what each row was before this migration ('note' or 'feature'). To undo, run by
-- hand (migrate-d1.yml): UPDATE notes SET kind = legacy_kind, updated_at = <now ms> WHERE legacy_kind = 'note'; and roll the
-- code back. updated_at is bumped so every device pulls the change on its next sync.
ALTER TABLE notes ADD COLUMN legacy_kind TEXT NOT NULL DEFAULT '';
UPDATE notes SET legacy_kind = kind;
UPDATE notes
SET kind = 'feature',
    updated_at = max(updated_at + 1, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
WHERE kind = 'note';
