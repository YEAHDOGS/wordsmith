-- Account-wide spend breaker, one row (id = 1), kept by the cron in api/lib/cost-breaker.js.
-- R2 bills past its free tier and that allowance is shared by every bucket on the Cloudflare account, so wordsmith's own
-- caps (storage_usage) are not enough on their own. Every 10 minutes the cron reads the account's R2 usage from
-- Cloudflare's analytics and sets tripped_at once it nears the free tier; while it is set, attachments refuse all R2 calls.
--   tripped_at  when the breaker opened; NULL = closed (R2 allowed).
--   reason      why it opened, and which public bucket domains it switched off (those stay off until turned back on by hand).
--   failures    analytics checks failed in a row; too many opens the breaker, since usage can't be confirmed.
--   checked_at  last successful check.
CREATE TABLE cost_breaker (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tripped_at INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  failures INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER
);
INSERT INTO cost_breaker (id) VALUES (1);
