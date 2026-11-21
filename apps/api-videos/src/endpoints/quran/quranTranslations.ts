/**
 * Quran translation editions (AUN-CAPTIONS O7): which Quran Foundation translation a channel's
 * translated caption tracks show, per language.
 *
 *   GET    /api/quran/translations?language=en                  QF editions (public; the pickers)
 *   GET    /api/channels/:channelId/quran-translations           the channel's edition per language and where it comes from
 *   PUT    /api/channels/:channelId/quran-translations/:language { id }  pick an edition (channel.edit)
 *   DELETE /api/channels/:channelId/quran-translations/:language         back to the platform's
 */
import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import { DEFAULT_QURAN_TRANSLATIONS, can, channelRoleOf } from '@al-ummah/shared-types';
import { AuthenticatedRoute, PublicRoute, type AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { loadChannelRecord } from '../../lib/channelAccess';
import { SubtitleService } from '../../lib/subtitles';
import { listTranslationEditions } from '../../lib/quran/translations';
import { logger } from '../../lib/logger';
import { featureOff } from '../../lib/features/off';
import { quranEditionsConfigured } from '../../lib/features';
const Edition = z.object({ id: z.number(), name: z.string(), author: z.string().optional(), language: z.string() });
const Err = { 'application/json': { schema: z.object({ success: z.literal(false), error: z.string() }) } };
const LANG = /^[a-z]{2,3}$/;

export class QuranTranslationsList extends PublicRoute {
	schema = {
		tags: ['Quran'],
		summary: 'Quran translation editions',
		description: 'The Quran Foundation translation editions, optionally for one language (ISO 639-1). 503 while Quran Foundation cannot be reached.',
		request: { query: z.object({ language: z.string().optional() }) },
		responses: {
			'200': { description: 'Editions', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ editions: z.array(Edition) }) }) } } },
			'503': { description: 'Quran Foundation unreachable', content: Err },
		},
	};

	async handle(c: AppContext) {
		// Quran Foundation not configured here: the editions pickers are hidden (404 feature_off)
		if (!(await quranEditionsConfigured(c.env as never))) return featureOff(c);
		const { query } = await this.getValidatedData<typeof this.schema>();
		const language = query.language?.toLowerCase();
		if (language && !LANG.test(language)) return c.json({ success: false, error: 'invalid_language' }, 400);
		const editions = await listTranslationEditions(c.env as never, language);
		if (!editions) return c.json({ success: false, error: 'quran_unavailable' }, 503);
		return c.json({ success: true, data: { editions } }, 200, { 'Cache-Control': 'public, max-age=3600' });
	}
}

interface Row {
	lang: string;
	qf_translation_id: number;
	name: string;
}

async function channelAccess(c: AppContext, channelId: string, userId: string): Promise<{ response: Response } | { ok: true }> {
	const channel = await loadChannelRecord(c.env as never, channelId);
	if (!channel || channel.isDeleted) return { response: c.json({ success: false, error: 'channel_not_found' }, 404) };
	if (!can(channelRoleOf(channel, userId), 'channel.edit')) return { response: c.json({ success: false, error: 'forbidden' }, 403) };
	return { ok: true };
}

const db = (c: AppContext) => c.env.SEARCH_DB as D1Database;

/** The channel's choice per language, over the platform's and the shipped defaults. */
export async function channelEditions(d1: D1Database, channelId: string) {
	const [own, platform] = await Promise.all([
		d1.prepare('SELECT lang, qf_translation_id, name FROM channel_quran_translations WHERE channel_id = ?').bind(channelId).all<Row>(),
		d1.prepare('SELECT lang, qf_translation_id, name FROM quran_translation_defaults').all<Row>(),
	]);
	const out = new Map<string, { language: string; id: number; name: string; source: 'channel' | 'platform' | 'default' }>();
	for (const [lang, e] of Object.entries(DEFAULT_QURAN_TRANSLATIONS)) out.set(lang, { language: lang, id: e.id, name: e.name, source: 'default' });
	for (const r of platform.results ?? []) out.set(r.lang, { language: r.lang, id: Number(r.qf_translation_id), name: r.name, source: 'platform' });
	for (const r of own.results ?? []) out.set(r.lang, { language: r.lang, id: Number(r.qf_translation_id), name: r.name, source: 'channel' });
	return [...out.values()].sort((a, b) => a.language.localeCompare(b.language));
}

