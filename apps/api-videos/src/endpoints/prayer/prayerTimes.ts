/**
 * Anonymous prayer times and Hijri dates by city and month (wiki Epic 21 §3 and §5.2, owner
 * decisions E21-D1 and E21-D2).
 *
 *   GET /api/prayer-times?city=<id>&month=YYYY-MM&method=<auto|id>&asr=<standard|hanafi>
 *   GET /api/hijri?month=YYYY-MM
 *
 * The routes never read auth state, cookies or the client's location: only these query values.
 * Answers are edge-cached (Cache API) and shared by everyone asking for the same key; minute
 * adjustments and the Hijri shift are applied on the device. With no known answer the route says
 * so (503 prayer_provider_unavailable); it never invents a time. Gated by `prayerTimes` and
 * `hijriCalendar` (FEATURE_ROUTES).
 */
import { z } from 'zod';
import { PublicRoute, type AppContext } from '../../base';
import { apiError } from '../../lib/api-error';
import { findCity } from '../../lib/prayer/cities';
import { isPrayerMethodId, resolveMethod } from '../../lib/prayer/methods';
import { allowedMonth, defaultPrayerSettings, hijriMonth, prayerMonth, type PrayerSettings } from '../../lib/prayer/service';

/** Browsers and the edge keep an answer a day, and may serve it a week longer while refreshing */
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';
const STALE_CACHE_CONTROL = 'public, max-age=3600';

export const PRAYER_CREDITS = {
	provider: { name: 'AlAdhan / Islamic Network', url: 'https://aladhan.com/' },
	hijri: {
		HJCoSA: { name: { en: 'High Judicial Council of Saudi Arabia', ar: 'المجلس الأعلى للقضاء في المملكة العربية السعودية' }, url: 'https://aladhan.com/islamic-calendar-api' },
		UAQ: { name: { en: 'Umm al-Qura calendar', ar: 'تقويم أم القرى' }, url: 'https://aladhan.com/islamic-calendar-api' },
	},
	cities: { name: 'GeoNames', url: 'https://www.geonames.org/', license: 'CC BY 4.0' },
} as const;

/** Tests swap the provider; production builds the AlAdhan adapter with the global fetch */
let settingsFactory: () => PrayerSettings = () => defaultPrayerSettings();
export function setPrayerSettingsForTests(factory: (() => PrayerSettings) | null): void {
	settingsFactory = factory ?? (() => defaultPrayerSettings());
}

function edgeCache(): Cache | undefined {
	return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
}

/** Normalized cache URL: the same key whatever order or extra parameters the client sent */
function cacheUrl(c: AppContext, path: string, params: Record<string, string>): string {
	const url = new URL(c.req.url);
	return `${url.origin}/__prayer-cache${path}?${new URLSearchParams(params)}`;
}

async function cached(url: string): Promise<Response | null> {
	try {
		const hit = await edgeCache()?.match(url);
		return hit ? new Response(hit.body, hit) : null;
	} catch {
		return null;
	}
}

function store(c: AppContext, url: string, response: Response): void {
	const cache = edgeCache();
	if (!cache) return;
	const put = cache.put(url, response.clone()).catch(() => undefined);
	try {
		c.executionCtx.waitUntil(put);
	} catch {
		// No execution context (tests): the put runs on its own
	}
}

function unavailable(c: AppContext) {
	return apiError(c, 503, 'prayer_provider_unavailable', undefined, { 'Cache-Control': 'no-store', 'Retry-After': '60' });
}

const Hijri = z.object({ day: z.number().int(), month: z.number().int(), year: z.number().int() });

