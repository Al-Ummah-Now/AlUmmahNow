/**
 * Explicit Kids Mode route policy table covering EVERY route in api-videos
 * (wiki E20 §4.3 & B2: fail closed on unclassified routes via CI test).
 *
 * Modes:
 * - `block_403`: refused immediately with `403 kids_mode_restricted`.
 * - `suppress_attribution`: runs without user/device/ranking attribution or short-circuits writes cleanly.
 * - `allowlisted_only`: allowed only when the target video/channel/playlist is approved in Kids catalog.
 * - `allow_public`: non-tracking public/kids-safe read (or exit endpoint requiring PIN).
 * - `admin_internal`: internal worker/webhook/diagnostic routes not exposed as consumer sessions.
 */
import type { KidsRouteMode } from '@al-ummah/shared-types';

export interface KidsRoutePolicyEntry {
  method: string;
  path: string;
  mode: KidsRouteMode;
  targetType?: 'video' | 'channel' | 'playlist';
  targetParam?: string;
}

const p = (
  method: string,
  path: string,
  mode: KidsRouteMode,
  targetType?: 'video' | 'channel' | 'playlist',
  targetParam?: string,
): KidsRoutePolicyEntry => ({
  method,
  path,
  mode,
  ...(targetType ? { targetType, targetParam } : {}),
});

