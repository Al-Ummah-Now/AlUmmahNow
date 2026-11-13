/**
 * GET /api/v1/quran/passage?range=67:1:1-67:5:12 (AUN-CAPTIONS §5.5, §9.4): the official Uthmani
 * text of a Quran range from our Quran Foundation copy, with its attribution and quran.com link.
 * Used by Studio's caption editor and the Quran passage card. Public and cacheable.
 */
import { z } from 'zod';
import { QURAN_ATTRIBUTION, parseQuranRange, quranAyahLabel, quranComUrl } from '@al-ummah/shared-types';
import { PublicRoute } from '../../base';
import type { AppContext } from '../../base';
import { readQuranPassage } from '../../lib/quran/copy';

const PassageResponse = z.object({
	range: z.string(),
	label: z.string().describe('"67:1–5"'),
	surah: z.object({ number: z.number(), nameArabic: z.string(), nameSimple: z.string() }),
	ayat: z.array(z.object({ ayah: z.number(), text: z.string().describe('Uthmani text, verbatim from Quran Foundation'), partial: z.boolean() })),
	quranComUrl: z.string(),
	attribution: z.object({ en: z.string(), ar: z.string() }),
	version: z.string(),
});

export class QuranPassageGet extends PublicRoute {
	schema = {
		tags: ['Quran'],
		summary: 'Official text of a Quran range',
		description: '🌐 Public. The Uthmani text of `range` (surah:ayah:word-surah:ayah:word, one surah) from the Quran Foundation copy. 503 while no fresh copy is available.',
		request: {
			query: z.object({ range: z.string().max(32).describe('e.g. 67:1:1-67:5:12') }),
		},
		responses: {
			'200': { description: 'The passage', content: { 'application/json': { schema: PassageResponse } } },
			'400': { description: 'Malformed range' },
			'404': { description: 'The range is not in the Quran' },
			'503': { description: 'No fresh copy of the Quran text yet' },
		},
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const range = parseQuranRange(query.range);
		if (!range) return c.json({ success: false, error: 'invalid_range' }, 400);
		const result = await readQuranPassage(c.env.MEDIA_PRIVATE, range);
		if (result.status === 'unavailable') {
			c.header('Retry-After', '3600');
			return c.json({ success: false, error: 'quran_text_unavailable' }, 503);
		}
		if (result.status !== 'ok') return c.json({ success: false, error: 'range_not_found' }, 404);
		const { file, current, ayat } = result as Extract<typeof result, { status: 'ok' }>;
		c.header('Cache-Control', 'public, max-age=3600');
		return c.json({
			range: query.range.trim(),
			label: quranAyahLabel(range),
			surah: { number: file.surah, nameArabic: file.name.ar, nameSimple: file.name.simple },
			ayat,
			quranComUrl: quranComUrl(range),
			attribution: { ...QURAN_ATTRIBUTION },
			version: current.version,
		});
	}
}
