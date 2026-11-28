/**
 * Inline title/description translation (AUN-CAPTIONS §5.8, #810) and viewer-side translated
 * titles (§5.9, O6). api-videos owns the request: the admin kill switch, the per-user daily
 * fair-use limit (O5), the edge cache, the audit row and the day's budget share; the processor runs
 * the model (POST /internal/translate over the PROCESSOR service binding) and keeps the AI budget
 * ledger, where a spent inline budget is refused (the $20/month backstop).
 *
 * Cache hits don't count against the fair-use limit. The texts are never stored or logged: the
 * audit keeps who, which languages, how many texts and characters, and the provider.
 */
import {
	INLINE_TRANSLATE_LIMITS,
	MessageType,
	guessTitleLanguage,
	type InlineTranslateField,
	type InlineTranslateItem,
	type InlineTranslateResultItem,
	type InternalTranslateResponse,
	type MetadataTranslatePayload,
	type VideoObject,
} from '@al-ummah/shared-types';
import { z } from 'zod';
import { logger } from '../logger';
import { readCaptionSettings, translationProviderFor, type CaptionJobsEnv, type CaptionSettings } from '../captions/jobs';

export interface InlineTranslateEnv extends CaptionJobsEnv {
	PROCESSOR?: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
}

export class TranslateHttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		readonly extra: Record<string, unknown> = {},
	) {
		super(code);
	}
}

const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;
/** The languages the site is shown in: viewer-side titles are made only for these (§5.9) */
export const VIEWER_TITLE_LANGUAGES = new Set(['en', 'ar']);
/** Bumped when the prompt or the Quran handling changes, so old cached answers are not served. */
const CACHE_VERSION = 'v1';
const CACHE_SECONDS = 30 * 24 * 3600;

export const db = (env: CaptionJobsEnv) => {
	if (!env.SEARCH_DB) throw new TranslateHttpError(503, 'unavailable');
	return env.SEARCH_DB as D1Database;
};

export const utcDay = (now: Date) => now.toISOString().slice(0, 10);
export const nextUtcMidnight = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The day's share of the monthly inline budget (the processor refuses past it). */
export const dailyInlineBudgetUsd = (settings: CaptionSettings) => Math.round((settings.inline.monthlyBudgetUsd / 30) * 10_000) / 10_000;

async function deeplBound(env: CaptionJobsEnv): Promise<boolean> {
	const v = env.AI_KEY_DEEPL as string | { get(): Promise<string> } | undefined;
	if (!v) return false;
	return !!(typeof v === 'string' ? v : await v.get().catch(() => ''));
}

// ---------------------------------------------------------------------------
// Edge cache (Workers caches.default; absent under node tests)
// ---------------------------------------------------------------------------

interface EdgeCache {
	match(key: string): Promise<Response | undefined>;
	put(key: string, response: Response): Promise<void>;
}
const edgeCache = (): EdgeCache | null => {
	const c = (globalThis as { caches?: { default?: EdgeCache } }).caches;
	return c?.default ?? null;
};
/**
 * Everything that shapes the prompt is in the key (field and context, e.g. the video's title), so an
 * answer made with one creator's context is never served to another request.
 */
export const cacheKey = async (from: string, to: string, provider: string, field: string, context: string, text: string) =>
	`https://translate.cache.internal/${CACHE_VERSION}/${from}/${to}/${provider}/${field}/${await sha256Hex(context)}/${await sha256Hex(text)}`;

export async function cached(keys: string[]): Promise<Array<{ text: string; quran?: Array<{ range: string; label: string }> } | null>> {
	const cache = edgeCache();
	if (!cache) return keys.map(() => null);
	return Promise.all(
		keys.map(async (k) => {
			try {
				const hit = await cache.match(k);
				return hit ? ((await hit.json()) as { text: string; quran?: Array<{ range: string; label: string }> }) : null;
			} catch {
				return null;
			}
		}),
	);
}

