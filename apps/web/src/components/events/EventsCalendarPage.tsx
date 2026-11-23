'use client';

/**
 * Online Event Calendar page (`/[locale]/events`, Epic 22 E22-S6 & E22-D7).
 *
 * Uses the shared frosted-glass surface primitive (`pb-t-raised` from `@al-ummah/shared-types/page-blocks.css`, O36),
 * dual Gregorian + Hijri dates with Eastern Arabic numerals in Arabic (O35, O38), `.ics` feed links,
 * `alummahnow.link/e/<streamId>` short-link sharing, and Epic 17 reminder toggles.
 */
import '@al-ummah/shared-types/page-blocks.css';
import React, { useCallback, useState } from 'react';
import { Bell, BellRing, Calendar, Check, Copy, Play, Radio, Share2 } from 'lucide-react';
import {
  EVENT_CALENDAR_TYPES,
  metaSeparator,
  type CalendarEventItem,
  type EventCalendarType,
} from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { MAIN_CONTENT_ID } from '@/components/SkipLinks';
import { useOptionalAuth } from '@/components/AuthProvider/authContext';
import { useFeatures } from '@/hooks/useFeatures';
import { useHydrated } from '@/hooks/useHydrated';
import { shareLink } from '@/lib/share/short-link';
import { EventsService } from '@/services/api/events';
import { EVENTS_COPY, eventTypeLabel, formatEventSchedule } from '@/lib/events/events-copy';

interface EventsCalendarPageProps {
  locale: 'en' | 'ar';
  initialItems: CalendarEventItem[];
  initialCursor: string | null;
  initialError?: boolean;
  /** Optional fixed timezone for deterministic unit tests */
  timeZone?: string;
}

