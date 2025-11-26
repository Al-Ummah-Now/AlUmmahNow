import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ReportCreate } from '../endpoints/moderation/reportCreate';
import { ModerationAction } from '../endpoints/moderation/moderationAction';

const app = new Hono();
export const moderationRouter = fromHono(app, { base: '/api/moderation' });

// Authenticated endpoints
moderationRouter.post('/reports', ReportCreate);
moderationRouter.post('/reports/:reportId/action', ModerationAction);

export default moderationRouter;
