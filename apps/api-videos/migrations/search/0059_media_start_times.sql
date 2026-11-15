-- How long each R2 transcode took to start (apps/media Transcoder.launch → TranscodeStartup), for the
-- Delivery panel's start time (p50/p95, cold vs warm) and the media diagnostics report. ms; start_cold
-- 1 when the container was booted for the attempt, 0 when it was already running (warm reuse).
-- Expand-only: NULL for jobs recorded before this.
ALTER TABLE media_jobs ADD COLUMN start_cold INTEGER;
ALTER TABLE media_jobs ADD COLUMN start_dispatch_ms INTEGER;
ALTER TABLE media_jobs ADD COLUMN start_ready_ms INTEGER;
ALTER TABLE media_jobs ADD COLUMN start_accept_ms INTEGER;
ALTER TABLE media_jobs ADD COLUMN start_ffmpeg_ms INTEGER;
