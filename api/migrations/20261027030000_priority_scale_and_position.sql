-- Name kept from an earlier draft that also remapped priority in place; that remap moved to the additive
-- 20261027040000_priority_level.sql so builds on the old 0..3 scale keep working.
-- Manual order from hold-and-drag reordering. Lower sorts first; fractional values let a note slot between two
-- neighbours without renumbering the rest. NULL = never placed by hand, so existing notes keep their current sort.
-- Additive: code that doesn't know the column never reads or writes it. Recovery: nothing to undo; a later migration
-- may drop the column once no build uses it.
ALTER TABLE notes ADD COLUMN position REAL;