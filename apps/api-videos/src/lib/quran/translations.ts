/**
 * Quran translations for translated caption tracks (AUN-CAPTIONS §5.7, O7, O13).
 *
 * - Quran is never machine-translated. An accepted span of a translated track shows the official
 *   translation of a Quran Foundation `translations` edition, fetched live when the track is served.
 * - The edition is the channel's pick for the language (Studio → Settings), else the platform's
 *   (admin), else the shipped default (Saheeh International for English). A language with no
 *   edition shows the Arabic text from our Content Sync copy.
 * - Responses are kept only in the edge cache, for at most 6 days (QF Developer Terms: no storage
 *   beyond a week outside Content Sync); never in R2 or D1. QF unreachable → the reference with a
 *   quran.com link.
 * - OAuth2 client credentials, granular scopes, one token per isolate renewed early, one retry on 401.
 *   Tests and E2E never call the real QF: they pass `fetchImpl`; the client refuses otherwise.
 */
import { DEFAULT_QURAN_TRANSLATIONS, cleanQfTranslation, type QuranTranslationEdition } from '@al-ummah/shared-types';
import { logger } from '../logger';

type SecretBinding = string | { get(): Promise<string> } | undefined;

export interface QfTranslationEnv {
	QF_CLIENT_ID?: SecretBinding;
	QF_CLIENT_SECRET?: SecretBinding;
	QF_OAUTH_HOST?: string;
	QF_API_HOST?: string;
	SEARCH_DB?: unknown;
	/** "fixture": the local stack and E2E serve fixture translations, never QF */
	QURAN_PROVIDER?: string;
	NODE_ENV?: string;
	CI?: string;
	E2E_ENV?: string;
}

export const QF_SCOPES = 'content.quran.read content.translations.read content.metadata.read';
/** Edge cache of a fetched translation: under the 7-day limit. */
export const QF_CACHE_SECONDS = 6 * 24 * 3600;
/** Most ayat fetched for one span (a longer span shows the reference). */
const MAX_AYAT_PER_SPAN = 20;

async function secret(b: SecretBinding): Promise<string> {
	if (!b) return '';
	return typeof b === 'string' ? b : ((await b.get()) ?? '');
}

const under = (e: Pick<QfTranslationEnv, 'NODE_ENV' | 'CI' | 'E2E_ENV'>) => e.NODE_ENV === 'test' || e.CI === 'true' || !!e.E2E_ENV;

// Only the settled token is shared: a pending fetch belongs to the request that started it
// (Workers' handle_cross_request_promise_resolution), so concurrent requests each fetch one.
let token: { value: string; until: number } | null = null;

/** Drops the cached token (tests). */
export function resetQfToken(): void {
	token = null;
}

