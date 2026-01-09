import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { AnalyticsGet } from '../endpoints/analytics/analyticsGet';

const app = new Hono();
export const analyticsRouter = fromHono(app, { base: '/api/analytics' });

// Authenticated endpoints
analyticsRouter.get('/', AnalyticsGet);

export default analyticsRouter;
