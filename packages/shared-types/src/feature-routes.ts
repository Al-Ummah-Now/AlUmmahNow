/**
 * Which server routes each feature switch gates (wiki AUN-FEATURES §5.1, FEAT-2).
 *
 * `FEATURE_ROUTES` is applied by each worker (`requireFeature`), never by hand. `FEATURE_AREAS`
 * are the path prefixes a feature owns: a test lists every route the workers register and fails
 * when a route in an area has neither a mapping nor an exemption with a reason. While a switch is
 * off its routes answer 404 `feature_off` with the error envelope, before validation, so an old
 * client's request in an old shape is refused the same way.
 *
 * `enforced: 'handler'` marks a route whose handler decides (it needs the body or the caller:
 * caption jobs carry their kind in the body; viewer caption download lets the channel's caption
 * editors through). The handler reads the overlaid old setting or calls `featureGate`.
 */
import type { FeatureKey } from './feature-registry';

export type FeatureApp = 'api-videos' | 'admin-api';
export type FeatureRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface FeatureRoute {
  app: FeatureApp;
  method: FeatureRouteMethod;
  /** The Hono path pattern as registered */
  path: string;
  key: FeatureKey;
  enforced?: 'middleware' | 'handler';
  /** Refuse while the switches cannot be read, instead of letting the handler decide (a safety surface) */
  failClosed?: boolean;
}

export interface FeatureArea {
  app: FeatureApp;
  /** Every registered route whose path starts with this belongs to the feature */
  prefix: string;
  key: FeatureKey;
}

export interface FeatureRouteExemption {
  app: FeatureApp;
  method: FeatureRouteMethod;
  path: string;
  reason: string;
}

const r = (app: FeatureApp, method: FeatureRouteMethod, path: string, key: FeatureKey, enforced: FeatureRoute['enforced'] = 'middleware'): FeatureRoute => ({ app, method, path, key, enforced });
const closed = (route: FeatureRoute): FeatureRoute => ({ ...route, failClosed: true });
const x = (app: FeatureApp, method: FeatureRouteMethod, path: string, reason: string): FeatureRouteExemption => ({ app, method, path, reason });

