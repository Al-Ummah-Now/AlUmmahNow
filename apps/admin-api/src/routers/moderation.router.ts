import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { ReportsList, ReportGet, ReportAction, ReportStats } from '../endpoints/moderation';
import { AiConfigGet, AiConfigUpdate, AiQueueList, AiSignalGet, AiSignalReview, AiSignalVisibility, AiSignalsList, AiUsageGet } from '../endpoints/aiModeration';

const app = new Hono();
const moderationRouter = fromHono(app, { base: '' });

// List and stats endpoints
moderationRouter.get('/reports', ReportsList);
moderationRouter.get('/reports/stats', ReportStats);

// Single report operations
moderationRouter.get('/reports/:reportId', ReportGet);
moderationRouter.post('/reports/:reportId/action', ReportAction);

// AI-assisted moderation (Epic 28)
moderationRouter.get('/ai/signals', AiSignalsList);
// Action needed / History tabs (docs/admin/QUEUES.md)
moderationRouter.get('/ai/queue', AiQueueList);
moderationRouter.get('/ai/signals/:id', AiSignalGet);
moderationRouter.post('/ai/signals/:id/review', AiSignalReview);
moderationRouter.post('/ai/signals/:id/visibility', AiSignalVisibility);
moderationRouter.get('/ai/config', AiConfigGet);
moderationRouter.put('/ai/config', AiConfigUpdate);
moderationRouter.get('/ai/usage', AiUsageGet);

export default moderationRouter;