async function getToken(env: QfTranslationEnv, f: typeof fetch, force: boolean): Promise<string> {
	if (!force && token && token.until > Date.now()) return token.value;
	return (async () => {
		const id = await secret(env.QF_CLIENT_ID);
		const key = await secret(env.QF_CLIENT_SECRET);
		if (!id || !key) throw new Error('QF credentials are not bound');
		const host = (env.QF_OAUTH_HOST || 'https://oauth2.quran.foundation').replace(/\/$/, '');
		const res = await f(`${host}/oauth2/token`, {
			method: 'POST',
			headers: { authorization: `Basic ${btoa(`${id}:${key}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
			body: `grant_type=client_credentials&scope=${encodeURIComponent(QF_SCOPES)}`,
		});
		if (!res.ok) throw new Error(`QF token: ${res.status}`);
		const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
		if (!body?.access_token) throw new Error('QF token response had no access_token');
		// Renew 10 minutes early
		const life = Math.max(60, (body.expires_in ?? 3600) - 600) * 1000;
		token = { value: body.access_token, until: Date.now() + life };
		return token.value;
	})();
}

/** GET a Content API path; JSON or null when QF can't answer (logged once per call). */
export async function qfGet<T>(env: QfTranslationEnv, path: string, fetchImpl?: typeof fetch): Promise<T | null> {
	if (!fetchImpl && under(env)) throw new Error('[Quran] Refusing to call Quran Foundation from a test, CI or E2E run: pass a fixture fetch');
	const f = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
	const base = `${(env.QF_API_HOST || 'https://apis.quran.foundation').replace(/\/$/, '')}/content`;
	try {
		const id = await secret(env.QF_CLIENT_ID);
		const send = async (force: boolean) => f(`${base}${path}`, { headers: { 'x-auth-token': await getToken(env, f, force), 'x-client-id': id, accept: 'application/json' } });
		let res = await send(false);
		if (res.status === 401) res = await send(true);
		if (!res.ok) {
			logger.warn('[Quran] QF answered an error', { path: path.split('?')[0], status: res.status });
			return null;
		}
		return (await res.json()) as T;
	} catch (error) {
		logger.warn('[Quran] QF unreachable', { path: path.split('?')[0], error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}

interface EdgeCache {
	match(key: Request): Promise<Response | undefined>;
	put(key: Request, value: Response): Promise<void>;
}
const edgeCache = (): EdgeCache | null => (globalThis as { caches?: { default?: EdgeCache } }).caches?.default ?? null;

async function cached<T>(key: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
	const cache = edgeCache();
	const req = new Request(`https://qf-cache.internal/${key}`);
	if (cache) {
		const hit = await cache.match(req).catch(() => undefined);
		if (hit) return (await hit.json()) as T;
	}
	const value = await load();
	if (value !== null && cache) {
		await cache.put(req, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': `public, s-maxage=${ttl}` } })).catch(() => undefined);
	}
	return value;
}

// ---------------------------------------------------------------------------
// Fixture (local stack, E2E): deterministic text, labelled as a fixture
// ---------------------------------------------------------------------------

const fixtureMode = (env: QfTranslationEnv) => env.QURAN_PROVIDER === 'fixture';

export const FIXTURE_EDITIONS: QuranTranslationEdition[] = [
	{ id: 20, name: 'Saheeh International', author: 'Saheeh International', language: 'en' },
	{ id: 85, name: 'M.A.S. Abdel Haleem', author: 'Abdel Haleem', language: 'en' },
	{ id: 31, name: 'Muhammad Hamidullah', author: 'Hamidullah', language: 'fr' },
];

// ---------------------------------------------------------------------------
// Editions
// ---------------------------------------------------------------------------

/** QF's translation editions, optionally for one language (cached a day). */
export async function listTranslationEditions(env: QfTranslationEnv, language?: string, fetchImpl?: typeof fetch): Promise<QuranTranslationEdition[] | null> {
	if (fixtureMode(env)) return FIXTURE_EDITIONS.filter((e) => !language || e.language === language);
	const all = await cached('translations-list', 24 * 3600, async () => {
		const body = await qfGet<{ translations?: Array<{ id: number; name: string; author_name?: string; language_name?: string; translated_name?: { name?: string } }> }>(
			env,
			'/api/v4/resources/translations',
			fetchImpl,
		);
		if (!body?.translations) return null;
		return body.translations.map((t) => ({ id: t.id, name: t.translated_name?.name || t.name, author: t.author_name, language: languageCode(t.language_name ?? '') }));
	});
	return all ? all.filter((e) => !language || e.language === language) : null;
}

/** QF lists languages by English name; ours are ISO 639-1. */
const LANGUAGE_BY_NAME: Record<string, string> = {
	english: 'en', french: 'fr', spanish: 'es', german: 'de', turkish: 'tr', urdu: 'ur', indonesian: 'id', malay: 'ms', persian: 'fa', bengali: 'bn',
	russian: 'ru', chinese: 'zh', hindi: 'hi', italian: 'it', portuguese: 'pt', dutch: 'nl', swahili: 'sw', somali: 'so', hausa: 'ha', pashto: 'ps',
	kurdish: 'ku', bosnian: 'bs', albanian: 'sq', japanese: 'ja', korean: 'ko', arabic: 'ar',
};
export const languageCode = (name: string) => LANGUAGE_BY_NAME[name.trim().toLowerCase()] ?? name.trim().toLowerCase().slice(0, 12);

interface EditionRow {
	qf_translation_id: number;
	name: string;
}

/** The edition a track of `language` uses: the channel's, else the platform's, else the shipped default; null = none. */
export async function editionFor(env: QfTranslationEnv, channelId: string | null | undefined, language: string): Promise<QuranTranslationEdition | null> {
	const lang = language.split('-')[0]!.toLowerCase();
	const db = env.SEARCH_DB as D1Database | undefined;
	if (db) {
		try {
			if (channelId) {
				const own = await db.prepare('SELECT qf_translation_id, name FROM channel_quran_translations WHERE channel_id = ? AND lang = ?').bind(channelId, lang).first<EditionRow>();
				if (own) return { id: Number(own.qf_translation_id), name: own.name, language: lang };
			}
			const platform = await db.prepare('SELECT qf_translation_id, name FROM quran_translation_defaults WHERE lang = ?').bind(lang).first<EditionRow>();
			if (platform) return { id: Number(platform.qf_translation_id), name: platform.name, language: lang };
		} catch (error) {
			logger.warn('[Quran] Edition lookup failed; using the default', { lang, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return DEFAULT_QURAN_TRANSLATIONS[lang] ?? null;
}

// ---------------------------------------------------------------------------
// Ayah translations
// ---------------------------------------------------------------------------

/** The translation of one ayah in an edition (edge-cached ≤ 6 days); null when QF can't answer. */
export async function ayahTranslation(env: QfTranslationEnv, editionId: number, surah: number, ayah: number, fetchImpl?: typeof fetch): Promise<string | null> {
	if (fixtureMode(env)) return `[fixture translation ${editionId} of ${surah}:${ayah}]`;
	return cached(`tr/${editionId}/${surah}:${ayah}`, QF_CACHE_SECONDS, async () => {
		const body = await qfGet<{ verse?: { translations?: Array<{ resource_id?: number; text?: string }> } }>(env, `/api/v4/verses/by_key/${surah}:${ayah}?translations=${editionId}&fields=verse_key`, fetchImpl);
		const text = body?.verse?.translations?.find((t) => t.text)?.text;
		return text ? cleanQfTranslation(text) : null;
	});
}

/** Every ayah of a span from `start` to `end` (one surah), joined; null when any is missing or the span is too long. */
export async function spanTranslation(env: QfTranslationEnv, editionId: number, surah: number, ayahStart: number, ayahEnd: number, fetchImpl?: typeof fetch): Promise<string | null> {
	if (ayahEnd < ayahStart || ayahEnd - ayahStart + 1 > MAX_AYAT_PER_SPAN) return null;
	const parts: string[] = [];
	for (let a = ayahStart; a <= ayahEnd; a++) {
		const text = await ayahTranslation(env, editionId, surah, a, fetchImpl);
		if (!text) return null;
		parts.push(text);
	}
	return parts.join(' ');
}
