/**
 * Privacy Router (GDPR data subject rights, Story 1.3)
 * Base: /api/privacy. All routes require authentication (AuthenticatedRoute).
 */

import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { PrivacyConsentGet, PrivacyConsentPut, PrivacyErase, PrivacyExport } from '../endpoints/privacy/privacy';

const app = new Hono();

export const privacyRouter = fromHono(app, { base: '/api/privacy' });

privacyRouter.get('/export', PrivacyExport);
privacyRouter.delete('/data', PrivacyErase);
privacyRouter.get('/consent', PrivacyConsentGet);
privacyRouter.put('/consent', PrivacyConsentPut);

export default privacyRouter;
