import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { LiveStreamCreate } from '../endpoints/live/liveStreamCreate';
import { LiveStreamsList } from '../endpoints/live/liveStreamsList';
import { LiveStreamUpdate } from '../endpoints/live/liveStreamUpdate';
import { LiveStreamDelete, LiveStreamEnd, LiveStreamGet, LiveStreamIngestGet, LiveStreamQoe, LiveStreamStart, LiveStreamStateGet } from '../endpoints/live/liveSession';

const app = new Hono();
export const liveRouter = fromHono(app, { base: '/api/live-streams' });

// Public endpoints
liveRouter.get('/', LiveStreamsList);
liveRouter.get('/:id', LiveStreamGet);
liveRouter.get('/:id/state', LiveStreamStateGet);
liveRouter.post('/:id/qoe', LiveStreamQoe);

// Authenticated endpoints
liveRouter.post('/', LiveStreamCreate);
liveRouter.patch('/:id', LiveStreamUpdate);
liveRouter.delete('/:id', LiveStreamDelete);
// Provider-neutral session lifecycle (D3, lib/live/*)
liveRouter.get('/:id/ingest', LiveStreamIngestGet);
liveRouter.post('/:id/start', LiveStreamStart);
liveRouter.post('/:id/end', LiveStreamEnd);

export default liveRouter;
