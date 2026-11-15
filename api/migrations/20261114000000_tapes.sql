-- Tapes: voice recordings (raps, verses, ideas, songs) imported from a phone recorder, one row each. The app shrinks
-- each recording to Opus before it uploads (src/lib/tape-encode.js); the audio lives in the private R2 bucket
-- (binding ATTACHMENTS) under "<user_id>/tapes/<id>", counted against the same free-tier caps as attachments.
--   tapes.title         what the owner calls it; starts as the file name.
--   tapes.body          the owner's notes or lyrics, Markdown.
--   tapes.source_name   the original file's name, as recorded.
--   tapes.source_hash   SHA-256 of the original file's bytes (hex): importing the same file twice finds this row.
--   tapes.source_size   the original file's size in bytes.
--   tapes.recorded_at   when it was recorded (ms): from the file name when it carries a date, else the file's time.
--   tapes.duration_ms   how long it plays.
--   tapes.audio_type    the stored audio's type (audio/ogg, or the original's on a browser that can't encode).
--   tapes.audio_size    the stored audio's size in bytes; 0 once a deleted tape's audio is gone.
-- A row is created only by uploading its audio (POST /api/tapes); sync edits title and body and tombstones deleted
-- tapes, which also deletes their audio. Which columns a client may write is in src/lib/models.js (MODELS.tapes).
-- Recovery: additive only. Old Workers and app builds never read this table, so rolling the code back needs no
-- database change; dropping the table would orphan the R2 objects under "<user_id>/tapes/".
CREATE TABLE tapes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL DEFAULT '',
  source_size INTEGER NOT NULL DEFAULT 0,
  recorded_at INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  audio_type TEXT NOT NULL DEFAULT '',
  audio_size INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX tapes_sync ON tapes(user_id, updated_at);
-- One live tape per original file; a deleted one frees its file to be imported again.
CREATE UNIQUE INDEX tapes_source ON tapes(user_id, source_hash) WHERE deleted_at IS NULL;
