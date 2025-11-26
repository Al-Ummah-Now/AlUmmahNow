import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ReportCreate } from '../endpoints/moderation/reportCreate';
import { ModerationAction } from '../endpoints/moderation/moderationAction';

const app = new Hono();
export const moderationRouter = fromHono(app, { base: '/api/moderation' });

// Authenticated endpoints
moderationRouter.post('/report', ReportCreate);
moderationRouter.post('/actions/:reportId', ModerationAction);

export default moderationRouter;
