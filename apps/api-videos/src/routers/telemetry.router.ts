import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { TelemetryBatchesCreate } from '../endpoints/analytics/telemetryBatches';

const app = new Hono();
export const telemetryRouter = fromHono(app);

// Native app telemetry & crash batch ingest (AlUmmahNowCore#8 / Epic 9.8, auth optional)
telemetryRouter.post('/batches', TelemetryBatchesCreate);

export default telemetryRouter;
