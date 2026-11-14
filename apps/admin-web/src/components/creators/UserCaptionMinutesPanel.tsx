import type { AdminAuditEntry, CaptionLedgerEntry, CaptionMinuteGrant, CaptionMinutesUsage } from '@al-ummah/shared-types';
import { getUserCaptionMinutes, grantCaptionMinutes, revokeCaptionGrant } from '@/lib/api/creators';
import { getI18n } from '@/i18n/server';
import { ErrorAlert, cardClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { CaptionGrantControls } from './CaptionGrantControls';

/**
 * The user page's caption minutes (AUN-CAPTIONS §6, owner decision 2026-11-14):
 * this month's allowance (their tier's minutes plus grants), the grants with
 * who gave or revoked them and why, and the grant form. Videos-side data.
 */
export async function UserCaptionMinutesPanel({ userId, canManage }: { userId: string; canManage: boolean }) {
  const { t } = await getI18n();
  let data: { usage: CaptionMinutesUsage; grants: CaptionMinuteGrant[]; ledger?: CaptionLedgerEntry[]; audit: AdminAuditEntry[] } | null = null;
  try {
    data = await getUserCaptionMinutes(userId);
  } catch (e) {
    logger.error('[captionMinutes] Failed to load', { userId, error: e instanceof Error ? e.message : String(e) });
  }
  return (
    <section id="caption-minutes" className={`${cardClass} mb-6`} aria-labelledby="caption-minutes-title" data-testid="user-caption-minutes">
      <h2 id="caption-minutes-title" className="text-lg font-semibold text-fg mb-1">{t('captionMinutes.title')}</h2>
      <p className="text-sm text-fg-muted mb-4">{t('captionMinutes.hint')}</p>
      {!data ? (
        <ErrorAlert testId="user-caption-minutes-failed">{t('captionMinutes.loadFailed')}</ErrorAlert>
      ) : (
        <CaptionGrantControls userId={userId} usage={data.usage} grants={data.grants} ledger={data.ledger ?? []} canManage={canManage} grant={grantCaptionMinutes} revoke={revokeCaptionGrant} />
      )}
    </section>
  );
}
