/**
 * Quran router (AUN-CAPTIONS). Base: /api/quran (served as /api/v1/quran).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { QuranPassageGet } from '../endpoints/quran/quranPassageGet';
import { QuranTranslationsList } from '../endpoints/quran/quranTranslations';

export const quranRouter = fromHono(new Hono());
quranRouter.get('/passage', QuranPassageGet);
quranRouter.get('/translations', QuranTranslationsList);

export default quranRouter;
