import Link from 'next/link';
import type { AdminAuditEntry, CreatorTier } from '@al-ummah/shared-types';
import { creatorTierAudit, listCreatorTiers } from '@/lib/api/creators';
import { getAdminSession } from '@/lib/auth';
import { canManageCreators } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { TierEditor } from '@/components/creators/TierEditor';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** Tier definitions (name, limits, channel limit), editable by admins, with their recent changes. */
export default async function CreatorTiersPage() {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  const canManage = canManageCreators(session?.user.role);
  let tiers: CreatorTier[] | null = null;
  let audit: AdminAuditEntry[] = [];
  try {
    [tiers, audit] = await Promise.all([listCreatorTiers(), creatorTierAudit().catch(() => [])]);
  } catch (e) {
    logger.error('[creators] Failed to load tiers', { error: e instanceof Error ? e.message : String(e) });
  }
  return (
    <div>
      <Link href="/creators" className={`${linkClass} text-sm`}>{t('creators.title')}</Link>
      <div className="mt-2 mb-6">
        <h1 className="text-3xl font-bold text-fg">{t('creators.tiersTitle')}</h1>
        <p className="text-fg-muted mt-1 max-w-3xl">{t('creators.tiersSubtitle')}</p>
        <p className="text-fg-muted mt-1 text-sm">{t('creators.superAdminNote')}</p>
      </div>
      {!canManage && <p className="mb-4 text-sm text-fg-muted">{t('creators.noAccess')}</p>}
      {tiers ? <TierEditor tiers={tiers} canManage={canManage} /> : <ErrorAlert testId="tiers-load-failed">{t('creators.loadFailed')}</ErrorAlert>}
      <section className={`${cardClass} mt-8`} aria-labelledby="tiers-audit" data-testid="tiers-audit">
        <h2 id="tiers-audit" className="text-lg font-semibold text-fg mb-3">{t('creators.tiersAudit')}</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('creators.tiersAuditEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {audit.map((entry) => (
              <li key={entry.id}>
                <span className="font-medium text-fg">{entry.key.replace('content:creator-tier:', '')}</span>{' '}
                <span className="text-fg-muted">{entry.action} · {t('creators.historyBy', { actor: entry.actorId, date: formatDate(entry.createdAt, locale, true) })}</span>
                {entry.details && <code className="ms-2 text-xs text-fg-muted" dir="ltr">{JSON.stringify(entry.details)}</code>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
