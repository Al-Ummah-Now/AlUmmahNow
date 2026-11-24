/** What an admin has to look at after an export or erase (videos admin → Errors). One item per key. */
import { reportNeedsAction, type ErrorReporterEnv, type ExecutionContextLike } from '@al-ummah/shared-types';
import { logger } from '../logger';

const ADMIN_PATH = '/channels';

/** A channel record that cannot be read: what it holds was left out of an export, or left in place by an erase. */
export function flagUnreadableChannel(env: unknown, ctx: ExecutionContextLike | undefined, purpose: 'export' | 'erase', channelId: string): void {
	logger.error('[Privacy] Channel record unreadable', { purpose, channelId });
	reportNeedsAction('api-videos', env as ErrorReporterEnv, ctx, {
		key: `privacy-channel-unreadable:${channelId}`,
		source: 'other',
		title: 'Channel record unreadable during a data export or erasure',
		message:
			purpose === 'erase'
				? 'The account was erased except for this channel and what is on it. Repair the record, then delete the channel.'
				: 'The export left this channel out. Repair the record, then the account can export again.',
		itemType: 'channel',
		itemId: channelId,
		itemUrl: `${ADMIN_PATH}/${encodeURIComponent(channelId)}`,
	});
}

/** A run needed another pass and could not be carried to it (lib/privacy/resume-state.ts). */
export function flagResumeUnavailable(env: unknown, ctx: ExecutionContextLike | undefined, purpose: 'export' | 'erase', error: unknown): void {
	reportNeedsAction('api-videos', env as ErrorReporterEnv, ctx, {
		key: `privacy-resume-unavailable:${purpose}`,
		source: 'other',
		title: `A data ${purpose === 'erase' ? 'erasure' : 'export'} could not be continued`,
		message: error instanceof Error ? error.message : 'INTERNAL_API_KEY is missing or unreadable, or the state is too long',
	});
}