export function EventsCalendarPage({
  locale,
  initialItems,
  initialCursor,
  initialError = false,
  timeZone,
}: EventsCalendarPageProps) {
  const c = EVENTS_COPY[locale];
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const { user } = useOptionalAuth();
  const { features } = useFeatures();
  const separator = metaSeparator(locale, '·');
  const hydrated = useHydrated();
  const displayTimeZone = timeZone ?? (hydrated ? undefined : 'UTC');

  const [items, setItems] = useState<CalendarEventItem[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<string | null>(initialCursor);
  const [selectedType, setSelectedType] = useState<EventCalendarType | 'all'>('all');
  const [subscribedOnly, setSubscribedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadFailed, setLoadFailed] = useState(initialError);
  const [copiedIcs, setCopiedIcs] = useState(false);
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
  const [pendingReminderId, setPendingReminderId] = useState<string | null>(null);

  const reload = useCallback(
    async (nextType: EventCalendarType | 'all', nextSubscribed: boolean) => {
      setLoading(true);
      setLoadFailed(false);
      const outcome = await EventsService.list({
        eventType: nextType === 'all' ? null : nextType,
        subscribedOnly: nextSubscribed,
        limit: 24,
      });
      setLoading(false);
      if (outcome.status === 'ok') {
        setItems(outcome.items);
        setNextCursor(outcome.nextCursor);
      } else {
        setLoadFailed(true);
      }
    },
    [],
  );

  const onSelectType = (type: EventCalendarType | 'all') => {
    setSelectedType(type);
    void reload(type, subscribedOnly);
  };

  const onSelectScope = (subOnly: boolean) => {
    setSubscribedOnly(subOnly);
    void reload(selectedType, subOnly);
  };

  const onLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const outcome = await EventsService.list({
      eventType: selectedType === 'all' ? null : selectedType,
      subscribedOnly,
      cursor: nextCursor,
      limit: 24,
    });
    setLoadingMore(false);
    if (outcome.status === 'ok') {
      setItems((prev) => [...prev, ...outcome.items]);
      setNextCursor(outcome.nextCursor);
    }
  };

  const copyIcsUrl = async () => {
    try {
      await navigator.clipboard.writeText(EventsService.icsUrl(null, locale));
      setCopiedIcs(true);
      setTimeout(() => setCopiedIcs(false), 2200);
    } catch {}
  };

  const shareEvent = async (ev: CalendarEventItem) => {
    const fallback = typeof window !== 'undefined' ? `${window.location.origin}/${locale}${ev.watchPath}` : `/${locale}${ev.watchPath}`;
    const link = shareLink({ kind: 'live', id: ev.streamId }, fallback, { locale });
    try {
      await navigator.clipboard.writeText(link);
      setCopiedEventId(ev.streamId);
      setTimeout(() => setCopiedEventId((cur) => (cur === ev.streamId ? null : cur)), 2200);
    } catch {}
  };

  const toggleReminder = async (ev: CalendarEventItem) => {
    if (!user || pendingReminderId) return;
    const nextRemind = !ev.viewerReminded;
    setPendingReminderId(ev.streamId);
    setItems((prev) =>
      prev.map((item) =>
        item.streamId === ev.streamId
          ? {
              ...item,
              viewerReminded: nextRemind,
              reminderCount: Math.max(0, item.reminderCount + (nextRemind ? 1 : -1)),
            }
          : item,
      ),
    );
    const ok = await EventsService.setReminder(ev.streamId, nextRemind);
    setPendingReminderId(null);
    if (!ok) {
      setItems((prev) =>
        prev.map((item) => (item.streamId === ev.streamId ? ev : item)),
      );
    }
  };

  const pillClass = (active: boolean) =>
    active
      ? 'min-h-10 rounded-full bg-[var(--aun-btn-filled-bg)] px-4 py-1.5 text-sm font-semibold text-[var(--aun-btn-filled-fg)] transition-colors'
      : 'min-h-10 rounded-full border border-[var(--fanous-color-outline)] bg-transparent px-4 py-1.5 text-sm font-medium text-[var(--fanous-color-text-primary)] hover:border-[var(--fanous-color-accent)] transition-colors';

  const flatBtnClass =
    'inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--fanous-color-outline)] bg-transparent px-3.5 py-1.5 text-sm font-medium text-[var(--fanous-color-text-primary)] hover:border-[var(--fanous-color-accent)] transition-colors';

  return (
    <main id={MAIN_CONTENT_ID} dir={dir} data-testid="events-page" className="w-full flex-1 py-6 md:py-10">
      <div className="pb" lang={locale} dir={dir}>
        <header className="pb-b pb-w-content pb-t-raised pb-a-start pb-s-m" data-testid="events-header">
          <div className="pb-in">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <Calendar className="h-6 w-6 text-[var(--fanous-color-accent)]" aria-hidden="true" />
                  <h1 className="pb-heading !m-0">{c.title}</h1>
                </div>
                <p className="pb-intro !m-0">{c.lead}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={EventsService.icsUrl(null, locale)}
                  download="alummahnow-events.ics"
                  data-testid="events-ics-link"
                  className={flatBtnClass}
                >
                  <Calendar className="h-4 w-4 text-[var(--fanous-color-accent)]" aria-hidden="true" />
                  <span>{c.subscribeIcs}</span>
                </a>
                <button
                  type="button"
                  onClick={() => void copyIcsUrl()}
                  data-testid="events-copy-ics"
                  className={flatBtnClass}
                >
                  {copiedIcs ? <Check className="h-4 w-4 text-[var(--fanous-color-accent)]" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  <span>{copiedIcs ? c.copiedCalendarLink : c.copyCalendarLink}</span>
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 border-t border-[var(--fanous-color-divider)] pt-4" data-testid="events-filters">
              {user && (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={c.scopeLabel}>
                  <button
                    type="button"
                    aria-pressed={!subscribedOnly}
                    onClick={() => onSelectScope(false)}
                    data-testid="events-scope-all"
                    className={pillClass(!subscribedOnly)}
                  >
                    {c.allChannels}
                  </button>
                  <button
                    type="button"
                    aria-pressed={subscribedOnly}
                    onClick={() => onSelectScope(true)}
                    data-testid="events-scope-subscribed"
                    className={pillClass(subscribedOnly)}
                  >
                    {c.subscribedChannels}
                  </button>
                </div>
              )}

              {features.liveEvents && (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={c.typeFilterLabel}>
                  <button
                    type="button"
                    aria-pressed={selectedType === 'all'}
                    onClick={() => onSelectType('all')}
                    data-testid="events-filter-all"
                    className={pillClass(selectedType === 'all')}
                  >
                    {c.types.all}
                  </button>
                  {EVENT_CALENDAR_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={selectedType === type}
                      onClick={() => onSelectType(type)}
                      data-testid={`events-filter-${type}`}
                      className={pillClass(selectedType === type)}
                    >
                      {c.types[type]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        {loadFailed ? (
          <section className="pb-b pb-w-content pb-t-raised pb-a-start pb-s-m" role="alert" data-testid="events-error">
            <div className="pb-in flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[var(--fanous-color-text-primary)]">{c.loadError}</p>
              <button
                type="button"
                onClick={() => void reload(selectedType, subscribedOnly)}
                className={flatBtnClass}
              >
                {c.retry}
              </button>
            </div>
          </section>
        ) : items.length === 0 && !loading ? (
          <section className="pb-b pb-w-content pb-t-raised pb-a-start pb-s-m" data-testid="events-empty">
            <div className="pb-in space-y-1">
              <h2 className="text-base font-semibold text-[var(--fanous-color-text-primary)]">{c.emptyTitle}</h2>
              <p className="text-sm text-[var(--fanous-color-text-secondary)]">{c.emptyDescription}</p>
            </div>
          </section>
        ) : (
          <div className="contents" data-testid="events-list">
            {items.map((ev) => {
              const schedule = formatEventSchedule(ev.scheduledStartAt ?? ev.startedAt, locale, displayTimeZone);
              const typeBadge = eventTypeLabel(ev.eventType, locale);
              const channelDisplay = locale === 'ar' && ev.channelNameAr ? ev.channelNameAr : ev.channelName;
              const channelHref = ev.channelHandle
                ? `/${locale}/@${ev.channelHandle.replace(/^@/, '')}`
                : `/${locale}/channels/${ev.channelId}`;
              const watchHref = `/${locale}${ev.watchPath.startsWith('/') ? ev.watchPath : `/${ev.watchPath}`}`;
              const isLive = ev.status === 'live';

              return (
                <article
                  key={ev.streamId}
                  data-testid="event-card"
                  data-stream-id={ev.streamId}
                  className="pb-b pb-w-content pb-t-raised pb-a-start pb-s-m"
                >
                  <div className="pb-in flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                      <span
                        data-testid="event-status-badge"
                        className={
                          isLive
                            ? 'inline-flex items-center gap-1.5 rounded-full bg-[var(--fanous-color-error-fill)] px-2.5 py-0.5 font-semibold text-[var(--fanous-color-on-error-fill)]'
                            : 'inline-flex items-center gap-1.5 rounded-full border border-[var(--fanous-color-outline)] px-2.5 py-0.5 text-[var(--fanous-color-text-primary)]'
                        }
                      >
                        <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                        {isLive ? c.statusLive : c.statusScheduled}
                      </span>
                      <span className="rounded-full border border-[var(--fanous-color-divider)] px-2.5 py-0.5 text-[var(--fanous-color-text-secondary)]">
                        {ev.kind === 'premiere' ? c.kindPremiere : c.kindLive}
                      </span>
                      {typeBadge && (
                        <span
                          data-testid="event-type-badge"
                          className="rounded-full border border-[var(--fanous-color-accent)] px-2.5 py-0.5 text-[var(--fanous-color-accent)]"
                        >
                          {typeBadge}
                        </span>
                      )}
                    </div>

                    {schedule && (
                      <p
                        data-testid="event-schedule-line"
                        className="text-sm font-medium text-[var(--fanous-color-accent)]"
                      >
                        <span data-testid="event-date-gregorian">{schedule.gregorian}</span>
                        <span>{separator}</span>
                        <span data-testid="event-date-hijri">{schedule.hijri}</span>
                        <span>{separator}</span>
                        <span data-testid="event-time">{schedule.time}</span>
                      </p>
                    )}

                    <div className="space-y-1">
                      <h2 className="text-lg font-semibold text-[var(--fanous-color-text-primary)]">
                        <Link href={watchHref} className="hover:underline">
                          <bdi>{ev.title}</bdi>
                        </Link>
                      </h2>
                      {ev.description && (
                        <p className="line-clamp-2 text-sm text-[var(--fanous-color-text-secondary)]">
                          <bdi>{ev.description}</bdi>
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--fanous-color-divider)] pt-3">
                      <Link
                        href={channelHref}
                        data-testid="event-channel-link"
                        className="text-sm font-medium text-[var(--fanous-color-text-primary)] hover:text-[var(--fanous-color-accent)] transition-colors"
                      >
                        <bdi>{channelDisplay}</bdi>
                      </Link>

                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={watchHref}
                          data-testid="event-watch-link"
                          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--aun-btn-filled-bg)] px-4 py-1.5 text-sm font-semibold text-[var(--aun-btn-filled-fg)] transition-opacity hover:opacity-90"
                        >
                          <Play className="h-4 w-4" aria-hidden="true" />
                          <span>{isLive ? c.watchNow : c.openEvent}</span>
                        </Link>

                        {user && !isLive && features.liveReminders && (
                          <button
                            type="button"
                            disabled={pendingReminderId === ev.streamId}
                            aria-pressed={ev.viewerReminded}
                            onClick={() => void toggleReminder(ev)}
                            data-testid="event-remind-btn"
                            className={flatBtnClass}
                          >
                            {ev.viewerReminded ? (
                              <BellRing className="h-4 w-4 text-[var(--fanous-color-accent)]" aria-hidden="true" />
                            ) : (
                              <Bell className="h-4 w-4" aria-hidden="true" />
                            )}
                            <span>{ev.viewerReminded ? c.reminded : c.notifyMe}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => void shareEvent(ev)}
                          data-testid="event-share-btn"
                          className={flatBtnClass}
                        >
                          {copiedEventId === ev.streamId ? (
                            <Check className="h-4 w-4 text-[var(--fanous-color-accent)]" aria-hidden="true" />
                          ) : (
                            <Share2 className="h-4 w-4" aria-hidden="true" />
                          )}
                          <span>{copiedEventId === ev.streamId ? c.copiedShortLink : c.shareShortLink}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {nextCursor && (
          <div className="pb-b pb-w-content pb-a-start pb-s-s flex justify-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void onLoadMore()}
              data-testid="events-load-more"
              className={flatBtnClass}
            >
              {c.loadMore}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

export default EventsCalendarPage;
