/**
 * AI category suggestions, api-videos side ("AI suggests, uploader confirms";
 * see packages/shared-types/src/category-suggestion.ts).
 *
 * api-videos never calls the model: it records the request in SEARCH_DB
 * `category_suggestions` and sends a CategorySuggest message to the moderation
 * queue (the processor's AI consumer), in the background. A failed enqueue is
 * logged and left `pending`; the processor's hourly sweep re-sends it. Uploads
 * and edits never wait for, or fail because of, a suggestion.
 */
import {
	MessageType,
	adoptDraftSuggestion,
	draftSubjectId,
	markCategorySuggestionPending,
	recordCategoryOutcome,
	type CategorySuggestPayload,
	type CategorySuggestionReason,
	type SearchDb,
} from '@al-ummah/shared-types';
import { inBackground } from './websocket-notify';
import { logger } from './logger';

type Producer = { send(message: unknown): Promise<unknown> };
type SuggestEnv = { SEARCH_DB?: unknown; MODERATION_QUEUE?: Producer; queue?: Producer };
type SuggestContext = Parameters<typeof inBackground>[0] & { env: SuggestEnv };

export function searchDbOf(env: SuggestEnv): SearchDb | null {
	return (env.SEARCH_DB as SearchDb | undefined) ?? null;
}

export function categorizeMessage(payload: CategorySuggestPayload, now: number = Date.now()) {
	return { id: crypto.randomUUID(), type: MessageType.CategorySuggest, payload, timestamp: now };
}

/** Send one CategorySuggest (moderation queue, else the videos queue). Throws when neither is bound or the send fails. */
export async function sendCategorySuggest(env: SuggestEnv, payload: CategorySuggestPayload): Promise<void> {
	const queue = env.MODERATION_QUEUE ?? env.queue;
	if (!queue) throw new Error('No queue bound for category suggestions');
	await queue.send(categorizeMessage(payload));
}

/** Request a suggestion for a stored video, in the background (upload without a category, edited text). */
export function requestVideoSuggestion(
	c: SuggestContext,
	input: { videoId: string; userId?: string | null; channelId?: string | null; reason: CategorySuggestionReason },
): void {
	const db = searchDbOf(c.env);
	if (!db) return;
	inBackground(c, 'category-suggest', async () => {
		try {
			await markCategorySuggestionPending(db, { subjectId: input.videoId, subjectType: 'video', reason: input.reason, userId: input.userId, channelId: input.channelId });
			await sendCategorySuggest(c.env, { subjectId: input.videoId, subjectType: 'video', reason: input.reason, requestedBy: input.userId ?? undefined });
			logger.info('[CategorySuggest] Requested', { videoId: input.videoId, reason: input.reason });
		} catch (error) {
			// Left pending: the processor's hourly sweep re-sends it
			logger.warn('[CategorySuggest] Request failed; the sweep will retry', { videoId: input.videoId, error: error instanceof Error ? error.message : String(error) });
		}
	});
}

/** Record what the owner kept (accepted/changed), in the background. */
export function recordOwnerCategory(c: SuggestContext, videoId: string, category: string | null, userId: string): void {
	const db = searchDbOf(c.env);
	if (!db) return;
	inBackground(c, 'category-outcome', async () => {
		try {
			const outcome = await recordCategoryOutcome(db, videoId, category, userId);
			if (outcome) logger.info('[CategorySuggest] Outcome recorded', { videoId, outcome, category });
		} catch (error) {
			logger.warn('[CategorySuggest] Outcome not recorded', { videoId, error: error instanceof Error ? error.message : String(error) });
		}
	});
}

/**
 * After an upload is initiated: the video adopts the form's finished suggestion
 * (and records whether the uploader kept it). Without one and without a chosen
 * category, a suggestion is requested for the video.
 */
export function adoptOrRequestSuggestion(
	c: SuggestContext,
	input: { videoId: string; userId: string; channelId: string | null; category: string | null; draftKey?: string | undefined },
): void {
	const db = searchDbOf(c.env);
	if (!db) return;
	inBackground(c, 'category-adopt', async () => {
		try {
			const adopted = input.draftKey
				? await adoptDraftSuggestion(db, draftSubjectId(input.userId, input.draftKey), input.videoId, input.userId, input.channelId)
				: false;
			if (adopted) {
				const outcome = await recordCategoryOutcome(db, input.videoId, input.category, input.userId);
				logger.info('[CategorySuggest] Upload adopted the form suggestion', { videoId: input.videoId, outcome });
				return;
			}
			if (input.category) return;
			await markCategorySuggestionPending(db, { subjectId: input.videoId, subjectType: 'video', reason: 'upload', userId: input.userId, channelId: input.channelId });
			await sendCategorySuggest(c.env, { subjectId: input.videoId, subjectType: 'video', reason: 'upload', requestedBy: input.userId });
		} catch (error) {
			logger.warn('[CategorySuggest] Upload suggestion not requested; the sweep will retry', { videoId: input.videoId, error: error instanceof Error ? error.message : String(error) });
		}
	});
}
