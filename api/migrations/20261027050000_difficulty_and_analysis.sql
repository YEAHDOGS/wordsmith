-- Triage fields for every note, so agents can sort the queue by size and leave their reasoning for the next agent:
--   difficulty   0 unrated, then 1..5 (DIFFICULTY_LABELS in src/lib/models.js). Set by people (the slider next to
--                priority) or by agents (POST /api/v1/notes/:id/analysis).
--   analysis     an agent's notes: scope, files to touch, plan, blockers, work done. Markdown.
--   batch        which group of work the note ships with, e.g. "small-fixes-2026-10-27". Features with the same batch
--                go out in one pull request.
--   analyzed_at  when the analysis was last written (server stamped). NULL = no agent has triaged it yet.
-- Recovery: additive only. Old Workers and app builds never read these columns, and their upserts leave them alone
-- (they only list the columns they know), so rolling the code back needs no database change.
ALTER TABLE notes ADD COLUMN difficulty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN analysis TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN batch TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN analyzed_at INTEGER;

-- GET /api/v1/batches and ?batch= filters.
CREATE INDEX notes_batch ON notes(user_id, batch);