export const FEATURE_ROUTES: readonly FeatureRoute[] = Object.freeze([
  // Uploads: new uploads only; uploads already started finish
  r('api-videos', 'POST', '/api/videos/upload/initiate', 'upload'),
  r('api-videos', 'POST', '/api/videos/upload/batch/initiate', 'upload'),
  r('api-videos', 'POST', '/api/videos/upload', 'upload'),
  r('api-videos', 'POST', '/api/videos/tus', 'upload'),
  r('admin-api', 'POST', '/api/admin/import/batches', 'upload'),
  r('admin-api', 'POST', '/api/admin/import/batches/:id/items', 'upload'),
  // Social import sources (TA-9): a sync makes new posts and videos on the channel
  r('admin-api', 'POST', '/api/admin/import/sources/:id/sync', 'upload'),
  r('admin-api', 'POST', '/api/admin/import/sources/:id/takeout/files/:fileId/upload', 'upload'),
  r('api-videos', 'POST', '/api/channels', 'createChannel'),
  r('api-videos', 'POST', '/api/youtube-import/oauth/start', 'youtubeImport'),
  r('api-videos', 'POST', '/api/youtube-import/:importId/start', 'youtubeImport'),
  r('api-videos', 'POST', '/api/videos/bulk-schedule', 'bulkSchedule'),
  r('api-videos', 'POST', '/api/videos/:videoId/audio-tracks', 'audioTracks'),
  r('api-videos', 'POST', '/api/videos/:videoId/audio-tracks/detect', 'audioTracks'),
  // Live: new streams and sessions; streams on air continue
  r('api-videos', 'POST', '/api/live-streams', 'live'),
  // Starts a stream (live) or a premiere (livePremieres, wiki E17): the handler knows which
  r('api-videos', 'POST', '/api/live-streams/:id/start', 'live', 'handler'),
  // Reminders (wiki E17); sending them is checked where it happens
  r('api-videos', 'POST', '/api/live-streams/:id/reminders', 'liveReminders'),
  r('api-videos', 'DELETE', '/api/live-streams/:id/reminders', 'liveReminders'),
  // Premieres (wiki E17): scheduling one and swapping its video; a running one ends as usual
  r('api-videos', 'POST', '/api/videos/:id/premiere', 'livePremieres'),
  r('api-videos', 'PATCH', '/api/live-streams/:id/premiere', 'livePremieres'),
  // Live chat (wiki E17): reading, posting, moderating and its settings
  closed(r('api-videos', 'GET', '/api/live-streams/:id/chat', 'liveChat')),
  closed(r('api-videos', 'GET', '/api/live-streams/:id/chat/held', 'liveChat')),
  closed(r('api-videos', 'POST', '/api/live-streams/:id/chat', 'liveChat')),
  closed(r('api-videos', 'POST', '/api/live-streams/:id/chat/:messageId/moderate', 'liveChat')),
  closed(r('api-videos', 'PATCH', '/api/live-streams/:id/chat/settings', 'liveChat')),
  // Caption jobs carry their kind (transcribe or translate) in the body
  r('api-videos', 'POST', '/api/videos/:videoId/captions/jobs', 'captionsTranscribe', 'handler'),
  r('api-videos', 'POST', '/api/videos/:videoId/captions/translations', 'captionsTranslate'),
  r('api-videos', 'POST', '/api/translate', 'inlineTranslate'),
  r('api-videos', 'GET', '/api/translate/usage', 'inlineTranslate'),
  r('api-videos', 'PUT', '/api/channels/:channelId/translation-settings', 'viewerTranslatedTitles'),
  r('api-videos', 'GET', '/api/videos/:videoId/translated-metadata', 'viewerTranslatedTitles', 'handler'),
  r('api-videos', 'GET', '/api/quran/translations', 'quranEditions'),
  r('api-videos', 'GET', '/api/channels/:channelId/quran-translations', 'quranEditions'),
  r('api-videos', 'PUT', '/api/channels/:channelId/quran-translations/:language', 'quranEditions'),
  // The channel's owner and caption editors and admins still download (QF1)
  r('api-videos', 'GET', '/api/videos/:videoId/subtitles/:language/download', 'viewerCaptionDownload', 'handler'),
  r('api-videos', 'GET', '/api/profile/intentional', 'intentionalViewing'),
  r('api-videos', 'PUT', '/api/profile/intentional', 'intentionalViewing'),
  r('api-videos', 'GET', '/api/videos/:videoId/recitation', 'recitationTools'),
  r('api-videos', 'GET', '/api/library/notes', 'studyNotes'),
  r('api-videos', 'GET', '/api/library/notes/export.md', 'studyNotes'),
  r('api-videos', 'POST', '/api/library/notes', 'studyNotes'),
  r('api-videos', 'DELETE', '/api/library/notes', 'studyNotes'),
  r('api-videos', 'PUT', '/api/library/notes/:id', 'studyNotes'),
  r('api-videos', 'DELETE', '/api/library/notes/:id', 'studyNotes'),
  r('api-videos', 'PUT', '/api/videos/:videoId/recitation-metadata', 'recitationTools'),
  r('api-videos', 'GET', '/api/prayer-times', 'prayerTimes'),
  r('api-videos', 'GET', '/api/hijri', 'hijriCalendar'),
  r('api-videos', 'GET', '/api/islamic/season', 'ramadanMode'),
  // Islamic preferences: reachable while any of prayer times, Qibla, Hijri or Ramadan mode is on (E21.1b)
  r('api-videos', 'GET', '/api/profile/islamic', 'prayerTimes', 'handler'),
  r('api-videos', 'PUT', '/api/profile/islamic', 'prayerTimes', 'handler'),
  r('api-videos', 'POST', '/api/social/channel/:channelId/connect', 'socialAutopost'),
  r('api-videos', 'POST', '/api/social/channel/:channelId/connect/confirm', 'socialAutopost'),
  r('api-videos', 'GET', '/api/videos/category-suggestions', 'aiCategorySuggest'),
  r('api-videos', 'POST', '/api/videos/category-suggestions', 'aiCategorySuggest'),
  r('admin-api', 'POST', '/api/sites/:channelId/domains', 'siteDomains'),
  r('admin-api', 'POST', '/internal/site-domains/:channelId/domains', 'siteDomains'),
  // Creator support (wiki AUN-MEMBERS): Studio › Support payee; the handler also checks the channel owner
  r('api-videos', 'GET', '/api/channels/:channelId/support/payee', 'creatorSupport', 'handler'),
  r('api-videos', 'POST', '/api/channels/:channelId/support/payee/onboard', 'creatorSupport', 'handler'),
  r('api-videos', 'POST', '/api/channels/:channelId/support/payee/refresh', 'creatorSupport', 'handler'),
  // The support sheet, the channel's own settings and Settings › Support (MEM-7); the handlers also check eligibility
  r('api-videos', 'GET', '/api/channels/:channelId/support', 'creatorSupport', 'handler'),
  r('api-videos', 'GET', '/api/channels/:channelId/support/quote', 'creatorSupport', 'handler'),
  r('api-videos', 'POST', '/api/channels/:channelId/support/checkout', 'creatorSupport', 'handler'),
  r('api-videos', 'PUT', '/api/channels/:channelId/support/settings', 'creatorSupport', 'handler'),
  r('api-videos', 'GET', '/api/me/support', 'creatorSupport', 'handler'),
  r('api-videos', 'GET', '/api/me/support/checkouts/:id', 'creatorSupport', 'handler'),
  r('api-videos', 'POST', '/api/me/support/pledges/:id/stop', 'creatorSupport', 'handler'),
  // Upgrade mode (O37): the page shows "not available" rather than refusing
  r('api-videos', 'GET', '/api/tiers/upgrade', 'tierRequests', 'handler'),
  r('api-videos', 'POST', '/api/me/tier-requests', 'tierRequests', 'handler'),
  r('api-videos', 'GET', '/api/notifications/quiet-hours', 'quietHours'),
  r('api-videos', 'PUT', '/api/notifications/quiet-hours', 'quietHours'),
  r('admin-api', 'POST', '/internal/newsletter/subscribe', 'newsletter'),
  r('admin-api', 'POST', '/internal/newsletter/confirm', 'newsletter', 'handler'),
  r('admin-api', 'POST', '/api/newsletter/issues/:id/send', 'newsletter'),
  // Channel moves by owners (wiki AUN-CHANNEL-CLAIM §5)
  r('api-videos', 'GET', '/api/channels/:id/move-receivers', 'channelMove'),
  r('api-videos', 'GET', '/api/channels/:id/move-offers', 'channelMove'),
  r('api-videos', 'POST', '/api/channels/:id/move-offers', 'channelMove'),
  r('api-videos', 'GET', '/api/move-offers', 'channelMove'),
  r('api-videos', 'GET', '/api/move-offers/:id', 'channelMove'),
  r('api-videos', 'POST', '/api/move-offers/:id/accept', 'channelMove'),
  r('api-videos', 'POST', '/api/move-offers/:id/decline', 'channelMove'),
  r('api-videos', 'DELETE', '/api/move-offers/:id', 'channelMove'),
]);

