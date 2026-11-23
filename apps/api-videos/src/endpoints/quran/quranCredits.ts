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
import { DEFAULT_QURAN_TRANSLATIONS, QURAN_ATTRIBUTION, QURAN_CREDIT, QURAN_FOUNDATION_URL, featureGate, type QuranTranslationEdition } from '@al-ummah/shared-types';
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

interface EdgeCache {
	match(key: Request): Promise<Response | undefined>;
	put(key: Request, value: Response): Promise<void>;
	delete(key: Request): Promise<boolean>;
}

const edgeCache = (): EdgeCache | null => (globalThis as { caches?: { default?: EdgeCache } }).caches?.default ?? null;
const CREDITS_ROWS_CACHE_URL = 'https://qf-cache.internal/quran-credits-rows';
const CREDITS_ROWS_EDGE_TTL_S = 3600;
const CREDITS_ROWS_ISOLATE_TTL_MS = 5 * 60_000;

// Settled per-isolate cache keyed by D1 instance so concurrent/test DBs never share stale rows
let isolateRowsCache: { db: D1Database; at: number; rows: Row[] } | null = null;

/**
 * Drops the cached edition picks in this isolate and the local colo's Cache API entry after a
 * channel or platform translation changes (and in tests).
 * Freshness bound: writing isolate / local colo immediately, other isolates in the same colo
 * within 5 minutes (CREDITS_ROWS_ISOLATE_TTL_MS), and other colos within 1 hour
 * (CREDITS_ROWS_EDGE_TTL_S, matching the endpoint's public Cache-Control: max-age=3600).
 */
export async function invalidateQuranCreditsCache(): Promise<void> {
	isolateRowsCache = null;
	const cache = edgeCache();
	if (cache) await cache.delete(new Request(CREDITS_ROWS_CACHE_URL)).catch(() => undefined);
}

async function readEditionRows(d1: D1Database, now = Date.now()): Promise<Row[]> {
	if (isolateRowsCache && isolateRowsCache.db === d1 && now - isolateRowsCache.at < CREDITS_ROWS_ISOLATE_TTL_MS) {
		return isolateRowsCache.rows;
	}
	const cache = edgeCache();
	const req = cache ? new Request(CREDITS_ROWS_CACHE_URL) : null;
	if (cache && req) {
		const hit = await cache.match(req).catch(() => undefined);
		if (hit) {
			const cached = (await hit.json().catch(() => null)) as Row[] | null;
			if (Array.isArray(cached)) {
				isolateRowsCache = { db: d1, at: now, rows: cached };
				return cached;
			}
		}
	}
	// channel_quran_translations is covered by idx_channel_quran_translations_edition (lang, qf_translation_id, name)
	const [platform, channels] = await Promise.all([
		d1.prepare('SELECT lang, qf_translation_id, name FROM quran_translation_defaults').all<Row>(),
		d1.prepare('SELECT DISTINCT lang, qf_translation_id, name FROM channel_quran_translations').all<Row>(),
	]);
	const rows = [...(platform.results ?? []), ...(channels.results ?? [])];
	isolateRowsCache = { db: d1, at: now, rows };
	if (cache && req) {
		await cache
			.put(req, new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json', 'cache-control': `public, s-maxage=${CREDITS_ROWS_EDGE_TTL_S}` } }))
			.catch(() => undefined);
	}
	return rows;
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
		const [text, editionsConfigured, editionsGate] = await Promise.all([
			quranTextAvailable(env),
			quranEditionsConfigured(env),
			featureGate(env, 'quranEditions').catch(() => ({ on: true as const })),
		]);
		const editionsOn = editionsConfigured && editionsGate.on;
		if (!text && !editionsOn) return featureOff(c);
		let editions: QuranTranslationEdition[] = [];
		if (editionsOn) {
			let rows: Row[] = [];
			try {
				rows = await readEditionRows(c.env.SEARCH_DB as D1Database);
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
