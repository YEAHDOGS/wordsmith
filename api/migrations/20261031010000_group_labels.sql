-- Group labels: every note group gets a label named "[project name] - [group name]" (src/lib/groups.js), so its notes
-- can be filtered from the sidebar like any label, whichever board column they sit in.
--   labels.group_id  the note group (note_groups.id) a label mirrors; NULL = an ordinary label. The app shows these
--                    labels with a group icon, puts a note's group label on it when it joins the group and takes it off
--                    when it leaves. Deleting the label leaves the group alone; deleting the group trashes its label.
-- Backfill: one label per live group that holds live notes, and those notes get it. Both bump updated_at, so every
-- device pulls them on its next sync.
-- Recovery: additive only (a new column, new label rows, label ids appended to notes.label_ids); old Workers and app
-- builds never read group_id and keep working. To undo the backfill: strip ids of labels WHERE group_id IS NOT NULL
-- from notes.label_ids, then delete those labels.
ALTER TABLE labels ADD COLUMN group_id TEXT;

INSERT INTO labels (id, user_id, name, color, group_id, created_at, updated_at)
SELECT 'gl' || lower(hex(randomblob(10))), g.user_id,
  substr(CASE WHEN p.name IS NOT NULL AND p.name <> '' THEN p.name || ' - ' || g.name ELSE g.name END, 1, 80),
  g.color, g.id,
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM note_groups g
LEFT JOIN projects p ON p.id = g.project_id AND p.deleted_at IS NULL
WHERE g.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM notes n WHERE n.group_id = g.id AND n.deleted_at IS NULL);

-- 30 = MAX_LABELS_PER_NOTE (src/lib/models.js): a note already at the cap keeps its labels and skips the group label.
UPDATE notes
SET label_ids = json_insert(label_ids, '$[#]', (SELECT l.id FROM labels l WHERE l.group_id = notes.group_id AND l.deleted_at IS NULL)),
  updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE deleted_at IS NULL
  AND group_id IS NOT NULL
  AND json_array_length(label_ids) < 30
  AND EXISTS (SELECT 1 FROM labels l WHERE l.group_id = notes.group_id AND l.deleted_at IS NULL);
