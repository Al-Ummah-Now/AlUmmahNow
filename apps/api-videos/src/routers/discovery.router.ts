import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { SearchSuggestionsGet, TrendingGet, RecommendationsGet } from '../endpoints/discovery/discovery';
import { ShortsPublicFeed } from '../endpoints/video/publicPlay';
import { SitemapPageGet, SitemapSummaryGet } from '../endpoints/sitemap/sitemap';

const app = new Hono();

/**
 * Discovery domain: typeahead suggestions, trending and recommendations.
 * Mounted at '/api' because the public paths are /api/search/suggestions,
 * /api/trending, /api/recommendations and /api/shorts (the www Shorts viewer).
 */
export const discoveryRouter = fromHono(app, { base: '/api' });

discoveryRouter.get('/search/suggestions', SearchSuggestionsGet);
discoveryRouter.get('/trending', TrendingGet);
discoveryRouter.get('/recommendations', RecommendationsGet);
discoveryRouter.get('/shorts', ShortsPublicFeed);
// The videos site's sitemaps (wiki AUN-SEO): public items only
discoveryRouter.get('/sitemap', SitemapSummaryGet);
discoveryRouter.get('/sitemap/:kind', SitemapPageGet);

export default discoveryRouter;
