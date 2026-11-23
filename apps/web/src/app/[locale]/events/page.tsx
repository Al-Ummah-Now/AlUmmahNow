import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventsCalendarPage } from '@/components/events/EventsCalendarPage';
import { EVENTS_COPY } from '@/lib/events/events-copy';
import { loadInitialEvents } from '@/lib/events/load-events-server';

/**
 * Upcoming Online Events Calendar (`/[locale]/events`, Epic 22 E22-S6 & E22-D7).
 *
 * Read per request: while `eventCalendar` is off, `GET /api/events` answers 404 and
 * this route calls `notFound()`.
 */
export const dynamic = 'force-dynamic';

const langOf = (locale: string): 'en' | 'ar' => (locale === 'ar' ? 'ar' : 'en');

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const c = EVENTS_COPY[langOf((await params).locale)];
  return { title: c.title, description: c.lead };
}

export default async function EventsRoute({ params }: { params: Promise<{ locale: string }> }) {
  const locale = langOf((await params).locale);
  const result = await loadInitialEvents();
  if (result.status === 'off') notFound();
  return (
    <EventsCalendarPage
      locale={locale}
      initialItems={result.items}
      initialCursor={result.nextCursor}
      initialError={result.status === 'error'}
    />
  );
}
