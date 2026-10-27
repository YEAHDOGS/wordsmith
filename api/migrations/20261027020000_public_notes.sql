-- Public sharing. A note with public = 1 can be read by anyone at /n/<id> (api/functions/n/[id].js),
-- which also fills the link-preview meta tags. New and existing notes stay private (0) until the owner flips it.
ALTER TABLE notes ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