export const KIDS_ROUTE_POLICIES: readonly KidsRoutePolicyEntry[] = Object.freeze([
  // OpenAPI & health/static docs
  p('GET', '/', 'allow_public'),
  p('GET', '/redocs', 'allow_public'),
  p('GET', '/openapi.json', 'allow_public'),
  p('GET', '/openapi.yaml', 'allow_public'),
  p('GET', '/api/openapi.json', 'allow_public'),
  p('GET', '/health', 'allow_public'),
  p('GET', '/metrics', 'admin_internal'),
  p('GET', '/test', 'admin_internal'),
  p('GET', '/test-error', 'admin_internal'),
  p('GET', '/status', 'allow_public'),

  // Ummah Kids public & parental control routes
  p('GET', '/api/kids/catalog', 'allow_public'),
  p('GET', '/api/kids/playlists', 'allow_public'),
  p('GET', '/api/kids/playlists/:id', 'allowlisted_only', 'playlist', 'id'),
  p('POST', '/api/me/kids-mode/exit', 'allow_public'),
  p('POST', '/api/me/kids-mode/enter', 'block_403'),
  p('GET', '/api/me/parental-controls', 'block_403'),
  p('PUT', '/api/me/parental-controls', 'block_403'),
  p('PUT', '/api/me/parental-controls/pin', 'block_403'),
  p('POST', '/api/studio/channels/:channelId/kids-review', 'block_403'),

  // Shared public configuration, i18n, quran text, categories
  p('GET', '/api/categories', 'allow_public'),
  p('GET', '/api/i18n/config', 'allow_public'),
  p('GET', '/api/i18n/metadata', 'allow_public'),
  p('GET', '/api/i18n/translations/:locale', 'allow_public'),
  p('POST', '/api/i18n/sync', 'admin_internal'),
  p('GET', '/api/app-config', 'allow_public'),
  p('GET', '/api/quran/passage', 'allow_public'),
  p('GET', '/api/quran/credits', 'allow_public'),
  p('GET', '/api/quran/translations', 'allow_public'),
  p('GET', '/api/sitemap', 'allow_public'),
  p('GET', '/api/sitemap/:kind', 'allow_public'),

  // Telemetry & write-path suppression (wiki E20 §4.3, B2)
  p('POST', '/api/videos/:id/view', 'suppress_attribution', 'video', 'id'),
  p('POST', '/api/videos/:id/watch-time', 'suppress_attribution', 'video', 'id'),
  p('POST', '/api/videos/:id/qoe', 'suppress_attribution', 'video', 'id'),
  p('POST', '/api/videos/:id/retention', 'suppress_attribution', 'video', 'id'),
  p('POST', '/api/analytics/events', 'suppress_attribution'),
  p('POST', '/api/live-streams/:id/qoe', 'suppress_attribution'),
  p('POST', '/api/live-streams/:id/viewers', 'suppress_attribution'),
  p('PUT', '/api/watch-state/:videoId', 'suppress_attribution'),
  p('POST', '/api/watch-history', 'suppress_attribution'),
  p('POST', '/api/watch-history/:videoId/progress', 'suppress_attribution'),
  p('PUT', '/api/watch-history/settings', 'suppress_attribution'),
  p('POST', '/api/profiles/watch-history', 'suppress_attribution'),

  // Watch state & watch history reads/deletes: blocked in Kids Mode (never leak parent history)
  p('GET', '/api/watch-state', 'block_403'),
  p('GET', '/api/continue-watching', 'block_403'),
  p('GET', '/api/watch-history/settings', 'block_403'),
  p('GET', '/api/watch-history', 'block_403'),
  p('DELETE', '/api/watch-history', 'block_403'),
  p('DELETE', '/api/watch-history/:videoId', 'block_403'),
  p('GET', '/api/watch-history/:videoId/progress', 'block_403'),
  p('GET', '/api/profiles/watch-history', 'block_403'),

  // Video playback & metadata reads allowed ONLY for allowlisted items
  p('GET', '/api/videos/:id', 'allowlisted_only', 'video', 'id'),
  p('GET', '/api/videos/:id/playback', 'allowlisted_only', 'video', 'id'),
  p('GET', '/api/videos/:id/play', 'allowlisted_only', 'video', 'id'),
  p('GET', '/api/videos/:id/chapters', 'allowlisted_only', 'video', 'id'),
  p('GET', '/api/videos/:videoId/subtitles', 'allowlisted_only', 'video', 'videoId'),
  p('GET', '/api/videos/:videoId/subtitles/:language', 'allowlisted_only', 'video', 'videoId'),
  p('GET', '/api/videos/:videoId/subtitles/:language/download', 'allowlisted_only', 'video', 'videoId'),
  p('GET', '/api/videos/:videoId/audio-tracks', 'allowlisted_only', 'video', 'videoId'),
  p('GET', '/api/videos/:videoId/translated-metadata', 'allowlisted_only', 'video', 'videoId'),

  // Channel & Playlist reads blocked in Kids Mode until KIDS-D16 is decided
  // (prevent unapproved future channel/playlist items from appearing; Kids uses GET /api/kids/*)
  p('GET', '/api/channels/:id', 'block_403'),
  p('GET', '/api/channels/:id/about', 'block_403'),
  p('GET', '/api/channels/:id/videos', 'block_403'),
  p('GET', '/api/channels/:id/shorts', 'block_403'),
  p('GET', '/api/channels/:id/playlists', 'block_403'),
  p('GET', '/api/channels/:id/tabs', 'block_403'),
  p('GET', '/api/channels/:channelId/sections', 'block_403'),
  p('GET', '/api/channels/:channelId/sections/populated', 'block_403'),
  p('GET', '/api/channels/:channelId/sections/:sectionId', 'block_403'),
  p('GET', '/api/playlists/:id', 'block_403'),
  p('GET', '/api/playlists/:id/items', 'block_403'),
  p('GET', '/api/playlists/:id/queue', 'block_403'),

  // Videos: comments, reactions, search/browse outside kids, uploads, editing — BLOCKED
  p('GET', '/api/videos', 'block_403'),
  p('GET', '/api/videos/search', 'block_403'),
  p('GET', '/api/videos/scheduled', 'block_403'),
  p('POST', '/api/videos', 'block_403'),
  p('PATCH', '/api/videos/bulk', 'block_403'),
  p('POST', '/api/videos/bulk/undo', 'block_403'),
  p('PUT', '/api/videos/:id', 'block_403'),
  p('DELETE', '/api/videos/:id', 'block_403'),
  p('POST', '/api/videos/bulk-delete', 'block_403'),
  p('POST', '/api/videos/bulk-update', 'block_403'),
  p('POST', '/api/videos/bulk-restore', 'block_403'),
  p('POST', '/api/videos/bulk-purge', 'block_403'),
  p('POST', '/api/videos/:id/restore', 'block_403'),
  p('DELETE', '/api/videos/:id/permanent', 'block_403'),
  p('POST', '/api/videos/upload/initiate', 'block_403'),
  p('POST', '/api/videos/upload/batch/initiate', 'block_403'),
  p('POST', '/api/videos/upload', 'block_403'),
  p('GET', '/api/videos/:id/upload-status', 'block_403'),
  p('POST', '/api/videos/:id/thumbnail', 'block_403'),
  p('POST', '/api/videos/upload/complete', 'block_403'),
  p('GET', '/api/videos/upload/resume/:videoId', 'block_403'),
  p('POST', '/api/videos/upload/failed/:videoId', 'block_403'),
  p('POST', '/api/videos/tus', 'block_403'),
  p('GET', '/api/videos/tus/:uploadId', 'block_403'),
  p('PATCH', '/api/videos/tus/:uploadId', 'block_403'),
  p('DELETE', '/api/videos/tus/:uploadId', 'block_403'),
  p('POST', '/api/videos/bulk-schedule', 'block_403'),
  p('PUT', '/api/videos/:id/chapters', 'block_403'),
  p('POST', '/api/videos/:videoId/subtitles', 'block_403'),
  p('PUT', '/api/videos/:videoId/subtitles/:language/default', 'block_403'),
  p('DELETE', '/api/videos/:videoId/subtitles/:language', 'block_403'),
  p('GET', '/api/videos/:videoId/captions/drafts', 'block_403'),
  p('GET', '/api/videos/:videoId/captions/drafts/:language', 'block_403'),
  p('PUT', '/api/videos/:videoId/captions/drafts/:language', 'block_403'),
  p('DELETE', '/api/videos/:videoId/captions/drafts/:language', 'block_403'),
  p('POST', '/api/videos/:videoId/captions/drafts/:language/publish', 'block_403'),
  p('GET', '/api/videos/:videoId/captions/drafts/:language/download', 'block_403'),
  p('POST', '/api/videos/:videoId/captions/drafts/:language/transcript', 'block_403'),
  p('POST', '/api/videos/:videoId/captions/translations', 'block_403'),
  p('POST', '/api/videos/:videoId/renditions', 'block_403'),
  p('PUT', '/api/videos/:videoId/renditions/:stagingId/files/:rung/:file', 'block_403'),
  p('POST', '/api/videos/:videoId/renditions/:stagingId/complete', 'block_403'),
  p('DELETE', '/api/videos/:videoId/renditions/:stagingId', 'block_403'),
  p('POST', '/api/videos/:videoId/review/transcript/claim', 'block_403'),
  p('POST', '/api/videos/:videoId/captions/jobs', 'block_403'),
  p('GET', '/api/videos/:videoId/captions/jobs', 'block_403'),
  p('POST', '/api/videos/:videoId/captions/jobs/:jobId/cancel', 'block_403'),
  p('GET', '/api/videos/:videoId/captions/minutes', 'block_403'),
  p('POST', '/api/videos/:videoId/audio-tracks', 'block_403'),
  p('POST', '/api/videos/:videoId/audio-tracks/detect', 'block_403'),
  p('PUT', '/api/videos/:videoId/audio-tracks/:trackId/upload', 'block_403'),
  p('POST', '/api/videos/:videoId/audio-tracks/:trackId/complete', 'block_403'),
  p('POST', '/api/videos/:videoId/audio-tracks/:trackId/retry', 'block_403'),
  p('PATCH', '/api/videos/:videoId/audio-tracks/:trackId', 'block_403'),
  p('DELETE', '/api/videos/:videoId/audio-tracks/:trackId', 'block_403'),
  p('POST', '/api/videos/:id/schedule', 'block_403'),
  p('GET', '/api/videos/:id/schedule', 'block_403'),
  p('PATCH', '/api/videos/:id/schedule', 'block_403'),
  p('DELETE', '/api/videos/:id/schedule', 'block_403'),
  p('POST', '/api/videos/:id/publish-now', 'block_403'),
  p('POST', '/api/videos/:id/review/appeal', 'block_403'),
  p('POST', '/api/videos/:id/review/resubmit', 'block_403'),
  p('POST', '/api/videos/:id/likes', 'block_403'),
  p('DELETE', '/api/videos/:id/likes', 'block_403'),
  p('POST', '/api/videos/:id/dislikes', 'block_403'),
  p('DELETE', '/api/videos/:id/dislikes', 'block_403'),
  p('GET', '/api/videos/:id/comments', 'block_403'),
  p('POST', '/api/videos/:id/comments', 'block_403'),
  p('GET', '/api/videos/:id/comments/:cid/replies', 'block_403'),
  p('POST', '/api/videos/:id/comments/:cid/approve', 'block_403'),
  p('POST', '/api/videos/:id/comments/:cid/restore', 'block_403'),
  p('POST', '/api/videos/:id/comments/:cid/hold', 'block_403'),
  p('POST', '/api/videos/:id/comments/:cid/pin', 'block_403'),
  p('POST', '/api/videos/:id/comments/:cid/heart', 'block_403'),
  p('PUT', '/api/videos/:id/comments/:cid', 'block_403'),
  p('DELETE', '/api/videos/:id/comments/:cid', 'block_403'),
  p('POST', '/api/videos/:id/comments/:cid/likes', 'block_403'),
  p('DELETE', '/api/videos/:id/comments/:cid/likes', 'block_403'),
  p('POST', '/api/videos/:id/comments/:cid/dislikes', 'block_403'),
  p('DELETE', '/api/videos/:id/comments/:cid/dislikes', 'block_403'),
  p('GET', '/api/videos/category-suggestions', 'block_403'),
  p('POST', '/api/videos/category-suggestions', 'block_403'),
  p('GET', '/api/videos/sections/recent', 'block_403'),
  p('GET', '/api/videos/sections/popular', 'block_403'),
  p('GET', '/api/videos/sections/trending', 'block_403'),
  p('GET', '/api/videos/sections/recommended', 'block_403'),
  p('GET', '/api/videos/sections/by-category/:category', 'block_403'),

  // Profiles, Users, Channels, Playlists, Community — blocked in Kids Mode
  p('GET', '/api/profiles', 'block_403'),
  p('GET', '/api/profiles/:id', 'block_403'),
  p('POST', '/api/profiles', 'block_403'),
  p('GET', '/api/profile', 'block_403'),
  p('PUT', '/api/profile', 'block_403'),
  p('DELETE', '/api/profile', 'block_403'),
  p('GET', '/api/profile/playback', 'block_403'),
  p('PUT', '/api/profile/playback', 'block_403'),
  p('GET', '/api/profile/onboarding', 'block_403'),
  p('PUT', '/api/profile/onboarding', 'block_403'),
  p('PUT', '/api/profile/public', 'block_403'),
  p('GET', '/api/profile/handle-availability', 'block_403'),
  p('GET', '/api/profile/subscriptions', 'block_403'),
  p('GET', '/api/profile/subscriptions/feed', 'block_403'),
  p('PUT', '/api/profile/avatar', 'block_403'),
  p('PUT', '/api/profile/cover', 'block_403'),
  p('GET', '/api/users/by-handle/:handle', 'block_403'),
  p('GET', '/api/users/by-handle/:handle/subscriptions', 'block_403'),
  p('GET', '/api/users/by-handle/:handle/playlists', 'block_403'),
  p('GET', '/api/channels', 'block_403'),
  p('POST', '/api/channels', 'block_403'),
  p('GET', '/api/channels/handles/:handle/availability', 'block_403'),
  p('GET', '/api/channels/access', 'block_403'),
  p('GET', '/api/channels/by-handle/:handle', 'block_403'),
  p('GET', '/api/channels/:id/owner', 'block_403'),
  p('PUT', '/api/channels/:id', 'block_403'),
  p('DELETE', '/api/channels/:id', 'block_403'),
  p('PUT', '/api/channels/:id/avatar', 'block_403'),
  p('PUT', '/api/channels/:id/cover', 'block_403'),
  p('GET', '/api/channels/:id/deleted-videos', 'block_403'),
  p('GET', '/api/channels/:id/content/summary', 'block_403'),
  p('GET', '/api/channels/:id/content/deleted', 'block_403'),
  p('GET', '/api/channels/:id/content', 'block_403'),
  p('GET', '/api/channels/:id/analytics/top-content', 'block_403'),
  p('GET', '/api/channels/:id/comments/summary', 'block_403'),
  p('GET', '/api/channels/:id/comments', 'block_403'),
  p('POST', '/api/channels/:id/comments/bulk', 'block_403'),
  p('GET', '/api/channels/:id/blocks', 'block_403'),
  p('POST', '/api/channels/:id/blocks', 'block_403'),
  p('DELETE', '/api/channels/:id/blocks/:userId', 'block_403'),
  p('GET', '/api/channels/:id/live', 'block_403'),
  p('POST', '/api/channels/:id/subscriptions', 'block_403'),
  p('DELETE', '/api/channels/:id/subscriptions', 'block_403'),
  p('GET', '/api/channels/:id/subscriptions/status', 'block_403'),
  p('GET', '/api/channels/:id/members', 'block_403'),
  p('PUT', '/api/channels/:id/members/:userId', 'block_403'),
  p('DELETE', '/api/channels/:id/members/:userId', 'block_403'),
  p('POST', '/api/channels/:id/invites', 'block_403'),
  p('DELETE', '/api/channels/:id/invites/:inviteId', 'block_403'),
  p('GET', '/api/channels/:id/audit', 'block_403'),
  p('PUT', '/api/channels/:id/tabs', 'block_403'),
  p('POST', '/api/channels/:channelId/sections', 'block_403'),
  p('PUT', '/api/channels/:channelId/sections/:sectionId', 'block_403'),
  p('DELETE', '/api/channels/:channelId/sections/:sectionId', 'block_403'),
  p('PATCH', '/api/channels/:channelId/sections/reorder', 'block_403'),
  p('GET', '/api/channels/:channelId/translation-settings', 'block_403'),
  p('PUT', '/api/channels/:channelId/translation-settings', 'block_403'),
  p('GET', '/api/channels/:channelId/quran-translations', 'block_403'),
  p('PUT', '/api/channels/:channelId/quran-translations/:language', 'block_403'),
  p('DELETE', '/api/channels/:channelId/quran-translations/:language', 'block_403'),
  p('GET', '/api/channel-invites', 'block_403'),
  p('POST', '/api/channel-invites/:id/accept', 'block_403'),
  p('POST', '/api/channel-invites/:id/decline', 'block_403'),
  p('GET', '/api/playlists', 'block_403'),
  p('POST', '/api/playlists', 'block_403'),
  p('POST', '/api/playlists/upload-adds', 'block_403'),
  p('GET', '/api/playlists/upload-adds', 'block_403'),
  p('PATCH', '/api/playlists/:id', 'block_403'),
  p('DELETE', '/api/playlists/:id', 'block_403'),
  p('POST', '/api/playlists/:id/videos', 'block_403'),
  p('DELETE', '/api/playlists/:id/videos/:videoId', 'block_403'),
  p('POST', '/api/playlists/:id/videos/bulk', 'block_403'),
  p('POST', '/api/playlists/:id/videos/remove', 'block_403'),
  p('PUT', '/api/playlists/:id/videos/order', 'block_403'),
  p('GET', '/api/playlists/:id/jobs/:jobId', 'block_403'),
  p('POST', '/api/playlists/:id/jobs/:jobId/retry', 'block_403'),

  // Community
  p('GET', '/api/community/channels/:channelId/posts', 'block_403'),
  p('GET', '/api/community/channels/:channelId/posts/:postId', 'block_403'),
  p('GET', '/api/community/posts/:postId', 'block_403'),
  p('POST', '/api/community/channels/:channelId/posts', 'block_403'),
  p('PUT', '/api/community/channels/:channelId/posts/:postId', 'block_403'),
  p('DELETE', '/api/community/channels/:channelId/posts/:postId', 'block_403'),
  p('POST', '/api/community/channels/:channelId/posts/:postId/like', 'block_403'),
  p('DELETE', '/api/community/channels/:channelId/posts/:postId/like', 'block_403'),
  p('POST', '/api/community/channels/:channelId/posts/:postId/vote', 'block_403'),
  p('GET', '/api/community/channels/:channelId/posts/:postId/results', 'block_403'),
  p('GET', '/api/community/channels/:channelId/posts/:postId/comments', 'block_403'),
  p('POST', '/api/community/channels/:channelId/posts/:postId/comments', 'block_403'),
  p('PUT', '/api/community/channels/:channelId/posts/:postId/comments/:commentId', 'block_403'),
  p('DELETE', '/api/community/channels/:channelId/posts/:postId/comments/:commentId', 'block_403'),
  p('POST', '/api/community/channels/:channelId/posts/:postId/comments/:commentId/like', 'block_403'),
  p('DELETE', '/api/community/channels/:channelId/posts/:postId/comments/:commentId/like', 'block_403'),
  p('GET', '/api/community/channels/:channelId/posts/:postId/comments/:commentId/replies', 'block_403'),
  p('POST', '/api/community/channels/:channelId/posts/:postId/comments/:commentId/pin', 'block_403'),
  p('DELETE', '/api/community/channels/:channelId/posts/:postId/comments/:commentId/pin', 'block_403'),
  p('POST', '/api/community/channels/:channelId/posts/:postId/comments/:commentId/heart', 'block_403'),
  p('DELETE', '/api/community/channels/:channelId/posts/:postId/comments/:commentId/heart', 'block_403'),
  p('POST', '/api/community/media/upload/images', 'block_403'),
  p('POST', '/api/community/media/upload/gif', 'block_403'),
  p('POST', '/api/community/media/link-preview', 'block_403'),

  // Library, Notifications, Devices (push registration) — blocked in Kids Mode
  p('GET', '/api/library/watch-later', 'block_403'),
  p('POST', '/api/library/watch-later', 'block_403'),
  p('PUT', '/api/library/watch-later/order', 'block_403'),
  p('GET', '/api/library/watch-later/:videoId', 'block_403'),
  p('DELETE', '/api/library/watch-later/:videoId', 'block_403'),
  p('GET', '/api/library/liked', 'block_403'),
  p('GET', '/api/library/saved-posts', 'block_403'),
  p('POST', '/api/library/saved-posts', 'block_403'),
  p('GET', '/api/library/saved-posts/:postId', 'block_403'),
  p('DELETE', '/api/library/saved-posts/:postId', 'block_403'),
  p('GET', '/api/notifications', 'block_403'),
  p('GET', '/api/notifications/unread-count', 'block_403'),
  p('POST', '/api/notifications/seen', 'block_403'),
  p('POST', '/api/notifications/read', 'block_403'),
  p('POST', '/api/notifications/unread', 'block_403'),
  p('POST', '/api/notifications/read-all', 'block_403'),
  p('GET', '/api/notifications/settings', 'block_403'),
  p('PUT', '/api/notifications/settings', 'block_403'),
  p('GET', '/api/notifications/channels/:channelId/bell', 'block_403'),
  p('PUT', '/api/notifications/channels/:channelId/bell', 'block_403'),
  p('DELETE', '/api/notifications/:id', 'block_403'),
  p('GET', '/api/devices', 'block_403'),
  p('GET', '/api/devices/webpush-key', 'block_403'),
  p('PUT', '/api/devices/:installId', 'block_403'),
  p('DELETE', '/api/devices/:installId', 'block_403'),

  // Billing, Support, Studio, Sites, Social, YouTube import, Discovery/Search, Privacy, Live, Translate, Analytics reads
  p('GET', '/api/live-streams', 'block_403'),
  p('POST', '/api/live-streams', 'block_403'),
  p('GET', '/api/live-streams/:id', 'block_403'),
  p('GET', '/api/live-streams/:id/state', 'block_403'),
  p('POST', '/api/live-streams/:id/start', 'block_403'),
  p('PATCH', '/api/live-streams/:id', 'block_403'),
  p('DELETE', '/api/live-streams/:id', 'block_403'),
  p('GET', '/api/live-streams/:id/ingest', 'block_403'),
  p('POST', '/api/live-streams/:id/end', 'block_403'),
  p('GET', '/api/analytics', 'block_403'),
  p('GET', '/api/analytics/summary', 'block_403'),
  p('GET', '/api/analytics/metrics', 'block_403'),
  p('GET', '/api/analytics/channels/:channelId', 'block_403'),
  p('GET', '/api/analytics/videos/:videoId', 'block_403'),
  p('GET', '/api/analytics/videos/:videoId/retention', 'block_403'),
  p('POST', '/api/moderation/reports', 'block_403'),
  p('GET', '/api/upload-defaults', 'block_403'),
  p('POST', '/api/upload-defaults', 'block_403'),
  p('GET', '/api/upload-defaults/:id', 'block_403'),
  p('PUT', '/api/upload-defaults/:id', 'block_403'),
  p('DELETE', '/api/upload-defaults/:id', 'block_403'),
  p('PUT', '/api/upload-defaults/:id/default', 'block_403'),
  p('GET', '/api/studio/brand-kit', 'block_403'),
  p('PUT', '/api/studio/brand-kit', 'block_403'),
  p('GET', '/api/studio/assets', 'block_403'),
  p('POST', '/api/studio/assets', 'block_403'),
  p('GET', '/api/studio/assets/:assetId', 'block_403'),
  p('DELETE', '/api/studio/assets/:assetId', 'block_403'),
  p('POST', '/api/translate', 'block_403'),
  p('GET', '/api/translate/usage', 'block_403'),
  p('GET', '/api/search/suggestions', 'block_403'),
  p('GET', '/api/trending', 'block_403'),
  p('GET', '/api/discovery/home', 'block_403'),
  p('GET', '/api/recommendations', 'block_403'),
  p('GET', '/api/shorts', 'block_403'),
  p('GET', '/api/search', 'block_403'),
  p('GET', '/api/explore', 'block_403'),
  p('GET', '/api/privacy/export', 'block_403'),
  p('DELETE', '/api/privacy/data', 'block_403'),
  p('GET', '/api/privacy/consent', 'block_403'),
  p('PUT', '/api/privacy/consent', 'block_403'),
  p('GET', '/api/me/creator', 'block_403'),
  p('GET', '/api/me/features', 'block_403'),
  p('GET', '/api/me/human-check', 'block_403'),
  p('GET', '/api/me/tier-requests', 'block_403'),
  p('POST', '/api/me/tier-requests', 'block_403'),
  p('POST', '/api/me/tier-requests/:id/withdraw', 'block_403'),
  p('GET', '/api/tiers/upgrade', 'block_403'),
  p('GET', '/api/me/tier', 'block_403'),
  p('GET', '/api/billing/plans', 'block_403'),
  p('GET', '/api/me/billing', 'block_403'),
  p('POST', '/api/me/billing/checkout', 'block_403'),
  p('GET', '/api/me/billing/checkouts/:id', 'block_403'),
  p('POST', '/api/me/billing/checkouts/:id/abandon', 'block_403'),
  p('GET', '/api/me/billing/payments/:id/receipt', 'block_403'),
  p('POST', '/api/me/billing/subscriptions/:id/cancel', 'block_403'),
  p('POST', '/api/me/billing/portal', 'block_403'),
  p('GET', '/api/channels/:channelId/support', 'block_403'),
  p('GET', '/api/channels/:channelId/support/quote', 'block_403'),
  p('POST', '/api/channels/:channelId/support/checkout', 'block_403'),
  p('PUT', '/api/channels/:channelId/support/settings', 'block_403'),
  p('GET', '/api/me/support', 'block_403'),
  p('GET', '/api/me/support/checkouts/:id', 'block_403'),
  p('POST', '/api/me/support/pledges/:id/stop', 'block_403'),
  p('GET', '/api/channels/:channelId/support/payee', 'block_403'),
  p('POST', '/api/channels/:channelId/support/payee/onboard', 'block_403'),
  p('POST', '/api/channels/:channelId/support/payee/refresh', 'block_403'),
  p('GET', '/api/apps/attestation/config', 'block_403'),
  p('POST', '/api/apps/attestation/challenge', 'block_403'),
  p('POST', '/api/apps/attestation/apple/register', 'block_403'),
  p('POST', '/api/apps/attestation/apple/assert', 'block_403'),
  p('POST', '/api/apps/attestation/android', 'block_403'),
  p('GET', '/api/sites/by-channel/:channelId', 'block_403'),
  p('GET', '/api/sites/by-host/:host', 'block_403'),
  p('GET', '/api/sites/by-host/:host/pages/:slug', 'block_403'),
  p('GET', '/api/sites/by-host/:host/home', 'block_403'),
  p('GET', '/api/sites/channel/:channelId', 'block_403'),
  p('PUT', '/api/sites/channel/:channelId', 'block_403'),
  p('POST', '/api/sites/channel/:channelId/preview', 'block_403'),
  p('GET', '/api/sites/channel/:channelId/pages', 'block_403'),
  p('POST', '/api/sites/channel/:channelId/pages', 'block_403'),
  p('GET', '/api/sites/channel/:channelId/pages/:pageId', 'block_403'),
  p('PUT', '/api/sites/channel/:channelId/pages/:pageId', 'block_403'),
  p('POST', '/api/sites/channel/:channelId/pages/:pageId/restore', 'block_403'),
  p('DELETE', '/api/sites/channel/:channelId/pages/:pageId', 'block_403'),
  p('GET', '/api/social/channel/:channelId', 'block_403'),
  p('POST', '/api/social/channel/:channelId/connect', 'block_403'),
  p('POST', '/api/social/channel/:channelId/connect/confirm', 'block_403'),
  p('GET', '/api/social/channel/:channelId/telegram/:code', 'block_403'),
  p('PATCH', '/api/social/channel/:channelId/accounts/:accountId', 'block_403'),
  p('DELETE', '/api/social/channel/:channelId/accounts/:accountId', 'block_403'),
  p('PUT', '/api/social/channel/:channelId/templates', 'block_403'),
  p('GET', '/api/social/channel/:channelId/deliveries', 'block_403'),
  p('POST', '/api/social/channel/:channelId/deliveries/:id/retry', 'block_403'),
  p('POST', '/api/social/channel/:channelId/webhooks', 'block_403'),
  p('PATCH', '/api/social/channel/:channelId/webhooks/:id', 'block_403'),
  p('DELETE', '/api/social/channel/:channelId/webhooks/:id', 'block_403'),
  p('POST', '/api/social/channel/:channelId/webhooks/:id/test', 'block_403'),
  p('POST', '/api/social/channel/:channelId/webhooks/:id/secret', 'block_403'),
  p('GET', '/api/social/channel/:channelId/webhooks/:id/deliveries', 'block_403'),
  p('GET', '/api/social/channel/:channelId/share-kit/:videoId', 'block_403'),
  p('GET', '/api/social/channel/:channelId/share-kit/:videoId/clip-source', 'block_403'),
  p('GET', '/api/social/networks', 'block_403'),
  p('GET', '/api/social/feeds/:channelId/:file', 'block_403'),
  p('GET', '/api/social/bluesky/client-metadata.json', 'block_403'),
  p('GET', '/api/social/bluesky/jwks.json', 'block_403'),
  p('GET', '/api/social/oauth/:network/callback', 'block_403'),
  p('POST', '/api/social/webhooks/telegram', 'admin_internal'),
  p('GET', '/api/youtube-import/available', 'block_403'),
  p('GET', '/api/youtube-import/status', 'block_403'),
  p('POST', '/api/youtube-import/oauth/start', 'block_403'),
  p('GET', '/api/youtube-import/oauth/callback', 'block_403'),
  p('POST', '/api/youtube-import/oauth/finish', 'block_403'),
  p('GET', '/api/youtube-import/:importId', 'block_403'),
  p('POST', '/api/youtube-import/:importId/start', 'block_403'),
  p('PUT', '/api/youtube-import/:importId/selection', 'block_403'),
  p('PUT', '/api/youtube-import/:importId/matches', 'block_403'),
  p('POST', '/api/youtube-import/:importId/items/:itemId/retry', 'block_403'),
  p('POST', '/api/youtube-import/:importId/cancel', 'block_403'),
  p('GET', '/api/youtube-import/:importId/link-back.csv', 'block_403'),
]);

