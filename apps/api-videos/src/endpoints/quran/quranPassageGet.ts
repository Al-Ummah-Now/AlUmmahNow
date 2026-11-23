/**
 * GET /api/v1/quran/passage?range=67:1:1-67:5:12 (AUN-CAPTIONS §5.5, §9.4): the official Uthmani
 * text of a Quran range from our Quran Foundation copy, with its attribution and quran.com link.
 * Used by Studio's caption editor and the Quran passage card. Public and cacheable.
 */
import { z } from 'zod';
import { QURAN_ATTRIBUTION, QURAN_CREDIT, QURAN_FOUNDATION_URL, formatQuranRange, parseQuranRange, quranAyahLabel, quranComUrl, type QuranRange } from '@al-ummah/shared-types';
import { PublicRoute } from '../../base';
import type { AppContext } from '../../base';
import { readQuranPassage, readQuranSurah } from '../../lib/quran/copy';
import { featureOff } from '../../lib/features/off';
import { logger } from '../../lib/logger';

/**
 * No fresh copy is an expected state (the sync has not run yet, or the copy aged out), not a
 * server error: the Quran text is hidden (GET /api/me/features `quranText`), this answers 404
 * feature_off, and one warning per isolate says so.
 */
let warnedUnavailable = false;
function textUnavailable(c: AppContext) {
	if (!warnedUnavailable) {
		warnedUnavailable = true;
		logger.warn('[Quran] No fresh Quran Foundation copy: the passage API answers feature_off until a sync succeeds');
	}
	return featureOff(c);
}

/** Test hook */
export function resetQuranUnavailableWarning(): void {
	warnedUnavailable = false;
}

const SHORT_RANGE = /^(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$/;

/** `3:166` or `3:166-167` (whole ayat, as a creator types it) → the full word range, from the copy. */
async function wholeAyat(bucket: unknown, query: string): Promise<QuranRange | 'unavailable' | null> {
	const m = SHORT_RANGE.exec(query);
	if (!m) return null;
	const surah = Number(m[1]);
	const from = Number(m[2]);
	const to = m[3] ? Number(m[3]) : from;
	if (surah < 1 || surah > 114 || from < 1 || to < from) return null;
	const got = await readQuranSurah(bucket as never, surah);
	if (!got) return 'unavailable';
	const last = got.file.ayat[to - 1];
	if (!last || !got.file.ayat[from - 1]) return null;
	return { from: { surah, ayah: from, word: 1 }, to: { surah, ayah: to, word: last.words.length } };
}

const PassageResponse = z.object({
	range: z.string(),
	label: z.string().describe('"67:1–5"'),
	surah: z.object({ number: z.number(), nameArabic: z.string(), nameSimple: z.string() }),
	ayat: z.array(z.object({ ayah: z.number(), text: z.string().describe('Uthmani text, verbatim from Quran Foundation'), partial: z.boolean() })),
	quranComUrl: z.string(),
	attribution: z.object({ en: z.string(), ar: z.string() }).describe("QF's full attribution line"),
	credit: z.object({ en: z.string(), ar: z.string(), url: z.string() }).describe('QF\'s short credit to show next to the text, linked to url (QF 2026-11-23)'),
	version: z.string(),
});

export class QuranPassageGet extends PublicRoute {
	schema = {
		tags: ['Quran'],
		summary: 'Official text of a Quran range',
		description: '🌐 Public. The Uthmani text of `range` (surah:ayah:word-surah:ayah:word, one surah; or whole ayat `3:166-167`) from the Quran Foundation copy. `range` in the response is always the full word range. 404 `feature_off` while no fresh copy is available (GET /api/me/features `quranText` is false then).',
		request: {
			query: z.object({ range: z.string().max(32).describe('e.g. 67:1:1-67:5:12') }),
		},
		responses: {
			'200': { description: 'The passage', content: { 'application/json': { schema: PassageResponse } } },
			'400': { description: 'Malformed range' },
			'404': { description: 'The range is not in the Quran (`range_not_found`), or no fresh copy of the Quran text yet (`feature_off`)' },
		},
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		let range = parseQuranRange(query.range.trim());
		if (!range && SHORT_RANGE.test(query.range.trim())) {
			const whole = await wholeAyat(c.env.MEDIA_PRIVATE, query.range.trim());
			if (whole === 'unavailable') {
				return textUnavailable(c);
			}
			if (!whole) return c.json({ success: false, error: 'range_not_found' }, 404);
			range = whole;
		}
		if (!range) return c.json({ success: false, error: 'invalid_range' }, 400);
		const result = await readQuranPassage(c.env.MEDIA_PRIVATE, range);
		if (result.status === 'unavailable') {
			return textUnavailable(c);
		}
		if (result.status !== 'ok') return c.json({ success: false, error: 'range_not_found' }, 404);
		const { file, current, ayat } = result as Extract<typeof result, { status: 'ok' }>;
		c.header('Cache-Control', 'public, max-age=3600');
		return c.json({
			range: formatQuranRange(range),
			label: quranAyahLabel(range),
			surah: { number: file.surah, nameArabic: file.name.ar, nameSimple: file.name.simple },
			ayat,
			quranComUrl: quranComUrl(range),
			attribution: { ...QURAN_ATTRIBUTION },
			credit: { ...QURAN_CREDIT, url: QURAN_FOUNDATION_URL },
			version: current.version,
		});
	}
}
