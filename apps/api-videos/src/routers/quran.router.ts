/**
 * Quran router (AUN-CAPTIONS). Base: /api/quran (served as /api/v1/quran).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { QuranPassageGet } from '../endpoints/quran/quranPassageGet';

export const quranRouter = fromHono(new Hono(), { base: '/api/quran' });
quranRouter.get('/passage', QuranPassageGet);

export default quranRouter;
