-- wordsmith core schema. This file and later migrations are the only database schema source.
-- Times are unix milliseconds. Synced rows (projects, labels, notes) keep tombstones in deleted_at
-- so every device learns about deletes through GET /api/sync?since=.

-- One row per person. Login always goes through an OAuth identity below.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL
);

-- OAuth accounts (github, google, apple) linked to a user. access_token is AES-GCM encrypted
-- and only kept for GitHub, where it powers pull request auto-sync.
CREATE TABLE identities (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  access_token TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX identities_user ON identities(user_id);

-- Login sessions for the web (cookie) and native apps (bearer). Only SHA-256 hashes are stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Personal access tokens for AI agents. Only SHA-256 hashes are stored.
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX api_tokens_user ON api_tokens(user_id);

-- In-flight OAuth logins (state, PKCE verifier). device_secret_hash is set for native app logins,
-- which poll for the resulting session instead of following a redirect.
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  device_secret_hash TEXT,
  session_token TEXT,
  created_at INTEGER NOT NULL
);

-- Fixed-window counters protecting login and token endpoints.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- Projects group notes and feature requests. repo is an optional GitHub "owner/name".
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'default',
  repo TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX projects_sync ON projects(user_id, updated_at);

-- User-made labels for organizing notes.
CREATE TABLE labels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'default',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX labels_sync ON labels(user_id, updated_at);

-- Notes and feature requests share one table. kind = 'note' | 'feature'.
-- Features carry a state (requested, in_progress, complete), a free-text status line,
-- and pull_requests: JSON array of { url, repo, number, title, state, merged_at }.
-- label_ids is a JSON array of label ids.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  kind TEXT NOT NULL DEFAULT 'note',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'default',
  label_ids TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'requested',
  status TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  pull_requests TEXT NOT NULL DEFAULT '[]',
  prs_checked_at INTEGER,
  -- Who is working on it (agent token name or "you") and when each lifecycle step happened.
  assignee TEXT NOT NULL DEFAULT '',
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX notes_sync ON notes(user_id, updated_at);
CREATE INDEX notes_features ON notes(user_id, kind, state, priority);

-- Append-only timeline of every interaction with a note, written only by the server.
-- type: created, edited, state, status, claimed, pr_linked, pr_merged, pr_closed, archived, deleted, restored.
-- actor_type: user (signed-in app), agent (API token, actor_name = token name), github (webhook or PR poll).
-- data is JSON with the details, e.g. { "from": "requested", "to": "in_progress" } or { "url": "..." }.
CREATE TABLE note_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL,
  type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX note_events_sync ON note_events(user_id, created_at);
CREATE INDEX note_events_note ON note_events(note_id, created_at);
