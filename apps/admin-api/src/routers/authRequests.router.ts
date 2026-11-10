import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { AuthRequestCreate, AuthRequestEvidence, AuthRequestGet, AuthRequestProvideInfo, AuthRequestRetry, AuthRequestsList } from '../endpoints/authRequests/AuthRequests';

const app = new Hono();
const authRequestsRouter = fromHono(app, { base: '' });

// Moderation requests to auth (docs/admin/AUTH_MODERATION_REQUESTS.md)
authRequestsRouter.get('/', AuthRequestsList);
authRequestsRouter.get('/evidence', AuthRequestEvidence);
authRequestsRouter.post('/', AuthRequestCreate);
authRequestsRouter.get('/:id', AuthRequestGet);
authRequestsRouter.post('/:id/retry', AuthRequestRetry);
authRequestsRouter.post('/:id/info', AuthRequestProvideInfo);

export default authRequestsRouter;