export const FEATURE_AREAS: readonly FeatureArea[] = Object.freeze([
  { app: 'api-videos', prefix: '/api/videos/upload', key: 'upload' },
  { app: 'api-videos', prefix: '/api/videos/tus', key: 'upload' },
  { app: 'admin-api', prefix: '/api/admin/import', key: 'upload' },
  { app: 'api-videos', prefix: '/api/youtube-import', key: 'youtubeImport' },
  { app: 'api-videos', prefix: '/api/videos/bulk-schedule', key: 'bulkSchedule' },
  { app: 'api-videos', prefix: '/api/videos/:videoId/audio-tracks', key: 'audioTracks' },
  { app: 'api-videos', prefix: '/api/live-streams', key: 'live' },
  { app: 'api-videos', prefix: '/api/videos/:videoId/captions/jobs', key: 'captionsTranscribe' },
  { app: 'api-videos', prefix: '/api/videos/:videoId/captions/translations', key: 'captionsTranslate' },
  { app: 'api-videos', prefix: '/api/translate', key: 'inlineTranslate' },
  { app: 'api-videos', prefix: '/api/quran/translations', key: 'quranEditions' },
  { app: 'api-videos', prefix: '/api/channels/:channelId/quran-translations', key: 'quranEditions' },
  { app: 'api-videos', prefix: '/api/videos/:videoId/subtitles/:language/download', key: 'viewerCaptionDownload' },
  { app: 'api-videos', prefix: '/api/videos/:videoId/recitation', key: 'recitationTools' },
  { app: 'api-videos', prefix: '/api/library/notes', key: 'studyNotes' },
  { app: 'api-videos', prefix: '/api/prayer-times', key: 'prayerTimes' },
  { app: 'api-videos', prefix: '/api/hijri', key: 'hijriCalendar' },
  { app: 'api-videos', prefix: '/api/islamic', key: 'ramadanMode' },
  { app: 'api-videos', prefix: '/api/social/channel', key: 'socialAutopost' },
  { app: 'api-videos', prefix: '/api/videos/category-suggestions', key: 'aiCategorySuggest' },
  { app: 'admin-api', prefix: '/api/sites/:channelId/domains', key: 'siteDomains' },
  { app: 'admin-api', prefix: '/internal/site-domains', key: 'siteDomains' },
  { app: 'api-videos', prefix: '/api/me/tier-requests', key: 'tierRequests' },
  { app: 'api-videos', prefix: '/api/notifications/quiet-hours', key: 'quietHours' },
  // Creator support (wiki AUN-MEMBERS): every channel support route is the switch's
  { app: 'api-videos', prefix: '/api/channels/:channelId/support', key: 'creatorSupport' },
  { app: 'api-videos', prefix: '/api/me/support', key: 'creatorSupport' },
  { app: 'admin-api', prefix: '/internal/newsletter', key: 'newsletter' },
  { app: 'admin-api', prefix: '/api/newsletter', key: 'newsletter' },
  { app: 'api-videos', prefix: '/api/move-offers', key: 'channelMove' },
]);

