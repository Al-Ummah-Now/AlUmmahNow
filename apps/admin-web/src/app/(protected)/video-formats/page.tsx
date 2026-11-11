import Link from '@/components/AppLink';
import { getLatestVideoFormatRun, listFlaggedVideoFormats } from '@/lib/api/admin';
import type { FlaggedVideoList, VideoFormatRunView } from '@/lib/api/types';
import { getI18n } from '@/i18n/server';
import type { MessageKey } from '@/i18n/translate';
import { formatDate, formatNumber } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { RunBackfill, SetFormatButtons } from './VideoFormatActions';

export const dynamic = 'force-dynamic';

const PAGE = 25;
const thClass = 'text-start px-4 py-3 text-fg-muted font-medium whitespace-nowrap';

const TOTALS: Array<[keyof VideoFormatRunView['totals'], MessageKey]> = [
  ['scanned', 'videoFormats.totalScanned'],
  ['shorts', 'videoFormats.totalShorts'],
  ['videos', 'videoFormats.totalVideos'],
  ['becameShorts', 'videoFormats.totalBecameShorts'],
  ['becameVideos', 'videoFormats.totalBecameVideos'],
  ['overrides', 'videoFormats.totalOverrides'],
  ['dimensionsStored', 'videoFormats.totalDimensions'],
  ['rechecking', 'videoFormats.totalRechecking'],
  ['flagged', 'videoFormats.totalFlagged'],
  ['errors', 'videoFormats.totalErrors'],
];

/** Short vs video: backfill runs and the videos an admin must classify by hand. */
export default async function VideoFormatsPage({ searchParams }: { searchParams: Promise<{ offset?: string }> }) {
  const { t, locale } = await getI18n();
  const offset = Math.max(0, Number((await searchParams).offset) || 0);
  let run: VideoFormatRunView | null = null;
  let flagged: FlaggedVideoList | null = null;
  let failed = false;
  try {
    [run, flagged] = await Promise.all([getLatestVideoFormatRun(), listFlaggedVideoFormats(PAGE, offset)]);
  } catch (e) {
    failed = true;
    logger.error('[video-formats] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-fg">{t('videoFormats.title')}</h1>
        <p className="text-fg-muted mt-2">{t('videoFormats.subtitle')}</p>
      </div>
      {failed && <ErrorAlert testId="video-formats-error">{t('errors.loadVideoFormats')}</ErrorAlert>}

      <section className={`${cardClass} mb-8`} aria-labelledby="vf-run" data-testid="video-formats-run">
        <h2 id="vf-run" className="text-lg font-semibold text-fg mb-2">{t('videoFormats.runTitle')}</h2>
        <p className="text-fg-muted text-sm mb-4">{t('videoFormats.runHelp')}</p>
        <RunBackfill />
        {run ? (
          <div className="mt-6" data-testid="video-formats-latest" data-status={run.status} data-dry-run={run.dryRun}>
            <p className="text-sm text-fg mb-4">
              {t('videoFormats.status')}: <strong>{run.status === 'done' ? t('videoFormats.statusDone') : t('videoFormats.statusRunning')}</strong>
              {' · '}
              {run.dryRun ? t('videoFormats.kindDry') : t('videoFormats.kindApply')}
              {' · '}
              {t('videoFormats.startedAt')} <time dateTime={run.startedAt}>{formatDate(run.startedAt, locale, true)}</time>
              {' · '}
              {t('videoFormats.pages')} {formatNumber(run.pagesDone, locale)}
            </p>
            {run.lastError && <ErrorAlert testId="video-formats-run-error">{`${t('videoFormats.lastError')}: ${run.lastError}`}</ErrorAlert>}
            <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {TOTALS.map(([key, label]) => (
                <div key={key} data-testid={`video-formats-total-${key}`} data-value={run!.totals[key]}>
                  <dt className="text-fg-muted text-xs font-medium">{t(label)}</dt>
                  <dd className="text-2xl font-bold text-fg">{formatNumber(run!.totals[key], locale)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          !failed && <p className="mt-6 text-fg-muted text-sm" data-testid="video-formats-no-run">{t('videoFormats.noRun')}</p>
        )}
      </section>

      <section aria-labelledby="vf-flagged" data-testid="video-formats-flagged">
        <h2 id="vf-flagged" className="text-lg font-semibold text-fg mb-1">{t('videoFormats.flaggedTitle')}</h2>
        <p className="text-fg-muted text-sm mb-4">{t('videoFormats.flaggedHelp')}</p>
        {flagged && flagged.total === 0 && (
          <div className={`${cardClass} text-center text-fg-muted`} data-testid="video-formats-flagged-none">{t('videoFormats.flaggedNone')}</div>
        )}
        {flagged && flagged.total > 0 && (
          <>
            <p className="text-sm text-fg-muted mb-2">{t('videoFormats.flaggedCount', { count: formatNumber(flagged.total, locale) })}</p>
            <div
              className="bg-surface border border-border rounded-lg overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              role="region"
              aria-label={t('videoFormats.flaggedTitle')}
              tabIndex={0}
            >
              <table className="w-full">
                <thead className="bg-surface-2">
                  <tr>
                    <th scope="col" className={thClass}>{t('videoFormats.colVideo')}</th>
                    <th scope="col" className={thClass}>{t('videoFormats.colLength')}</th>
                    <th scope="col" className={thClass}>{t('videoFormats.colSize')}</th>
                    <th scope="col" className={thClass}>{t('videoFormats.colReason')}</th>
                    <th scope="col" className={thClass}>{t('videoFormats.colAction')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {flagged.items.map((v) => (
                    <tr key={v.id} data-testid="video-formats-flagged-row" data-video-id={v.id}>
                      <td className="px-4 py-3 text-fg">
                        <div className="font-medium">{v.title || v.id}</div>
                        <div className="text-xs text-fg-muted font-mono" dir="ltr">{v.id}</div>
                      </td>
                      <td className="px-4 py-3 text-fg whitespace-nowrap" dir="ltr">{v.duration ? `${formatNumber(Math.round(v.duration), locale)} s` : t('videoFormats.unknown')}</td>
                      <td className="px-4 py-3 text-fg whitespace-nowrap" dir="ltr">{v.width && v.height ? `${v.width}×${v.height}` : t('videoFormats.unknown')}</td>
                      <td className="px-4 py-3 text-fg-muted text-sm">{v.formatIssue?.reason}</td>
                      <td className="px-4 py-3"><SetFormatButtons id={v.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="flex gap-4 mt-4" aria-label={t('videoFormats.flaggedTitle')}>
              {offset > 0 && <Link className={linkClass} href={`/video-formats?offset=${Math.max(0, offset - PAGE)}`}>{t('videoFormats.previous')}</Link>}
              {offset + PAGE < flagged.total && <Link className={linkClass} href={`/video-formats?offset=${offset + PAGE}`}>{t('videoFormats.next')}</Link>}
            </nav>
          </>
        )}
      </section>
    </div>
  );
}
