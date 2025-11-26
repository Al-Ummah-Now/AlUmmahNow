import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { LiveStreamCreate } from '../endpoints/live/liveStreamCreate';
import { LiveStreamsList } from '../endpoints/live/liveStreamsList';
import { LiveStreamUpdate } from '../endpoints/live/liveStreamUpdate';

const app = new Hono();
export const liveRouter = fromHono(app, { base: '/api/live-streams' });

// Public endpoints
liveRouter.get('/', LiveStreamsList);

// Authenticated endpoints
liveRouter.post('/', LiveStreamCreate);
liveRouter.patch('/:id', LiveStreamUpdate);

export default liveRouter;
