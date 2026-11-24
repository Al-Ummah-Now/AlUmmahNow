/**
 * Content flags in api-videos (wiki E20 §5.4, §5.5). They act only while the `ageRules` switch is on.
 */
import { applyContentFlags, featureGate, hasContentFlagInput, isMadeForKids, type ContentFlagFields, type ContentFlagInput, type ContentFlagProblem } from '@al-ummah/shared-types';
import type { Context } from 'hono';
import { apiError } from './api-error';
import { getCommentSettings, type CommentSettings } from './comments';
import { featureOff } from './features/off';
import { logger } from './logger';

/** Whether the age rules are on. Throws when the switches can't be read. */
export async function ageRulesOn(env: unknown): Promise<boolean> {
	return (await featureGate(env as never, 'ageRules')).on;
}

/**
 * Whether this video's made-for-kids rules apply. Only a flagged video reads the switch, and an unreadable
 * switch means yes: the rules only take things away (comments, history, notifications).
 */
export async function kidsRulesApply(env: unknown, video: ContentFlagFields | null | undefined): Promise<boolean> {
	if (!isMadeForKids(video)) return false;
	try {
		return await ageRulesOn(env);
	} catch (error) {
		logger.warn('[ContentFlags] Switch unreadable; made-for-kids rules kept on', { error: error instanceof Error ? error.message : String(error) });
		return true;
	}
}

/** The video's comment setting as it applies: off on a video made for kids. */
export async function commentSettingsOf(env: unknown, video: (ContentFlagFields & { commentSettings?: unknown }) | null | undefined): Promise<CommentSettings> {
	return (await kidsRulesApply(env, video)) ? 'off' : getCommentSettings(video);
}

/**
 * The refusal of a request that sets flags: the switch is off (404 feature_off; unreadable: 503), or the
 * flags are not allowed on this video. Null when it may go on; `video` is not changed.
 */
export async function contentFlagRefusal(c: Context, input: ContentFlagInput, video: ContentFlagFields = {}): Promise<Response | null> {
	if (!hasContentFlagInput(input)) return null;
	let on: boolean;
	try {
		on = await ageRulesOn(c.env);
	} catch {
		return apiError(c, 503, 'service_unavailable');
	}
	if (!on) return featureOff(c, 'ageRules');
	const problem = applyContentFlags({ ...video }, input);
	return problem ? contentFlagProblem(c, problem) : null;
}

export const contentFlagProblem = (c: Context, problem: ContentFlagProblem): Response => apiError(c, problem === 'age_restricted_locked' ? 403 : 400, problem);
