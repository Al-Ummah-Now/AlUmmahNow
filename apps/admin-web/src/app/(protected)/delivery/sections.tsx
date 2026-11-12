/**
 * Server-rendered sections of the Delivery comparison page: Speed, Playback
 * (table and daily charts) and Cost (measured use and the projection).
 */
import type { MediaSummary } from '@/lib/api/types';
import type { Translator } from '@/i18n/translate';
import { cardClass } from '@/components/ui';
import { DailyChart, SeriesSwatch } from './DailyChart';
import { deliveryFormats } from './format';
import {
  MONTHLY_CAP_USD,
  PROVIDERS,
  SCALES,
  dailySeries,
  periodDays,
  playbackTotals,
  projectMonthlyCost,
  transcodeCost,
  unitCosts,
  type PlaybackStats,
  type Projection,
  type Provider,
} from './metrics';

interface SectionProps {
  summary: MediaSummary;
  t: Translator;
  locale: string;
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded border border-border bg-surface-2 p-4">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-fg tabular-nums" data-testid={testId}>{value}</dd>
    </div>
  );
}

export function SpeedSection({ summary, t, locale }: SectionProps) {
  const f = deliveryFormats(locale);
  const j = summary.jobs;
  const time = (v: number | null | undefined) => (v === null || v === undefined ? t('mediaDelivery.noValue') : f.duration(v));
  const count = (v: number | null | undefined) => f.integer(v ?? 0);
  return (
    <section className={`${cardClass} mb-6`} aria-labelledby="delivery-speed-title" data-testid="delivery-speed">
      <h2 id="delivery-speed-title" className="text-lg font-semibold text-fg mb-1">{t('mediaDelivery.speedTitle')}</h2>
      <p className="text-fg-muted text-sm mb-4">{t('mediaDelivery.speedIntro')}</p>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label={t('mediaDelivery.r2Playable')} value={time(j?.r2_seconds_to_playable)} testId="delivery-r2-playable" />
        <Stat label={t('mediaDelivery.bunnyPlayable')} value={time(j?.bunny_seconds_to_playable)} testId="delivery-bunny-playable" />
        <Stat label={t('mediaDelivery.jobsTotal')} value={count(j?.jobs)} testId="delivery-jobs-total" />
        <Stat label={t('mediaDelivery.jobsReady')} value={count(j?.ready)} testId="delivery-jobs-ready" />
        <Stat label={t('mediaDelivery.jobsFailed')} value={count(j?.failed)} testId="delivery-jobs-failed" />
        <Stat label={t('mediaDelivery.jobsRunning')} value={count(j?.running)} testId="delivery-jobs-running" />
      </dl>
    </section>
  );
}