export async function remember(key: string, value: { text: string; quran?: Array<{ range: string; label: string }> }): Promise<void> {
	const cache = edgeCache();
	if (!cache) return;
	try {
		await cache.put(key, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${CACHE_SECONDS}` } }));
	} catch (error) {
		logger.debug('[Translate] Cache write failed', { error: error instanceof Error ? error.message : String(error) });
	}
}

// ---------------------------------------------------------------------------
// Fair use (O5)
// ---------------------------------------------------------------------------

export interface FairUse {
	used: number;
	limit: number;
	resetsAt: string;
}

export async function readFairUse(env: CaptionJobsEnv, userId: string, settings: CaptionSettings, now = new Date()): Promise<FairUse> {
	const row = await db(env).prepare('SELECT items FROM inline_translation_usage WHERE user_id = ? AND day = ?').bind(userId, utcDay(now)).first<{ items: number }>();
	return { used: Number(row?.items ?? 0), limit: settings.inline.dailyItems, resetsAt: nextUtcMidnight(now) };
}

/** Takes `n` texts from today's allowance, all or nothing; false when they don't fit. */
export async function takeFairUse(env: CaptionJobsEnv, userId: string, n: number, limit: number, now: Date): Promise<boolean> {
	if (n > limit) return false;
	const day = utcDay(now);
	const d1 = db(env);
	const result = await d1
		.prepare(
			`INSERT INTO inline_translation_usage (user_id, day, items) VALUES (?, ?, ?)
			 ON CONFLICT (user_id, day) DO UPDATE SET items = items + excluded.items WHERE items + excluded.items <= ?`,
		)
		.bind(userId, day, n, limit)
		.run();
	// Earlier days of this user are no longer needed (keyed by user: never a scan)
	await d1.prepare('DELETE FROM inline_translation_usage WHERE user_id = ? AND day < ?').bind(userId, day).run();
	return (result.meta?.changes ?? 0) > 0;
}

export async function giveBackFairUse(env: CaptionJobsEnv, userId: string, n: number, now: Date): Promise<void> {
	await db(env).prepare('UPDATE inline_translation_usage SET items = MAX(0, items - ?) WHERE user_id = ? AND day = ?').bind(n, userId, utcDay(now)).run();
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function auditTranslation(
	env: CaptionJobsEnv,
	row: { userId: string; kind: 'inline' | 'caption' | 'viewer'; videoId?: string | null; field?: string | null; from: string; to: string; items: number; chars: number; provider: string; model: string; cached: boolean },
	now = new Date(),
): Promise<void> {
	await db(env)
		.prepare(
			'INSERT INTO translation_audit (id, at, user_id, kind, video_id, field, from_lang, to_lang, items, chars, provider, model, cached) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
		)
		.bind(crypto.randomUUID(), now.toISOString(), row.userId, row.kind, row.videoId ?? null, row.field ?? null, row.from, row.to, row.items, row.chars, row.provider, row.model, row.cached ? 1 : 0)
		.run();
}

// ---------------------------------------------------------------------------
// The processor
// ---------------------------------------------------------------------------

async function apiKey(env: CaptionJobsEnv): Promise<string> {
	const v = env.INTERNAL_API_KEY as string | { get(): Promise<string> } | undefined;
	return typeof v === 'string' ? v : ((await v?.get()) ?? '');
}

const TranslateAnswer = z.object({
	items: z.array(z.object({
		id: z.string().min(1).max(80),
		text: z.string().max(INLINE_TRANSLATE_LIMITS.textChars * 4),
		quran: z.array(z.object({ range: z.string().max(40), label: z.string().max(80) })).max(500).optional(),
		refused: z.literal('quran').optional(),
	})).max(INLINE_TRANSLATE_LIMITS.texts),
	provider: z.enum(['workers-ai', 'deepl']),
	model: z.string().min(1).max(256),
	usd: z.number().nonnegative(),
});

export async function callProcessor(
	env: InlineTranslateEnv,
	body: { items: InlineTranslateItem[]; from: string; to: string; field: InlineTranslateField; provider: 'workers-ai' | 'deepl'; dailyBudgetUsd: number; context?: { title?: string; channel?: string }; mode?: 'admin_field' },
): Promise<InternalTranslateResponse> {
	if (!env.PROCESSOR) throw new TranslateHttpError(503, 'unavailable');
	const res = await env.PROCESSOR.fetch('https://processor.internal/internal/translate', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'X-API-Key': await apiKey(env) },
		body: JSON.stringify({ ...body, feature: 'inline_translate' }),
	});
	if (res.status === 503) {
		const answer = (await res.json().catch(() => null)) as { error?: string } | null;
		throw new TranslateHttpError(503, answer?.error === 'budget_spent' ? 'budget_spent' : 'unavailable');
	}
	if (!res.ok) throw new TranslateHttpError(502, 'translation_failed');
	const parsed = TranslateAnswer.safeParse(await res.json().catch(() => null));
	if (!parsed.success) throw new TranslateHttpError(502, 'translation_failed');
	const requestedIds = new Set(body.items.map(({ id }) => id));
	if (!parsed.data.items.every(({ id }) => requestedIds.delete(id))) throw new TranslateHttpError(502, 'translation_failed');
	return parsed.data;
}

// ---------------------------------------------------------------------------
// Inline translation (the Translate button)
// ---------------------------------------------------------------------------

export interface InlineTranslateInput {
	userId: string;
	items: InlineTranslateItem[];
	from: string;
	to: string;
	field: InlineTranslateField;
	videoId?: string | null;
	context?: { title?: string; channel?: string };
}

export interface InlineTranslateResult {
	items: InlineTranslateResultItem[];
	provider: string;
	fairUse: FairUse;
}

export function validateInline(input: Pick<InlineTranslateInput, 'items' | 'from' | 'to'>): void {
	if (!LANGUAGE.test(input.from) || !LANGUAGE.test(input.to)) throw new TranslateHttpError(400, 'invalid_language');
	if (input.from === input.to) throw new TranslateHttpError(400, 'same_language');
	if (!input.items.length || input.items.length > INLINE_TRANSLATE_LIMITS.texts) throw new TranslateHttpError(400, 'too_many_texts', { max: INLINE_TRANSLATE_LIMITS.texts });
	const ids = new Set<string>();
	let chars = 0;
	for (const i of input.items) {
		if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(i.id) || ids.has(i.id)) throw new TranslateHttpError(400, 'invalid_id');
		ids.add(i.id);
		if (i.text.length > INLINE_TRANSLATE_LIMITS.textChars) throw new TranslateHttpError(400, 'text_too_long', { max: INLINE_TRANSLATE_LIMITS.textChars });
		chars += i.text.length;
	}
	if (chars > INLINE_TRANSLATE_LIMITS.chars) throw new TranslateHttpError(400, 'too_much_text', { max: INLINE_TRANSLATE_LIMITS.chars });
}

export async function translateInline(env: InlineTranslateEnv, input: InlineTranslateInput, now = new Date()): Promise<InlineTranslateResult> {
	validateInline(input);
	const settings = await readCaptionSettings(env);
	if (!settings.inline.enabled) throw new TranslateHttpError(503, 'translation_paused');
	const provider = translationProviderFor(settings, input.to, await deeplBound(env));

	// Empty texts come back empty; the rest from the cache, then the model
	const texts = input.items.filter((i) => i.text.trim());
	const contextKey = JSON.stringify([input.context?.title ?? '', input.context?.channel ?? '']);
	const keys = await Promise.all(texts.map((i) => cacheKey(input.from, input.to, provider, input.field, contextKey, i.text)));
	const hits = await cached(keys);
	const misses = texts.filter((_, n) => !hits[n]);
	const results = new Map<string, InlineTranslateResultItem>();
	texts.forEach((i, n) => {
		const hit = hits[n];
		if (hit) results.set(i.id, { id: i.id, text: hit.text, ...(hit.quran ? { quran: hit.quran } : {}), cached: true });
	});

	let usedProvider = misses.length ? provider : 'cache';
	let model = 'cache';
	if (misses.length) {
		if (!(await takeFairUse(env, input.userId, misses.length, settings.inline.dailyItems, now))) {
			const fairUse = await readFairUse(env, input.userId, settings, now);
			throw new TranslateHttpError(429, 'fair_use_limit', { limit: fairUse.limit, used: fairUse.used, resetsAt: fairUse.resetsAt });
		}
		let answer: InternalTranslateResponse;
		try {
			answer = await callProcessor(env, {
				items: misses.map(({ id, text }) => ({ id, text })),
				from: input.from,
				to: input.to,
				field: input.field,
				provider,
				dailyBudgetUsd: dailyInlineBudgetUsd(settings),
				...(input.context ? { context: input.context } : {}),
			});
		} catch (error) {
			await giveBackFairUse(env, input.userId, misses.length, now);
			throw error;
		}
		usedProvider = answer.provider;
		model = answer.model;
		const byId = new Map(answer.items.map((a) => [a.id, a]));
		await Promise.all(
			misses.map(async (m) => {
				const a = byId.get(m.id);
				if (!a) return;
				results.set(m.id, { id: m.id, text: a.text, ...(a.quran ? { quran: a.quran } : {}), cached: false });
				await remember(keys[texts.indexOf(m)]!, { text: a.text, ...(a.quran ? { quran: a.quran } : {}) });
			}),
		);
	}

	await auditTranslation(
		env,
		{
			userId: input.userId,
			kind: 'inline',
			videoId: input.videoId ?? null,
			field: input.field,
			from: input.from,
			to: input.to,
			items: input.items.length,
			chars: input.items.reduce((n, i) => n + i.text.length, 0),
			provider: usedProvider,
			model,
			cached: misses.length === 0,
		},
		now,
	);
	return {
		items: input.items.map((i) => results.get(i.id) ?? { id: i.id, text: '', cached: false }),
		provider: usedProvider,
		fairUse: await readFairUse(env, input.userId, settings, now),
	};
}

// ---------------------------------------------------------------------------
// Viewer-side titles (§5.9, O6): admin switch (on by default until the owner decides), per-channel opt-out
// ---------------------------------------------------------------------------

export interface ViewerTranslationEnv extends InlineTranslateEnv {
	queue?: { send(message: unknown, options?: { delaySeconds?: number }): Promise<unknown> };
}

export interface ViewerTranslation {
	lang: string;
	from: string;
	title: string;
	description: string | null;
	provider: string;
}

const sourceHash = (video: Pick<VideoObject, 'title' | 'description'>) => sha256Hex(`${video.title ?? ''}\u0000${video.description ?? ''}`);

export async function channelAllowsViewerTitles(env: CaptionJobsEnv, channelId: string | null | undefined): Promise<boolean> {
	if (!channelId) return true;
	const row = await db(env).prepare('SELECT viewer_titles FROM channel_translation_settings WHERE channel_id = ?').bind(channelId).first<{ viewer_titles: number }>();
	return !row || row.viewer_titles === 1;
}

export async function setChannelViewerTitles(env: CaptionJobsEnv, channelId: string, allowed: boolean, userId: string, now = new Date()): Promise<void> {
	await db(env)
		.prepare(
			`INSERT INTO channel_translation_settings (channel_id, viewer_titles, updated_by, updated_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT (channel_id) DO UPDATE SET viewer_titles = excluded.viewer_titles, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
		)
		.bind(channelId, allowed ? 1 : 0, userId, now.toISOString())
		.run();
}

const hasCreatorText = (video: VideoObject, lang: string) => {
	const localized = (video as { titleLocalized?: Record<string, string | undefined> }).titleLocalized;
	return !!localized?.[lang]?.trim();
};

/**
 * The machine translation of a public video's title and description for a viewer of `lang`, or
 * null. Off (null) while the admin switch is off, when the channel opted out, when the creator
 * wrote a title in that language, or when the title is already in it. A missing or stale
 * translation is queued (the viewer sees the original meanwhile): `pending`.
 */
export async function viewerTranslation(env: ViewerTranslationEnv, video: VideoObject, wanted: string, now = new Date()): Promise<{ translation: ViewerTranslation | null; pending: boolean }> {
	const none = { translation: null, pending: false };
	// Only the site's own languages: a public, anonymous route must not queue one job per language code
	const lang = wanted.split('-')[0]!.toLowerCase();
	if (!VIEWER_TITLE_LANGUAGES.has(lang) || !video.title?.trim()) return none;
	const settings = await readCaptionSettings(env);
	if (!settings.viewerTitles.enabled || !settings.inline.enabled) return none;
	if (hasCreatorText(video, lang)) return none;
	const from = guessTitleLanguage(video.title);
	if (from === lang.split('-')[0]) return none;
	if (!(await channelAllowsViewerTitles(env, video.channelId))) return none;
	const hash = await sourceHash(video);
	const row = await db(env)
		.prepare('SELECT title, description, provider, source_hash FROM metadata_translations WHERE video_id = ? AND lang = ?')
		.bind(video.id, lang)
		.first<{ title: string; description: string | null; provider: string; source_hash: string }>();
	if (row && row.source_hash === hash) return { translation: { lang, from, title: row.title, description: row.description, provider: row.provider }, pending: false };

	// Queued once per video, language and source text for a while (edge marker), never per view
	const marker = `https://translate.cache.internal/pending/${video.id}/${lang}/${hash}`;
	const cache = edgeCache();
	if (cache && (await cache.match(marker).catch(() => undefined))) return { translation: null, pending: true };
	if (!env.queue) return none;
	const payload: MetadataTranslatePayload = {
		videoId: video.id,
		lang,
		from,
		sourceHash: hash,
		title: video.title.slice(0, 1000),
		...(video.description?.trim() ? { description: video.description.slice(0, INLINE_TRANSLATE_LIMITS.textChars) } : {}),
		dailyBudgetUsd: dailyInlineBudgetUsd(settings),
		requestedAt: now.toISOString(),
	};
	await env.queue.send({ id: crypto.randomUUID(), type: MessageType.MetadataTranslate, payload, timestamp: now.getTime() });
	if (cache) await cache.put(marker, new Response('1', { headers: { 'cache-control': 'max-age=900' } })).catch(() => undefined);
	return { translation: null, pending: true };
}

/** The processor's answer for a viewer translation (internal). 409 when the video changed meanwhile. */
export async function saveViewerTranslation(
	env: CaptionJobsEnv,
	video: VideoObject,
	body: { lang: string; sourceHash: string; title: string; description: string | null; provider: string; model: string },
	now = new Date(),
): Promise<void> {
	if (!LANGUAGE.test(body.lang) || !body.title.trim()) throw new TranslateHttpError(400, 'invalid');
	if ((await sourceHash(video)) !== body.sourceHash) throw new TranslateHttpError(409, 'source_changed');
	await db(env)
		.prepare(
			`INSERT INTO metadata_translations (video_id, lang, source_hash, title, description, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (video_id, lang) DO UPDATE SET source_hash = excluded.source_hash, title = excluded.title, description = excluded.description, provider = excluded.provider, model = excluded.model, created_at = excluded.created_at`,
		)
		.bind(video.id, body.lang, body.sourceHash, body.title.slice(0, 1000), body.description?.slice(0, INLINE_TRANSLATE_LIMITS.textChars) ?? null, body.provider.slice(0, 40), body.model.slice(0, 120), now.toISOString())
		.run();
	await auditTranslation(
		env,
		{ userId: 'system', kind: 'viewer', videoId: video.id, field: 'title', from: guessTitleLanguage(video.title ?? ''), to: body.lang, items: body.description ? 2 : 1, chars: (video.title?.length ?? 0) + (video.description?.length ?? 0), provider: body.provider, model: body.model, cached: false },
		now,
	);
}

/** A video's viewer translations go with it (purge, erasure). */
export async function deleteViewerTranslations(env: CaptionJobsEnv, videoId: string): Promise<void> {
	if (!env.SEARCH_DB) return;
	await db(env).prepare('DELETE FROM metadata_translations WHERE video_id = ?').bind(videoId).run();
}
