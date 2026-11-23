/**
 * Prayer router (wiki Epic 21 §3). Base: /api (served as /api/v1/prayer-times and /api/v1/hijri).
 * Anonymous: these routes never read auth state.
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { HijriMonthGet, PrayerTimesGet } from '../endpoints/prayer/prayerTimes';

export const prayerRouter = fromHono(new Hono());
prayerRouter.get('/prayer-times', PrayerTimesGet);
prayerRouter.get('/hijri', HijriMonthGet);

export default prayerRouter;
