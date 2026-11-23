/**
 * Quran router (AUN-CAPTIONS). Base: /api/quran (served as /api/v1/quran).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { QuranPassageGet } from '../endpoints/quran/quranPassageGet';
import { QuranTranslationsList } from '../endpoints/quran/quranTranslations';
import { QuranCreditsGet } from '../endpoints/quran/quranCredits';

export const quranRouter = fromHono(new Hono());
quranRouter.get('/passage', QuranPassageGet);
quranRouter.get('/translations', QuranTranslationsList);
// QF's attribution and every edition in use, for the Credits page (QF 2026-11-23)
quranRouter.get('/credits', QuranCreditsGet);

export default quranRouter;
