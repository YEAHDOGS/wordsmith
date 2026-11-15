-- Tapes, what's on them: a transcript and the owner's verdict, so thousands of recordings can be searched and the
-- good ones found.
--   tapes.transcript        the words on the tape, one utterance per line. Written by the desktop app's local speech
--                           engine (nothing leaves the machine to make it); the owner can correct it.
--   tapes.transcript_model  the speech model that wrote it (a catalog id from src/lib/speech-models.json).
--   tapes.transcribed_at    when (ms); NULL = not transcribed yet.
--   tapes.rating            0 unrated, 1 trash, 2 maybe, 3 gold (TAPE_RATINGS in src/lib/models.js).
-- Recovery: additive only (new columns with defaults). Old Workers and app builds ignore them, so rolling the code
-- back needs no database change.
ALTER TABLE tapes ADD COLUMN transcript TEXT NOT NULL DEFAULT '';
ALTER TABLE tapes ADD COLUMN transcript_model TEXT NOT NULL DEFAULT '';
ALTER TABLE tapes ADD COLUMN transcribed_at INTEGER;
ALTER TABLE tapes ADD COLUMN rating INTEGER NOT NULL DEFAULT 0;
