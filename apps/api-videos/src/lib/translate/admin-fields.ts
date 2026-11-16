/**
 * Translation of staff-set site fields (L10N rule, owner 2026-11-16): the Translate button beside
 * every en/ar pair in the admin, and a list page's "Translate missing". admin-api checks the staff
 * permission and calls `POST /internal/translate/admin-fields`; this runs it on the inline path
 * (lib/translate/inline.ts): the admin kill switch, the day's inline budget share (the processor's
 * ledger), the edge cache and the translation_audit row. Differences from the creators' button:
 *
 * - English ↔ Arabic only, Workers AI only (never DeepL), and the processor's `admin_field` mode:
 *   the site's wording («مرئي/مرئيات»), the CMS glossary, placeholders kept.
 * - Quran text is refused, not masked: the item comes back empty with `refused: 'quran'` and any
 *   reference found, so the admin pastes the official text and its recognised translation.
 * - Its own daily cap per staff member (ADMIN_FIELD_TRANSLATE_DAILY_ITEMS), kept in
 *   inline_translation_usage under `staff:<userId>`; viewers' fair use is untouched.
 * - The audit row is kind 'inline' with field `admin:<field>` (the table's kind CHECK has no
 *   separate value, and the prefix is enough to tell them apart).
 */
import {
	ADMIN_FIELD_LANGUAGES,
	ADMIN_FIELD_NAME,
	ADMIN_FIELD_TRANSLATE_DAILY_ITEMS,
	ADMIN_FIELD_TRANSLATE_LIMITS,
	looksLikeMushafText,
	type AdminFieldRefusal,
	type AdminFieldTranslateItem,
	type AdminFieldTranslateResponse,
	type InternalTranslateResponse,
} from '@al-ummah/shared-types';
import { readCaptionSettings } from '../captions/jobs';
import {
	TranslateHttpError,
	auditTranslation,
	cacheKey,
	callProcessor,
	cached,
	dailyInlineBudgetUsd,
	db,
	giveBackFairUse,
	nextUtcMidnight,
	remember,
	takeFairUse,
	utcDay,
	type InlineTranslateEnv,
} from './inline';

export interface AdminFieldTranslateInput {
	userId: string;
	from: string;
	to: string;
	texts: string[];
	field: string;
}

const usageKey = (userId: string) => `staff:${userId}`;

export async function readStaffUsage(env: InlineTranslateEnv, userId: string, now = new Date()): Promise<AdminFieldTranslateResponse['usage']> {
	const row = await db(env).prepare('SELECT items FROM inline_translation_usage WHERE user_id = ? AND day = ?').bind(usageKey(userId), utcDay(now)).first<{ items: number }>();
	return { used: Number(row?.items ?? 0), limit: ADMIN_FIELD_TRANSLATE_DAILY_ITEMS, resetsAt: nextUtcMidnight(now) };
}

export function validateAdminFields(input: AdminFieldTranslateInput): void {
	const langs = ADMIN_FIELD_LANGUAGES as readonly string[];
	if (!langs.includes(input.from) || !langs.includes(input.to)) throw new TranslateHttpError(400, 'invalid_language');
	if (input.from === input.to) throw new TranslateHttpError(400, 'same_language');
	if (!input.userId || input.userId.length > 128) throw new TranslateHttpError(400, 'invalid_user');
	if (!ADMIN_FIELD_NAME.test(input.field)) throw new TranslateHttpError(400, 'invalid_field');
	if (!Array.isArray(input.texts) || !input.texts.length || input.texts.length > ADMIN_FIELD_TRANSLATE_LIMITS.texts) throw new TranslateHttpError(400, 'too_many_texts', { max: ADMIN_FIELD_TRANSLATE_LIMITS.texts });
	let chars = 0;
	for (const t of input.texts) {
		if (typeof t !== 'string') throw new TranslateHttpError(400, 'invalid_request');
		if (t.length > ADMIN_FIELD_TRANSLATE_LIMITS.textChars) throw new TranslateHttpError(400, 'text_too_long', { max: ADMIN_FIELD_TRANSLATE_LIMITS.textChars });
		chars += t.length;
	}
	if (chars > ADMIN_FIELD_TRANSLATE_LIMITS.chars) throw new TranslateHttpError(400, 'too_much_text', { max: ADMIN_FIELD_TRANSLATE_LIMITS.chars });
}

