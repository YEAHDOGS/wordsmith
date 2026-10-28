-- One live project per name per user. projects.name_key is the name folded for comparison (Unicode NFC, trimmed,
-- lowercased; projectKey in src/lib/models.js), written by the server on every project write, so "Café", "café" and
-- " CAFÉ " are the same name. SQLite's lower() only folds A-Z, which is why the key is computed in JavaScript.
-- The backfill below uses lower(trim(name)), exact for the ASCII names in production and staging when this shipped
-- (checked with wrangler on 2026-10-28); the Worker rewrites the key on a project's next write.
-- Any live duplicates keep their names but lose their key (see below), so this migration can't fail.
-- The key and index skip NULL keys: for the few seconds an old Worker runs against this schema it writes projects
-- without a key, and those must not collide.
-- Recovery: additive; no data changes beyond the new column (production had no duplicates). To undo: DROP INDEX projects_user_name_key; the
-- name_key column is ignored by older code.
ALTER TABLE projects ADD COLUMN name_key TEXT;
UPDATE projects SET name_key = lower(trim(name));

-- Duplicates: every live project after the first with the same key loses its key (NULL), so it sits outside the unique
-- index. Names are left alone (no surprise renames, no generated name that could itself collide), so the index always
-- builds. The server lets a project keep its own name (saveProjects), and its key returns on its next write once the
-- name is free.
UPDATE projects
SET name_key = NULL
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, name_key ORDER BY created_at, id) AS place
    FROM projects WHERE deleted_at IS NULL
  ) WHERE place > 1
);

CREATE UNIQUE INDEX projects_user_name_key ON projects(user_id, name_key) WHERE deleted_at IS NULL AND name_key IS NOT NULL;
