import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { SearchGet } from '../endpoints/search/searchGet';
import { ExploreGet } from '../endpoints/search/exploreGet';
import { OwnershipBackfillPost, SearchBackfillPost, SearchIndexStats } from '../endpoints/search/searchBackfill';

const app = new Hono();

/**
 * Search v2 domain (Epic 29): index-backed search, explore data, and internal
 * index maintenance. Mounted at the root because it spans /api and /internal.
 * /api/search/suggestions stays in the discovery router.
 */
export const searchRouter = fromHono(app, { base: '' });

searchRouter.get('/api/search', SearchGet);
searchRouter.get('/api/explore', ExploreGet);
searchRouter.post('/internal/search/backfill', SearchBackfillPost);
searchRouter.post('/internal/search/ownership-backfill', OwnershipBackfillPost);
searchRouter.get('/internal/search/stats', SearchIndexStats);

export default searchRouter;
