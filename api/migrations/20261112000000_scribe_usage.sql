-- wordsmith cloud for Scribe (api/functions/api/scribe.js): how much Workers AI each account used each day, so one
-- person can't spend the whole account's free daily allowance and Scribe as a whole stays under it.
--   scribe_usage.day       the UTC date, YYYY-MM-DD: Workers AI's allowance resets at 00:00 UTC.
--   scribe_usage.user_id   the account, or '*' for everyone together.
--   scribe_usage.neurons   Workers AI's measure of compute, worked out from the tokens each request used.
--   scribe_usage.requests  how many requests went to the model.
-- Rows older than a week are deleted as new days are written.
-- Recovery: additive only. Old Workers never read this table, so rolling the code back needs no database change.
CREATE TABLE scribe_usage (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  neurons REAL NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id)
);
