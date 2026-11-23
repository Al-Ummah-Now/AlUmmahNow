/**
 * Bilingual copy & dual Gregorian + Hijri date/time formatting for the online Event Calendar
 * (Epic 22, E22-S6 & E22-D7).
 *
 * Formatting rules:
 * - Arabic uses Eastern Arabic digits (`٠–٩`) via `@al-ummah/shared-types` `dateTimeFormat` and
 *   `numberFormat(..., { useGrouping: false })` (O35, O38).
 * - Arabic uses «،» commas and «مرئي / مرئيات» terminology (never «فيديو»).
 */
import { dateTimeFormat, metaSeparator, numberFormat, type EventCalendarType } from '@al-ummah/shared-types';
import { gregorianToHijri, getHijriMonthName } from '@/components/calendar/utils/hijriConverter';

export interface EventsLocaleCopy {
  title: string;
  lead: string;
  subscribeIcs: string;
  copyCalendarLink: string;
  copiedCalendarLink: string;
  scopeLabel: string;
  allChannels: string;
  subscribedChannels: string;
  typeFilterLabel: string;
  types: {
    all: string;
    jumuah: string;
    taraweeh: string;
    conference: string;
    halqa: string;
  };
  statusLive: string;
  statusScheduled: string;
  kindPremiere: string;
  kindLive: string;
  watchNow: string;
  openEvent: string;
  notifyMe: string;
  reminded: string;
  shareShortLink: string;
  copiedShortLink: string;
  emptyTitle: string;
  emptyDescription: string;
  loadError: string;
  retry: string;
  loadMore: string;
  channelScheduleHeading: string;
  channelScheduleViewAll: string;
  channelIcsLabel: string;
}

export const EVENTS_COPY: Record<'en' | 'ar', EventsLocaleCopy> = {
  en: {
    title: 'Upcoming Events',
    lead: 'Scheduled live streams, premieres, Jumu’ah khutbahs, Taraweeh, conferences, and halqas across channels.',
    subscribeIcs: 'Subscribe (.ics)',
    copyCalendarLink: 'Copy calendar link',
    copiedCalendarLink: 'Calendar URL copied',
    scopeLabel: 'Channels',
    allChannels: 'All channels',
    subscribedChannels: 'Subscribed',
    typeFilterLabel: 'Event type',
    types: {
      all: 'All events',
      jumuah: "Jumu'ah",
      taraweeh: 'Taraweeh',
      conference: 'Conferences',
      halqa: 'Halqas',
    },
    statusLive: 'Live now',
    statusScheduled: 'Upcoming',
    kindPremiere: 'Premiere',
    kindLive: 'Live stream',
    watchNow: 'Watch live',
    openEvent: 'Open event',
    notifyMe: 'Notify me',
    reminded: 'Reminder on',
    shareShortLink: 'Copy link',
    copiedShortLink: 'Link copied',
    emptyTitle: 'No upcoming online events right now',
    emptyDescription: 'When channels schedule live streams, premieres, or community events, they appear here with Gregorian and Hijri dates.',
    loadError: 'Could not load upcoming events right now.',
    retry: 'Try again',
    loadMore: 'Show more events',
    channelScheduleHeading: 'Upcoming online schedule',
    channelScheduleViewAll: 'All platform events',
    channelIcsLabel: 'Channel calendar (.ics)',
  },
  ar: {
    title: 'الفعاليات القادمة',
    lead: 'تابع مواعيد البث المباشر والعروض الأولى للمرئيات، وخطب الجمعة والتراويح والمؤتمرات وحلقات العلم عبر القنوات.',
    subscribeIcs: 'الاشتراك (ملف تقويم)',
    copyCalendarLink: 'نسخ رابط التقويم',
    copiedCalendarLink: 'نُسخ رابط التقويم',
    scopeLabel: 'القنوات',
    allChannels: 'كل القنوات',
    subscribedChannels: 'القنوات المشترك فيها',
    typeFilterLabel: 'نوع الفعالية',
    types: {
      all: 'كل الفعاليات',
      jumuah: 'الجمعة',
      taraweeh: 'التراويح',
      conference: 'المؤتمرات',
      halqa: 'الحلقات',
    },
    statusLive: 'مباشر الآن',
    statusScheduled: 'قادمة',
    kindPremiere: 'عرض أول',
    kindLive: 'بث مباشر',
    watchNow: 'شاهد البث',
    openEvent: 'فتح الفعالية',
    notifyMe: 'نبّهني',
    reminded: 'التذكير مفعّل',
    shareShortLink: 'نسخ الرابط',
    copiedShortLink: 'نُسخ الرابط',
    emptyTitle: 'لا توجد فعاليات قادمة حاليًّا',
    emptyDescription: 'تظهر هنا مواعيد الفعاليات التي تجدولها القنوات بالتاريخين الميلادي والهجري.',
    loadError: 'تعذّر تحميل الفعاليات القادمة حاليًّا.',
    retry: 'إعادة المحاولة',
    loadMore: 'عرض المزيد من الفعاليات',
    channelScheduleHeading: 'فعاليات القناة القادمة',
    channelScheduleViewAll: 'كل الفعاليات',
    channelIcsLabel: 'تقويم القناة',
  },
};

export interface FormattedEventSchedule {
  gregorian: string;
  hijri: string;
  time: string;
  combined: string;
}

/**
 * Formats an ISO timestamp into Gregorian date, Hijri date, and local time using the shared
 * locale formatters (Eastern Arabic digits `٠–٩` and ungrouped years in `ar`).
 */
export function formatEventSchedule(
  iso: string | null | undefined,
  locale: 'en' | 'ar',
  timeZone?: string,
): FormattedEventSchedule | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const fmtLocale = locale === 'ar' ? 'ar' : 'en-US';
  const tzOpt = timeZone ? { timeZone } : {};

  const gregorian = dateTimeFormat(fmtLocale, {
    ...tzOpt,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);

  const time = dateTimeFormat(fmtLocale, {
    ...tzOpt,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

  // Compute Hijri calendar date in target timezone (or UTC/local fallback)
  const parts = dateTimeFormat('en-CA', {
    ...tzOpt,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const gy = Number(parts.find((p) => p.type === 'year')?.value ?? date.getUTCFullYear());
  const gm = Number(parts.find((p) => p.type === 'month')?.value ?? date.getUTCMonth() + 1);
  const gd = Number(parts.find((p) => p.type === 'day')?.value ?? date.getUTCDate());
  const hijriRaw = gregorianToHijri(new Date(gy, gm - 1, gd));
  const numFmt = numberFormat(fmtLocale, { useGrouping: false });
  const hijriDay = numFmt.format(hijriRaw.day);
  const hijriYear = numFmt.format(hijriRaw.year);
  const hijriMonth = getHijriMonthName(hijriRaw.month, locale);
  const hijri = locale === 'ar' ? `${hijriDay} ${hijriMonth} ${hijriYear} هـ` : `${hijriDay} ${hijriMonth} ${hijriYear} AH`;

  const sep = metaSeparator(locale, '·');
  return {
    gregorian,
    hijri,
    time,
    combined: `${gregorian}${sep}${hijri}${sep}${time}`,
  };
}

export function eventTypeLabel(eventType: EventCalendarType | null | undefined, locale: 'en' | 'ar'): string | null {
  if (!eventType) return null;
  return EVENTS_COPY[locale].types[eventType] ?? null;
}
