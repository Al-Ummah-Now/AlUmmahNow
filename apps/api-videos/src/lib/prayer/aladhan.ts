/**
 * The AlAdhan / Islamic Network adapter (wiki Epic 21 §3, E21-D1 and E21-D2). It is called only by
 * the Worker, only on a cache miss, and only with a catalogue city's public coordinates; never a
 * user's location, id or IP. One call returns a whole Gregorian month: the six times of each day
 * (ISO 8601 with offset, so no time-zone math here) and each day's Hijri day, month and year.
 *
 * Terms: https://aladhan.com/credits-and-terms (free, no key, no warranty, no SLA). Written
 * permission for server-side caching is a launch gate (spec §3), not a code switch.
 */
import type { AsrMethod, HijriSource, PrayerMethodId } from './methods';
import type { PrayerCity } from './cities';

export const ALADHAN_BASE = 'https://api.aladhan.com/v1';
export const PRAYER_NAMES = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type PrayerName = (typeof PRAYER_NAMES)[number];

export interface HijriParts {
	day: number;
	month: number;
	year: number;
}

export interface PrayerDay {
	/** Gregorian date in the city's time zone, YYYY-MM-DD */
	date: string;
	/** UTC instants, ISO 8601 */
	times: Record<PrayerName, string>;
	hijri: HijriParts;
}

export interface HijriDay {
	date: string;
	hijri: HijriParts;
}

/** A provider failure: `status` is the upstream HTTP status (0 = network), `retryAfterMs` from Retry-After */
export class ProviderError extends Error {
	constructor(
		readonly status: number,
		readonly retryAfterMs: number | null = null,
	) {
		super(`prayer provider failed (${status})`);
		this.name = 'ProviderError';
	}
}

export interface PrayerProvider {
	id: string;
	fetchMonth(city: PrayerCity, month: string, method: PrayerMethodId, asr: AsrMethod, hijri: HijriSource): Promise<PrayerDay[]>;
	fetchHijriMonth(month: string, hijri: HijriSource): Promise<HijriDay[]>;
}

const UPSTREAM_TIMEOUT_MS = 8000;

function retryAfter(response: Response): number | null {
	const header = response.headers.get('retry-after');
	if (!header) return null;
	const seconds = Number(header);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const at = Date.parse(header);
	return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

const int = (value: unknown): number => {
	const n = Number(value);
	if (!Number.isInteger(n)) throw new ProviderError(502);
	return n;
};

/** "DD-MM-YYYY" (AlAdhan's Gregorian format) to "YYYY-MM-DD" */
function isoDate(ddmmyyyy: unknown): string {
	const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(ddmmyyyy ?? ''));
	if (!m) throw new ProviderError(502);
	return `${m[3]}-${m[2]}-${m[1]}`;
}

function hijriOf(raw: any): HijriParts {
	const parts = { day: int(raw?.day), month: int(raw?.month?.number), year: int(raw?.year) };
	if (parts.day < 1 || parts.day > 30 || parts.month < 1 || parts.month > 12 || parts.year < 1300) throw new ProviderError(502);
	return parts;
}

/** "2026-11-01T05:12:00+03:00 (+03)" or "2026-11-01T05:12:00+03:00" to a UTC ISO instant */
function instant(value: unknown): string {
	const text = String(value ?? '').split(' ')[0];
	const t = Date.parse(text);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) || !Number.isFinite(t)) throw new ProviderError(502);
	return new Date(t).toISOString();
}

const TIMING_KEYS: Record<PrayerName, string> = { fajr: 'Fajr', sunrise: 'Sunrise', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };

export function parseCalendar(body: any, expectedDays: number): PrayerDay[] {
	if (body?.code !== 200 || !Array.isArray(body?.data)) throw new ProviderError(502);
	const days = body.data.map((d: any): PrayerDay => {
		const times = {} as Record<PrayerName, string>;
		for (const name of PRAYER_NAMES) times[name] = instant(d?.timings?.[TIMING_KEYS[name]]);
		return { date: isoDate(d?.date?.gregorian?.date), times, hijri: hijriOf(d?.date?.hijri) };
	});
	if (days.length !== expectedDays) throw new ProviderError(502);
	return days;
}

export function parseHijriCalendar(body: any, expectedDays: number): HijriDay[] {
	if (body?.code !== 200 || !Array.isArray(body?.data)) throw new ProviderError(502);
	const days = body.data.map((d: any): HijriDay => ({ date: isoDate(d?.gregorian?.date), hijri: hijriOf(d?.hijri) }));
	if (days.length !== expectedDays) throw new ProviderError(502);
	return days;
}

export function daysInMonth(month: string): number {
	const [y, m] = month.split('-').map(Number);
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function aladhanProvider(fetchImpl: typeof fetch = fetch, base = ALADHAN_BASE): PrayerProvider {
	async function get(url: string): Promise<any> {
		let response: Response;
		try {
			// No cookies, no credentials, no client headers: only our Worker's request
			response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
		} catch {
			throw new ProviderError(0);
		}
		if (!response.ok) throw new ProviderError(response.status, retryAfter(response));
		try {
			return await response.json();
		} catch {
			throw new ProviderError(502);
		}
	}
	return {
		id: 'aladhan',
		async fetchMonth(city, month, method, asr, hijri) {
			const [year, mm] = month.split('-');
			const q = new URLSearchParams({
				latitude: String(city.latitude),
				longitude: String(city.longitude),
				method: String(method),
				school: asr === 'hanafi' ? '1' : '0',
				timezonestring: city.timeZone,
				iso8601: 'true',
				calendarMethod: hijri,
			});
			return parseCalendar(await get(`${base}/calendar/${Number(year)}/${Number(mm)}?${q}`), daysInMonth(month));
		},
		async fetchHijriMonth(month, hijri) {
			const [year, mm] = month.split('-');
			return parseHijriCalendar(await get(`${base}/gToHCalendar/${Number(mm)}/${Number(year)}?calendarMethod=${hijri}`), daysInMonth(month));
		},
	};
}
