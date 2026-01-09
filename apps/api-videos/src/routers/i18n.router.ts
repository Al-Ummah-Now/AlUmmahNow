/**
 * i18n Router
 * Routes for internationalization - translations, config, metadata
 */

import { Hono } from 'hono';
import { fromHono } from 'chanfana';

// Import i18n endpoints
import { GetTranslationsEndpoint } from '../endpoints/i18n/translationsGet';
import { GetI18nConfigEndpoint } from '../endpoints/i18n/configGet';
import { GetI18nMetadataEndpoint } from '../endpoints/i18n/metadataGet';
import { SyncTranslationsEndpoint } from '../endpoints/i18n/translationsSync';

const app = new Hono();

export const i18nRouter = fromHono(app, { base: '/api/i18n' });

// i18n routes
// All routes are relative to base: /api/i18n

// Get i18n configuration (available locales, RTL settings)
i18nRouter.get('/config', GetI18nConfigEndpoint);

// Get translations metadata (version, checksums for cache invalidation)
i18nRouter.get('/metadata', GetI18nMetadataEndpoint);

// Get translations for a specific locale
i18nRouter.get('/translations/:locale', GetTranslationsEndpoint);

// Sync/Seed translations to R2 (development/admin use)
i18nRouter.post('/sync', SyncTranslationsEndpoint);

export default i18nRouter;
