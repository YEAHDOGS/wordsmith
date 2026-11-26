-- Attachments on notes. File bytes live in the private R2 bucket (binding ATTACHMENTS) under r2_key;
-- this table holds the metadata every device syncs. Rows are tombstoned (deleted_at) when removed.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX attachments_sync ON attachments(user_id, updated_at);
CREATE INDEX attachments_note ON attachments(note_id);

-- App-wide R2 usage, one row (id = 1). Uploads and downloads reserve against hard caps set below
-- R2's free tier (see api/lib/attachments.js), so usage can never turn into a bill.
-- month is "YYYY-MM"; the op counters reset when it changes.
CREATE TABLE storage_usage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  bytes INTEGER NOT NULL DEFAULT 0,
  month TEXT NOT NULL DEFAULT '',
  writes INTEGER NOT NULL DEFAULT 0,
  reads INTEGER NOT NULL DEFAULT 0
);
INSERT INTO storage_usage (id) VALUES (1);
