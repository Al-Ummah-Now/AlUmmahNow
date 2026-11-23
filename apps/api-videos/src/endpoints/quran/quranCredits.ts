/**
 * Quran credits (QF 2026-11-23): what the web Credits page (/{locale}/credits) shows.
 *
 *   GET /api/quran/credits   public
 *
 * QF asked for its full line, "Quran data provided by Quran Foundation (https://quran.foundation/)",
 * together with the name of each translation edition we use, on a page viewers can easily reach
 * (https://api-docs.quran.foundation/docs/tutorials/faq#what-attribution-or-copyright-information-should-i-show).
 * The editions are never hand-typed: they are the ones translated caption tracks can show right now,
 * the shipped defaults, the platform's pick per language (admin) and every channel's own pick, each
 * named and credited to its translator as QF's catalogue gives them (the stored name while QF can't
 * be reached).
 */
import { z } from 'zod';
import { DEFAULT_QURAN_TRANSLATIONS, QURAN_ATTRIBUTION, QURAN_CREDIT, QURAN_FOUNDATION_URL, type QuranTranslationEdition } from '@al-ummah/shared-types';
import { PublicRoute, type AppContext } from '../../base';
import { listTranslationEditions } from '../../lib/quran/translations';
import { quranEditionsConfigured, quranTextAvailable } from '../../lib/features';
import { featureOff } from '../../lib/features/off';
import { logger } from '../../lib/logger';

const Edition = z.object({
	id: z.number().describe('QF translation resource id'),
	name: z.string().describe("The edition's name, as QF gives it"),
	author: z.string().optional().describe('The translator, as QF gives it'),
	language: z.string().describe('ISO 639-1'),
});

export const QuranCreditsBody = z.object({
	success: z.literal(true),
	data: z.object({
		attribution: z.object({ en: z.string(), ar: z.string() }),
		credit: z.object({ en: z.string(), ar: z.string(), url: z.string() }),
		/** The official Arabic text shown in captions comes from our Content Sync copy */
		quranText: z.boolean(),
		editions: z.array(Edition),
	}),
});

interface Row {
	lang: string;
	qf_translation_id: number;
	name: string;
}

/**
 * Every edition a translated track can show: the shipped defaults, the platform's picks and the
 * channels' picks, one entry per QF id, ordered by language then name. `catalogue` (QF's list)
 * supplies the name and translator; without it the stored name stands.
 */
export function editionsInUse(rows: Row[], catalogue: QuranTranslationEdition[] | null): QuranTranslationEdition[] {
	const byId = new Map<number, QuranTranslationEdition>();
	for (const e of Object.values(DEFAULT_QURAN_TRANSLATIONS)) byId.set(e.id, { ...e });
	for (const r of rows) {
		const id = Number(r.qf_translation_id);
		if (!byId.has(id)) byId.set(id, { id, name: r.name, language: r.lang });
	}
	const fromQf = new Map((catalogue ?? []).map((e) => [e.id, e]));
	return [...byId.values()]
		.map((e) => {
			const qf = fromQf.get(e.id);
			const author = qf?.author || e.author;
			return { id: e.id, name: qf?.name || e.name, ...(author ? { author } : {}), language: e.language };
		})
		.sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name) || a.id - b.id);
}

export class QuranCreditsGet extends PublicRoute {
	schema = {
		tags: ['Quran'],
		summary: 'Quran credits',
		description:
			"🌐 Public. Quran Foundation's attribution and short credit, and every translation edition translated caption tracks can show (the shipped defaults, the platform's and the channels' picks), named as QF's catalogue gives them. 404 `feature_off` when no Quran text from QF is shown here.",
		responses: {
			'200': { description: 'Credits', content: { 'application/json': { schema: QuranCreditsBody } } },
			'404': { description: 'No Quran text from Quran Foundation on this site (feature_off)' },
		},
	};

	async handle(c: AppContext) {
		const env = c.env as never;
		const [text, editionsOn] = await Promise.all([quranTextAvailable(env), quranEditionsConfigured(env)]);
		if (!text && !editionsOn) return featureOff(c);
		let editions: QuranTranslationEdition[] = [];
		if (editionsOn) {
			let rows: Row[] = [];
			try {
				// Both tables are small (one row per language, and per channel that picked one), keyed by
				// language or channel: DISTINCT reads them once each
				const d1 = c.env.SEARCH_DB as D1Database;
				const [platform, channels] = await Promise.all([
					d1.prepare('SELECT lang, qf_translation_id, name FROM quran_translation_defaults').all<Row>(),
					d1.prepare('SELECT DISTINCT lang, qf_translation_id, name FROM channel_quran_translations').all<Row>(),
				]);
				rows = [...(platform.results ?? []), ...(channels.results ?? [])];
			} catch (error) {
				logger.warn('[Quran] Credits: edition picks unreadable; listing the defaults', { error: error instanceof Error ? error.message : String(error) });
			}
			const catalogue = await listTranslationEditions(env).catch(() => null);
			editions = editionsInUse(rows, catalogue);
		}
		return c.json(
			{
				success: true as const,
				data: {
					attribution: { ...QURAN_ATTRIBUTION },
					credit: { ...QURAN_CREDIT, url: QURAN_FOUNDATION_URL },
					quranText: text,
					editions,
				},
			},
			200,
			{ 'Cache-Control': 'public, max-age=3600' },
		);
	}
}
