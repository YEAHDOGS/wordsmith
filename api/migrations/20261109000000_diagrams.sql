-- Architecture diagrams: boxes on a grid joined by arrows, for laying out a project's systems (clients, services,
-- databases, queues, cloud zones). Drawn in the app (Architecture page) or by agents (/api/v1/diagrams, MCP).
--   diagrams.project_id   the project it documents; NULL = not tied to one.
--   diagrams.description  what the diagram shows, Markdown.
--   diagrams.nodes        JSON list of boxes: { id, kind, title, text, color, x, y, w, h }.
--   diagrams.edges        JSON list of arrows: { id, from, to, label, style }; from and to are node ids.
-- The shapes of nodes and edges are checked by src/lib/models.js (MODELS.diagrams), not here.
-- Recovery: additive only. Old Workers and app builds never read this table, so rolling the code back needs no
-- database change.
CREATE TABLE diagrams (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  nodes TEXT NOT NULL DEFAULT '[]',
  edges TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX diagrams_user_updated ON diagrams(user_id, updated_at);
