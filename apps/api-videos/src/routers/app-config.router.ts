/**
 * App config router (Epic 9.3). Base: /api/app-config (served as /api/v1/app-config).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { AppConfigGet } from '../endpoints/app-config/appConfigGet';
import { AppConfigDocumentGet, AppConfigDocumentPut } from '../endpoints/app-config/appConfigAdmin';

const app = new Hono();

export const appConfigRouter = fromHono(app, { base: '/api/app-config' });

appConfigRouter.get('/', AppConfigGet);

// Internal admin (Epic 9.5): /internal/* is behind the INTERNAL_API_KEY middleware
export const appConfigAdminRouter = fromHono(new Hono(), { base: '/internal/app-config' });
appConfigAdminRouter.get('/:key', AppConfigDocumentGet);
appConfigAdminRouter.put('/:key', AppConfigDocumentPut);

export default appConfigRouter;
