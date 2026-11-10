-- The "Needs you" view: an agent's open question to the owner, and a snooze time.
--   notes.ask            what an agent needs the owner to decide ('' = nothing). Lines starting "1." ... "9." are
--                        options the owner can pick with one key. The owner's answer is appended to the body and clears it.
--   notes.snoozed_until  the note stays out of "Needs you" until this time (ms); NULL = not snoozed. Owner only.
-- Recovery: additive only. Old Workers and app builds never read the new columns, and their upserts only write the
-- columns they know, so rolling the code back needs no database change.
ALTER TABLE notes ADD COLUMN ask TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN snoozed_until INTEGER;
