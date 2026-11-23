/**
 * App config router (Epic 9.3). Base: /api/app-config (served as /api/v1/app-config).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { AppConfigGet, AppUpdateFailurePost } from '../endpoints/app-config/appConfigGet';
import { AppConfigDocumentGet, AppConfigDocumentPut, AppConfigEvaluate } from '../endpoints/app-config/appConfigAdmin';
import { AppReleasesAvailablePut, AppReleasesGet, AppReleasesRefresh } from '../endpoints/app-config/appReleases';

const app = new Hono();

export const appConfigRouter = fromHono(app);

appConfigRouter.get('/', AppConfigGet);
// An app reports an update that failed verification (AUN-APP-UPDATES §5.3)
appConfigRouter.post('/update-failure', AppUpdateFailurePost);

// Internal admin (Epic 9.5): /internal/* is behind the INTERNAL_API_KEY middleware
export const appConfigAdminRouter = fromHono(new Hono());
appConfigAdminRouter.post('/evaluate', AppConfigEvaluate);
// The release index (AUN-APP-UPDATES); before '/:key' so `releases` is not read as a document key
appConfigAdminRouter.get('/releases', AppReleasesGet);
appConfigAdminRouter.post('/releases/refresh', AppReleasesRefresh);
appConfigAdminRouter.put('/releases/available', AppReleasesAvailablePut);
appConfigAdminRouter.get('/:key', AppConfigDocumentGet);
appConfigAdminRouter.put('/:key', AppConfigDocumentPut);

export default appConfigRouter;
