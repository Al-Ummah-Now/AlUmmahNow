import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ReportCreate } from '../endpoints/moderation/reportCreate';

const app = new Hono();
export const moderationRouter = fromHono(app);

// User endpoint to create reports (admin endpoints moved to admin-api)
moderationRouter.post('/reports', ReportCreate);

export default moderationRouter;
