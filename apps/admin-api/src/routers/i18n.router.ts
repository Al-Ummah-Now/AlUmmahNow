/**
 * i18n Admin Router
 * Routes for internationalization administration
 */

import { Hono } from 'hono';
import { fromHono } from 'chanfana';

// Import i18n admin endpoints
import { UpdateTranslationsEndpoint } from '../endpoints/i18n';

const app = new Hono();

const i18nRouter = fromHono(app, { base: '' });

// i18n admin routes
// All routes require admin/moderator authentication (applied globally in index.ts)

// Update translations for a specific locale
i18nRouter.put('/translations/:locale', UpdateTranslationsEndpoint);

export default i18nRouter;
