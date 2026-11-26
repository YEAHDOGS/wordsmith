-- Who made each note, and a color per agent token.
--   notes.created_by       name of whoever created the note: the person, or the agent token's name (plus its session)
--   notes.created_by_type  'user', 'agent' or 'github'; the app marks agent-made notes with a bot icon
--   api_tokens.color       one of COLORS (src/lib/models.js); every note the token creates takes this color
-- The server stamps both note columns when a note is first saved (api/lib/notes.js), so no client can claim another
-- author. Existing notes are filled in from their "created" timeline event.
-- Recovery: additive only. Old Workers and app builds never read the new columns, and their upserts only write the
-- columns they know, so rolling the code back needs no database change.
ALTER TABLE notes ADD COLUMN created_by TEXT;
ALTER TABLE notes ADD COLUMN created_by_type TEXT;
ALTER TABLE api_tokens ADD COLUMN color TEXT NOT NULL DEFAULT 'default';

UPDATE notes SET
  created_by = (SELECT e.actor_name FROM note_events e WHERE e.note_id = notes.id AND e.user_id = notes.user_id AND e.type = 'created' ORDER BY e.created_at LIMIT 1),
  created_by_type = (SELECT e.actor_type FROM note_events e WHERE e.note_id = notes.id AND e.user_id = notes.user_id AND e.type = 'created' ORDER BY e.created_at LIMIT 1)
WHERE created_by IS NULL;
