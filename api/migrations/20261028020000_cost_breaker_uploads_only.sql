-- uploads_only: 1 while the open spend breaker (cost_breaker, api/lib/cost-breaker.js) was tripped by storage alone.
-- Storage is measured as a 30-day peak, so such a trip can outlast the files it was about; reads and public bucket
-- traffic never add stored bytes, so then only uploads are refused and public domains stay on. Each successful check
-- sets it from what is over at that moment; a failed check (usage unknown) sets it to 0, refusing everything.
ALTER TABLE cost_breaker ADD COLUMN uploads_only INTEGER NOT NULL DEFAULT 0;
