'use client';

/**
 * Upcoming online schedule strip shown on a channel's Home and Live tabs when `features.eventCalendar`
 * is enabled AND the channel has at least one scheduled/live event (Epic 22, E22-S6).
 *
 * Strictly adheres to "Hidden when off": renders nothing (`null`) and makes zero requests when
 * `features.eventCalendar` is false, and renders nothing when the channel has zero upcoming events.
 */
import React, { useEffect, useState } from 'react';
import { Calendar, Radio } from 'lucide-react';
import type { CalendarEventItem } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { useFeatures } from '@/hooks/useFeatures';
import { useLanguage } from '@/hooks/useLanguage';
import { EventsService } from '@/services/api/events';
import { EVENTS_COPY, eventTypeLabel, formatEventSchedule } from '@/lib/events/events-copy';

interface ChannelUpcomingEventsProps {
  channelId: string;
}

export function ChannelUpcomingEvents({ channelId }: ChannelUpcomingEventsProps) {
  const { ready, features } = useFeatures();
  const { lang, dir } = useLanguage();
  const locale: 'en' | 'ar' = lang === 'ar' ? 'ar' : 'en';
  const c = EVENTS_COPY[locale];

  const [items, setItems] = useState<CalendarEventItem[]>([]);

  useEffect(() => {
    if (!ready || !features.eventCalendar) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void EventsService.list({ channelId, limit: 4 }).then((outcome) => {
      if (cancelled) return;
      if (outcome.status === 'ok') {
        setItems(outcome.items);
      } else {
        setItems([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [channelId, features.eventCalendar, ready]);

  if (!ready || !features.eventCalendar || items.length === 0) {
    return null;
  }

  return (
    <section
      dir={dir}
      data-testid="channel-upcoming-events"
      aria-label={c.channelScheduleHeading}
      className="mb-6 rounded-xl border border-[var(--fanous-color-divider)] bg-[var(--fanous-color-surface)] p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-[var(--fanous-color-accent)]" aria-hidden="true" />
          <h2 className="text-base font-semibold text-[var(--fanous-color-text-primary)]">
            {c.channelScheduleHeading}
          </h2>
        </div>
        <div className="flex items-center gap-3 text-xs font-medium">
          <a
            href={EventsService.icsUrl(channelId, locale)}
            download={`channel-${channelId}-events.ics`}
            data-testid="channel-events-ics"
            className="text-[var(--fanous-color-text-secondary)] hover:text-[var(--fanous-color-accent)]"
          >
            {c.channelIcsLabel}
          </a>
          <Link
            href={`/${locale}/events`}
            className="text-[var(--fanous-color-accent)] hover:underline"
          >
            {c.channelScheduleViewAll}
          </Link>
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((ev) => {
          const schedule = formatEventSchedule(ev.scheduledStartAt ?? ev.startedAt, locale);
          const badge = eventTypeLabel(ev.eventType, locale);
          const watchHref = `/${locale}${ev.watchPath.startsWith('/') ? ev.watchPath : `/${ev.watchPath}`}`;
          return (
            <li
              key={ev.streamId}
              data-testid="channel-upcoming-event-card"
              className="rounded-lg border border-[var(--fanous-color-divider)] p-3"
            >
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="inline-flex items-center gap-1 font-semibold text-[var(--fanous-color-accent)]">
                  <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                  {ev.status === 'live' ? c.statusLive : c.statusScheduled}
                </span>
                {badge && (
                  <span className="rounded-full border border-[var(--fanous-color-divider)] px-2 py-0.5 text-[var(--fanous-color-text-secondary)]">
                    {badge}
                  </span>
                )}
              </div>
              <Link href={watchHref} className="block text-sm font-semibold text-[var(--fanous-color-text-primary)] hover:underline">
                <bdi>{ev.title}</bdi>
              </Link>
              {schedule && (
                <p className="mt-1 text-xs text-[var(--fanous-color-text-secondary)]">{schedule.combined}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
