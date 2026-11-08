/**
 * Watch-state sync & Continue watching (Epic 9.9), for native clients.
 * Bases: /api/watch-state and /api/continue-watching (served under /api/v1/).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ContinueWatchingList, WatchStateList, WatchStatePut } from '../endpoints/watch-state/watchState';

export const watchStateRouter = fromHono(new Hono(), { base: '/api/watch-state' });
watchStateRouter.get('/', WatchStateList);
watchStateRouter.put('/:videoId', WatchStatePut);

export const continueWatchingRouter = fromHono(new Hono(), { base: '/api/continue-watching' });
continueWatchingRouter.get('/', ContinueWatchingList);
