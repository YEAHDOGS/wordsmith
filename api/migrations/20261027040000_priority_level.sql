-- Priority grows from 0..3 to 0..5 (0 none, 1 Low, 2 Normal, 3 High, 4 Urgent, 5 Critical; PRIORITY_LABELS in
-- src/lib/models.js) without touching the old column, so Workers and app builds still on the old code keep working:
--   priority_level  the 0..5 scale every new build reads and writes.
--   priority        the old 0..3 scale (0 none, 1 High, 2 Urgent, 3 Critical), still read and written by old builds.
-- New code writes both (saveNotes in api/lib/notes.js keeps priority = LEGACY_PRIORITY[priority_level]). The triggers
-- below cover old Workers, which only write priority: a changed old value is carried over to priority_level.
-- Recovery: everything here is additive. Rolling the code back needs no database change (old code ignores the new
-- column; the triggers only keep it current). Once no old build is left, a later migration can drop the triggers and,
-- if wanted, the legacy column.
ALTER TABLE notes ADD COLUMN priority_level INTEGER NOT NULL DEFAULT 0;

-- Backfill: old 1 High, 2 Urgent, 3 Critical keep their meaning as 3, 4, 5. updated_at is bumped (milliseconds,
-- like every other timestamp) so new builds pull priority_level on their next sync; old builds just see the same
-- values again. max() keeps it moving forward even if a clock ran ahead.
UPDATE notes
SET priority_level = priority + 2,
    updated_at = max(updated_at + 1, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
WHERE priority BETWEEN 1 AND 3;

CREATE INDEX notes_features_level ON notes(user_id, kind, state, priority_level);

-- An old Worker changed the old priority but left priority_level alone: convert it up.
CREATE TRIGGER notes_legacy_priority_update AFTER UPDATE OF priority ON notes
WHEN NEW.priority IS NOT OLD.priority AND NEW.priority_level IS OLD.priority_level
BEGIN
  UPDATE notes SET priority_level = CASE WHEN NEW.priority BETWEEN 1 AND 3 THEN NEW.priority + 2 ELSE 0 END WHERE id = NEW.id;
END;

-- An old Worker created a note with a priority: priority_level is still the default 0.
CREATE TRIGGER notes_legacy_priority_insert AFTER INSERT ON notes
WHEN NEW.priority BETWEEN 1 AND 3 AND NEW.priority_level = 0
BEGIN
  UPDATE notes SET priority_level = NEW.priority + 2 WHERE id = NEW.id;
END;