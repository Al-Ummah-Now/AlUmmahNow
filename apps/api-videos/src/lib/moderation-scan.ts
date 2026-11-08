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

export type ScanRequest = Omit<ModerationScanPayload, 'text' | 'timestamp'> & { text: string | null | undefined };

/** Plain text for scanning: tags dropped (post content is sanitised HTML), entities decoded, capped. */
export function toScanText(text: string | null | undefined): string {
	if (!text) return '';
	return text
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MODERATION_MAX_TEXT);
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

export function buildScanMessage(request: ScanRequest, now: Date = new Date()) {
	const text = toScanText(request.text);
	if (!text) return null;
	const payload: ModerationScanPayload = { ...request, text, timestamp: now.toISOString() };
	return { id: crypto.randomUUID(), type: MessageType.ModerationScan, payload, timestamp: now.getTime() };
}

export function scanInBackground(c: ScanContext, request: ScanRequest): void {
	const queue = c.env.MODERATION_QUEUE;
	if (!queue) return;
	const message = buildScanMessage(request);
	if (!message) return;
	inBackground(c, 'moderation-scan', async () => {
		try {
			await queue.send(message);
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
export function communityPostScanText(post: { content?: string | null; poll?: unknown; quiz?: unknown }): string {
	const parts: string[] = [];
	if (post.content) parts.push(post.content);
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
