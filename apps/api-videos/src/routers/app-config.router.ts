/**
 * App config router (Epic 9.3). Base: /api/app-config (served as /api/v1/app-config).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { AppConfigGet } from '../endpoints/app-config/appConfigGet';

const app = new Hono();

export const appConfigRouter = fromHono(app, { base: '/api/app-config' });

appConfigRouter.get('/', AppConfigGet);

export default appConfigRouter;
