/**
 * AI moderation producer (Epic 28, docs/specs/EPIC-28-PLAN.md §1).
 *
 * After a content write succeeds, send one ModerationScan to the dedicated moderation
 * queue, in the background. Fail safe: a missing binding or a failed send is logged and
 * the content is published as normal. The text travels only in the queue message.
 */
import { MessageType, MODERATION_MAX_TEXT, type ModerationScanPayload } from '@al-ummah/shared-types';
import { inBackground } from './websocket-notify';
import { logger } from './logger';

type ScanContext = Parameters<typeof inBackground>[0] & {
	env: { MODERATION_QUEUE?: { send(message: unknown): Promise<unknown> } };
};

export type ScanRequest = Omit<ModerationScanPayload, 'text' | 'timestamp' | 'part' | 'parts'> & { text: string | null | undefined };

/** Surfaces whose stored text is sanitised HTML; tags are stripped only for these. */
const HTML_SURFACES = new Set<ModerationScanPayload['surface']>(['community_post', 'post_comment']);

/** Most parts sent for one write (40,000 chars); longer text is logged as truncated. */
export const MAX_SCAN_PARTS = 10;

/**
 * Text for scanning. HTML surfaces lose their tags and entities; plain-text surfaces keep
 * everything (bracketed text is content there). Whitespace is collapsed. Not truncated.
 */
export function toScanText(text: string | null | undefined, html = false): string {
	if (!text) return '';
	let out = text;
	if (html) {
		out = out
			.replace(/<[^>]*>/g, ' ')
			.replace(/&nbsp;/g, ' ')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&amp;/g, '&');
	}
	return out.replace(/\s+/g, ' ').trim();
}

/** Splits text into parts of at most MODERATION_MAX_TEXT characters, so nothing goes unscanned. */
export function splitForScan(text: string): string[] {
	const parts: string[] = [];
	for (let i = 0; i < text.length && parts.length < MAX_SCAN_PARTS; i += MODERATION_MAX_TEXT) {
		parts.push(text.slice(i, i + MODERATION_MAX_TEXT));
	}
	return parts;
}

/** Title, description, tags and their localized variants of a video, as one text. */
export function videoScanText(video: {
	title?: string | null;
	description?: string | null;
	tags?: string[] | null;
	titleLocalized?: Record<string, string> | null;
	descriptionLocalized?: Record<string, string> | null;
}): string {
	const parts = [
		video.title,
		...Object.values(video.titleLocalized ?? {}),
		video.description,
		...Object.values(video.descriptionLocalized ?? {}),
		(video.tags ?? []).join(' '),
	];
	return [...new Set(parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0))].join('\n');
}

export function buildScanMessages(request: ScanRequest, now: Date = new Date()) {
	const text = toScanText(request.text, HTML_SURFACES.has(request.surface));
	if (!text) return [];
	const chunks = splitForScan(text);
	if (text.length > MODERATION_MAX_TEXT * MAX_SCAN_PARTS) {
		logger.warn('[Moderation] Text longer than the scan limit; the end is not scanned', { surface: request.surface, subjectId: request.subjectId, length: text.length });
	}
	return chunks.map((chunk, index) => {
		const payload: ModerationScanPayload = {
			...request,
			text: chunk,
			timestamp: now.toISOString(),
			...(chunks.length > 1 ? { part: index + 1, parts: chunks.length } : {}),
		};
		return { id: crypto.randomUUID(), type: MessageType.ModerationScan, payload, timestamp: now.getTime() };
	});
}

export function scanInBackground(c: ScanContext, request: ScanRequest): void {
	const queue = c.env.MODERATION_QUEUE;
	if (!queue) return;
	const messages = buildScanMessages(request);
	if (messages.length === 0) return;
	inBackground(c, 'moderation-scan', async () => {
		try {
			for (const message of messages) await queue.send(message);
		} catch (error) {
			logger.warn('[Moderation] Scan enqueue failed; content stays published', {
				surface: request.surface,
				subjectId: request.subjectId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});
}

/** Post text, poll question/options and quiz questions/answers. */
export function communityPostScanText(post: {
	content?: string | null;
	poll?: unknown;
	quiz?: unknown;
	title?: string;
	article?: { title?: string; excerpt?: string | null; body?: string };
	slides?: { heading?: string | null; body?: string | null; image?: { alt?: string | null } }[];
	link?: { url?: string; title?: string | null; description?: string | null };
}): string {
	const parts: string[] = [];
	if (post.content) parts.push(post.content);
	// PostV2 (post-schema.ts): titles, the article body, card texts and the link
	for (const v of [post.title, post.article?.title, post.article?.excerpt, post.article?.body?.slice(0, 20_000), post.link?.title, post.link?.description, post.link?.url]) {
		if (typeof v === 'string' && v) parts.push(v);
	}
	for (const s of post.slides ?? []) {
		for (const v of [s?.heading, s?.body, s?.image?.alt]) if (typeof v === 'string' && v) parts.push(v);
	}
	const collect = (value: unknown, depth = 0): void => {
		if (depth > 4 || value == null) return;
		if (Array.isArray(value)) value.forEach((v) => collect(v, depth + 1));
		else if (typeof value === 'object') {
			for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
				if (typeof v === 'string' && ['question', 'text', 'option', 'title', 'answer', 'explanation'].includes(key)) parts.push(v);
				else if (typeof v === 'object') collect(v, depth + 1);
			}
		}
	};
	collect(post.poll);
	collect(post.quiz);
	return parts.join('\n');
}
