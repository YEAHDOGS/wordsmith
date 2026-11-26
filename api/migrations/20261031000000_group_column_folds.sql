-- Folding a note group on the board is per column. A group shows in every board column that holds some of its notes,
-- and the single note_groups.collapsed flag folded all of them at once.
--   note_groups.folded_columns  JSON list of board column ids (boards.columns[].id) where the group is folded, on every
--                               device. note_groups.collapsed stays the fold on the notes page, where a group is one band.
-- Recovery: additive only. Old Workers and app builds never read the new column, and their upserts only write the
-- columns they know, so rolling the code back needs no database change.
ALTER TABLE note_groups ADD COLUMN folded_columns TEXT NOT NULL DEFAULT '[]';
