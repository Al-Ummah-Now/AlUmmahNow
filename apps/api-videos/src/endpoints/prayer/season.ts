/**
 * The published Islamic season covering a date (wiki Epic 21 §4 21.2 and §5.3). Public and
 * cacheable; gated by `ramadanMode` (FEATURE_ROUTES). Outside a season it answers `season: null`
 * and the apps show nothing seasonal.
 *
 * GET /api/islamic/season?date=YYYY-MM-DD
 */
import { z } from 'zod';
import { PublicRoute, type AppContext } from '../../base';
import { activeSeason, validDate } from '../../lib/islamic-seasons';
import { apiError } from '../../lib/api-error';

export class IslamicSeasonGet extends PublicRoute {
	schema = {
		tags: ['Prayer'],
		summary: 'The published Islamic season covering a date',
		description: 'Admin-curated (Ramadan, the first ten days of Dhul-Hijjah, others) with a bilingual source label and ordered item ids. Dates are an admin override, never a claim of a moon sighting.',
		request: { query: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The viewer's local date") }) },
		responses: { '200': { description: '{ season } or { season: null }' }, '400': { description: 'Not a real date' } },
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		if (!validDate(query.date)) return apiError(c, 400, 'invalid_request', { field: 'date' });
		const season = await activeSeason(c.env.SEARCH_DB as D1Database, query.date);
		c.header('Cache-Control', 'public, max-age=300');
		if (!season) return c.json({ success: true as const, data: { season: null } });
		const { updatedBy: _by, deletedAt: _d, version: _v, state: _s, ...pub } = season;
		return c.json({ success: true as const, data: { season: pub } });
	}
}
