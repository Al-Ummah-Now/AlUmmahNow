import { creatorTierOrigin, type AdminAuditEntry, type CreatorTier, type CreatorTierAssignment } from '@al-ummah/shared-types';
import { getUserCreatorTier, listCreatorTiers, setUserCreatorTier } from '@/lib/api/creators';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, cardClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { CreatorTierControl } from './CreatorTierControl';

/** The user page's creator tier: the Tier selector, where it came from, and its history (audit log). */
export async function UserCreatorTierPanel({ userId, userName, canManage }: { userId: string; userName?: string; canManage: boolean }) {
  const { t, locale } = await getI18n();
  let tiers: CreatorTier[] = [];
  let current: { assignment: CreatorTierAssignment | null; audit: (AdminAuditEntry & { previous?: Record<string, unknown> | null })[] } | null = null;
  try {
    const [list, user] = await Promise.all([listCreatorTiers(), getUserCreatorTier(userId)]);
    tiers = list.items;
    current = user;
  } catch (e) {
    logger.error('[creators] Failed to load the user tier', { userId, error: e instanceof Error ? e.message : String(e) });
  }
  const nameOf = (id: unknown) => (typeof id === 'string' && id ? tiers.find((tier) => tier.id === id)?.name ?? id : t('creators.none'));
  return (
    <section id="creator-tier" className={`${cardClass} mb-6`} aria-labelledby="creator-tier-title" data-testid="user-creator-tier">
      <h2 id="creator-tier-title" className="text-lg font-semibold text-fg mb-1">{t('creators.panelTitle')}</h2>
      <p className="text-sm text-fg-muted mb-4">{t('creators.panelHint')}</p>
      {!current ? (
        <ErrorAlert testId="user-creator-tier-failed">{t('creators.loadFailed')}</ErrorAlert>
      ) : (
        <>
          <CreatorTierControl
            userId={userId}
            userName={userName || userId}
            current={current.assignment ? { ...current.assignment, origin: creatorTierOrigin(current.assignment) ?? 'admin' } : null}
            tiers={tiers}
            canManage={canManage}
            testId="user-creator-tier-control"
            setTier={setUserCreatorTier}
          />
          {!canManage && <p className="text-sm text-fg-muted mt-2">{t('creators.noAccess')}</p>}
          <h3 className="text-base font-semibold text-fg mt-6 mb-2">{t('creators.historyTitle')}</h3>
          {current.audit.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('creators.historyEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" data-testid="user-creator-tier-history">
              {current.audit.map((entry) => (
                <li key={entry.id}>
                  <span className="text-fg">{t('creators.historyEntry', { from: nameOf(entry.previous?.tierId), to: nameOf(entry.details?.tierId) })}</span>{' '}
                  <span className="text-fg-muted">{t('creators.historyBy', { actor: entry.actorId, date: formatDate(entry.createdAt, locale, true) })}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
