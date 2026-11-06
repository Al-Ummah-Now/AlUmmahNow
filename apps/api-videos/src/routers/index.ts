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
};
