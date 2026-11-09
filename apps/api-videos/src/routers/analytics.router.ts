import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { AnalyticsGet } from '../endpoints/analytics/analyticsGet';
import {
  AnalyticsSummaryGet,
  AnalyticsChannelGet,
  AnalyticsVideoGet,
  AnalyticsRetentionGet,
  AnalyticsMetricsGet,
} from '../endpoints/analytics/analyticsOwner';
import { ClientAnalyticsEventsCreate } from '../endpoints/analytics/clientEvents';

const app = new Hono();
export const analyticsRouter = fromHono(app, { base: '/api/analytics' });

// Authenticated, owner-scoped analytics
analyticsRouter.get('/', AnalyticsGet);
analyticsRouter.get('/summary', AnalyticsSummaryGet);
analyticsRouter.get('/metrics', AnalyticsMetricsGet);
analyticsRouter.get('/channels/:channelId', AnalyticsChannelGet);
analyticsRouter.get('/videos/:videoId', AnalyticsVideoGet);
analyticsRouter.get('/videos/:videoId/retention', AnalyticsRetentionGet);

// Client telemetry ingestion (auth optional) forwarded by the web app
analyticsRouter.post('/events', ClientAnalyticsEventsCreate);

export default analyticsRouter;
