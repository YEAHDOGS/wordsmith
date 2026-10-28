-- One live project per name per user. projects.name_key is the name folded for comparison (Unicode NFC, trimmed,
-- lowercased; projectKey in src/lib/models.js), written by the server on every project write, so "Café", "café" and
-- " CAFÉ " are the same name. SQLite's lower() only folds A-Z, which is why the key is computed in JavaScript.
-- The backfill below uses lower(trim(name)), exact for the ASCII names in production and staging when this shipped
-- (checked with wrangler on 2026-10-28); the Worker rewrites the key on a project's next write.
-- Any live duplicates are renamed "<name> (<id>)" before the index, so this migration can't fail: ids are unique, so the
-- new names are too (a short id prefix could collide).
-- The key and index skip NULL keys: for the few seconds an old Worker runs against this schema it writes projects
-- without a key, and those must not collide.
-- Recovery: additive except the duplicate renames (none existed). To undo: DROP INDEX projects_user_name_key; the
-- name_key column is ignored by older code.
ALTER TABLE projects ADD COLUMN name_key TEXT;
UPDATE projects SET name_key = lower(trim(name));

UPDATE projects
SET name = trim(name) || ' (' || id || ')',
    name_key = lower(trim(name)) || ' (' || lower(id) || ')',
    updated_at = max(updated_at + 1, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, name_key ORDER BY created_at, id) AS place
    FROM projects WHERE deleted_at IS NULL
  ) WHERE place > 1
);

CREATE UNIQUE INDEX projects_user_name_key ON projects(user_id, name_key) WHERE deleted_at IS NULL AND name_key IS NOT NULL;
