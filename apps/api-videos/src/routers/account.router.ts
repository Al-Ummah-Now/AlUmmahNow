/**
 * In-app account deletion and export (Epic 9.7). Base: /api/account (served as /api/v1/account).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { AccountDeletionPost, AccountExportGet } from '../endpoints/account/account';

export const accountRouter = fromHono(new Hono(), { base: '/api/account' });
accountRouter.post('/deletion', AccountDeletionPost);
accountRouter.get('/export', AccountExportGet);
