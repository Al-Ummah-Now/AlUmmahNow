/**
 * Entitlements Domain Router (Epic 27)
 *
 * Routes (relative to base /api/entitlements), authenticated:
 * - GET / ?subject=channel:{id}|user:{id}   Plan, resolved entitlements, usage
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { EntitlementsGet } from '../endpoints/entitlements/entitlementsGet';

const app = new Hono();
const entitlementsRouter = fromHono(app, { base: '/api/entitlements' });

entitlementsRouter.get('/', EntitlementsGet);

export default entitlementsRouter;