/** The platform's edition per language (admin), over the shipped defaults. */
export async function platformEditions(d1: D1Database) {
	const platform = await d1.prepare('SELECT lang, qf_translation_id, name FROM quran_translation_defaults').all<Row>();
	const out = new Map<string, { language: string; id: number; name: string; source: 'platform' | 'default' }>();
	for (const [lang, e] of Object.entries(DEFAULT_QURAN_TRANSLATIONS)) out.set(lang, { language: lang, id: e.id, name: e.name, source: 'default' });
	for (const r of platform.results ?? []) out.set(r.lang, { language: r.lang, id: Number(r.qf_translation_id), name: r.name, source: 'platform' });
	return [...out.values()].sort((a, b) => a.language.localeCompare(b.language));
}

const ChannelEdition = z.object({ language: z.string(), id: z.number(), name: z.string(), source: z.enum(['channel', 'platform', 'default']) });
const channelParams = z.object({ channelId: Str({ description: 'Channel ID' }) });

export class ChannelQuranTranslationsGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Quran'],
			summary: "A channel's Quran translation editions",
			description: 'Per language: the edition translated caption tracks show, and whether the channel picked it, the platform set it, or it is the shipped default.',
			request: { params: channelParams },
			responses: {
				'200': { description: 'Editions', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ editions: z.array(ChannelEdition) }) }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Channel not found', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		// Quran Foundation not configured here: the editions pickers are hidden (404 feature_off)
		if (!(await quranEditionsConfigured(c.env as never))) return featureOff(c);
		const { params } = await this.getValidatedData<typeof this.schema>();
		const access = await channelAccess(c, params.channelId, this.getUserId(c));
		if ('response' in access) return access.response;
		return c.json({ success: true, data: { editions: await channelEditions(db(c), params.channelId) } });
	}
}

export class ChannelQuranTranslationSet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Quran'],
			summary: "Pick a channel's Quran translation edition for a language",
			description: 'The id must be a Quran Foundation edition of that language. 503 while Quran Foundation cannot be reached (nothing changes).',
			request: {
				params: channelParams.extend({ language: Str({ description: 'ISO 639-1' }) }),
				body: { content: { 'application/json': { schema: z.object({ id: z.number().int().positive() }) } } },
			},
			responses: {
				'200': { description: 'Saved', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ editions: z.array(ChannelEdition) }) }) } } },
				'400': { description: '`unknown_edition` or `invalid_language`', content: Err },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Channel not found', content: Err },
				'503': { description: 'Quran Foundation unreachable', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		// Quran Foundation not configured here: the editions pickers are hidden (404 feature_off)
		if (!(await quranEditionsConfigured(c.env as never))) return featureOff(c);
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const access = await channelAccess(c, params.channelId, userId);
		if ('response' in access) return access.response;
		const language = params.language.toLowerCase();
		if (!LANG.test(language) || language === 'ar' || !new SubtitleService().validateLanguage(language)) return c.json({ success: false, error: 'invalid_language' }, 400);
		const editions = await listTranslationEditions(c.env as never, language);
		if (!editions) return c.json({ success: false, error: 'quran_unavailable' }, 503);
		const edition = editions.find((e) => e.id === body.id);
		if (!edition) return c.json({ success: false, error: 'unknown_edition' }, 400);
		await db(c)
			.prepare(
				`INSERT INTO channel_quran_translations (channel_id, lang, qf_translation_id, name, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT (channel_id, lang) DO UPDATE SET qf_translation_id = excluded.qf_translation_id, name = excluded.name, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
			)
			.bind(params.channelId, language, edition.id, edition.name.slice(0, 200), userId, new Date().toISOString())
			.run();
		logger.info('[Quran] Channel edition set', { channelId: params.channelId, language, edition: edition.id });
		return c.json({ success: true, data: { editions: await channelEditions(db(c), params.channelId) } });
	}
}

export class ChannelQuranTranslationReset extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Quran'],
			summary: "Use the platform's Quran translation edition for a language again",
			request: { params: channelParams.extend({ language: Str({ description: 'ISO 639-1' }) }) },
			responses: {
				'200': { description: 'Reset', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ editions: z.array(ChannelEdition) }) }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Channel not found', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		// Quran Foundation not configured here: the editions pickers are hidden (404 feature_off)
		if (!(await quranEditionsConfigured(c.env as never))) return featureOff(c);
		const { params } = await this.getValidatedData<typeof this.schema>();
		const access = await channelAccess(c, params.channelId, this.getUserId(c));
		if ('response' in access) return access.response;
		await db(c).prepare('DELETE FROM channel_quran_translations WHERE channel_id = ? AND lang = ?').bind(params.channelId, params.language.toLowerCase()).run();
		return c.json({ success: true, data: { editions: await channelEditions(db(c), params.channelId) } });
	}
}
