-- GET /api/videos with a category and no channel (lib/search/ownership.ts channelVideoIds): the category's
-- videos in list order, by date and by views, instead of a scan of the videos bucket. Partial: only rows
-- that have a category (videos) are in them.
CREATE INDEX IF NOT EXISTS idx_content_ownership_category_created ON content_ownership (kind, category, created_at DESC, id) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_ownership_category_views ON content_ownership (kind, category, views DESC, id) WHERE category IS NOT NULL;
