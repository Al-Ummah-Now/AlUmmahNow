/**
 * Viewer offline download cleanup & revocation routes (Epic 14).
 * Base: /api/downloads (served under /api/v1/downloads).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { DownloadsSync } from '../endpoints/downloads/downloads';

export const downloadsRouter = fromHono(new Hono());
downloadsRouter.post('/sync', DownloadsSync);

export default downloadsRouter;
