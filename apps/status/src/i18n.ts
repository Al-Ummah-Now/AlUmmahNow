/** Public status page text, en + ar. Status and component names come from @al-ummah/shared-types. */
import { STATUS_COMPONENTS, STATUS_LABELS, type ComponentState, type IncidentStatus } from '@al-ummah/shared-types';

export type Locale = 'en' | 'ar';

const en = {
  siteName: 'Al Ummah Now',
  title: 'Status',
  pageTitle: 'Al Ummah Now status',
  description: 'Live status of Al Ummah Now: the website, videos, sign-in, uploads, playback and more.',
  skip: 'Skip to content',
  overall_operational: 'All systems operational',
  overall_maintenance: 'Maintenance in progress',
  overall_degraded: 'Some systems are slow',
  overall_partial: 'Some systems are having problems',
  overall_major: 'Major outage',
  lastChecked: 'Last checked {time}',
  noData: 'Waiting for the first checks',
  components: 'Components',
  uptimeTitle: 'Uptime over the last 90 days',
  uptimeValue: '{value}% uptime',
  uptimeNone: 'No data yet',
  daysAgo: '90 days ago',
  daysAgo30: '30 days ago',
  today: 'Today',
  dayNoData: '{day}: no data',
  dayUptime: '{day}: {state}, {value}% uptime',
  dayState: '{day}: {state}',
  active: 'Active incidents',
  maintenanceNow: 'Maintenance in progress',
  upcoming: 'Scheduled maintenance',
  history: 'Past incidents',
  historyNone: 'No incidents in the last 14 days.',
  affected: 'Affected: {list}',
  window: '{from} to {to}',
  from: 'From {from}',
  updatedAt: 'Updated {time}',
  postedAt: 'Posted {time}',
  resolvedAt: 'Resolved {time}',
  readMore: 'Details',
  back: 'Back to status',
  feeds: 'Follow updates',
  atom: 'Atom feed',
  rss: 'RSS feed',
  json: 'JSON',
  darkMode: 'Dark mode',
  otherLanguage: 'العربية',
  otherLanguageLabel: 'Arabic',
  footerNote: 'This page runs separately from the services it watches, so it stays up when they are down.',
  notFound: 'Incident not found',
  notFoundBody: 'It may have been removed.',
  incident: 'Incident',
  maintenance: 'Maintenance',
} as const;

type Messages = Record<keyof typeof en, string>;

const ar: Messages = {
  siteName: 'الأمة الآن',
  title: 'الحالة',
  pageTitle: 'حالة خدمات الأمة الآن',
  description: 'الحالة المباشرة لخدمات الأمة الآن: الموقع والمرئيات وتسجيل الدخول والرفع والتشغيل وغيرها.',
  skip: 'انتقل إلى المحتوى',
  overall_operational: 'جميع الخدمات تعمل',
  overall_maintenance: 'صيانة جارية',
  overall_degraded: 'بعض الخدمات بطيئة',
  overall_partial: 'بعض الخدمات تواجه مشكلات',
  overall_major: 'انقطاع كبير',
  lastChecked: 'آخر فحص {time}',
  noData: 'بانتظار أول فحص',
  components: 'الخدمات',
  uptimeTitle: 'نسبة التشغيل خلال آخر ٩٠ يومًا',
  uptimeValue: 'نسبة التشغيل {value}٪',
  uptimeNone: 'لا توجد بيانات بعد',
  daysAgo: 'قبل ٩٠ يومًا',
  daysAgo30: 'قبل ٣٠ يومًا',
  today: 'اليوم',
  dayNoData: '{day}: لا توجد بيانات',
  dayUptime: '{day}: {state}، نسبة التشغيل {value}٪',
  dayState: '{day}: {state}',
  active: 'حوادث جارية',
  maintenanceNow: 'صيانة جارية',
  upcoming: 'صيانة مجدولة',
  history: 'الحوادث السابقة',
  historyNone: 'لا حوادث خلال آخر ١٤ يومًا.',
  affected: 'الخدمات المتأثرة: {list}',
  window: 'من {from} إلى {to}',
  from: 'ابتداءً من {from}',
  updatedAt: 'حُدّث {time}',
  postedAt: 'نُشر {time}',
  resolvedAt: 'حُلّ {time}',
  readMore: 'التفاصيل',
  back: 'العودة إلى الحالة',
  feeds: 'تابع التحديثات',
  atom: 'موجز Atom',
  rss: 'موجز RSS',
  json: 'JSON',
  darkMode: 'الوضع الداكن',
  otherLanguage: 'English',
  otherLanguageLabel: 'الإنجليزية',
  footerNote: 'تعمل هذه الصفحة بمعزل عن الخدمات التي تراقبها، فتبقى متاحة حين تتعطل.',
  notFound: 'الحادثة غير موجودة',
  notFoundBody: 'ربما حُذفت.',
  incident: 'حادثة',
  maintenance: 'صيانة',
};

const MESSAGES: Record<Locale, Messages> = { en, ar };

export type MessageKey = keyof typeof en;

export function t(locale: Locale, key: MessageKey, vars: Record<string, string> = {}): string {
  return MESSAGES[locale][key].replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

export function stateLabel(locale: Locale, s: ComponentState | IncidentStatus | 'none'): string {
  return STATUS_LABELS[s][locale];
}

export function componentName(locale: Locale, id: string): string {
  return STATUS_COMPONENTS.find((c) => c.id === id)?.[locale] ?? id;
}

export function formatTime(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso)) + (locale === 'ar' ? ' (ت.ع.م)' : ' UTC');
}

export function formatDay(locale: Locale, day: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

export function formatPercent(locale: Locale, value: string): string {
  return locale === 'ar' ? Number(value).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value;
}
