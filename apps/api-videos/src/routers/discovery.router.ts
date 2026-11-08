import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { SearchSuggestionsGet, TrendingGet, RecommendationsGet } from '../endpoints/discovery/discovery';

const app = new Hono();

/**
 * Discovery domain: typeahead suggestions, trending and recommendations.
 * Mounted at '/api' because the public paths are /api/search/suggestions,
 * /api/trending and /api/recommendations.
 */
export const discoveryRouter = fromHono(app, { base: '/api' });

discoveryRouter.get('/search/suggestions', SearchSuggestionsGet);
discoveryRouter.get('/trending', TrendingGet);
discoveryRouter.get('/recommendations', RecommendationsGet);

export default discoveryRouter;
