/**
 * Translation router (AUN-CAPTIONS §5.8). Base: /api/translate (served as /api/v1/translate).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { TranslateCreate, TranslateUsageGet } from '../endpoints/translate/translate';

export const translateRouter = fromHono(new Hono());
translateRouter.post('/', TranslateCreate);
translateRouter.get('/usage', TranslateUsageGet);

export default translateRouter;