type Answer = { text: string; quran?: Array<{ range: string; label: string }>; refused?: AdminFieldRefusal };

export async function translateAdminFields(env: InlineTranslateEnv, input: AdminFieldTranslateInput, now = new Date()): Promise<AdminFieldTranslateResponse> {
	validateAdminFields(input);
	const settings = await readCaptionSettings(env);
	if (!settings.inline.enabled) throw new TranslateHttpError(503, 'translation_paused');

	const results = new Map<number, AdminFieldTranslateItem>();
	// Mushaf text never leaves: refused here, before the cache, the cap or a model
	const todo: Array<{ n: number; text: string }> = [];
	input.texts.forEach((text, n) => {
		if (!text.trim()) results.set(n, { text: '', cached: false });
		else if (looksLikeMushafText(text)) results.set(n, { text: '', refused: 'quran', cached: false });
		else todo.push({ n, text });
	});

	// One cache entry per distinct text; the field is part of the key (it shapes the prompt)
	const distinct = [...new Set(todo.map((t) => t.text))];
	const keys = await Promise.all(distinct.map((text) => cacheKey(input.from, input.to, 'admin-field', input.field, '', text)));
	const hits = (await cached(keys)) as Array<Answer | null>;
	const answers = new Map<string, Answer & { cached: boolean }>();
	distinct.forEach((text, i) => {
		const hit = hits[i];
		if (hit) answers.set(text, { ...hit, cached: true });
	});
	const misses = distinct.filter((text) => !answers.has(text));

	let provider = misses.length ? 'workers-ai' : 'cache';
	let model = 'cache';
	if (misses.length) {
		if (!(await takeFairUse(env, usageKey(input.userId), misses.length, ADMIN_FIELD_TRANSLATE_DAILY_ITEMS, now))) {
			const usage = await readStaffUsage(env, input.userId, now);
			throw new TranslateHttpError(429, 'daily_limit', usage);
		}
		let answer: InternalTranslateResponse;
		try {
			answer = await callProcessor(env, {
				items: misses.map((text, i) => ({ id: `t${i}`, text })),
				from: input.from,
				to: input.to,
				field: 'title',
				provider: 'workers-ai',
				dailyBudgetUsd: dailyInlineBudgetUsd(settings),
				mode: 'admin_field',
			});
		} catch (error) {
			await giveBackFairUse(env, usageKey(input.userId), misses.length, now);
			throw error;
		}
		provider = answer.provider;
		model = answer.model;
		const byId = new Map(answer.items.map((a) => [a.id, a]));
		await Promise.all(
			misses.map(async (text, i) => {
				const a = byId.get(`t${i}`);
				if (!a) return;
				const value: Answer = a.refused ? { text: '', refused: a.refused, ...(a.quran ? { quran: a.quran } : {}) } : { text: a.text, ...(a.quran ? { quran: a.quran } : {}) };
				answers.set(text, { ...value, cached: false });
				await remember(keys[distinct.indexOf(text)]!, value as never);
			}),
		);
	}
	for (const { n, text } of todo) {
		const a = answers.get(text);
		results.set(n, a ? { text: a.text, ...(a.refused ? { refused: a.refused } : {}), ...(a.quran ? { quran: a.quran } : {}), cached: a.cached } : { text: '', cached: false });
	}

	await auditTranslation(
		env,
		{
			userId: input.userId,
			kind: 'inline',
			field: `admin:${input.field}`,
			from: input.from,
			to: input.to,
			items: input.texts.length,
			chars: input.texts.reduce((n, t) => n + t.length, 0),
			provider,
			model,
			cached: misses.length === 0,
		},
		now,
	);
	return {
		items: input.texts.map((_, n) => results.get(n) ?? { text: '', cached: false }),
		provider,
		machineTranslation: true,
		usage: await readStaffUsage(env, input.userId, now),
	};
}
