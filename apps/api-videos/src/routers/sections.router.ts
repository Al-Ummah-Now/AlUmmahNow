import { Hono } from 'hono';
import { fromHono } from 'chanfana';

// Import video sections endpoints
import { RecentVideosSection } from '../endpoints/sections/recent';
import { PopularVideosSection } from '../endpoints/sections/popular';
import { TrendingVideosSection } from '../endpoints/sections/trending';
import { RecommendedVideosSection } from '../endpoints/sections/recommended';
import { CategoryVideosSection } from '../endpoints/sections/by-category';
import { AdminIndexOperations } from '../endpoints/sections/admin';

const app = new Hono();

export const sectionsRouter = fromHono(app, { base: '/api/videos/sections' });

// Register video sections routes (all paths are relative to base)
sectionsRouter.get('/recent', RecentVideosSection);
sectionsRouter.get('/popular', PopularVideosSection);
sectionsRouter.get('/trending', TrendingVideosSection);
sectionsRouter.get('/recommended', RecommendedVideosSection);
sectionsRouter.get('/by-category/:category', CategoryVideosSection);
sectionsRouter.get('/admin', AdminIndexOperations);

export default sectionsRouter;
