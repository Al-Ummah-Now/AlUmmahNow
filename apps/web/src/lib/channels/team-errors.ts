import type { AppTranslations } from '@/lib/i18n';
import { TeamError, type TeamErrorCode } from './team';

/** Friendly copy for a team failure; the raw error is never shown. */
export function teamErrorMessage(t: AppTranslations, error: unknown): string {
  const code: TeamErrorCode = error instanceof TeamError ? error.code : 'unknown';
  const e = t.channelRoles.errors;
  switch (code) {
    case 'person_not_found': return e.personNotFound;
    case 'already_member': return e.alreadyMember;
    case 'cannot_invite_owner': return e.cannotInviteOwner;
    case 'member_limit': return e.memberLimit;
    case 'forbidden': return e.forbidden;
    case 'already_invited': return e.alreadyInvited;
    case 'pending_limit': return e.pendingLimit;
    case 'rate_limited': return e.rateLimited;
    case 'shared_limit': return e.sharedLimit;
    case 'invite_not_found': return e.inviteNotFound;
    case 'invalid_email': return e.invalidEmail;
    default: return e.generic;
  }
}