export function PlaybackSection({ summary, t, locale }: SectionProps) {
  const f = deliveryFormats(locale);
  const totals = playbackTotals(summary.qoe);
  const days = periodDays(summary.days);
  const daily = dailySeries(summary.qoe, days);
  const none = t('mediaDelivery.noValue');
  const show = (v: number | null, format: (n: number) => string) => (v === null ? none : format(v));
  const rows: { key: string; label: string; value: (s: PlaybackStats, p: Provider) => string }[] = [
    { key: 'sessions', label: t('mediaDelivery.mSessions'), value: (s) => f.integer(s.sessions) },
    { key: 'viewerHours', label: t('mediaDelivery.mViewerHours'), value: (s) => f.hours(s.viewerHours) },
    { key: 'startup', label: t('mediaDelivery.mStartup'), value: (s) => show(s.startupMs === null ? null : s.startupMs / 1000, f.seconds) },
    { key: 'rebuffer', label: t('mediaDelivery.mRebuffer'), value: (s) => show(s.rebufferRatio, f.percent) },
    { key: 'avgKbps', label: t('mediaDelivery.mAvgKbps'), value: (s) => show(s.avgKbps, f.kbps) },
    { key: 'peakKbps', label: t('mediaDelivery.mPeakKbps'), value: (s) => show(s.peakKbps, f.kbps) },
    { key: 'switches', label: t('mediaDelivery.mSwitches'), value: (s) => show(s.switchesPerSession, f.decimal) },
    { key: 'errors', label: t('mediaDelivery.mErrors'), value: (s) => show(s.errorRate, f.percent) },
    { key: 'fallbacks', label: t('mediaDelivery.mFallbacks'), value: (s, p) => (p === 'bunny' ? t('mediaDelivery.notApplicable') : show(s.fallbackRate, f.percent)) },
  ];
  const labels = (title: string) => ({
    chart: t('mediaDelivery.chartLabel', { title }),
    table: t('mediaDelivery.chartTable'),
    day: t('mediaDelivery.colDay'),
    bunny: t('mediaDelivery.colBunny'),
    r2: t('mediaDelivery.colR2'),
    legendBunny: t('mediaDelivery.legendBunny'),
    legendR2: t('mediaDelivery.legendR2'),
    empty: t('mediaDelivery.chartEmpty'),
    noValue: none,
  });
  const empty = totals.bunny.sessions === 0 && totals.r2.sessions === 0;
  return (
    <section className={`${cardClass} mb-6`} aria-labelledby="delivery-playback-title" data-testid="delivery-playback">
      <h2 id="delivery-playback-title" className="text-lg font-semibold text-fg mb-1">{t('mediaDelivery.playbackTitle')}</h2>
      <p className="text-fg-muted text-sm mb-4">{t('mediaDelivery.playbackIntro')}</p>
      {empty && <p className="mb-4 text-fg-muted" data-testid="delivery-playback-empty">{t('mediaDelivery.playbackEmpty')}</p>}
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm" data-testid="delivery-playback-table">
          <caption className="sr-only">{t('mediaDelivery.playbackCaption')}</caption>
          <thead className="border-b border-border">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium text-fg-muted">{t('mediaDelivery.colMeasure')}</th>
              {PROVIDERS.map((p) => (
                <th key={p} scope="col" className="px-3 py-2 text-end font-medium text-fg-muted">
                  <span className="inline-flex items-center gap-2">
                    <SeriesSwatch kind={p} />
                    {t(p === 'bunny' ? 'mediaDelivery.colBunny' : 'mediaDelivery.colR2')}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-border last:border-0" data-measure={row.key}>
                <th scope="row" className="px-3 py-2 text-start font-normal text-fg">{row.label}</th>
                {PROVIDERS.map((p) => (
                  <td key={p} className="px-3 py-2 text-end tabular-nums text-fg" data-provider={p}>{row.value(totals[p], p)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <DailyChart
          title={t('mediaDelivery.chartStartupTitle')}
          days={days}
          bunny={daily.bunny.map((d) => d.startupS)}
          r2={daily.r2.map((d) => d.startupS)}
          unit="seconds"
          locale={locale}
          labels={labels(t('mediaDelivery.chartStartupTitle'))}
          testId="delivery-startup-chart"
        />
        <DailyChart
          title={t('mediaDelivery.chartRebufferTitle')}
          days={days}
          bunny={daily.bunny.map((d) => d.rebuffer)}
          r2={daily.r2.map((d) => d.rebuffer)}
          unit="ratio"
          locale={locale}
          labels={labels(t('mediaDelivery.chartRebufferTitle'))}
          testId="delivery-rebuffer-chart"
        />
      </div>
    </section>
  );
}

function CapBadge({ fits, t }: { fits: boolean; t: Translator }) {
  // Text, not colour alone: the word says whether it fits
  return (
    <span className={`ms-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${fits ? 'bg-chip-resolved-bg text-chip-resolved-fg' : 'bg-danger-bg text-danger-fg'}`} data-fits={fits}>
      {fits ? t('mediaDelivery.fits') : t('mediaDelivery.over')}
    </span>
  );
}

export function CostSection({ summary, t, locale }: SectionProps) {
  const f = deliveryFormats(locale);
  const used = transcodeCost(summary.jobs);
  const unit = unitCosts(summary.jobs, summary.costs, playbackTotals(summary.qoe));
  const projections = SCALES.map((scale) => projectMonthlyCost(scale, unit));
  const none = t('mediaDelivery.noValue');
  const range = (low: number, high: number) => t('mediaDelivery.range', { low: f.usd(low), high: f.usd(high) });
  const scaleName = { small: t('mediaDelivery.scaleSmall'), medium: t('mediaDelivery.scaleMedium'), large: t('mediaDelivery.scaleLarge') };
  const rows: { key: string; label: string; cell: (p: Projection) => React.ReactNode; strong?: boolean }[] = [
    { key: 'r2Transcode', label: t('mediaDelivery.rowR2Transcode'), cell: (p) => f.usd(p.r2.transcode) },
    { key: 'r2Storage', label: t('mediaDelivery.rowR2Storage'), cell: (p) => f.usd(p.r2.storage) },
    { key: 'r2Ops', label: t('mediaDelivery.rowR2Ops'), cell: (p) => f.usd(p.r2.ops) },
    { key: 'r2Total', label: t('mediaDelivery.rowR2Total'), strong: true, cell: (p) => <>{f.usd(p.r2.total)}<CapBadge fits={p.fits.r2} t={t} /></> },
    { key: 'bunnyStorage', label: t('mediaDelivery.rowBunnyStorage'), cell: (p) => f.usd(p.bunny.storage) },
    { key: 'bunnyDelivery', label: t('mediaDelivery.rowBunnyDelivery'), cell: (p) => range(p.bunny.deliveryLow, p.bunny.deliveryHigh) },
    { key: 'bunnyTotal', label: t('mediaDelivery.rowBunnyTotal'), strong: true, cell: (p) => <>{range(p.bunny.totalLow, p.bunny.totalHigh)}<CapBadge fits={p.fits.bunny} t={t} /></> },
    { key: 'both', label: t('mediaDelivery.rowBoth'), strong: true, cell: (p) => <>{range(p.both.low, p.both.high)}<CapBadge fits={p.fits.both} t={t} /></> },
  ];
  const units: { key: keyof typeof unit.measured; label: string; value: string }[] = [
    { key: 'transcode', label: t('mediaDelivery.unitTranscode'), value: f.decimal(unit.containerSecondsPerVideoMinute) },
    { key: 'storage', label: t('mediaDelivery.unitStorage'), value: f.decimal(unit.storedGbPerVideoMinute) },
    { key: 'classA', label: t('mediaDelivery.unitClassA'), value: f.decimal(unit.classAPerVideoMinute) },
    { key: 'classB', label: t('mediaDelivery.unitClassB'), value: f.decimal(unit.classBPerViewerHour) },
    { key: 'delivery', label: t('mediaDelivery.unitDelivery'), value: f.decimal(unit.gbPerViewerHour) },
  ];
  return (
    <section className={`${cardClass} mb-6`} aria-labelledby="delivery-cost-title" data-testid="delivery-cost">
      <h2 id="delivery-cost-title" className="text-lg font-semibold text-fg mb-1">{t('mediaDelivery.costTitle')}</h2>
      <p className="text-fg-muted text-sm mb-4">{t('mediaDelivery.costIntro')}</p>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label={t('mediaDelivery.containerSeconds')} value={f.hours(used.containerSeconds / 3600)} testId="delivery-container-time" />
        <Stat label={t('mediaDelivery.perVideoMinute')} value={used.perVideoMinute === null ? none : f.decimal(used.perVideoMinute)} testId="delivery-per-minute" />
        <Stat label={t('mediaDelivery.usdPerVideoMinute')} value={used.usdPerVideoMinute === null ? none : f.usd(used.usdPerVideoMinute)} testId="delivery-usd-per-minute" />
        <Stat label={t('mediaDelivery.storedGb')} value={f.gb(used.storedGb)} testId="delivery-stored" />
      </dl>

      <h3 className="font-semibold text-fg mb-1">{t('mediaDelivery.projectionTitle', { cap: f.usd(MONTHLY_CAP_USD) })}</h3>
      <p className="text-fg-muted text-sm mb-3">{t('mediaDelivery.projectionIntro')}</p>
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm" data-testid="delivery-projection">
          <caption className="sr-only">{t('mediaDelivery.projectionCaption')}</caption>
          <thead className="border-b border-border">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium text-fg-muted">{t('mediaDelivery.colItem')}</th>
              {projections.map((p) => (
                <th key={p.scale.id} scope="col" className="px-3 py-2 text-end font-medium text-fg-muted align-bottom">
                  <span className="block text-fg">{scaleName[p.scale.id]}</span>
                  <span className="block text-xs font-normal">{t('mediaDelivery.scaleVolume', { upload: f.integer(p.scale.uploadHours), watched: f.integer(p.scale.viewerHours) })}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-border last:border-0" data-row={row.key}>
                <th scope="row" className={`px-3 py-2 text-start text-fg ${row.strong ? 'font-semibold' : 'font-normal'}`}>{row.label}</th>
                {projections.map((p) => (
                  <td key={p.scale.id} className={`px-3 py-2 text-end tabular-nums text-fg ${row.strong ? 'font-semibold' : ''}`} data-scale={p.scale.id}>
                    {row.cell(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-fg-muted underline">{t('mediaDelivery.unitsTitle')}</summary>
        <ul className="mt-2 space-y-1" data-testid="delivery-units">
          {units.map((u) => (
            <li key={u.key} className="text-fg" data-measured={unit.measured[u.key]}>
              {u.label}: <span className="tabular-nums">{u.value}</span> ({unit.measured[u.key] ? t('mediaDelivery.measured') : t('mediaDelivery.assumed')})
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
