-- notes_features indexed the old 0..3 priority column, which nothing filters or sorts by any more: the claim queries
-- (api/lib/agent.js) use notes_features_level (user_id, kind, state, priority_level), which covers the same prefix.
-- D1 bills every index entry a write touches as a written row, so this index only added cost to note saves.
-- Recovery: no data changes. To restore it: CREATE INDEX notes_features ON notes(user_id, kind, state, priority);
DROP INDEX IF EXISTS notes_features;
