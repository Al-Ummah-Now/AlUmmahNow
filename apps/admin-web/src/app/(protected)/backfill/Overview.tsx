'use client';

/**
 * This environment before any run: live counts of the videos with no R2 rendition yet and what moving all of
 * them would cost, likely (measured rates) and at the ceiling. Admins run it in batches (a channel or a date
 * range), each with its own estimate and cap; nothing starts from here.
 */
import type { BackfillCost, BackfillOverview } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { cardClass } from '@/components/ui';
import { useFormats } from './useFormats';
import { Sep } from '@/components/Sep';

export function Overview({ overview, environment }: { overview: BackfillOverview; environment: string }) {
  const { t } = useLanguage();
  const f = useFormats();
  const rows: { key: 'likely' | 'ceiling'; label: string; cost: BackfillCost }[] = [
    { key: 'likely', label: t('mediaBackfill.overviewLikely'), cost: overview.likely },
    { key: 'ceiling', label: t('mediaBackfill.overviewCeiling'), cost: overview.ceiling },
  ];
  return (
    <section className={cardClass} aria-labelledby="backfill-overview-title" data-testid="backfill-overview">
      <h2 id="backfill-overview-title" className="text-xl font-semibold text-fg">{t('mediaBackfill.overviewTitle', { env: environment })}</h2>
      <p className="text-sm text-fg-muted mt-1" data-testid="backfill-overview-counts">
        {t('mediaBackfill.overviewCounts', { videos: f.integer(overview.videos), time: f.duration(overview.videoSeconds) })}
        {' '}
        {overview.bunnyStoredBytes === null ? t('mediaBackfill.overviewBunnyUnknown') : t('mediaBackfill.overviewBunny', { size: f.gb(overview.bunnyStoredBytes / 1e9) })}
      </p>
      <div className="mt-4 overflow-x-auto rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" tabIndex={0} role="region" aria-labelledby="backfill-overview-title">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('mediaBackfill.overviewCaption')}</caption>
          <thead>
            <tr className="text-start text-fg-muted">
              <th scope="col" className="py-2 pe-4 text-start font-medium">{t('mediaBackfill.overviewCase')}</th>
              <th scope="col" className="py-2 pe-4 text-start font-medium">{t('mediaBackfill.estTranscode')}</th>
              <th scope="col" className="py-2 pe-4 text-start font-medium">{t('mediaBackfill.estEgress')}</th>
              <th scope="col" className="py-2 pe-4 text-start font-medium">{t('mediaBackfill.estOps')}</th>
              <th scope="col" className="py-2 pe-4 text-start font-medium">{t('mediaBackfill.estStorage')}</th>
              <th scope="col" className="py-2 text-start font-medium">{t('mediaBackfill.estTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, cost }) => (
              <tr key={key} className="border-t border-border" data-testid={`backfill-overview-${key}`}>
                <th scope="row" className="py-2 pe-4 text-start font-medium text-fg">{label}</th>
                <td className="py-2 pe-4 text-fg">{f.integer(cost.transcodeSeconds / 60)}<Sep />{f.usd(cost.transcodeUsd)}</td>
                <td className="py-2 pe-4 text-fg">{f.gb(cost.egressBytes / 1e9)}<Sep />{f.usd(cost.egressUsd)}</td>
                <td className="py-2 pe-4 text-fg">{f.integer(cost.classAOps)}<Sep />{f.usd(cost.opsUsd)}</td>
                <td className="py-2 pe-4 text-fg">{f.gb(cost.storageBytes / 1e9)}<Sep />{f.usd(cost.storageUsdMonth)}</td>
                <td className="py-2 font-bold text-fg" data-testid={`backfill-overview-${key}-total`}>{f.usd(cost.totalUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-fg-muted">
        {overview.basis.assumed ? t('mediaBackfill.basisAssumed') : t('mediaBackfill.basisMeasured', { jobs: f.integer(overview.basis.jobs) })}
        {' '}{t('mediaBackfill.overviewCeilingHint')}
      </p>
      <p className="mt-1 text-sm text-fg">{t('mediaBackfill.overviewBatches')}</p>
    </section>
  );
}