export class PrayerTimesGet extends PublicRoute {
	schema = {
		tags: ['Prayer'],
		summary: 'Prayer times and Hijri dates for a city and month (anonymous)',
		description:
			'Send only a catalogue city id, a calendar month (last month to 12 months ahead), a method and the Asr method. No account, cookie or location is read. Times are UTC instants; the device applies minute adjustments and the Hijri shift. 503 `prayer_provider_unavailable` when no known answer exists; times are never invented.',
		request: {
			query: z.object({
				city: z.string().regex(/^[1-9][0-9]{0,9}$/).describe('Catalogue city id (GeoNames)'),
				month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe('YYYY-MM; other windows are refused'),
				method: z.string().regex(/^(auto|[0-9]{1,2})$/).optional().default('auto'),
				asr: z.enum(['standard', 'hanafi']).optional().default('standard'),
			}),
		},
		responses: {
			'200': {
				description: 'One row per day',
				content: {
					'application/json': {
						schema: z.object({
							success: z.literal(true),
							data: z.object({
								city: z.object({ id: z.string(), name: z.string(), country: z.string(), timeZone: z.string(), latitude: z.number(), longitude: z.number() }),
								month: z.string(),
								method: z.number().int(),
								asr: z.enum(['standard', 'hanafi']),
								provider: z.string(),
								hijriSource: z.string(),
								stale: z.boolean(),
								fetchedAt: z.string(),
								days: z.array(z.object({ date: z.string(), times: z.record(z.string(), z.string()), hijri: Hijri })),
								credits: z.any(),
							}),
						}),
					},
				},
			},
			'400': { description: 'Unknown city, method or a month outside the window' },
			'503': { description: 'prayer_provider_unavailable' },
		},
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const city = await findCity(query.city);
		if (!city) return apiError(c, 400, 'invalid_request', { field: 'city' });
		if (!allowedMonth(query.month)) return apiError(c, 400, 'invalid_request', { field: 'month' });
		const requested = query.method === 'auto' ? 'auto' : Number(query.method);
		if (requested !== 'auto' && !isPrayerMethodId(requested)) return apiError(c, 400, 'invalid_request', { field: 'method' });
		const settings = settingsFactory();
		const method = resolveMethod(requested, city.country);
		const key = cacheUrl(c, '/prayer-times', { p: settings.provider.id, h: settings.hijriSource, city: city.id, month: query.month, method: String(method), asr: query.asr });
		const hit = await cached(key);
		if (hit) return hit;

		const result = await prayerMonth(c.env as never, settings, { city, month: query.month, method, asr: query.asr });
		if (!result) return unavailable(c);
		const response = c.json(
			{
				success: true as const,
				data: {
					city: { id: city.id, name: city.name, country: city.country, timeZone: city.timeZone, latitude: city.latitude, longitude: city.longitude },
					month: query.month,
					method,
					asr: query.asr,
					provider: settings.provider.id,
					hijriSource: settings.hijriSource,
					stale: result.stale,
					fetchedAt: result.fetchedAt,
					days: result.days,
					credits: { provider: PRAYER_CREDITS.provider, hijri: PRAYER_CREDITS.hijri[settings.hijriSource], cities: PRAYER_CREDITS.cities },
				},
			},
			200,
			{ 'Cache-Control': result.stale ? STALE_CACHE_CONTROL : CACHE_CONTROL },
		);
		if (!result.stale) store(c, key, response);
		return response;
	}
}

export class HijriMonthGet extends PublicRoute {
	schema = {
		tags: ['Prayer'],
		summary: 'Hijri dates for a Gregorian month (anonymous)',
		description: 'The same provider, gate and cache as prayer times, without a city. The device applies the viewer\'s Hijri shift and formats the numeric parts.',
		request: { query: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }) },
		responses: {
			'200': { description: 'One row per day: date and Hijri day, month and year' },
			'400': { description: 'A month outside the window' },
			'503': { description: 'prayer_provider_unavailable' },
		},
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		if (!allowedMonth(query.month)) return apiError(c, 400, 'invalid_request', { field: 'month' });
		const settings = settingsFactory();
		const key = cacheUrl(c, '/hijri', { p: settings.provider.id, h: settings.hijriSource, month: query.month });
		const hit = await cached(key);
		if (hit) return hit;
		const result = await hijriMonth(c.env as never, settings, query.month);
		if (!result) return unavailable(c);
		const response = c.json(
			{
				success: true as const,
				data: { month: query.month, provider: settings.provider.id, hijriSource: settings.hijriSource, stale: result.stale, fetchedAt: result.fetchedAt, days: result.days, credits: { hijri: PRAYER_CREDITS.hijri[settings.hijriSource] } },
			},
			200,
			{ 'Cache-Control': result.stale ? STALE_CACHE_CONTROL : CACHE_CONTROL },
		);
		if (!result.stale) store(c, key, response);
		return response;
	}
}
