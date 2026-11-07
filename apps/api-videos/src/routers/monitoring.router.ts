import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { HealthCheck } from '../endpoints/monitoring/healthCheck';
import { Metrics } from '../endpoints/monitoring/metrics';
import { TestRunner } from '../endpoints/monitoring/testRunner';
import { TestError } from '../endpoints/monitoring/test-error';
import { StatusPage } from '../endpoints/monitoring/statusPage';
import { SyncR2Buckets } from '../endpoints/monitoring/sync-r2';
import { LibraryBackfill } from '../endpoints/library/backfill';

const app = new Hono();
export const monitoringRouter = fromHono(app, { base: '' }); // Root level

// Public endpoints (root level)
monitoringRouter.get('/health', HealthCheck);
monitoringRouter.get('/metrics', Metrics);
monitoringRouter.get('/test', TestRunner);
monitoringRouter.get('/test-error', TestError);
monitoringRouter.get('/status', StatusPage);

// Internal sync endpoint (dev only)
monitoringRouter.get('/internal/sync-r2', SyncR2Buckets);

// One-off backfill of liked-videos / channel-subscriber indexes (X-API-Key, Epic 29)
monitoringRouter.post('/internal/library/backfill', LibraryBackfill);

export default monitoringRouter;
