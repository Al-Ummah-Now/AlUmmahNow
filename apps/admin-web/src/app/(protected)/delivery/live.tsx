/**
 * Live transcoder figures of the Delivery page (epic #687): transcoding now
 * out of the maximum, jobs waiting, and the oldest wait. Presentational,
 * server and client safe; LiveTranscodes refreshes it.
 */
import type { MediaLive } from '@/lib/api/types';
import type { Translator } from '@/i18n/translate';
import Link from '@/components/AppLink';
import { cardClass, linkClass } from '@/components/ui';

import { deliveryFormats } from './format';
import { numberFormat } from '@al-ummah/shared-types';

import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
export interface LiveFiguresProps {
  live: MediaLive | null;
  t: Translator;
  locale: string;
  /** The last refresh failed: the figures shown are older */
  stale?: boolean;
  /** Where the max concurrent transcodes setting is changed (admins only; absent for moderators) */
  settingsHref?: string;
}

function Figure({ label, value, testId, note, link }: { label: string; value: string; testId: string; note?: { text: string; testId: string }; link?: { href: string; text: string } }) {
  return (
    <div className="rounded border border-border bg-surface-2 p-4">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-fg tabular-nums" data-testid={testId}>{value}</dd>
      {note && <dd className="mt-1 text-xs text-fg-muted" data-testid={note.testId}>{note.text}</dd>}
      {link && (
        <dd className="mt-1 text-xs">
          <Link href={link.href} className={linkClass} data-testid="delivery-live-limit-link">{link.text}</Link>
        </dd>
      )}
    </div>
  );
}

/** Seconds with one decimal ("6.2 s"), in the page's digits. */
function seconds(ms: number, locale: string): string {
  return numberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'short', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ms / 1000);
}

/** How long transcodes took to start (the attempt began → FFmpeg running), recent p50/p95, cold vs warm. */
function StartTimes({ live, t, locale }: { live: MediaLive; t: Translator; locale: string }) {
  const s = live.startTimes;
  if (s === undefined) return null;
  if (!s || !s.samples || s.p50Ms === null || s.p95Ms === null) {
    return <p className="mt-3 text-sm text-fg-muted" data-testid="delivery-live-start">{t('mediaDelivery.liveStartNone')}</p>;
  }
  const parts = [t('mediaDelivery.liveStart', { days: numberFormat(locale).format(s.days), p50: seconds(s.p50Ms, locale), p95: seconds(s.p95Ms, locale), n: numberFormat(locale).format(s.samples) })];
  if (s.cold.p50Ms !== null) parts.push(t('mediaDelivery.liveStartCold', { p50: seconds(s.cold.p50Ms, locale) }));
  if (s.warm.p50Ms !== null) parts.push(t('mediaDelivery.liveStartWarm', { p50: seconds(s.warm.p50Ms, locale) }));
  return <p className="mt-3 text-sm text-fg" data-testid="delivery-live-start">{parts.join(t('common.sep'))}</p>;
}

export function LiveFigures({ live, t, locale, stale = false, settingsHref }: LiveFiguresProps) {
  const f = deliveryFormats(locale);
  const updated = live ? new Date(live.at) : null;
  return (
    <section className={`${cardClass} mb-6`} aria-labelledby="delivery-live-title" data-testid="delivery-live">
      <h2 id="delivery-live-title" className="text-lg font-semibold text-fg mb-1">{t('mediaDelivery.liveTitle')}</h2>
      <p className="text-fg-muted text-sm mb-4">{t('mediaDelivery.liveIntro')}</p>
      {live ? (
        <>
          {live.rangeMin !== null && live.rangeMax !== null && (
            // "N running · M waiting · range min–max"
            <p className="mb-3 text-base font-medium text-fg tabular-nums" data-testid="delivery-live-summary">
              {t('mediaDelivery.liveSummary', { running: f.integer(live.transcoding), waiting: f.integer(live.queued), min: f.integer(live.rangeMin), max: f.integer(live.rangeMax) })}
            </p>
          )}
          <dl className="grid gap-3 sm:grid-cols-3">
            <Figure
              label={t('mediaDelivery.liveTranscoding')}
              value={f.integer(live.transcoding)}
              testId="delivery-live-transcoding"
              // The admin's range (autoscaled min–max) and the ceiling beside it
              note={
                live.rangeMin !== null && live.rangeMax !== null
                  ? {
                      text: [t('mediaDelivery.liveRange', { min: f.integer(live.rangeMin), max: f.integer(live.rangeMax) }), live.ceiling ? t('mediaDelivery.liveCeiling', { c: f.integer(live.ceiling) }) : null].filter(Boolean).join(t('common.sep')),
                      testId: 'delivery-live-ceiling',
                    }
                  : undefined
              }
              link={settingsHref ? { href: settingsHref, text: t('mediaDelivery.liveLimitLink') } : undefined}
            />
            <Figure label={t('mediaDelivery.liveQueued')} value={f.integer(live.queued)} testId="delivery-live-queued" />
            <Figure
              label={t('mediaDelivery.liveOldest')}
              value={live.queued > 0 && live.oldestQueuedSeconds !== null ? f.duration(live.oldestQueuedSeconds) : t('mediaDelivery.liveNoWait')}
              testId="delivery-live-oldest"
            />
          </dl>
          <StartTimes live={live} t={t} locale={locale} />
          <p className="mt-3 text-xs text-fg-muted" data-testid="delivery-live-updated">
            {updated && !Number.isNaN(updated.getTime())
              ? fillNodes(t('mediaDelivery.liveUpdated'), { time: <LocalTime value={updated} clock locale={locale} /> })
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
