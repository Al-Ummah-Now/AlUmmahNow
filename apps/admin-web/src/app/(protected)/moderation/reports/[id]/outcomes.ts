/**
 * What the report page says about each outcome (kept apart from React so it is unit tested,
 * test/report-outcomes.test.ts): what it does to this kind of item, why one is not offered, and what
 * a refused decision means.
 */
import type { ModerationAction, ReportableEntityType, ReportOutcomeReason } from '@al-ummah/shared-types';
import type { MessageKey } from '@/i18n/translate';

/** A type whose outcome does something other than the general description says. */
export function actionDescription(type: ReportableEntityType, action: ModerationAction): MessageKey | null {
  if (type === 'comment' && action === 'removed') return 'actions.commentRemovedDescription';
  if ((type === 'comment' || type === 'post') && action === 'deleted') return 'actions.softDeletedDescription';
  if (type === 'live_chat' && (action === 'removed' || action === 'deleted')) return 'actions.chatRemovedDescription';
  return null;
}

export function outcomeReasonKey(reason: ReportOutcomeReason): MessageKey {
  const keys: Record<ReportOutcomeReason, MessageKey> = {
    not_for_type: 'actions.reasonNotForType',
    not_for_post_comment: 'actions.reasonNotForPostComment',
    item_gone: 'actions.reasonItemGone',
    permission: 'actions.reasonPermission',
  };
  return keys[reason];
}

export function actionErrorKey(status: number, code?: string): MessageKey {
  if (code === 'item_gone') return 'actions.reasonItemGone';
  if (code === 'outcome_not_available') return 'actions.reasonNotForType';
  if (status === 403) return 'actions.reasonPermission';
  if (status === 409) return 'actions.alreadyClosed';
  return status === 401 ? 'errors.notAuthenticated' : 'actions.failed';
}
