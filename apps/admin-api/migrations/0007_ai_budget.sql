-- Atomic daily AI budget (docs/architecture/SCALABILITY-AUDIT.md, PR-9).
--
-- The moderation consumer used to read today's SUM(neurons), call Workers AI,
-- then record the cost. With the consumer scaled out, every in-flight scan
-- passed the check before any of them recorded, so the cap was overshot by
-- the whole backlog. Now a scan reserves its worst-case cost here first, in
-- one conditional UPDATE (reserved < cap), and settles to the real cost after:
-- the cap can be crossed by at most one scan, however many run at once.
-- The row is seeded from ai_usage_daily, so the first scan of a day (or of a
-- deploy) counts what was already spent.
CREATE TABLE IF NOT EXISTS ai_budget_daily (
    day TEXT NOT NULL,                   -- 'YYYY-MM-DD' (UTC)
    feature TEXT NOT NULL,               -- 'moderation'
    reserved REAL NOT NULL DEFAULT 0,    -- neurons: spent + reserved by scans in flight
    PRIMARY KEY (day, feature)
);
