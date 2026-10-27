-- Priority moves from 0..3 to 0..5: 0 = none, then 1 Low, 2 Normal, 3 High, 4 Urgent, 5 Critical
-- (labels in PRIORITY_LABELS, src/lib/models.js). The old 1 High, 2 Urgent, 3 Critical keep their meaning as 3, 4, 5.
-- updated_at is bumped to now (milliseconds, like every other timestamp) so each device pulls the new values on its
-- next sync instead of keeping the old numbers. max() keeps it moving forward even if a clock ran ahead.
UPDATE notes
SET priority = priority + 2,
    updated_at = max(updated_at + 1, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
WHERE priority BETWEEN 1 AND 3;

-- Manual order from hold-and-drag reordering. Lower sorts first; fractional values let a note slot between two
-- neighbours without renumbering the rest. NULL = never placed by hand, so existing notes keep their current sort.
ALTER TABLE notes ADD COLUMN position REAL;
