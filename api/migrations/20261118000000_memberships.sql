-- Buy Me a Coffee memberships, so subscribing to DOGS unlocks wordsmith by itself (api/functions/api/webhooks/bmc.js).
--   memberships             one row per supporter, written by Buy Me a Coffee's membership.* webhooks. An account holds
--                           a membership when one of its emails (users.email, or any identities.email) matches, so
--                           subscribing before signing up works too. src/lib/models.js planOf reads it.
--   memberships.email       the supporter's email, lowercased.
--   memberships.level_id    Buy Me a Coffee's membership_level_id; PLANS in src/lib/models.js says what each unlocks.
--   memberships.level_name  the level's name when the event arrived, for scripts/access.js list.
--   memberships.duration    'month' or 'year': how often it renews, and which price amount is.
--   memberships.amount      what the supporter pays each duration, in currency.
--   memberships.status      'active', 'canceled' (works until period_end) or 'paused'.
--   memberships.period_end  when the paid period ends (ms), or NULL.
--   memberships.live        0 for Buy Me a Coffee's dashboard test events.
--   memberships.event_at    when Buy Me a Coffee created the event (ms): an older event that arrives late (a retry)
--                           never overwrites a newer one.
--   users.plan              the plan an access = 'member' account was given by hand (scripts/access.js approve); NULL
--                           means models.js GRANTED_PLAN. Accounts that exist now (the owner) get the top plan.
CREATE TABLE memberships (
  email TEXT PRIMARY KEY,
  level_id INTEGER,
  level_name TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT 'month',
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  period_end INTEGER,
  live INTEGER NOT NULL DEFAULT 1,
  event_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE users ADD COLUMN plan TEXT;
UPDATE users SET plan = 'megaman' WHERE access = 'member';
