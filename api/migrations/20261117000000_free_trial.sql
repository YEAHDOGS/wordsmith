-- Free trial: a new account gets TRIAL_DAYS (src/lib/models.js) from users.created_at, then needs a DOGS membership
-- ($1 a month on Buy Me a Coffee), approved by hand with `npm run access -- approve <email>` (scripts/access.js).
--   users.access             'trial' (new accounts), 'member' (approved, full access) or 'lapsed' (membership ended).
--   users.access_changed_at  when access last changed (ms); NULL = never (still on the trial it started with).
-- Every account that exists when this runs keeps full access: they signed up before the trial began.
-- Recovery: additive only (new columns with defaults, plus a backfill). Old Workers never read these columns, so rolling
-- the code back needs no database change; the lock simply stops being enforced.
ALTER TABLE users ADD COLUMN access TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE users ADD COLUMN access_changed_at INTEGER;
UPDATE users SET access = 'member', access_changed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
