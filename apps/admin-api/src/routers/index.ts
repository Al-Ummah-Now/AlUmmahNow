import moderationRouter from './moderation.router';
import indicesRouter from './indices.router';
import i18nRouter from './i18n.router';
import channelsRouter from './channels.router';
import siteSettingsRouter from './siteSettings.router';
import contactRouter from './contact.router';
import authRequestsRouter from './authRequests.router';
import errorsRouter from './errors.router';
import categorySuggestionsRouter from './categorySuggestions.router';
import videoFormatRouter from './video-format.router';

/**
 * Register all feature routers with the main OpenAPI instance.
 * @param openapi - The main OpenAPI instance from chanfana
 */
export function registerAllRouters(openapi: any) {
  // Register moderation router at /api/moderation
  openapi.route('/api/moderation', moderationRouter);

  // Register indices router at /api/indices
  openapi.route('/api/indices', indicesRouter);

  // Register i18n admin router at /api/i18n
  openapi.route('/api/i18n', i18nRouter);

  // Channel administration (verification) at /api/channels
  openapi.route('/api/channels', channelsRouter);

  // Site-wide settings at /api/site-settings
  openapi.route('/api/site-settings', siteSettingsRouter);

  // Contact us inbox at /api/contact
  openapi.route('/api/contact', contactRouter);
  // Moderation requests to auth at /api/auth-requests
  openapi.route('/api/auth-requests', authRequestsRouter);

  // Errors page at /api/errors
  openapi.route('/api/errors', errorsRouter);

  // AI category suggestions (review, backfill, settings) at /api/category-suggestions
  openapi.route('/api/category-suggestions', categorySuggestionsRouter);

  // Short vs video formats (backfill runs, unclassifiable videos, manual set) at /api/video-format
  openapi.route('/api/video-format', videoFormatRouter);
}