interface CompiledPolicy {
  entry: KidsRoutePolicyEntry;
  exact: boolean;
  regex: RegExp;
  paramNames: string[];
}

function compilePolicy(entry: KidsRoutePolicyEntry): CompiledPolicy {
  const paramNames: string[] = [];
  const exact = !entry.path.includes(':');
  const escaped = entry.path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return {
    entry,
    exact,
    regex: new RegExp(`^${escaped}$`),
    paramNames,
  };
}

const COMPILED = new Map<string, { exact: Map<string, KidsRoutePolicyEntry>; patterns: CompiledPolicy[] }>();
for (const entry of KIDS_ROUTE_POLICIES) {
  let bucket = COMPILED.get(entry.method);
  if (!bucket) {
    bucket = { exact: new Map(), patterns: [] };
    COMPILED.set(entry.method, bucket);
  }
  const compiled = compilePolicy(entry);
  if (compiled.exact) {
    bucket.exact.set(entry.path, entry);
  } else {
    bucket.patterns.push(compiled);
  }
}

export interface MatchedKidsRoutePolicy {
  entry: KidsRoutePolicyEntry;
  params: Record<string, string>;
}

export function matchKidsRoutePolicy(method: string, pathname: string): MatchedKidsRoutePolicy | null {
  const normalizedPath = pathname.startsWith('/api/v1/') ? `/api/${pathname.slice('/api/v1/'.length)}` : pathname;
  const bucket = COMPILED.get(method.toUpperCase());
  if (!bucket) return null;
  const exact = bucket.exact.get(normalizedPath);
  if (exact) return { entry: exact, params: {} };
  for (const item of bucket.patterns) {
    const m = normalizedPath.match(item.regex);
    if (!m) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < item.paramNames.length; i++) {
      params[item.paramNames[i]] = decodeURIComponent(m[i + 1]);
    }
    return { entry: item.entry, params };
  }
  return null;
}
