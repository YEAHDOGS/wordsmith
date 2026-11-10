-- Standing context: one Markdown doc per person (preferences, facts, pointers) that every agent reads at session start,
-- through GET /api/v1/context or the MCP get_context tool. Only the owner writes it, from Settings; agent tokens read it.
-- Never public, never in another user's reads. Body size is capped by MAX_CONTEXT (src/lib/models.js).
-- Recovery: additive only. Older Workers never touch the table; to undo, DROP TABLE user_context.
CREATE TABLE user_context (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
