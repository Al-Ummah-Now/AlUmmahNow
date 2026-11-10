/**
 * The words a user sees when an upload or a channel create is refused: never
 * the server's raw text. Creator tiers answer with a `code` (and `retryAfter`
 * for a limit); everything else falls back to the caller's generic message.
 */
import { CREATOR_ERROR_CODES } from '@al-ummah/shared-types';
import type { AppTranslations } from '@al-ummah/shared-types';

export interface RefusedCall {
  code?: string;
  retryAfter?: number;
  maxChannels?: number;
}

/** "23 minutes", "1 hour", "2 hours" (rounded up to whole minutes, then hours from 90 minutes). */
export function formatWait(t: Pick<AppTranslations, 'creator'>, seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 90) return minutes === 1 ? t.creator.minute : t.creator.minutes.replace('{count}', String(minutes));
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? t.creator.hour : t.creator.hours.replace('{count}', String(hours));
}

/** The friendly message for a refused call, or null when it is not a creator-tier refusal. */
export function creatorRefusalMessage(t: Pick<AppTranslations, 'creator'>, call: RefusedCall | null | undefined): string | null {
  switch (call?.code) {
    case CREATOR_ERROR_CODES.uploadsByInvitation:
      return t.creator.invitationShort;
    case CREATOR_ERROR_CODES.uploadLimit:
      return call.retryAfter && call.retryAfter > 0
        ? t.creator.limitReached.replace('{time}', formatWait(t, call.retryAfter))
        : t.creator.limitReachedSoon;
    case CREATOR_ERROR_CODES.channelLimit:
      return t.creator.channelLimit.replace('{max}', String(call.maxChannels ?? ''));
    case 'upload_limits_unavailable':
    case 'creator_access_unavailable':
      return t.creator.unavailable;
    default:
      return null;
  }
}
