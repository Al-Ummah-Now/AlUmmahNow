/**
 * Client telemetry (Epic 9.8). Base: /api/telemetry (served as /api/v1/telemetry).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { TelemetryEventsPost } from '../endpoints/telemetry/telemetryEvents';

export const telemetryRouter = fromHono(new Hono(), { base: '/api/telemetry' });
telemetryRouter.post('/events', TelemetryEventsPost);
