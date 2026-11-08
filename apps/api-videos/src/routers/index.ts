import videoRouter from './video.router';
import profileRouter from './profile.router';
import channelRouter from './channel.router';
import playlistRouter from './playlist.router';
import watchHistoryRouter from './watch-history.router';
import communityRouter from './community.router';
import liveRouter from './live.router';
import analyticsRouter from './analytics.router';
import moderationRouter from './moderation.router';
import settingsRouter from './settings.router';
import sectionsRouter from './sections.router';
import monitoringRouter from './monitoring.router';
import i18nRouter from './i18n.router';
import discoveryRouter from './discovery.router';
import privacyRouter from './privacy.router';
import libraryRouter from './library.router';
import notificationsRouter from './notifications.router';
import searchRouter from './search.router';
import appConfigRouter, { appConfigAdminRouter } from './app-config.router';
import { telemetryRouter } from './telemetry.router';
import { accountRouter } from './account.router';
import { continueWatchingRouter, watchStateRouter } from './watch-state.router';
import { devicesRouter } from './devices.router';

/**
 * Register all feature routers with the main OpenAPI instance.
 * This function mounts all domain routers at their respective base paths.
 *
 * Router base paths:
 * - Video: /api/videos
 * - Community: /api/community
 * - Channel: /api/channels
 * - Playlist: /api/playlists
 * - Profile: /api (includes /profiles and /profile routes)
 * - Watch History: /api/watch-history
 * - Sections: /api/videos/sections
 * - Settings: /api/upload-defaults
 * - Live: /api/live-streams
 * - Analytics: /api/analytics
 * - Moderation: /api/moderation
 * - i18n: /api/i18n
 * - Discovery: /api/search/suggestions, /api/trending, /api/recommendations
 * - Privacy: /api/privacy (GDPR export, erasure, consent)
 * - Search v2: /api/search, /api/explore, /internal/search/* (root level)
 * - Monitoring: / (root level - health, metrics, status)
 *
 * @param openapi - The main OpenAPI instance from chanfana
 */
export function registerAllRouters(openapi: any) {
  // Video domain - video CRUD, upload, comments, likes, chapters, subtitles, scheduling
  openapi.route('/api/videos', videoRouter);

  // Profile domain - profile CRUD, avatar/cover upload, legacy watch history
  // Note: Profile router has special base '/api' (not '/api/profile')
  openapi.route('/api', profileRouter);

  // Channel domain - channel CRUD, subscriptions, tabs, sections, content lists
  openapi.route('/api/channels', channelRouter);

  // Playlist domain - playlist CRUD, video management
  openapi.route('/api/playlists', playlistRouter);

  // Watch History domain - new watch history system with progress tracking
  openapi.route('/api/watch-history', watchHistoryRouter);

  // Community domain - community posts, polls, comments
  openapi.route('/api/community', communityRouter);

  // Live streaming domain - live stream CRUD
  openapi.route('/api/live-streams', liveRouter);

  // Analytics domain - analytics retrieval
  openapi.route('/api/analytics', analyticsRouter);

  // Moderation domain - reports and moderation actions
  openapi.route('/api/moderation', moderationRouter);

  // Settings domain - upload defaults (templates)
  openapi.route('/api/upload-defaults', settingsRouter);

  // Sections domain - video sections (recent, popular, trending, recommended)
  openapi.route('/api/videos/sections', sectionsRouter);

  // i18n domain - internationalization (translations, config, metadata)
  openapi.route('/api/i18n', i18nRouter);

  // Discovery domain - search suggestions, trending, recommendations
  openapi.route('/api', discoveryRouter);

  // Privacy domain - GDPR export, erasure, consent audit trail
  openapi.route('/api/privacy', privacyRouter);

  // Library domain - Watch later, liked videos, saved posts (Story 29.6)
  openapi.route('/api/library', libraryRouter);

  // Notifications domain - notification center, settings, per-channel bell (Story 29.10)
  openapi.route('/api/notifications', notificationsRouter);
  // App config (Epic 9.3) - API versions and minimum supported app version
  openapi.route('/api/app-config', appConfigRouter);
  openapi.route('/internal/app-config', appConfigAdminRouter);
  // Client telemetry (Epic 9.8)
  openapi.route('/api/telemetry', telemetryRouter);
  // In-app account deletion and export (Epic 9.7)
  openapi.route('/api/account', accountRouter);
  openapi.route('/api/watch-state', watchStateRouter);
  openapi.route('/api/continue-watching', continueWatchingRouter);
  // Push device registration (Epic 9.4)
  openapi.route('/api/devices', devicesRouter);

  // Search v2 domain - index-backed search, explore, internal backfill (root level)
  openapi.route('', searchRouter);

  // Monitoring domain - health checks, metrics, status page (root level)
  openapi.route('', monitoringRouter);
}

// Re-export all routers for individual use
export {
  videoRouter,
  profileRouter,
  channelRouter,
  playlistRouter,
  watchHistoryRouter,
  communityRouter,
  liveRouter,
  analyticsRouter,
  moderationRouter,
  settingsRouter,
  sectionsRouter,
  i18nRouter,
  discoveryRouter,
  monitoringRouter,
  privacyRouter,
  libraryRouter,
  notificationsRouter,
  searchRouter,
};