const FINISH = 'finishes work already started';
const REMOVE = 'removing or cleaning up always works';
const READ = 'reads what already exists';
const SOURCES = 'manages a social import source (super admins); only its sync makes new posts';

export const FEATURE_ROUTE_EXEMPTIONS: readonly FeatureRouteExemption[] = Object.freeze([
  x('api-videos', 'POST', '/api/videos/upload/complete', FINISH),
  x('api-videos', 'POST', '/api/videos/upload/failed/:videoId', `${FINISH} (marks a started upload failed)`),
  x('api-videos', 'GET', '/api/videos/upload/resume/:videoId', FINISH),
  x('api-videos', 'GET', '/api/videos/tus/:uploadId', FINISH),
  x('api-videos', 'PATCH', '/api/videos/tus/:uploadId', FINISH),
  x('api-videos', 'DELETE', '/api/videos/tus/:uploadId', REMOVE),
  x('api-videos', 'GET', '/api/youtube-import/available', 'answers whether import is available (the client hides it)'),
  x('api-videos', 'GET', '/api/youtube-import/status', READ),
  x('api-videos', 'GET', '/api/youtube-import/:importId', READ),
  x('api-videos', 'GET', '/api/youtube-import/:importId/link-back.csv', READ),
  x('api-videos', 'GET', '/api/youtube-import/oauth/callback', `${FINISH} (Google returns here after connect)`),
  x('api-videos', 'POST', '/api/youtube-import/oauth/finish', FINISH),
  x('api-videos', 'POST', '/api/youtube-import/:importId/cancel', REMOVE),
  x('api-videos', 'POST', '/api/youtube-import/:importId/items/:itemId/retry', FINISH),
  x('api-videos', 'PUT', '/api/youtube-import/:importId/matches', FINISH),
  x('api-videos', 'PUT', '/api/youtube-import/:importId/selection', FINISH),
  x('api-videos', 'GET', '/api/videos/:videoId/audio-tracks', READ),
  x('api-videos', 'PATCH', '/api/videos/:videoId/audio-tracks/:trackId', 'renaming or reordering an existing track'),
  x('api-videos', 'DELETE', '/api/videos/:videoId/audio-tracks/:trackId', REMOVE),
  x('api-videos', 'PUT', '/api/videos/:videoId/audio-tracks/:trackId/upload', FINISH),
  x('api-videos', 'POST', '/api/videos/:videoId/audio-tracks/:trackId/complete', FINISH),
  x('api-videos', 'POST', '/api/videos/:videoId/audio-tracks/:trackId/retry', FINISH),
  x('api-videos', 'GET', '/api/live-streams', READ),
  x('api-videos', 'GET', '/api/live-streams/:id', READ),
  x('api-videos', 'GET', '/api/live-streams/:id/ingest', 'streams on air continue'),
  x('api-videos', 'GET', '/api/live-streams/:id/state', 'streams on air continue'),
  x('api-videos', 'PATCH', '/api/live-streams/:id', 'editing an existing stream'),
  x('api-videos', 'DELETE', '/api/live-streams/:id', REMOVE),
  x('api-videos', 'POST', '/api/live-streams/:id/end', 'ending a stream always works'),
  x('api-videos', 'POST', '/api/live-streams/:id/qoe', 'streams on air continue'),
  x('api-videos', 'POST', '/api/live-streams/:id/viewers', 'streams on air continue'),
  x('api-videos', 'GET', '/api/videos/:videoId/captions/jobs', READ),
  x('api-videos', 'POST', '/api/videos/:videoId/captions/jobs/:jobId/cancel', REMOVE),
  x('api-videos', 'DELETE', '/api/channels/:channelId/quran-translations/:language', REMOVE),
  x('api-videos', 'GET', '/api/social/channel/:channelId', READ),
  x('api-videos', 'GET', '/api/social/channel/:channelId/deliveries', READ),
  x('api-videos', 'POST', '/api/social/channel/:channelId/deliveries/:id/retry', `${FINISH} (queued posts wait while it is off, FEAT-5)`),
  x('api-videos', 'GET', '/api/social/channel/:channelId/share-kit/:videoId', 'the share kit is the manual share, not auto-post'),
  x('api-videos', 'GET', '/api/social/channel/:channelId/share-kit/:videoId/clip-source', 'the share kit is the manual share, not auto-post'),
  x('api-videos', 'GET', '/api/social/channel/:channelId/telegram/:code', FINISH),
  x('api-videos', 'PATCH', '/api/social/channel/:channelId/accounts/:accountId', 'editing a connected account'),
  x('api-videos', 'DELETE', '/api/social/channel/:channelId/accounts/:accountId', REMOVE),
  x('api-videos', 'PUT', '/api/social/channel/:channelId/templates', 'editing post templates'),
  x('api-videos', 'POST', '/api/social/channel/:channelId/webhooks', 'webhooks are the channel’s own integration, not auto-post'),
  x('api-videos', 'PATCH', '/api/social/channel/:channelId/webhooks/:id', 'webhooks are the channel’s own integration, not auto-post'),
  x('api-videos', 'DELETE', '/api/social/channel/:channelId/webhooks/:id', REMOVE),
  x('api-videos', 'POST', '/api/social/channel/:channelId/webhooks/:id/secret', 'webhooks are the channel’s own integration, not auto-post'),
  x('api-videos', 'POST', '/api/social/channel/:channelId/webhooks/:id/test', 'webhooks are the channel’s own integration, not auto-post'),
  x('api-videos', 'GET', '/api/social/channel/:channelId/webhooks/:id/deliveries', READ),
  x('admin-api', 'GET', '/api/admin/import/batches', READ),
  x('admin-api', 'GET', '/api/admin/import/batches/:id', READ),
  x('admin-api', 'GET', '/api/admin/import/encoding', READ),
  x('admin-api', 'GET', '/api/admin/import/items/:id/delivery', READ),
  x('admin-api', 'GET', '/api/admin/import/items/by-video/:videoId', READ),
  x('admin-api', 'GET', '/api/admin/import/me', READ),
  x('admin-api', 'GET', '/api/admin/import/quran-index', READ),
  x('admin-api', 'POST', '/api/admin/import/channels', 'the import’s channel; its uploads are gated'),
  x('admin-api', 'POST', '/api/admin/import/errors', 'reports an import failure'),
  x('admin-api', 'GET', '/api/admin/import/sources', READ),
  x('admin-api', 'GET', '/api/admin/import/sources/channels/:channelId/connections', READ),
  x('admin-api', 'GET', '/api/admin/import/sources/:id', READ),
  x('admin-api', 'GET', '/api/admin/import/sources/:id/items', READ),
  x('admin-api', 'POST', '/api/admin/import/sources', SOURCES),
  x('admin-api', 'PATCH', '/api/admin/import/sources/:id', SOURCES),
  x('admin-api', 'DELETE', '/api/admin/import/sources/:id', REMOVE),
  x('admin-api', 'POST', '/api/admin/import/sources/:id/cancel', 'stopping a sync always works'),
  x('admin-api', 'GET', '/api/admin/import/sources/:id/takeout', READ),
  x('admin-api', 'POST', '/api/admin/import/sources/:id/takeout/files', 'lists a Takeout export’s files; uploading one is gated'),
  x('admin-api', 'POST', '/api/admin/import/sources/:id/takeout/files/:fileId/confirm', 'picks the record for a file already listed'),
  x('admin-api', 'POST', '/api/admin/import/sources/:id/takeout/files/:fileId/uploaded', FINISH),
  x('admin-api', 'POST', '/api/admin/import/items/:id/failed', FINISH),
  x('admin-api', 'POST', '/api/admin/import/items/:id/renditions', FINISH),
  x('admin-api', 'POST', '/api/admin/import/items/:id/renditions/:stagingId/complete', FINISH),
  x('admin-api', 'PUT', '/api/admin/import/items/:id/renditions/:stagingId/files/:rung/:file', FINISH),
  x('admin-api', 'DELETE', '/api/admin/import/items/:id/renditions/:stagingId', REMOVE),
  x('admin-api', 'POST', '/api/admin/import/items/:id/sidecars', FINISH),
  x('admin-api', 'POST', '/api/admin/import/items/:id/transcript', FINISH),
  x('admin-api', 'POST', '/api/admin/import/items/:id/translations', FINISH),
  x('admin-api', 'POST', '/api/admin/import/items/:id/uploaded', FINISH),
  x('admin-api', 'GET', '/api/sites/:channelId/domains', READ),
  x('admin-api', 'DELETE', '/api/sites/:channelId/domains/:host', REMOVE),
  x('admin-api', 'POST', '/api/sites/:channelId/domains/:host/refresh', 'checking a domain already added'),
  x('admin-api', 'GET', '/internal/site-domains/:channelId/domains', READ),
  x('admin-api', 'DELETE', '/internal/site-domains/:channelId/domains/:host', REMOVE),
  x('admin-api', 'POST', '/internal/site-domains/:channelId/domains/:host/refresh', 'checking a domain already added'),
  x('admin-api', 'PUT', '/internal/site-domains/:channelId/primary', 'choosing among domains already added'),
  x('admin-api', 'GET', '/internal/site-domains-status', 'reports whether domains can be set up'),
  x('admin-api', 'POST', '/internal/newsletter/unsubscribe', 'unsubscribing always works'),
  x('admin-api', 'GET', '/api/newsletter/issues', READ),
  x('admin-api', 'GET', '/api/newsletter/issues/:id', READ),
  x('admin-api', 'POST', '/api/newsletter/issues', 'drafting an issue (sending is gated)'),
  x('admin-api', 'PATCH', '/api/newsletter/issues/:id', 'drafting an issue (sending is gated)'),
  x('admin-api', 'DELETE', '/api/newsletter/issues/:id', REMOVE),
  x('admin-api', 'GET', '/api/newsletter/subscribers', READ),
  x('admin-api', 'DELETE', '/api/newsletter/subscribers/:id', `${REMOVE} (erasing a subscriber)`),
  x('api-videos', 'GET', '/api/me/tier-requests', READ),
  x('api-videos', 'POST', '/api/me/tier-requests/:id/withdraw', REMOVE),
]);

