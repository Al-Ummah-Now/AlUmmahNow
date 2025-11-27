import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ReportsList, ReportGet, ReportAction, ReportStats } from '../endpoints/moderation';

const app = new Hono();
const moderationRouter = fromHono(app, { base: '' });

// List and stats endpoints
moderationRouter.get('/reports', ReportsList);
moderationRouter.get('/reports/stats', ReportStats);

// Single report operations
moderationRouter.get('/reports/:reportId', ReportGet);
moderationRouter.post('/reports/:reportId/action', ReportAction);

export default moderationRouter;
