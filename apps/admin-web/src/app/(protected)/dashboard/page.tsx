import Link from '@/components/AppLink';
import type { ReportStats } from '@al-ummah/shared-types';
import { getStats } from '@/lib/api/admin';
import { getI18n } from '@/i18n/server';
import { formatNumber, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass } from '@/components/ui';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const cardLinkClass =
  'bg-surface border border-border rounded-lg p-6 hover:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

export default async function AdminDashboard() {
  const { t, locale } = await getI18n();
  let stats: ReportStats | null = null;
  let failed = false;

  try {
    stats = await getStats();
  } catch (e) {
    failed = true;
    logger.error('[dashboard] Failed to load stats', { error: e instanceof Error ? e.message : String(e) });
  }

  const statCards: { key: string; label: MessageKey; value: number; tone: string }[] = stats
    ? [
        { key: 'total', label: 'dashboard.totalReports', value: stats.total, tone: 'text-fg' },
        { key: 'pending', label: 'dashboard.pending', value: stats.byStatus.pending, tone: 'text-warning-fg' },
        { key: 'resolved', label: 'dashboard.resolved', value: stats.byStatus.resolved, tone: 'text-success-fg' },
        { key: 'dismissed', label: 'dashboard.dismissed', value: stats.byStatus.dismissed, tone: 'text-fg-muted' },
        { key: 'last24h', label: 'dashboard.last24Hours', value: stats.recentActivity.last24Hours, tone: 'text-info-fg' },
      ]
    : [];

  return (
    <div>
      <h1 className="text-3xl font-bold text-fg mb-8">{t('dashboard.title')}</h1>

      {failed && <ErrorAlert testId="stats-error">{t('errors.loadStats')}</ErrorAlert>}

      {stats && (
        <section aria-label={t('dashboard.statsLabel')}>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
            {statCards.map((card) => (
              <div key={card.key} className={cardClass} data-testid={`stat-${card.key}`}>
                <dt className="text-fg-muted text-sm font-medium">{t(card.label)}</dt>
                <dd className={`text-3xl font-bold mt-2 ${card.tone}`} data-value={card.value}>
                  {formatNumber(card.value, locale)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/moderation" className={cardLinkClass}>
          <h2 className="text-xl font-semibold text-fg mb-2">{t('dashboard.moderationTitle')}</h2>
          <p className="text-fg-muted">{t('dashboard.moderationDescription')}</p>
          {stats && stats.byStatus.pending > 0 && (
            <span className="inline-block mt-4 bg-chip-pending-bg text-chip-pending-fg px-3 py-1 rounded-full text-sm font-medium">
              {t('dashboard.pendingBadge', { count: stats.byStatus.pending })}
            </span>
          )}
        </Link>
        <Link href="/translations" className={cardLinkClass}>
          <h2 className="text-xl font-semibold text-fg mb-2">{t('dashboard.translationsTitle')}</h2>
          <p className="text-fg-muted">{t('dashboard.translationsDescription')}</p>
          <span className="inline-block mt-4 bg-chip-reviewing-bg text-chip-reviewing-fg px-3 py-1 rounded-full text-sm font-medium">
            EN / AR
          </span>
        </Link>
        <Link href="/indices" className={cardLinkClass}>
          <h2 className="text-xl font-semibold text-fg mb-2">{t('dashboard.indicesTitle')}</h2>
          <p className="text-fg-muted">{t('dashboard.indicesDescription')}</p>
        </Link>
      </div>
    </div>
  );
}
