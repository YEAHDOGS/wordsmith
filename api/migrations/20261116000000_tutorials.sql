-- First-run tutorials an account has finished or skipped, so each one shows once per account, on every device.
--   tutorials_seen.user_id   the account.
--   tutorials_seen.tutorial  which tutorial (TUTORIALS in src/lib/models.js), e.g. 'scribe'.
--   tutorials_seen.seen_at   when it was finished or skipped (ms).
-- Recovery: additive only. Old Workers never read this table, so rolling the code back needs no database change.
CREATE TABLE tutorials_seen (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tutorial TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, tutorial)
);
