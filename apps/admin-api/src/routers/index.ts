import moderationRouter from './moderation.router';
import indicesRouter from './indices.router';
import i18nRouter from './i18n.router';
import channelsRouter from './channels.router';
import plansRouter from './plans.router';

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

  // Plans & entitlements (Epic 27); admins only
  openapi.route('/api/plans', plansRouter);
}
