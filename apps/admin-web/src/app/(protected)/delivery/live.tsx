/**
 * Live transcoder figures of the Delivery page (epic #687): transcoding now
 * out of the maximum, jobs waiting, and the oldest wait. Presentational,
 * server and client safe; LiveTranscodes refreshes it.
 */
import type { MediaLive } from '@/lib/api/types';
import type { Translator } from '@/i18n/translate';
import { cardClass } from '@/components/ui';
import { deliveryFormats } from './format';

export interface LiveFiguresProps {
  live: MediaLive | null;
  t: Translator;
  locale: string;
  /** The last refresh failed: the figures shown are older */
  stale?: boolean;
}

function Figure({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded border border-border bg-surface-2 p-4">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-fg tabular-nums" data-testid={testId}>{value}</dd>
    </div>
  );
}

export function LiveFigures({ live, t, locale, stale = false }: LiveFiguresProps) {
  const f = deliveryFormats(locale);
  const updated = live ? new Date(live.at) : null;
  return (
    <section className={`${cardClass} mb-6`} aria-labelledby="delivery-live-title" data-testid="delivery-live">
      <h2 id="delivery-live-title" className="text-lg font-semibold text-fg mb-1">{t('mediaDelivery.liveTitle')}</h2>
      <p className="text-fg-muted text-sm mb-4">{t('mediaDelivery.liveIntro')}</p>
      {live ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Figure
              label={t('mediaDelivery.liveTranscoding')}
              value={live.maxTranscodes === null ? f.integer(live.transcoding) : t('mediaDelivery.liveOf', { n: f.integer(live.transcoding), m: f.integer(live.maxTranscodes) })}
              testId="delivery-live-transcoding"
            />
            <Figure label={t('mediaDelivery.liveQueued')} value={f.integer(live.queued)} testId="delivery-live-queued" />
            <Figure
              label={t('mediaDelivery.liveOldest')}
              value={live.queued > 0 && live.oldestQueuedSeconds !== null ? f.duration(live.oldestQueuedSeconds) : t('mediaDelivery.liveNoWait')}
              testId="delivery-live-oldest"
            />
          </dl>
          <p className="mt-3 text-xs text-fg-muted" data-testid="delivery-live-updated">
            {updated && !Number.isNaN(updated.getTime())
              ? t('mediaDelivery.liveUpdated', { time: new Intl.DateTimeFormat(locale, { timeStyle: 'medium' }).format(updated) })
              : null}
            {stale && <span className="ms-2 text-danger-fg" data-testid="delivery-live-stale">{t('mediaDelivery.liveStale')}</span>}
          </p>
        </>
      ) : (
        <p className="text-fg-muted" data-testid="delivery-live-unavailable">{t('mediaDelivery.liveUnavailable')}</p>
      )}
    </section>
  );
}
