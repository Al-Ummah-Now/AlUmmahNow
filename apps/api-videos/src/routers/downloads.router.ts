/**
 * Viewer offline download cleanup & revocation routes (Epic 14).
 * Base: /api/downloads (served under /api/v1/downloads).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { DownloadsSync } from '../endpoints/downloads/downloads';
import { DownloadsRevocations } from '../endpoints/downloads/revocations';

export const downloadsRouter = fromHono(new Hono());
downloadsRouter.post('/sync', DownloadsSync);
downloadsRouter.get('/revocations', DownloadsRevocations);

export default downloadsRouter;
