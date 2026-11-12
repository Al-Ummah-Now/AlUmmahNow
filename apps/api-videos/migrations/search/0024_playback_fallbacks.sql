-- Playback fallbacks per day (epic #687, single playback URL): the API picks one source per play and a
-- player that fails on it asks GET /api/videos/:id/playback?exclude=r2&reason=<code>.
-- server_fallbacks: counted by that endpoint. qoe_sessions: play sessions that reported the same
-- fallback in their QoE beacon (requested vs actual source). The Delivery page shows both. Expand-only.
CREATE TABLE IF NOT EXISTS playback_fallback_daily (
  day TEXT NOT NULL,
  requested TEXT NOT NULL,
  actual TEXT NOT NULL,
  reason TEXT NOT NULL,
  server_fallbacks INTEGER NOT NULL DEFAULT 0,
  qoe_sessions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, requested, actual, reason)
);