/**
 * Switches with no route of their own yet, and why (the route test accepts these). The rest of
 * creator support's routes arrive with their MEMBERS stories and are mapped then.
 */
export const FEATURE_KEYS_WITHOUT_ROUTES: Readonly<Partial<Record<FeatureKey, string>>> = Object.freeze({
  liveEvents: 'E17 enforces event stream tags in the live stream handlers',
  charityDonations: 'MEMBERS adds its routes and maps them here',
  supportDormantTransfer: 'no route: the monthly support.dormant job reads it',
  listenMode: 'E14-S3 adds the audio playback route and maps it here',
  offlineDownloads: 'E14-S3 adds the offline download routes and maps them here',
  eventCalendar: 'E22-S3 adds its routes and maps them here',
  qibla: 'E21.1 calculates locally; any preference routes arrive with that story',
  ageRules: 'the content flag and made-for-kids handlers read it (E20-B1); E20-B4 adds requireMinimumAge and maps its routes here',
  parentsGuide: 'the Help topic page of apps/web reads GET /api/me/features and is a 404 while off (E20-S1)',
  appUpdates: 'GET /api/v1/app-config stays public while off and answers update.enabled false with no notice (wiki AUN-APP-UPDATES §4.1); it also serves flags and config',
});

/** The routes a worker gates in its middleware. */
export function middlewareFeatureRoutes(app: FeatureApp): FeatureRoute[] {
  return FEATURE_ROUTES.filter((route) => route.app === app && route.enforced !== 'handler');
}
